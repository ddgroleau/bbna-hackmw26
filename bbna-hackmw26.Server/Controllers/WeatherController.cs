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
                //   retrievedAt - when our server fetched it (UTC)
                //   observation - the unmodified NWS reading; the actual weather is under observation.properties
                return Ok(new
                {
                    building = building.Value,
                    station = observation.Station,
                    source = observation.SourceUrl,
                    retrievedAt = DateTimeOffset.UtcNow,
                    observation = observation.Data
                });
            }
            catch (HttpRequestException ex)
            {
                // NWS is down or returned an error. Report it as 502 Bad Gateway
                // (an upstream service failed, not our server) with a standard error body.
                return Problem(
                    title: "Weather data unavailable",
                    detail: $"api.weather.gov request failed: {ex.Message}",
                    statusCode: StatusCodes.Status502BadGateway);
            }
        }
    }
}
