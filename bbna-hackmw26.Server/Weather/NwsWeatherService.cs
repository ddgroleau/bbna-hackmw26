using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace bbna_hackmw26.Server.Weather
{
    /// <summary>A weather station that reports observations (e.g. KMKC, Kansas City Downtown Airport).</summary>
    /// <param name="Id">Station code, e.g. "KMKC".</param>
    /// <param name="Name">Human-readable station name.</param>
    /// <param name="Url">NWS API address for the station's details.</param>
    public record ObservationStation(string Id, string Name, string Url);

    /// <summary>One weather reading exactly as NWS returned it, plus where it came from.</summary>
    /// <param name="Station">The station that took the reading.</param>
    /// <param name="SourceUrl">The exact NWS URL the reading was fetched from.</param>
    /// <param name="Data">The unmodified NWS JSON (temperature, wind, humidity, etc.).</param>
    /// <param name="RetrievedAt">When our server fetched it from NWS (UTC). Cached readings keep their original time.</param>
    public record RawObservation(ObservationStation Station, string SourceUrl, JsonElement Data, DateTimeOffset RetrievedAt);

    /// <summary>
    /// Talks to the National Weather Service API to get weather for the configured building.
    ///
    /// How it finds the weather, step by step:
    ///   1. Ask NWS which forecast grid the building's coordinates fall in  (GET /points/{lat},{lon})
    ///   2. Ask for the observation stations for that grid, nearest first  (GET /gridpoints/.../stations)
    ///   3. Get the latest reading from the nearest station                (GET /stations/{id}/observations/latest)
    /// Steps 1-2 only run once, because the building doesn't move. Step 3's result is cached
    /// for a few minutes (Nws:CacheMinutes in appsettings.json), because stations only report
    /// about once an hour and we don't want every page load to hit NWS.
    ///
    /// The HttpClient is pre-configured in Program.cs with the NWS base URL and required headers.
    /// </summary>
    public class NwsWeatherService(
        HttpClient http,
        IMemoryCache cache,
        IOptions<BuildingOptions> building,
        IOptions<NwsOptions> nws)
    {
        // Key the latest reading is stored under in the in-memory cache.
        private const string LatestObservationCacheKey = "nws:latest-observation";

        private readonly BuildingOptions _building = building.Value;
        private readonly NwsOptions _nws = nws.Value;

        // The nearest station, remembered after the first lookup (steps 1-2 above).
        // It's static because ASP.NET creates a new instance of this service for every
        // request, and an instance field would be thrown away each time.
        private static ObservationStation? _station;

        /// <summary>
        /// Gets the most recent weather reading from the station nearest the building.
        /// Returns the cached reading if we fetched one within the last few minutes.
        /// </summary>
        /// <exception cref="HttpRequestException">NWS could not be reached or returned an error.</exception>
        public async Task<RawObservation> GetLatestObservationAsync(CancellationToken ct)
        {
            // Fetched recently? Reuse it instead of calling NWS again.
            if (cache.TryGetValue(LatestObservationCacheKey, out RawObservation? cached) && cached is not null)
                return cached;

            // Steps 1-2: find (or reuse) the nearest station.
            var station = await GetNearestStationAsync(ct);

            // Step 3: fetch that station's latest reading.
            var url = $"stations/{station.Id}/observations/latest";
            var data = await GetJsonAsync(url, ct);

            // Keep the reading untouched, with the full source URL so callers can see where it came from.
            var observation = new RawObservation(
                station, new Uri(http.BaseAddress!, url).ToString(), data, DateTimeOffset.UtcNow);

            // Cache it. Failed requests throw before reaching this line, so errors are never cached.
            cache.Set(LatestObservationCacheKey, observation, TimeSpan.FromMinutes(_nws.CacheMinutes));
            return observation;
        }

        /// <summary>
        /// Works out which weather station is closest to the building (steps 1-2).
        /// The result is cached, so NWS is only asked once per app run.
        /// </summary>
        private async Task<ObservationStation> GetNearestStationAsync(CancellationToken ct)
        {
            // Already looked it up earlier? Reuse it.
            if (_station is not null) return _station;

            // Step 1: look up the building's point. NWS only accepts up to 4 decimal places,
            // and InvariantCulture guarantees a "." decimal separator regardless of PC settings.
            var lat = _building.Latitude.ToString("0.####", CultureInfo.InvariantCulture);
            var lon = _building.Longitude.ToString("0.####", CultureInfo.InvariantCulture);
            var point = await GetJsonAsync($"points/{lat},{lon}", ct);

            // The point response tells us where to find the list of nearby stations.
            var stationsUrl = point.GetProperty("properties").GetProperty("observationStations").GetString()!;

            // Step 2: get the station list. NWS sorts it nearest-first, so we only need the first one.
            var stations = await GetJsonAsync($"{stationsUrl}?limit=1", ct);
            var nearest = stations.GetProperty("features")[0];
            var props = nearest.GetProperty("properties");

            // Remember the station for next time and return it.
            return _station = new ObservationStation(
                props.GetProperty("stationIdentifier").GetString()!,
                props.GetProperty("name").GetString()!,
                nearest.GetProperty("id").GetString()!);
        }

        /// <summary>
        /// Sends a GET request to NWS and returns the parsed JSON response.
        /// Accepts either a path relative to the NWS base URL or a full URL.
        /// </summary>
        /// <exception cref="HttpRequestException">The response was not a success (2xx) status.</exception>
        private async Task<JsonElement> GetJsonAsync(string url, CancellationToken ct)
        {
            using var response = await http.GetAsync(url, ct);

            // Turn any non-2xx response (404, 500, 503...) into an HttpRequestException,
            // which the controller catches and reports as a 502.
            response.EnsureSuccessStatusCode();

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);

            // Clone() copies the JSON out of the document so it stays valid after the
            // document is disposed at the end of this method.
            return doc.RootElement.Clone();
        }
    }
}
