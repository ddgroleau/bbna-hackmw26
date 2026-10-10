using bbna_hackmw26.Server.Weather;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace bbna_hackmw26.Server.Controllers
{
    [ApiController]
    [Route("api/weather")]
    public class WeatherController(NwsWeatherService weather, IOptions<BuildingOptions> building) : ControllerBase
    {
        // Latest NWS observation from the station nearest the building, passed through unmodified.
        [HttpGet("raw", Name = "GetRawWeather")]
        public async Task<IActionResult> GetRaw(CancellationToken ct)
        {
            try
            {
                var observation = await weather.GetLatestObservationAsync(ct);
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
                return Problem(
                    title: "Weather data unavailable",
                    detail: $"api.weather.gov request failed: {ex.Message}",
                    statusCode: StatusCodes.Status502BadGateway);
            }
        }
    }
}
