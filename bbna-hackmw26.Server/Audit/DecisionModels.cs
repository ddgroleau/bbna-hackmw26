using System.Text.Json;
using System.Text.Json.Serialization;

namespace bbna_hackmw26.Server.Audit
{
    // Operating postures, serialized with the same ids the client uses.
    public enum Posture
    {
        [JsonStringEnumMemberName("normal")] Normal,
        [JsonStringEnumMemberName("delay")] Delay,
        [JsonStringEnumMemberName("early_dismissal")] EarlyDismissal,
        [JsonStringEnumMemberName("telework")] Telework,
        [JsonStringEnumMemberName("closure")] Closure,
    }

    public static class PostureLabels
    {
        public static string Label(this Posture posture) => posture switch
        {
            Posture.Normal => "Normal operations",
            Posture.Delay => "Delayed arrival",
            Posture.EarlyDismissal => "Early departure",
            Posture.Telework => "Unscheduled telework",
            Posture.Closure => "Office closed",
            _ => posture.ToString(),
        };
    }

    public enum DecisionStatus { AwaitingDecision, Decided }

    public enum DecisionAction { Accepted, Overridden }

    public static class AuditEventKind
    {
        public const string EvidenceCaptured = "EvidenceCaptured";
        public const string RecommendationGenerated = "RecommendationGenerated";
        public const string DecisionRecorded = "DecisionRecorded";
    }

    // Requests

    // The single body POST /api/decisions accepts. Without a RecordId it opens a new record from the
    // recommendation fields; with one it records the human decision (FinalPosture, Rationale) on that record.
    public record DecisionLogRequest(
        string? RecordId,
        Posture? FinalPosture,
        string? Rationale,
        string? FacilityCode,
        string? FacilityName,
        Posture? RecommendedPosture,
        string? Reason,
        string? RulesetVersion,
        EvidenceInput? Evidence);


    // Facility fields fall back to the configured Building when omitted.
    public record CreateDecisionRequest(
        string? FacilityCode,
        string? FacilityName,
        Posture RecommendedPosture,
        string Reason,
        string RulesetVersion,
        EvidenceInput Evidence);

    // Summary is the human-readable line shown in the timeline; Sources holds the raw payloads retained for review.
    public record EvidenceInput(string Summary, JsonElement? Sources);

    // The decision is attributed to the current viewer; see DecisionLogStore.CurrentUser.
    public record RecordDecisionRequest(Posture FinalPosture, string? Rationale);

    public record ClientInfo(string? IpAddress, string? UserAgent);

    // Responses

    public record DecisionRecord(
        string Id,
        string FacilityCode,
        string FacilityName,
        DecisionStatus Status,
        Posture RecommendedPosture,
        string RecommendationReason,
        string RulesetVersion,
        Posture? FinalPosture,
        DecisionAction? Action,
        string? DecidedBy,
        DateTimeOffset? DecidedAt,
        DateTimeOffset CreatedAt);

    public record AuditEvent(
        long Seq,
        DateTimeOffset OccurredAt,
        string Kind,
        string Actor,
        string Title,
        string Detail,
        JsonElement? Payload,
        string? PrevHash,
        string Hash);

    // BrokenAtSeq is the first event whose hash or chain link does not match its stored content.
    public record IntegrityResult(bool Valid, int EventCount, long? BrokenAtSeq);

    public record DecisionRecordDetail(DecisionRecord Record, IReadOnlyList<AuditEvent> Events, IntegrityResult Integrity);
}
