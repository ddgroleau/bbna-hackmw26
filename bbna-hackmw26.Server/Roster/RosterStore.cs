using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Data.Sqlite;

namespace bbna_hackmw26.Server.Roster
{
    // The facility roster lives in the employees table of the app's SQLite database (created by AuditDatabase).
    // Seed() reloads it from MockData/employees.json at startup; Summarize() works out who gets notified from
    // those rows. The summary is the "people" block of /api/situation, which the client and the agent both read.
    public class RosterStore(string connectionString)
    {
        private static readonly JsonSerializerOptions SeedJson = new(JsonSerializerDefaults.Web)
        {
            Converters = { new JsonStringEnumConverter() },
        };

        private readonly string _connectionString = connectionString;

        // Replaces the employees table with the seed file, so edits to the file show up on the next startup.
        // Returns the number of employees loaded.
        public int Seed(string seedPath)
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(seedPath));
            var employees = doc.RootElement.GetProperty("employees").Deserialize<List<Employee>>(SeedJson)!;

            using var conn = Open();
            using var tx = conn.BeginTransaction();
            using (var clear = conn.CreateCommand())
            {
                clear.CommandText = "DELETE FROM employees";
                clear.ExecuteNonQuery();
            }

            using var insert = conn.CreateCommand();
            insert.CommandText = """
                INSERT INTO employees (id, name, role, assignment, status, accommodation)
                VALUES ($id, $name, $role, $assignment, $status, $accommodation)
                """;
            foreach (var e in employees)
            {
                insert.Parameters.Clear();
                insert.Parameters.AddWithValue("$id", e.Id);
                insert.Parameters.AddWithValue("$name", e.Name);
                insert.Parameters.AddWithValue("$role", e.Role);
                insert.Parameters.AddWithValue("$assignment", e.Assignment.ToString());
                insert.Parameters.AddWithValue("$status", e.Status.ToString());
                insert.Parameters.AddWithValue("$accommodation", (object?)e.Accommodation?.ToString() ?? DBNull.Value);
                insert.ExecuteNonQuery();
            }

