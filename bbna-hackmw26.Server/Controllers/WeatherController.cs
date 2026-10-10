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
