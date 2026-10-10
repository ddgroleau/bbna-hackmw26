using System.Text.Json;

namespace bbna_hackmw26.Server.Audit
{
    public enum FacilityStatus { Open, Closed }

    public enum DecisionStatus { AwaitingDecision, Decided }

    public enum DecisionAction { Accepted, Overridden }

    public static class AuditEventKind
    {
        public const string EvidenceCaptured = "EvidenceCaptured";
        public const string RecommendationGenerated = "RecommendationGenerated";
        public const string DecisionRecorded = "DecisionRecorded";
    }

    // Requests

    // Facility fields fall back to the configured Building when omitted.
    public record CreateDecisionRequest(
        string? FacilityCode,
        string? FacilityName,
        FacilityStatus RecommendedStatus,
        string Reason,
        string RulesetVersion,
        EvidenceInput Evidence);

    // Summary is the human-readable line shown in the timeline; Sources holds the raw payloads retained for review.
    public record EvidenceInput(string Summary, JsonElement? Sources);

    // The decision is attributed to the current viewer; see DecisionLogStore.CurrentUser.
    public record RecordDecisionRequest(FacilityStatus FinalStatus, string? Rationale);

    public record ClientInfo(string? IpAddress, string? UserAgent);

    // Responses

    public record DecisionRecord(
        string Id,
        string FacilityCode,
        string FacilityName,
        DecisionStatus Status,
        FacilityStatus RecommendedStatus,
        string RecommendationReason,
        string RulesetVersion,
        FacilityStatus? FinalStatus,
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
