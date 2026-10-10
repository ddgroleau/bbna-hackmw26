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
