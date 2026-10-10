using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;

namespace bbna_hackmw26.Server.Audit
{
    /// <summary>
    /// Creates the SQLite audit database once at app startup (called from Program.cs).
    ///
    /// What happens on startup:
    ///   - No database file yet          -> create it with the current schema.
    ///   - Database has the same schema  -> use it as-is (records are kept).
    ///   - Database has a different schema (someone changed the tables below)
    ///                                   -> back it up, drop it, and create a new one with the new schema.
    ///
    /// "Same schema" is decided automatically: the schema text below is hashed into a version number,
    /// which is stored inside the database file (SQLite's "user_version"). Editing the schema in any way
    /// changes the number, so nobody has to remember to bump a version by hand.
    /// </summary>
    public static class AuditDatabase
    {
        /// <summary>
        /// The database tables. Edit this to change the schema; the database is rebuilt on the next startup.
        ///   decision_records - the current state of each closure decision.
        ///   audit_events     - an append-only, hash-chained history each decision can be reconstructed from.
        /// The triggers stop the history being edited or deleted through SQL.
        /// </summary>
        public const string Schema = """
            CREATE TABLE decision_records (
                id                    TEXT PRIMARY KEY,
                facility_code         TEXT NOT NULL,
                facility_name         TEXT NOT NULL,
                status                TEXT NOT NULL CHECK (status IN ('AwaitingDecision', 'Decided')),
                recommended_posture   TEXT NOT NULL CHECK (recommended_posture IN ('Normal', 'Delay', 'EarlyDismissal', 'Telework', 'Closure')),
                recommendation_reason TEXT NOT NULL,
                ruleset_version       TEXT NOT NULL,
                final_posture         TEXT CHECK (final_posture IN ('Normal', 'Delay', 'EarlyDismissal', 'Telework', 'Closure')),
                action                TEXT CHECK (action IN ('Accepted', 'Overridden')),
                decided_by            TEXT,
                decided_at            TEXT,
                created_at            TEXT NOT NULL
            );
            CREATE INDEX ix_decision_records_facility
                ON decision_records (facility_code, created_at DESC);

            CREATE TABLE audit_events (
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
            CREATE INDEX ix_audit_events_record ON audit_events (record_id, seq);

            CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
            BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

            CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
            BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

            CREATE TRIGGER decision_records_no_delete BEFORE DELETE ON decision_records
            BEGIN SELECT RAISE(ABORT, 'decision records cannot be deleted'); END;

            CREATE TRIGGER decision_records_final BEFORE UPDATE ON decision_records
            WHEN OLD.status = 'Decided'
            BEGIN SELECT RAISE(ABORT, 'decided records are immutable'); END;
            """;

        /// <summary>
        /// Version number of the schema above: the first 4 bytes of a SHA-256 hash of its text,
        /// as a positive number. Any edit to the schema gives a different number.
        /// Line endings are normalised first, so Windows (CRLF) and Mac/Linux (LF) checkouts agree.
        /// </summary>
        public static readonly int SchemaVersion = ComputeVersion(Schema);

        /// <summary>The connection string the app uses for the database at the given path.</summary>
        public static string ConnectionString(string path) => new SqliteConnectionStringBuilder
        {
            DataSource = path,
            ForeignKeys = true,   // enforce the audit_events -> decision_records link
        }.ToString();

        /// <summary>
        /// Makes sure the database at <paramref name="path"/> exists with the current schema,
        /// rebuilding it if the schema has changed. Call once at startup, before the app serves requests.
        /// </summary>
        public static void EnsureCreated(string path, ILogger logger)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);

            // What's in the file right now? null = no database (or an empty one).
            var existingVersion = ReadSchemaVersion(path);

            if (existingVersion == SchemaVersion)
            {
                logger.LogInformation("Audit database {Path} is up to date (schema {Version}).", path, SchemaVersion);
                return;
            }

            if (existingVersion is not null)
            {
                // The schema changed: keep a copy of the old database, then drop it.
                var backupPath = BackupAndDelete(path, existingVersion.Value);
                logger.LogWarning(
                    "Audit database schema changed ({OldVersion} -> {NewVersion}). Old database backed up to {BackupPath} and recreated.",
                    existingVersion, SchemaVersion, backupPath);
            }

            Create(path);
            logger.LogInformation("Created audit database {Path} (schema {Version}).", path, SchemaVersion);
        }

        /// <summary>
        /// Reads the schema version stored in the database file. Returns null if there's no file,
        /// or the file has no tables yet (e.g. an empty file), since there's nothing to keep.
        /// </summary>
        private static int? ReadSchemaVersion(string path)
        {
            if (!File.Exists(path)) return null;

            // Pooling = false: close the file for real when we're done, so it can be moved/deleted afterwards.
            using var conn = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT (SELECT user_version FROM pragma_user_version),
                       (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%')
                """;
            using var reader = cmd.ExecuteReader();
            reader.Read();
            var version = reader.GetInt32(0);
            var tableCount = reader.GetInt64(1);
            return tableCount == 0 ? null : version;
        }

        /// <summary>
        /// Copies the old database to a backup file next to it, e.g. audit.db.schema-2.20261010-221500.bak,
        /// then deletes the original (and SQLite's -wal/-shm side files). Returns the backup's path.
        /// </summary>
        private static string BackupAndDelete(string path, int oldVersion)
        {
            var backupPath = $"{path}.schema-{oldVersion}.{DateTime.Now:yyyyMMdd-HHmmss}.bak";

            using (var conn = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString()))
            {
                conn.Open();
                using var cmd = conn.CreateCommand();
                // VACUUM INTO writes a complete, consistent copy, including changes still sitting in the -wal file.
                cmd.CommandText = "VACUUM INTO $backup";
                cmd.Parameters.AddWithValue("$backup", backupPath);
                cmd.ExecuteNonQuery();
            }

            // Drop the old database: the main file plus SQLite's write-ahead log and shared-memory files.
            foreach (var file in new[] { path, path + "-wal", path + "-shm" })
                File.Delete(file);   // no error if the file doesn't exist

            return backupPath;
        }

        /// <summary>Creates a fresh database with the current schema and stamps it with the schema version.</summary>
        private static void Create(string path)
        {
            using var conn = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
            conn.Open();
            using var tx = conn.BeginTransaction();
            using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            // All in one transaction: if any statement fails, no half-built database is left behind.
            cmd.CommandText = $"{Schema}\nPRAGMA user_version = {SchemaVersion};";
            cmd.ExecuteNonQuery();
            tx.Commit();

            // WAL mode lets the app read while it writes. It's saved in the file, so it only needs setting once.
            // (It can't be changed inside a transaction, hence a separate command.)
            using var wal = conn.CreateCommand();
            wal.CommandText = "PRAGMA journal_mode = WAL;";
            wal.ExecuteNonQuery();
        }

        /// <summary>Turns the schema text into a positive whole number (see <see cref="SchemaVersion"/>).</summary>
        private static int ComputeVersion(string schema)
        {
            var normalised = schema.Replace("\r\n", "\n").Trim();
            var hash = SHA256.HashData(Encoding.UTF8.GetBytes(normalised));
            var version = BitConverter.ToInt32(hash, 0) & int.MaxValue;   // & int.MaxValue = drop the sign bit
            return version == 0 ? 1 : version;                            // 0 is what a brand-new SQLite file reports
        }
    }
}
