using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace bbna_hackmw26.Server.Weather
{
    public record ObservationStation(string Id, string Name, string Url);

    public record RawObservation(ObservationStation Station, string SourceUrl, JsonElement Data);

    public class NwsWeatherService(HttpClient http, IOptions<BuildingOptions> building)
    {
        private readonly BuildingOptions _building = building.Value;
        // Typed HttpClient services are transient, so the resolved station is cached statically.
        private static ObservationStation? _station;

        public async Task<RawObservation> GetLatestObservationAsync(CancellationToken ct)
        {
            var station = await GetNearestStationAsync(ct);
            var url = $"stations/{station.Id}/observations/latest";
            var data = await GetJsonAsync(url, ct);
            return new RawObservation(station, new Uri(http.BaseAddress!, url).ToString(), data);
        }

        // Point -> grid -> station list is fixed for a building, so resolve it once and reuse.
        private async Task<ObservationStation> GetNearestStationAsync(CancellationToken ct)
        {
            if (_station is not null) return _station;

            var lat = _building.Latitude.ToString("0.####", CultureInfo.InvariantCulture);
            var lon = _building.Longitude.ToString("0.####", CultureInfo.InvariantCulture);
            var point = await GetJsonAsync($"points/{lat},{lon}", ct);
            var stationsUrl = point.GetProperty("properties").GetProperty("observationStations").GetString()!;

            var stations = await GetJsonAsync($"{stationsUrl}?limit=1", ct);
            var nearest = stations.GetProperty("features")[0];
            var props = nearest.GetProperty("properties");

            return _station = new ObservationStation(
                props.GetProperty("stationIdentifier").GetString()!,
                props.GetProperty("name").GetString()!,
                nearest.GetProperty("id").GetString()!);
        }

        private async Task<JsonElement> GetJsonAsync(string url, CancellationToken ct)
        {
            using var response = await http.GetAsync(url, ct);
            response.EnsureSuccessStatusCode();
            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            return doc.RootElement.Clone();
        }
    }
}
