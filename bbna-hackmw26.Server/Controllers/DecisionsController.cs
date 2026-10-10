using System.Text.Json;
using bbna_hackmw26.Server.Audit;
using bbna_hackmw26.Server.Weather;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace bbna_hackmw26.Server.Controllers
{
    [ApiController]
    [Route("api/decisions")]
    public class DecisionsController(DecisionLogStore store, IOptions<BuildingOptions> building) : ControllerBase
    {
        private static readonly JsonSerializerOptions ExportJson = new(JsonSerializerDefaults.Web)
        {
            WriteIndented = true,
            Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() },
        };

        [HttpGet(Name = "ListDecisions")]
        public async Task<IReadOnlyList<DecisionRecord>> List(
            [FromQuery] string? facility, [FromQuery] int limit = 50, CancellationToken ct = default)
            => await store.ListAsync(facility, Math.Clamp(limit, 1, 500), ct);

        // Most recent record for a facility (defaults to the configured building), for the status display.
        [HttpGet("current", Name = "GetCurrentDecision")]
        public async Task<IActionResult> GetCurrent([FromQuery] string? facility, CancellationToken ct)
        {
            var latest = (await store.ListAsync(facility ?? building.Value.Code, 1, ct)).FirstOrDefault();
            return latest is null ? NotFound() : Ok(await store.GetAsync(latest.Id, ct));
        }

        [HttpGet("{id}", Name = "GetDecision")]
        public async Task<IActionResult> Get(string id, CancellationToken ct)
        {
            var detail = await store.GetAsync(id, ct);
            return detail is null ? NotFound() : Ok(detail);
        }

        [HttpGet("{id}/export", Name = "ExportDecision")]
        public async Task<IActionResult> Export(string id, CancellationToken ct)
        {
            var detail = await store.GetAsync(id, ct);
            if (detail is null) return NotFound();
            var json = JsonSerializer.SerializeToUtf8Bytes(new { exportedAt = DateTimeOffset.UtcNow, detail }, ExportJson);
            return File(json, "application/json", $"{id}.json");
        }

        [HttpPost(Name = "CreateDecision")]
        public async Task<IActionResult> Create(CreateDecisionRequest request, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(request.Reason) || string.IsNullOrWhiteSpace(request.RulesetVersion)
                || string.IsNullOrWhiteSpace(request.Evidence?.Summary))
                return Problem(title: "Reason, rulesetVersion, and evidence.summary are required.",
                    statusCode: StatusCodes.Status400BadRequest);

            var detail = await store.CreateAsync(
                request.FacilityCode ?? building.Value.Code,
                request.FacilityName ?? building.Value.Name,
                request, ct);
            return CreatedAtRoute("GetDecision", new { id = detail.Record.Id }, detail);
        }

        [HttpPost("{id}/decision", Name = "RecordDecision")]
        public async Task<IActionResult> RecordDecision(string id, RecordDecisionRequest request, CancellationToken ct)
        {
            var existing = await store.GetAsync(id, ct);
            if (existing is null) return NotFound();

            // Overriding the rules engine must be explained for after-action review.
            if (request.FinalStatus != existing.Record.RecommendedStatus && string.IsNullOrWhiteSpace(request.Rationale))
                return Problem(title: "A rationale is required when overriding the recommendation.",
                    statusCode: StatusCodes.Status400BadRequest);

            var client = new ClientInfo(
                HttpContext.Connection.RemoteIpAddress?.ToString(),
                Request.Headers.UserAgent.ToString());
            if (!await store.RecordDecisionAsync(id, request, client, ct))
                return Problem(title: "This record has already been decided.", statusCode: StatusCodes.Status409Conflict);

            return Ok(await store.GetAsync(id, ct));
        }
    }
}
