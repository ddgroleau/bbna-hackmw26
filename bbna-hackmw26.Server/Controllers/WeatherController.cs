using bbna_hackmw26.Server.Weather;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace bbna_hackmw26.Server.Controllers
{
    /// <summary>
    /// Weather endpoints for the federal building configured in appsettings.json.
    /// All routes start with /api/weather.
    /// </summary>
    [ApiController]
    [Route("api/weather")]
    public class WeatherController(NwsWeatherService weather, IOptions<BuildingOptions> building) : ControllerBase
    {
        /// <summary>
        /// GET /api/weather/raw
        /// Returns the latest National Weather Service reading from the station nearest the
        /// building, passed through unmodified, along with the building and station details.
        /// </summary>
        /// <response code="200">The latest reading.</response>
        /// <response code="502">The National Weather Service could not be reached or returned an error.</response>
        [HttpGet("raw", Name = "GetRawWeather")]
        public async Task<IActionResult> GetRaw(CancellationToken ct)
        {
            try
            {
                var observation = await weather.GetLatestObservationAsync(ct);

                // Response shape:
                //   building    - which building this weather is for (name, address, coordinates)
                //   station     - which weather station took the reading
                //   source      - the exact NWS URL the reading came from
                //   retrievedAt - when our server fetched it from NWS (UTC; may be a few minutes old due to caching)
                //   observation - the unmodified NWS reading; the actual weather is under observation.properties
                return Ok(new
                {
                    building = building.Value,
                    station = observation.Station,
                    source = observation.SourceUrl,
                    retrievedAt = observation.RetrievedAt,
                    observation = observation.Data
                });
            }
            catch (HttpRequestException ex)
            {
                return NwsUnavailable(ex);
            }
        }

        /// <summary>
        /// GET /api/weather/current
        /// Returns the latest reading in a simple, frontend-friendly shape: plain numbers in
        /// US units (°F, mph, inHg, miles), with null for anything the station didn't report.
        /// See <see cref="CurrentWeather"/> for every field.
        /// </summary>
        /// <response code="200">The latest reading, simplified.</response>
        /// <response code="502">The National Weather Service could not be reached or returned an error.</response>
        [HttpGet("current", Name = "GetCurrentWeather")]
        [ProducesResponseType<CurrentWeather>(StatusCodes.Status200OK)]
        [ProducesResponseType<ProblemDetails>(StatusCodes.Status502BadGateway)]
        public async Task<IActionResult> GetCurrent(CancellationToken ct)
        {
            try
            {
                // Same reading as /raw (shares the cache), converted into the simple shape.
                var observation = await weather.GetLatestObservationAsync(ct);
                return Ok(CurrentWeather.FromRaw(observation, building.Value));
            }
            catch (HttpRequestException ex)
            {
                return NwsUnavailable(ex);
            }
        }

        /// <summary>
        /// GET /api/weather/alerts
        /// Returns every National Weather Service alert currently in effect at the building
        /// (e.g. Tornado Warning, Severe Thunderstorm Watch, Flash Flood Warning, Heat Advisory),
        /// most serious first. An empty list is normal and means no active alerts.
        /// See <see cref="WeatherAlertsResponse"/> and <see cref="WeatherAlert"/> for every field.
        /// </summary>
        /// <param name="severeOnly">If true, only return Extreme and Severe alerts (threats to life or property).</param>
        /// <param name="ct">Cancelled if the caller disconnects.</param>
        /// <response code="200">The active alerts (possibly none).</response>
        /// <response code="502">The National Weather Service could not be reached or returned an error.</response>
        [HttpGet("alerts", Name = "GetWeatherAlerts")]
        [ProducesResponseType<WeatherAlertsResponse>(StatusCodes.Status200OK)]
        [ProducesResponseType<ProblemDetails>(StatusCodes.Status502BadGateway)]
        public async Task<IActionResult> GetAlerts([FromQuery] bool severeOnly = false, CancellationToken ct = default)
        {
            try
            {
                var raw = await weather.GetActiveAlertsAsync(ct);
                var response = WeatherAlert.ListFromRaw(raw, building.Value);

                // Optional filter: drop Moderate/Minor/Unknown alerts (e.g. advisories).
                if (severeOnly)
                    response = response with { Alerts = response.Alerts.Where(a => a.IsSevere).ToList() };

                return Ok(response);
            }
            catch (HttpRequestException ex)
            {
                return NwsUnavailable(ex);
            }
        }

        /// <summary>
        /// GET /api/weather/forecast
        /// Returns the expected weather for each upcoming workday (Mon-Fri, about a week ahead),
        /// split into Overnight / MorningCommute / OfficeHours / EveningCommute windows plus a
        /// WholeDay total: snow and ice in inches, lowest wind chill and highest heat index in °F,
        /// strongest gust in mph, and highest chance of precipitation.
        /// Window times come from the "Workday" section of appsettings.json.
        /// See <see cref="WorkdayForecastResponse"/> for every field.
        /// </summary>
        /// <response code="200">The workday forecast.</response>
        /// <response code="502">The National Weather Service could not be reached or returned an error.</response>
        [HttpGet("forecast", Name = "GetWorkdayForecast")]
        [ProducesResponseType<WorkdayForecastResponse>(StatusCodes.Status200OK)]
        [ProducesResponseType<ProblemDetails>(StatusCodes.Status502BadGateway)]
        public async Task<IActionResult> GetForecast([FromServices] IOptions<WorkdayOptions> workday, CancellationToken ct)
        {
            try
            {
                var raw = await weather.GetForecastGridAsync(ct);
                return Ok(WorkdayForecastBuilder.Build(raw, building.Value, workday.Value, DateTimeOffset.UtcNow));
            }
            catch (HttpRequestException ex)
            {
                return NwsUnavailable(ex);
            }
        }

        /// <summary>
        /// GET /api/weather/storm-outlook
        /// Returns NOAA Storm Prediction Center's severe thunderstorm risk at the building for
        /// today (Day 1), tomorrow (Day 2) and the day after (Day 3), on SPC's 0-5 scale
        /// (Marginal, Slight, Enhanced, Moderate, High). Gives advance notice of tornado and
        /// severe storm days, before any NWS watch or warning is issued.
        /// See <see cref="StormOutlookResponse"/> and <see cref="StormOutlookDay"/> for every field.
        /// </summary>
        /// <response code="200">The Day 1-3 outlook at the building.</response>
        /// <response code="502">The Storm Prediction Center could not be reached or returned an error.</response>
        [HttpGet("storm-outlook", Name = "GetStormOutlook")]
        [ProducesResponseType<StormOutlookResponse>(StatusCodes.Status200OK)]
        [ProducesResponseType<ProblemDetails>(StatusCodes.Status502BadGateway)]
        public async Task<IActionResult> GetStormOutlook([FromServices] SpcOutlookService spc, CancellationToken ct)
        {
            try
            {
                var outlooks = await spc.GetOutlooksAsync(ct);
                return Ok(StormOutlookBuilder.Build(outlooks, building.Value));
            }
            catch (HttpRequestException ex)
            {
                return Problem(
                    title: "Storm outlook unavailable",
                    detail: $"spc.noaa.gov request failed: {ex.Message}",
                    statusCode: StatusCodes.Status502BadGateway);
            }
        }

        /// <summary>
        /// GET /api/weather/similar-days?date=2026-10-12&amp;limit=3
        /// Finds past Kansas City days (2019-2024) whose weather pattern most resembles the forecast for a
        /// workday: e.g. a refreeze before the morning commute, a winter storm, or a tornado watch in the
        /// evening. Each match says why it was picked and what happened (warnings, NOAA storm reports,
        /// injury crashes vs a typical day). Used by the AI agent as context for its recommendation.
        /// Returns no matches when the day's weather is unremarkable.
        /// </summary>
        /// <param name="date">Workday to match (yyyy-MM-dd), within the forecast. Defaults to the next workday.</param>
        /// <param name="limit">Most matches to return (1-10, default 3).</param>
        /// <response code="200">The best-matching past days (possibly none).</response>
        /// <response code="400">The date isn't one of the forecast workdays.</response>
        /// <response code="502">The National Weather Service forecast could not be reached.</response>
        [HttpGet("similar-days", Name = "GetSimilarDays")]
        [ProducesResponseType<SimilarDaysResponse>(StatusCodes.Status200OK)]
        [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
        [ProducesResponseType<ProblemDetails>(StatusCodes.Status502BadGateway)]
        public async Task<IActionResult> GetSimilarDays(
            [FromQuery] DateOnly? date,
            [FromServices] IOptions<WorkdayOptions> workday,
            [FromServices] IOptions<WeatherHistoryOptions> historyOptions,
            [FromServices] SpcOutlookService spc,
            [FromServices] WeatherHistoryStore history,
            [FromServices] BedrockEmbeddingClient bedrock,
            [FromQuery] int limit = 3,
            CancellationToken ct = default)
        {
            // 1. The forecast for the day being decided (required).
            WorkdayForecastResponse forecast;
            try
            {
                forecast = WorkdayForecastBuilder.Build(await weather.GetForecastGridAsync(ct), building.Value, workday.Value, DateTimeOffset.UtcNow);
            }
            catch (HttpRequestException ex)
            {
                return NwsUnavailable(ex);
            }
            var day = date is { } d ? forecast.Days.FirstOrDefault(x => x.Date == d) : forecast.Days.FirstOrDefault();
            if (day is null)
                return Problem(
                    title: "Date not in the forecast",
                    detail: $"Pick one of the forecast workdays: {string.Join(", ", forecast.Days.Select(x => x.Date.ToString("yyyy-MM-dd")))}.",
                    statusCode: StatusCodes.Status400BadRequest);

            // 2. Alerts and the SPC storm outlook sharpen the match but are optional: if either feed is down,
            //    match on the forecast alone and say so in the note.
            var notes = new List<string>();
            IReadOnlyList<WeatherAlert> alerts = [];
            try { alerts = WeatherAlert.ListFromRaw(await weather.GetActiveAlertsAsync(ct), building.Value).Alerts; }
            catch (HttpRequestException) { notes.Add("NWS alerts were unavailable, so active alerts weren't matched."); }

            StormOutlookDay? outlook = null;
            try
            {
                // The SPC day whose period starts on this date (building time). SPC only covers 3 days ahead.
                var tz = TimeZoneInfo.FindSystemTimeZoneById(workday.Value.TimeZone);
                outlook = StormOutlookBuilder.Build(await spc.GetOutlooksAsync(ct), building.Value).Days
                    .FirstOrDefault(o => o.ValidFrom is { } from && DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(from, tz).DateTime) == day.Date);
            }
            catch (HttpRequestException) { notes.Add("The SPC storm outlook was unavailable."); }

            // 3. The day's pattern, and the past days that match it.
            var pattern = DayFeatures.FromForecast(day, alerts, outlook);
            IReadOnlyList<SimilarPastDay> matches = [];
            var usedEmbeddings = false;

            if (history.Cards.Count == 0)
                notes.Add("The weather history database is missing; build it with tools/weather-history/build_cards.py.");
            else if (!pattern.IsWinter && !pattern.IsStorm)
                notes.Add("No winter or severe-storm weather is forecast for this day, so no past days are compared.");
            else
            {
                // Optional tie-breaker: embed the forecast (same format as the cards) and compare by meaning.
                var stored = history.Cards.FirstOrDefault(c => c.Embedding is not null);
                float[]? vector = null;
                if (stored is not null && bedrock.IsConfigured)
                {
                    vector = await bedrock.EmbedAsync(SimilarDaysMatcher.QueryText(day, pattern, alerts), stored.Embedding!.Length, ct);
                    usedEmbeddings = vector is not null;
                }

                matches = SimilarDaysMatcher.Rank(pattern, isWorkday: true, history.Cards, vector,
                    historyOptions.Value.MinimumScore, Math.Clamp(limit, 1, 10));
                if (matches.Count == 0) notes.Add("No past day matched this forecast closely enough.");
            }

            return Ok(new SimilarDaysResponse
            {
                BuildingName = building.Value.Name,
                Date = day.Date,
                ForecastPattern = pattern,
                UsedEmbeddings = usedEmbeddings,
                Note = notes.Count > 0 ? string.Join(" ", notes) : null,
                Source = SimilarDaysMatcher.Source,
                Matches = matches,
            });
        }

        /// <summary>
        /// The error response used when NWS is down or returns an error: 502 Bad Gateway
        /// (an upstream service failed, not our server) with a standard error body.
        /// </summary>
        private ObjectResult NwsUnavailable(HttpRequestException ex) =>
            Problem(
                title: "Weather data unavailable",
                detail: $"api.weather.gov request failed: {ex.Message}",
                statusCode: StatusCodes.Status502BadGateway);
    }
}
