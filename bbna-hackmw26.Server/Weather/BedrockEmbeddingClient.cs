using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace bbna_hackmw26.Server.Weather
{
    /// <summary>
    /// Turns text into an embedding (a list of numbers capturing its meaning) with Amazon Titan Text
    /// Embeddings on Bedrock. Used by /api/weather/similar-days to compare the forecast with past days.
    ///
    /// Entirely optional: with no API key configured, or if Bedrock fails, it returns null and the
    /// caller ranks on the matching rules alone. A failure here never breaks the endpoint.
    /// </summary>
    public class BedrockEmbeddingClient(HttpClient http, IMemoryCache cache, IOptions<BedrockOptions> options, ILogger<BedrockEmbeddingClient> logger)
    {
        private readonly BedrockOptions _bedrock = options.Value;

        /// <summary>True if a Bedrock API key is available.</summary>
        public bool IsConfigured => !string.IsNullOrWhiteSpace(_bedrock.ApiKey);

        /// <summary>
        /// Embeds the text with <see cref="BedrockOptions.EmbeddingModel"/>. Returns null if Bedrock isn't
        /// configured or the call fails. Results are cached for a day, keyed by the text.
        /// </summary>
        /// <param name="dimensions">Vector length; must match the stored vectors (1024).</param>
        public async Task<float[]?> EmbedAsync(string text, int dimensions, CancellationToken ct)
        {
            if (!IsConfigured) return null;

            var cacheKey = "bedrock:embed:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{_bedrock.EmbeddingModel}|{dimensions}|{text}")));
            if (cache.TryGetValue(cacheKey, out float[]? cached) && cached is not null) return cached;

            try
            {
                // Bedrock runtime "invoke model" call, authorised with the Bedrock API key as a bearer token.
                // normalize = true returns unit-length vectors, so a dot product gives the cosine similarity.
                var body = new StringContent(JsonSerializer.Serialize(new { inputText = text, dimensions, normalize = true }), Encoding.UTF8);
                // Bedrock rejects "application/json; charset=utf-8" (HTTP 400), so send the bare media type.
                body.Headers.ContentType = new MediaTypeHeaderValue("application/json");

                using var request = new HttpRequestMessage(HttpMethod.Post,
                    $"https://bedrock-runtime.{_bedrock.Region}.amazonaws.com/model/{_bedrock.EmbeddingModel}/invoke") { Content = body };
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _bedrock.ApiKey);
                request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

                using var response = await http.SendAsync(request, ct);
                if (!response.IsSuccessStatusCode)
                {
                    // Bedrock's error body explains the problem (bad key, wrong region, model not enabled...).
                    var error = await response.Content.ReadAsStringAsync(ct);
                    logger.LogWarning("Bedrock embedding failed with HTTP {Status}: {Error}. Ranking similar days on rules only.",
                        (int)response.StatusCode, error.Length > 300 ? error[..300] : error);
                    return null;
                }

                using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
                var vector = doc.RootElement.GetProperty("embedding").EnumerateArray().Select(v => v.GetSingle()).ToArray();
                cache.Set(cacheKey, vector, TimeSpan.FromDays(1));
                return vector;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or KeyNotFoundException)
            {
                // Cancelled by the caller: let that propagate as normal.
                if (ct.IsCancellationRequested) throw;
                logger.LogWarning(ex, "Bedrock embedding failed; ranking similar days on rules only.");
                return null;
            }
        }

        /// <summary>
        /// Finds the Bedrock API key for local development without putting it in appsettings.json:
        /// first the AWS_BEARER_TOKEN_BEDROCK environment variable, then the AI agent's git-ignored
        /// .env file (bbna-hackmw26.client/src/api/.env), which holds the same key. Returns "" if neither has it.
        /// </summary>
        public static string FindApiKey(string contentRootPath)
        {
            var fromEnvironment = Environment.GetEnvironmentVariable("AWS_BEARER_TOKEN_BEDROCK");
            if (!string.IsNullOrWhiteSpace(fromEnvironment)) return fromEnvironment.Trim();

            var envFile = Path.GetFullPath(Path.Combine(contentRootPath, "..", "bbna-hackmw26.client", "src", "api", ".env"));
            if (!File.Exists(envFile)) return "";

            // File.ReadAllLines skips the invisible byte-order mark Notepad may add at the start.
            foreach (var line in File.ReadAllLines(envFile))
            {
                var trimmed = line.Trim();
                if (trimmed.StartsWith("AWS_BEARER_TOKEN_BEDROCK=", StringComparison.Ordinal))
                    return trimmed["AWS_BEARER_TOKEN_BEDROCK=".Length..].Trim().Trim('"', '\'');
            }
            return "";
        }
    }
}
