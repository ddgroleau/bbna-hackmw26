using bbna_hackmw26.Server.Audit;
using bbna_hackmw26.Server.Weather;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace bbna_hackmw26.Server.Controllers
{
    // The decision log has two endpoints: GET reads every record, POST writes to it.
    [ApiController]
    [Route("api/decisions")]
    public class DecisionsController(DecisionLogStore store, IOptions<BuildingOptions> building) : ControllerBase
    {
        // Every record with its events and integrity check, newest first.
        [HttpGet(Name = "ListDecisions")]
        public async Task<IReadOnlyList<DecisionRecordDetail>> List(CancellationToken ct)
            => await store.ListAllAsync(ct);

        [HttpPost(Name = "LogDecision")]
        public Task<IActionResult> Post(DecisionLogRequest request, CancellationToken ct)
            => string.IsNullOrWhiteSpace(request.RecordId) ? Create(request, ct) : RecordDecision(request.RecordId, request, ct);

        private async Task<IActionResult> Create(DecisionLogRequest request, CancellationToken ct)
        {
            if (request.RecommendedPosture is not { } recommended || string.IsNullOrWhiteSpace(request.Reason)
                || string.IsNullOrWhiteSpace(request.RulesetVersion) || string.IsNullOrWhiteSpace(request.Evidence?.Summary))
                return Problem(title: "recommendedPosture, reason, rulesetVersion, and evidence.summary are required to open a record.",
                    statusCode: StatusCodes.Status400BadRequest);

            var detail = await store.CreateAsync(
                request.FacilityCode ?? building.Value.Code,
                request.FacilityName ?? building.Value.Name,
                new CreateDecisionRequest(request.FacilityCode, request.FacilityName, recommended,
                    request.Reason, request.RulesetVersion, request.Evidence, request.RecommendedBy),
                ct);
            return StatusCode(StatusCodes.Status201Created, detail);
        }

        private async Task<IActionResult> RecordDecision(string id, DecisionLogRequest request, CancellationToken ct)
        {
            if (request.FinalPosture is not { } final)
                return Problem(title: "finalPosture is required to record a decision.", statusCode: StatusCodes.Status400BadRequest);

            var existing = await store.GetAsync(id, ct);
            if (existing is null)
                return Problem(title: $"No decision record '{id}'.", statusCode: StatusCodes.Status404NotFound);

            // Overriding the recommendation must be explained for after-action review.
            if (final != existing.Record.RecommendedPosture && string.IsNullOrWhiteSpace(request.Rationale))
                return Problem(title: "A rationale is required when overriding the recommendation.",
                    statusCode: StatusCodes.Status400BadRequest);

            var client = new ClientInfo(
                HttpContext.Connection.RemoteIpAddress?.ToString(),
                Request.Headers.UserAgent.ToString());
            if (!await store.RecordDecisionAsync(id, new RecordDecisionRequest(final, request.Rationale), client, ct))
                return Problem(title: "This record has already been decided.", statusCode: StatusCodes.Status409Conflict);

            return Ok(await store.GetAsync(id, ct));
        }
    }
}
