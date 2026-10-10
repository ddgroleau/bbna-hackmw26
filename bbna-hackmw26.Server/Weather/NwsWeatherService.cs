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

    /// <summary>The active-alerts list exactly as NWS returned it, plus where and when it came from.</summary>
    /// <param name="SourceUrl">The exact NWS URL the alerts were fetched from.</param>
    /// <param name="Data">The unmodified NWS JSON: a "features" array with one entry per alert (empty if none).</param>
    /// <param name="RetrievedAt">When our server fetched it from NWS (UTC). Cached lists keep their original time.</param>
    public record RawAlerts(string SourceUrl, JsonElement Data, DateTimeOffset RetrievedAt);

    /// <summary>The detailed multi-day forecast grid exactly as NWS returned it, plus where and when it came from.</summary>
    /// <param name="SourceUrl">The exact NWS URL the forecast was fetched from.</param>
    /// <param name="Data">The unmodified NWS JSON: one time series per measurement (snowfallAmount, windChill, ...).</param>
    /// <param name="RetrievedAt">When our server fetched it from NWS (UTC). Cached forecasts keep their original time.</param>
    public record RawForecastGrid(string SourceUrl, JsonElement Data, DateTimeOffset RetrievedAt);

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
    /// Active alerts (tornado warnings, severe thunderstorm watches, etc.) come from a separate,
    /// single call (GET /alerts/active?point={lat},{lon}), cached for a shorter time
    /// (Nws:AlertsCacheMinutes) because warnings are time-critical.
    ///
    /// The multi-day forecast comes from the forecast grid found in step 1
    /// (GET /gridpoints/{office}/{x},{y}), cached for Nws:ForecastCacheMinutes.
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

        // Key the active alerts list is stored under in the in-memory cache.
        private const string ActiveAlertsCacheKey = "nws:active-alerts";

        // Key the multi-day forecast grid is stored under in the in-memory cache.
        private const string ForecastGridCacheKey = "nws:forecast-grid";

        private readonly BuildingOptions _building = building.Value;
        private readonly NwsOptions _nws = nws.Value;

        // The building's point details from step 1 (forecast grid, station list URL, ...) and the
        // nearest station from step 2, remembered after the first lookup.
        // They're static because ASP.NET creates a new instance of this service for every
        // request, and instance fields would be thrown away each time.
        private static JsonElement? _point;
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
        /// Gets every NWS alert (watches, warnings, advisories) currently in effect at the building's location.
        /// Returns the cached list if we fetched one within the last minute or so.
        /// An empty list is normal and means there are no active alerts.
        /// </summary>
        /// <exception cref="HttpRequestException">NWS could not be reached or returned an error.</exception>
        public async Task<RawAlerts> GetActiveAlertsAsync(CancellationToken ct)
        {
            // Fetched recently? Reuse it instead of calling NWS again.
            if (cache.TryGetValue(ActiveAlertsCacheKey, out RawAlerts? cached) && cached is not null)
                return cached;

            // Ask for alerts covering the building's exact point.
            // status=actual leaves out NWS test and exercise messages, so we never show a fake warning.
            var url = $"alerts/active?point={BuildingPoint()}&status=actual";
            var data = await GetJsonAsync(url, ct);

            var alerts = new RawAlerts(new Uri(http.BaseAddress!, url).ToString(), data, DateTimeOffset.UtcNow);

            // Cache it briefly. Failed requests throw before reaching this line, so errors are never cached.
            cache.Set(ActiveAlertsCacheKey, alerts, TimeSpan.FromMinutes(_nws.AlertsCacheMinutes));
            return alerts;
        }

        /// <summary>
        /// Gets the detailed forecast for the building's grid square: hour-by-hour (or block-by-block)
        /// values for the next ~7 days, e.g. snowfall amount, ice accumulation, wind chill.
        /// Returns the cached forecast if we fetched one within the last few minutes.
        /// </summary>
        /// <exception cref="HttpRequestException">NWS could not be reached or returned an error.</exception>
        public async Task<RawForecastGrid> GetForecastGridAsync(CancellationToken ct)
        {
            // Fetched recently? Reuse it instead of calling NWS again.
            if (cache.TryGetValue(ForecastGridCacheKey, out RawForecastGrid? cached) && cached is not null)
                return cached;

            // The point lookup (step 1) gives us the full URL of the building's forecast grid,
            // e.g. https://api.weather.gov/gridpoints/EAX/43,51
            var point = await GetPointAsync(ct);
            var url = point.GetProperty("forecastGridData").GetString()!;
            var data = await GetJsonAsync(url, ct);

            var forecast = new RawForecastGrid(url, data, DateTimeOffset.UtcNow);

            // Cache it. Failed requests throw before reaching this line, so errors are never cached.
            cache.Set(ForecastGridCacheKey, forecast, TimeSpan.FromMinutes(_nws.ForecastCacheMinutes));
            return forecast;
        }

        /// <summary>
        /// Step 1: asks NWS about the building's coordinates. The answer says which forecast office
        /// and grid square cover the building, and where to find nearby stations.
        /// Returns the "properties" part of the response. Cached, so NWS is only asked once per app run.
        /// </summary>
        private async Task<JsonElement> GetPointAsync(CancellationToken ct)
        {
            // Already looked it up earlier? Reuse it.
            if (_point is { } point) return point;

            var response = await GetJsonAsync($"points/{BuildingPoint()}", ct);
            var properties = response.GetProperty("properties");
            _point = properties;
            return properties;
        }

        /// <summary>
        /// The building's coordinates formatted the way NWS expects: "lat,lon", e.g. "39.1045,-94.5909".
        /// NWS only accepts up to 4 decimal places, and InvariantCulture guarantees a "."
        /// decimal separator regardless of the PC's regional settings.
        /// </summary>
        private string BuildingPoint()
        {
            var lat = _building.Latitude.ToString("0.####", CultureInfo.InvariantCulture);
            var lon = _building.Longitude.ToString("0.####", CultureInfo.InvariantCulture);
            return $"{lat},{lon}";
        }

        /// <summary>
        /// Works out which weather station is closest to the building (steps 1-2).
        /// The result is cached, so NWS is only asked once per app run.
        /// </summary>
        private async Task<ObservationStation> GetNearestStationAsync(CancellationToken ct)
        {
            // Already looked it up earlier? Reuse it.
            if (_station is not null) return _station;

            // Step 1: look up (or reuse) the building's point details.
            var point = await GetPointAsync(ct);

            // The point details tell us where to find the list of nearby stations.
            var stationsUrl = point.GetProperty("observationStations").GetString()!;

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
