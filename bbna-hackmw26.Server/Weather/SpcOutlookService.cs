using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace bbna_hackmw26.Server.Weather
{
    /// <summary>One day's SPC outlook map exactly as SPC published it, plus where and when it came from.</summary>
    /// <param name="Day">1 = today/tonight, 2 = tomorrow, 3 = the day after.</param>
    /// <param name="SourceUrl">The exact SPC URL the map was downloaded from.</param>
    /// <param name="Data">The unmodified GeoJSON: one "feature" (map area) per risk category.</param>
    /// <param name="RetrievedAt">When our server downloaded it (UTC). Cached maps keep their original time.</param>
    public record RawSpcOutlook(int Day, string SourceUrl, JsonElement Data, DateTimeOffset RetrievedAt);

    /// <summary>
    /// Downloads the Storm Prediction Center's Day 1-3 severe thunderstorm outlooks.
    ///
    /// Each outlook is a map (GeoJSON) of areas at each risk level, e.g. "Slight Risk" over
    /// parts of Missouri. <see cref="StormOutlookBuilder"/> then works out which area the building falls in.
    /// All three days are downloaded together and cached for Spc:CacheMinutes.
    ///
    /// The HttpClient is pre-configured in Program.cs with the SPC base URL and a User-Agent.
    /// </summary>
    public class SpcOutlookService(HttpClient http, IMemoryCache cache, IOptions<SpcOptions> spc)
    {
        // Key the three outlooks are stored under in the in-memory cache.
        private const string OutlooksCacheKey = "spc:outlooks";

        private readonly SpcOptions _spc = spc.Value;

        /// <summary>
        /// Gets the Day 1, 2 and 3 categorical outlooks. Returns the cached set if we downloaded
        /// them within the last few minutes.
        /// </summary>
        /// <exception cref="HttpRequestException">SPC could not be reached or returned an error.</exception>
        public async Task<IReadOnlyList<RawSpcOutlook>> GetOutlooksAsync(CancellationToken ct)
        {
            // Downloaded recently? Reuse them instead of asking SPC again.
            if (cache.TryGetValue(OutlooksCacheKey, out IReadOnlyList<RawSpcOutlook>? cached) && cached is not null)
                return cached;

            // Download all three days at the same time rather than one after another.
            var outlooks = await Task.WhenAll(new[] { 1, 2, 3 }.Select(day => GetOutlookAsync(day, ct)));

            // Cache them. A failed download throws before reaching this line, so errors are never cached.
            cache.Set<IReadOnlyList<RawSpcOutlook>>(OutlooksCacheKey, outlooks, TimeSpan.FromMinutes(_spc.CacheMinutes));
            return outlooks;
        }

        /// <summary>Downloads one day's categorical outlook ("cat" = the overall risk-level map).</summary>
        private async Task<RawSpcOutlook> GetOutlookAsync(int day, CancellationToken ct)
        {
            var url = $"day{day}otlk_cat.lyr.geojson";
            using var response = await http.GetAsync(url, ct);

            // Turn any non-2xx response into an HttpRequestException, which the controller reports as a 502.
            response.EnsureSuccessStatusCode();

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);

            // Clone() copies the JSON out of the document so it stays valid after the document is disposed.
            return new RawSpcOutlook(day, new Uri(http.BaseAddress!, url).ToString(), doc.RootElement.Clone(), DateTimeOffset.UtcNow);
        }
    }
}