            tx.Commit();
            return employees.Count;
        }

        public IReadOnlyList<Employee> GetEmployees()
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT id, name, role, assignment, status, accommodation FROM employees ORDER BY id";
            using var reader = cmd.ExecuteReader();

            var employees = new List<Employee>();
            while (reader.Read())
            {
                employees.Add(new Employee(
                    reader.GetString(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    Enum.Parse<Assignment>(reader.GetString(3)),
                    Enum.Parse<EmployeeStatus>(reader.GetString(4)),
                    reader.IsDBNull(5) ? null : Enum.Parse<Accommodation>(reader.GetString(5))));
            }
            return employees;
        }

        // The headline counts the sidebar shows for the facility.
        public static FacilityPopulation Population(IReadOnlyList<Employee> employees) => new(
            employees.Count,
            employees.Count(e => e.Assignment == Assignment.Essential),
            employees.Count(e => e.Assignment == Assignment.TeleworkReady));

        // Who gets notified: everyone assigned to the office except those on leave or travel today.
        public static PeopleSummary Summarize(IReadOnlyList<Employee> employees)
        {
            var included = employees.Where(e => e.Status == EmployeeStatus.Active).ToList();
            var onLeave = employees.Count(e => e.Status == EmployeeStatus.Leave);
            var onTravel = employees.Count(e => e.Status == EmployeeStatus.Travel);

            var steps = new List<ResolutionStep>
            {
                new($"{employees.Count} employees assigned to office", "Agency HR roster", employees.Count),
            };
            if (onLeave > 0) steps.Add(new($"{onLeave} on approved leave", "No commute impact", -onLeave));
            if (onTravel > 0) steps.Add(new($"{onTravel} on official travel", "Different duty location", -onTravel));
            steps.Add(new($"{included.Count} final recipients", "Each gets the message for their assignment", included.Count, true));

            var essential = included.Count(e => e.Assignment == Assignment.Essential);
            var audiences = new AudienceCounts(
                included.Count(e => e.Assignment == Assignment.TeleworkReady),
                included.Count(e => e.Assignment == Assignment.OnSite),
                essential);

            // A few representative rows for the recipient review table: two essential, one of each other
            // group, and one of each exclusion.
            var sample = included.Where(e => e.Assignment == Assignment.Essential).Take(2)
                .Concat(included.Where(e => e.Assignment == Assignment.TeleworkReady).Take(1))
                .Concat(included.Where(e => e.Assignment == Assignment.OnSite).Take(1))
                .Concat(employees.Where(e => e.Status == EmployeeStatus.Leave).Take(1))
                .Concat(employees.Where(e => e.Status == EmployeeStatus.Travel).Take(1))
                .Select(e => new SampleRecord(e.Name, e.Role, Logic(e), Routing(e), e.Status == EmployeeStatus.Active))
                .ToList();

            return new PeopleSummary(
                "Fictional people for a demo, read from the employees table.",
                "Roster resolved against today's leave and travel records.",
                new StaffSummary(employees.Count, included.Count, employees.Count - included.Count, essential, steps),
                audiences,
                new AccessibilityNote("Accessibility routing", AccessibilityDetail(included)),
                sample);
        }

        private static string Logic(Employee e) => e.Status switch
        {
            EmployeeStatus.Leave => "Approved leave",
            EmployeeStatus.Travel => "On official travel",
            _ => e.Assignment switch
            {
                Assignment.Essential => "Essential personnel",
                Assignment.TeleworkReady => "Telework-ready",
                _ => "On-site only",
            },
        };

        private static string[] Routing(Employee e)
        {
            if (e.Status != EmployeeStatus.Active) return [];
            if (e.Accommodation == Accommodation.TextFirst) return ["SMS", "Email"];
            if (e.Accommodation == Accommodation.Relay) return ["SMS", "Relay", "Email"];
            return e.Assignment == Assignment.Essential ? ["SMS", "Voice", "Email"] : ["SMS", "Email"];
        }

        private static string AccessibilityDetail(List<Employee> included)
        {
            var textFirst = included.Count(e => e.Accommodation == Accommodation.TextFirst);
            var relay = included.Count(e => e.Accommodation == Accommodation.Relay);
            var parts = new List<string>();
            if (textFirst > 0) parts.Add($"{Employees(textFirst)} {Receive(textFirst)} text-first messages and Section 508–compliant email.");
            if (relay > 0) parts.Add($"{Employees(relay)} {Receive(relay)} voice messages through a relay service.");
            return parts.Count > 0 ? string.Join(" ", parts) : "No one on today's roster needs alternate routing.";

            static string Employees(int n) => n == 1 ? "1 employee" : $"{n} employees";
            static string Receive(int n) => n == 1 ? "receives" : "receive";
        }

        private SqliteConnection Open()
        {
            var conn = new SqliteConnection(_connectionString);
            conn.Open();
            return conn;
        }
    }

    public enum Assignment { Essential, TeleworkReady, OnSite }
    public enum EmployeeStatus { Active, Leave, Travel }
    public enum Accommodation { TextFirst, Relay }

    public record Employee(string Id, string Name, string Role, Assignment Assignment, EmployeeStatus Status, Accommodation? Accommodation);

    public record FacilityPopulation(int Employees, int EssentialPersonnel, int TeleworkEligible);

    // Serialized as the "people" block of /api/situation; the property names match the client's People type.
    public record PeopleSummary(
        string DataNote, string ResolvedAgainst, StaffSummary Staff, AudienceCounts Audiences,
        AccessibilityNote Accessibility, IReadOnlyList<SampleRecord> Sample);

    public record StaffSummary(int Assigned, int Recipients, int Excluded, int Essential, IReadOnlyList<ResolutionStep> Steps);

    public record ResolutionStep(
        string Label, string Detail, int Delta,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool Final = false);

    public record AudienceCounts(int TeleworkReady, int Onsite, int Essential);

    public record AccessibilityNote(string Title, string Detail);

    public record SampleRecord(string Name, string Role, string Logic, IReadOnlyList<string> Routing, bool Included);
}
