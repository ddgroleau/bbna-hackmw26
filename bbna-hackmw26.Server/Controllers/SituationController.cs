using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;

namespace bbna_hackmw26.Server.Controllers
{
    // Serves the files in MockData/ so the client has a real endpoint to call.
    // Replace the scenario file with live feeds and the rules engine when they exist;
    // the response shape is what the client depends on.
    [ApiController]
    [Route("api/situation")]
    public class SituationController(IWebHostEnvironment env) : ControllerBase
    {
        private const string DefaultScenario = "winter-storm";

        private string DataRoot => Path.Combine(env.ContentRootPath, "MockData");

        [HttpGet]
        public IActionResult Get([FromQuery] string? scenario)
        {
            var scenarios = Directory.GetFiles(Path.Combine(DataRoot, "scenarios"), "*.json")
                .Select(Load)
                .ToDictionary(s => s["id"]!.GetValue<string>());

            if (!scenarios.TryGetValue(scenario ?? DefaultScenario, out var chosen))
            {
                return NotFound(new { error = $"Unknown scenario '{scenario}'.", available = scenarios.Keys });
            }

            var facility = Load(Path.Combine(DataRoot, "facility.json"));
            var zone = TimeZoneInfo.FindSystemTimeZoneById(facility["timeZone"]!.GetValue<string>());
            var now = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone);

            // Scenario files carry no timestamps, so the mock always reads as freshly captured.
            var weather = chosen["weather"]!.DeepClone();
            weather["observedAt"] = now.AddMinutes(-7).ToString("o");
            weather["forecastIssuedAt"] = now.AddMinutes(-52).ToString("o");
            weather["roadsReportedAt"] = now.AddMinutes(-21).ToString("o");

            var options = new JsonArray();
            foreach (var s in scenarios.Values.OrderBy(s => s["label"]!.GetValue<string>()))
            {
                options.Add(new JsonObject { ["id"] = s["id"]!.DeepClone(), ["label"] = s["label"]!.DeepClone() });
            }

            return Ok(new JsonObject
            {
                ["isMock"] = true,
                ["scenario"] = chosen["id"]!.DeepClone(),
                ["scenarios"] = options,
                ["generatedAt"] = now.ToString("o"),
                ["decisionWindow"] = BuildDecisionWindow(facility, zone, now),
                ["facility"] = facility,
                ["recommendation"] = chosen["recommendation"]!.DeepClone(),
                ["weather"] = weather,
                ["people"] = Load(Path.Combine(DataRoot, "roster.json")),
                ["thresholds"] = Load(Path.Combine(DataRoot, "thresholds.json")),
                ["messageTemplates"] = Load(Path.Combine(DataRoot, "message-templates.json")),
            });
        }

        // Nothing is sent. This only acknowledges the request so the client flow can be exercised.
        [HttpPost("notify")]
        public IActionResult Notify(NotifyRequest request)
        {
            return Ok(new
            {
                status = "simulated",
                request.Posture,
                request.Channels,
                request.StaffRecipients,
                request.FamilyContacts,
                sentAt = DateTimeOffset.UtcNow,
            });
        }

        private static JsonObject Load(string path) =>
            JsonNode.Parse(System.IO.File.ReadAllText(path))!.AsObject();

        private static JsonObject BuildDecisionWindow(JsonObject facility, TimeZoneInfo zone, DateTimeOffset now)
        {
            var hours = facility["hours"]!;
            var opens = TimeOnly.Parse(hours["opens"]!.GetValue<string>(), CultureInfo.InvariantCulture);
            var operatingDays = hours["days"]!.AsArray().Select(d => d!.GetValue<string>()).ToHashSet();
            var today = DateOnly.FromDateTime(now.DateTime);

            // The decision is for the next day the facility opens: today if it has not opened yet.
            var day = now.TimeOfDay < opens.ToTimeSpan() ? today : today.AddDays(1);
            while (!operatingDays.Contains(day.DayOfWeek.ToString()))
            {
                day = day.AddDays(1);
            }

            var steps = new JsonArray();
            DateTimeOffset decisionDue = default;
            foreach (var step in facility["decisionSchedule"]!.AsArray())
            {
                var local = day.ToDateTime(TimeOnly.Parse(step!["time"]!.GetValue<string>(), CultureInfo.InvariantCulture));
                var at = new DateTimeOffset(local, zone.GetUtcOffset(local));
                if (step["kind"]!.GetValue<string>() == "decision")
                {
                    decisionDue = at;
                }

                var copy = step.DeepClone();
                copy["at"] = at.ToString("o");
                steps.Add(copy);
            }

            var dayLabel = day == today ? "Today"
                : day == today.AddDays(1) ? "Tomorrow"
                : day.DayOfWeek.ToString();

            return new JsonObject
            {
                ["recordId"] = $"LCP-{day:yyyy-MMdd}-{decisionDue:HHmm}",
                ["operatingDate"] = day.ToString("yyyy-MM-dd"),
                ["operatingDayLabel"] = day.ToString("dddd, MMMM d", CultureInfo.InvariantCulture),
                ["dayLabel"] = dayLabel,
                ["decisionDueAt"] = decisionDue.ToString("o"),
                ["steps"] = steps,
            };
        }
    }

    public record NotifyRequest(string Posture, string[] Channels, int StaffRecipients, int FamilyContacts);
}
