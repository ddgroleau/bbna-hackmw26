using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace bbna_hackmw26.Server.Audit
{
    // SQLite-backed decision log. decision_records holds the current state of each record;
    // audit_events is an append-only, hash-chained history that the state can be reconstructed from.
    // The database itself (tables, schema changes) is set up once at startup by AuditDatabase, called from Program.cs;
    // this class only reads and writes records.
    public class DecisionLogStore(string connectionString)
    {
        private const string RecordColumns = """
            id, facility_code, facility_name, status, recommended_posture, recommendation_reason,
            ruleset_version, final_posture, action, decided_by, decided_at, created_at
            """;

        private readonly string _connectionString = connectionString;

        // Creates a record awaiting a human decision, logging the captured evidence and the rules engine recommendation.
        public async Task<DecisionRecordDetail> CreateAsync(
            string facilityCode, string facilityName, CreateDecisionRequest request, CancellationToken ct)
        {
            var now = DateTimeOffset.UtcNow;
            await using var conn = Open();
            // Microsoft.Data.Sqlite transactions are BEGIN IMMEDIATE, so the daily sequence below can't race.
            await using var tx = conn.BeginTransaction();

            var id = await NextRecordIdAsync(conn, facilityCode, now, ct);

            await ExecuteAsync(conn, $"""
                INSERT INTO decision_records ({RecordColumns})
                VALUES ($id, $code, $name, 'AwaitingDecision', $rec, $reason, $ruleset, NULL, NULL, NULL, NULL, $now)
                """, ct,
                ("$id", id), ("$code", facilityCode), ("$name", facilityName),
                ("$rec", request.RecommendedPosture.ToString()), ("$reason", request.Reason),
                ("$ruleset", request.RulesetVersion), ("$now", Format(now)));

            var prev = await AppendEventAsync(conn, id, null, now, AuditEventKind.EvidenceCaptured, "system",
                "Automated evidence capture completed", request.Evidence.Summary,
                request.Evidence.Sources?.GetRawText(), ct);

            await AppendEventAsync(conn, id, prev, now, AuditEventKind.RecommendationGenerated, "rules-engine",
                "Rules engine generated recommendation",
                $"Recommended {request.RecommendedPosture.Label().ToLowerInvariant()} under ruleset {request.RulesetVersion}. {request.Reason}",
                JsonSerializer.Serialize(new { recommendedPosture = request.RecommendedPosture.ToString(), rulesetVersion = request.RulesetVersion }),
                ct);

            await tx.CommitAsync(ct);
            return (await GetAsync(id, ct))!;
        }

        // There is no login: whoever is viewing the record makes the decision, so they are logged as CurrentUser.
        // The client's IP and user agent are kept in the payload as the only trace of where the decision came from.
        public const string CurrentUser = "Current user";

        // Returns false when the record is missing or was already decided.
        public async Task<bool> RecordDecisionAsync(
            string id, RecordDecisionRequest request, ClientInfo client, CancellationToken ct)
        {
            var now = DateTimeOffset.UtcNow;
            await using var conn = Open();
            await using var tx = conn.BeginTransaction();

            var record = await ReadRecordAsync(conn, id, ct);
            if (record is null || record.Status != DecisionStatus.AwaitingDecision) return false;

            var action = request.FinalPosture == record.RecommendedPosture ? DecisionAction.Accepted : DecisionAction.Overridden;
            var detail = action == DecisionAction.Accepted
                ? $"{CurrentUser} accepted the recommendation: {request.FinalPosture.Label().ToLowerInvariant()}."
                : $"{CurrentUser} overrode the recommendation ({record.RecommendedPosture.Label()} → {request.FinalPosture.Label()}).";
            if (!string.IsNullOrWhiteSpace(request.Rationale)) detail += $" Rationale: {request.Rationale}";

            await ExecuteAsync(conn, """
                UPDATE decision_records
                SET status = 'Decided', final_posture = $final, action = $action, decided_by = $by, decided_at = $now
                WHERE id = $id
                """, ct,
                ("$id", id), ("$final", request.FinalPosture.ToString()), ("$action", action.ToString()),
                ("$by", CurrentUser), ("$now", Format(now)));

            var prev = await ScalarAsync<string>(conn,
                "SELECT hash FROM audit_events WHERE record_id = $id ORDER BY seq DESC LIMIT 1", ct, ("$id", id));

            await AppendEventAsync(conn, id, prev, now, AuditEventKind.DecisionRecorded, CurrentUser,
                "Human decision recorded", detail,
                JsonSerializer.Serialize(new
                {
                    finalPosture = request.FinalPosture.ToString(),
                    action = action.ToString(),
                    rationale = request.Rationale,
                    client = new { ipAddress = client.IpAddress, userAgent = client.UserAgent },
                }),
                ct);

            await tx.CommitAsync(ct);
            return true;
        }

        public async Task<DecisionRecordDetail?> GetAsync(string id, CancellationToken ct)
        {
            await using var conn = Open();
            var record = await ReadRecordAsync(conn, id, ct);
            if (record is null) return null;

            var events = await ReadEventsAsync(conn, id, ct);
            return Detail(record, events.GetValueOrDefault(id, []));
        }

        // Every record with its full event history, newest record first.
        public async Task<IReadOnlyList<DecisionRecordDetail>> ListAllAsync(CancellationToken ct)
        {
            await using var conn = Open();
            var records = new List<DecisionRecord>();
            await using (var cmd = Command(conn, $"""
                SELECT {RecordColumns} FROM decision_records ORDER BY created_at DESC, id DESC
                """))
            await using (var reader = await cmd.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct)) records.Add(MapRecord(reader));
            }

            var events = await ReadEventsAsync(conn, null, ct);
            return records.Select(r => Detail(r, events.GetValueOrDefault(r.Id, []))).ToList();
        }

        private static DecisionRecordDetail Detail(DecisionRecord record, List<StoredEvent> events)
            => new(record, events.Select(e => e.Event).ToList(), Verify(events));

        // The raw occurred_at and payload strings are kept alongside each event because the hash covers them exactly.
        private record StoredEvent(AuditEvent Event, string RecordId, string OccurredAt, string? RawPayload);

        // Events grouped by record in sequence order; a null recordId reads every record's events.
        private static async Task<Dictionary<string, List<StoredEvent>>> ReadEventsAsync(
            SqliteConnection conn, string? recordId, CancellationToken ct)
        {
            var events = new Dictionary<string, List<StoredEvent>>();
            await using var cmd = Command(conn, """
                SELECT seq, occurred_at, kind, actor, title, detail, payload, prev_hash, hash, record_id
                FROM audit_events WHERE $id IS NULL OR record_id = $id ORDER BY seq
                """, ("$id", recordId));
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var id = reader.GetString(9);
                var occurredAt = reader.GetString(1);
                var payload = reader.IsDBNull(6) ? null : reader.GetString(6);
                var stored = new StoredEvent(new AuditEvent(
                    reader.GetInt64(0),
                    Parse(occurredAt),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetString(4),
                    reader.GetString(5),
                    payload is null ? null : JsonDocument.Parse(payload).RootElement.Clone(),
                    reader.IsDBNull(7) ? null : reader.GetString(7),
                    reader.GetString(8)), id, occurredAt, payload);

                if (!events.TryGetValue(id, out var list)) events[id] = list = [];
                list.Add(stored);
            }
            return events;
        }

        // Re-derives each hash from the stored content and checks it links to the previous event.
        private static IntegrityResult Verify(List<StoredEvent> events)
        {
            string? expectedPrev = null;
            foreach (var (e, recordId, occurredAt, payload) in events)
            {
                var hash = ComputeHash(e.PrevHash, recordId, occurredAt, e.Kind, e.Actor, e.Title, e.Detail, payload);
                if (e.PrevHash != expectedPrev || e.Hash != hash)
                    return new IntegrityResult(false, events.Count, e.Seq);
                expectedPrev = e.Hash;
            }
            return new IntegrityResult(true, events.Count, null);
        }

        private static async Task<string> AppendEventAsync(
            SqliteConnection conn, string recordId, string? prevHash, DateTimeOffset at, string kind, string actor,
            string title, string detail, string? payload, CancellationToken ct)
        {
            var occurredAt = Format(at);
            var hash = ComputeHash(prevHash, recordId, occurredAt, kind, actor, title, detail, payload);
            await ExecuteAsync(conn, """
                INSERT INTO audit_events (record_id, occurred_at, kind, actor, title, detail, payload, prev_hash, hash)
                VALUES ($record, $at, $kind, $actor, $title, $detail, $payload, $prev, $hash)
                """, ct,
                ("$record", recordId), ("$at", occurredAt), ("$kind", kind), ("$actor", actor), ("$title", title),
                ("$detail", detail), ("$payload", payload), ("$prev", prevHash), ("$hash", hash));
            return hash;
        }

        // Serializing the fields as a JSON array keeps field boundaries unambiguous.
        private static string ComputeHash(
            string? prevHash, string recordId, string occurredAt, string kind, string actor,
            string title, string detail, string? payload)
        {
            var canonical = JsonSerializer.Serialize(new[] { prevHash, recordId, occurredAt, kind, actor, title, detail, payload });
            return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
        }

        // IDs look like DSM-2026-1010-0001: facility code, UTC date, then a per-facility daily sequence.
        private static async Task<string> NextRecordIdAsync(
            SqliteConnection conn, string facilityCode, DateTimeOffset now, CancellationToken ct)
        {
            var prefix = $"{facilityCode}-{now:yyyy}-{now:MMdd}-";
            var count = await ScalarAsync<long>(conn,
                "SELECT COUNT(*) FROM decision_records WHERE substr(id, 1, length($prefix)) = $prefix", ct, ("$prefix", prefix));
            return $"{prefix}{count + 1:0000}";
        }

        private static async Task<DecisionRecord?> ReadRecordAsync(SqliteConnection conn, string id, CancellationToken ct)
        {
            await using var cmd = Command(conn, $"SELECT {RecordColumns} FROM decision_records WHERE id = $id", ("$id", id));
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            return await reader.ReadAsync(ct) ? MapRecord(reader) : null;
        }

        private static DecisionRecord MapRecord(SqliteDataReader r) => new(
            r.GetString(0),
            r.GetString(1),
            r.GetString(2),
            Enum.Parse<DecisionStatus>(r.GetString(3)),
            Enum.Parse<Posture>(r.GetString(4)),
            r.GetString(5),
            r.GetString(6),
            r.IsDBNull(7) ? null : Enum.Parse<Posture>(r.GetString(7)),
            r.IsDBNull(8) ? null : Enum.Parse<DecisionAction>(r.GetString(8)),
            r.IsDBNull(9) ? null : r.GetString(9),
            r.IsDBNull(10) ? null : Parse(r.GetString(10)),
            Parse(r.GetString(11)));

        private SqliteConnection Open()
        {
            var conn = new SqliteConnection(_connectionString);
            conn.Open();
            return conn;
        }

        private static SqliteCommand Command(SqliteConnection conn, string sql, params (string Name, object? Value)[] args)
        {
            var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
            return cmd;
        }

        private static async Task ExecuteAsync(
            SqliteConnection conn, string sql, CancellationToken ct, params (string, object?)[] args)
        {
            await using var cmd = Command(conn, sql, args);
            await cmd.ExecuteNonQueryAsync(ct);
        }

        private static async Task<T?> ScalarAsync<T>(
            SqliteConnection conn, string sql, CancellationToken ct, params (string, object?)[] args)
        {
            await using var cmd = Command(conn, sql, args);
            var result = await cmd.ExecuteScalarAsync(ct);
            return result is null or DBNull ? default : (T)result;
        }

        private static string Format(DateTimeOffset value) => value.ToString("O", CultureInfo.InvariantCulture);

        private static DateTimeOffset Parse(string value) => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture);
    }
}
