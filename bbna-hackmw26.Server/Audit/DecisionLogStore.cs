using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;

namespace bbna_hackmw26.Server.Audit
{
    // SQLite-backed decision log. decision_records holds the current state of each record;
    // audit_events is an append-only, hash-chained history that the state can be reconstructed from.
    public class DecisionLogStore
    {
        private const string Schema = """
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS decision_records (
                id                    TEXT PRIMARY KEY,
                facility_code         TEXT NOT NULL,
                facility_name         TEXT NOT NULL,
                status                TEXT NOT NULL CHECK (status IN ('AwaitingDecision', 'Decided')),
                recommended_status    TEXT NOT NULL CHECK (recommended_status IN ('Open', 'Closed')),
                recommendation_reason TEXT NOT NULL,
                ruleset_version       TEXT NOT NULL,
                final_status          TEXT CHECK (final_status IN ('Open', 'Closed')),
                action                TEXT CHECK (action IN ('Accepted', 'Overridden')),
                decided_by            TEXT,
                decided_at            TEXT,
                created_at            TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_decision_records_facility
                ON decision_records (facility_code, created_at DESC);

            CREATE TABLE IF NOT EXISTS audit_events (
                seq         INTEGER PRIMARY KEY AUTOINCREMENT,
                record_id   TEXT NOT NULL REFERENCES decision_records (id),
                occurred_at TEXT NOT NULL,
                kind        TEXT NOT NULL,
                actor       TEXT NOT NULL,
                title       TEXT NOT NULL,
                detail      TEXT NOT NULL,
                payload     TEXT,
                prev_hash   TEXT,
                hash        TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_audit_events_record ON audit_events (record_id, seq);

            CREATE TRIGGER IF NOT EXISTS audit_events_no_update BEFORE UPDATE ON audit_events
            BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

            CREATE TRIGGER IF NOT EXISTS audit_events_no_delete BEFORE DELETE ON audit_events
            BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

            CREATE TRIGGER IF NOT EXISTS decision_records_no_delete BEFORE DELETE ON decision_records
            BEGIN SELECT RAISE(ABORT, 'decision records cannot be deleted'); END;

            CREATE TRIGGER IF NOT EXISTS decision_records_final BEFORE UPDATE ON decision_records
            WHEN OLD.status = 'Decided'
            BEGIN SELECT RAISE(ABORT, 'decided records are immutable'); END;
            """;

        private const string RecordColumns = """
            id, facility_code, facility_name, status, recommended_status, recommendation_reason,
            ruleset_version, final_status, action, decided_by, decided_at, created_at
            """;

        private readonly string _connectionString;

        public DecisionLogStore(IOptions<AuditOptions> options, IWebHostEnvironment env)
        {
            var path = Path.GetFullPath(options.Value.DatabasePath, env.ContentRootPath);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            _connectionString = new SqliteConnectionStringBuilder
            {
                DataSource = path,
                ForeignKeys = true,
            }.ToString();
        }

        public void Initialize()
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = Schema;
            cmd.ExecuteNonQuery();
        }

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
                ("$rec", request.RecommendedStatus.ToString()), ("$reason", request.Reason),
                ("$ruleset", request.RulesetVersion), ("$now", Format(now)));

            var prev = await AppendEventAsync(conn, id, null, now, AuditEventKind.EvidenceCaptured, "system",
                "Automated evidence capture completed", request.Evidence.Summary,
                request.Evidence.Sources?.GetRawText(), ct);

            await AppendEventAsync(conn, id, prev, now, AuditEventKind.RecommendationGenerated, "rules-engine",
                "Rules engine generated recommendation",
                $"Recommended {request.RecommendedStatus} under ruleset {request.RulesetVersion}. {request.Reason}",
                JsonSerializer.Serialize(new { recommendedStatus = request.RecommendedStatus.ToString(), rulesetVersion = request.RulesetVersion }),
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

            var action = request.FinalStatus == record.RecommendedStatus ? DecisionAction.Accepted : DecisionAction.Overridden;
            var detail = action == DecisionAction.Accepted
                ? $"{CurrentUser} accepted the recommendation. Facility {request.FinalStatus}."
                : $"{CurrentUser} overrode the recommendation ({record.RecommendedStatus} → {request.FinalStatus}).";
            if (!string.IsNullOrWhiteSpace(request.Rationale)) detail += $" Rationale: {request.Rationale}";

            await ExecuteAsync(conn, """
                UPDATE decision_records
                SET status = 'Decided', final_status = $final, action = $action, decided_by = $by, decided_at = $now
                WHERE id = $id
                """, ct,
                ("$id", id), ("$final", request.FinalStatus.ToString()), ("$action", action.ToString()),
                ("$by", CurrentUser), ("$now", Format(now)));

            var prev = await ScalarAsync<string>(conn,
                "SELECT hash FROM audit_events WHERE record_id = $id ORDER BY seq DESC LIMIT 1", ct, ("$id", id));

            await AppendEventAsync(conn, id, prev, now, AuditEventKind.DecisionRecorded, CurrentUser,
                "Human decision recorded", detail,
                JsonSerializer.Serialize(new
                {
                    finalStatus = request.FinalStatus.ToString(),
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

            var events = new List<(AuditEvent Event, string RecordId, string OccurredAt, string? RawPayload)>();
            await using (var cmd = Command(conn, """
                SELECT seq, occurred_at, kind, actor, title, detail, payload, prev_hash, hash
                FROM audit_events WHERE record_id = $id ORDER BY seq
                """, ("$id", id)))
            await using (var reader = await cmd.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                {
                    var occurredAt = reader.GetString(1);
                    var payload = reader.IsDBNull(6) ? null : reader.GetString(6);
                    events.Add((new AuditEvent(
                        reader.GetInt64(0),
                        Parse(occurredAt),
                        reader.GetString(2),
                        reader.GetString(3),
                        reader.GetString(4),
                        reader.GetString(5),
                        payload is null ? null : JsonDocument.Parse(payload).RootElement.Clone(),
                        reader.IsDBNull(7) ? null : reader.GetString(7),
                        reader.GetString(8)), id, occurredAt, payload));
                }
            }

            return new DecisionRecordDetail(record, events.Select(e => e.Event).ToList(), Verify(events));
        }

        public async Task<IReadOnlyList<DecisionRecord>> ListAsync(string? facilityCode, int limit, CancellationToken ct)
        {
            await using var conn = Open();
            await using var cmd = Command(conn, $"""
                SELECT {RecordColumns} FROM decision_records
                WHERE $code IS NULL OR facility_code = $code
                ORDER BY created_at DESC LIMIT $limit
                """, ("$code", facilityCode), ("$limit", limit));
            await using var reader = await cmd.ExecuteReaderAsync(ct);

            var records = new List<DecisionRecord>();
            while (await reader.ReadAsync(ct)) records.Add(MapRecord(reader));
            return records;
        }

        // Re-derives each hash from the stored content and checks it links to the previous event.
        private static IntegrityResult Verify(
            List<(AuditEvent Event, string RecordId, string OccurredAt, string? RawPayload)> events)
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
            Enum.Parse<FacilityStatus>(r.GetString(4)),
            r.GetString(5),
            r.GetString(6),
            r.IsDBNull(7) ? null : Enum.Parse<FacilityStatus>(r.GetString(7)),
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
