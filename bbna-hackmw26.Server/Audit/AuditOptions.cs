namespace bbna_hackmw26.Server.Audit
{
    public class AuditOptions
    {
        public const string SectionName = "Audit";

        // Relative paths resolve against the content root.
        public string DatabasePath { get; set; } = "data/audit.db";
    }
}
