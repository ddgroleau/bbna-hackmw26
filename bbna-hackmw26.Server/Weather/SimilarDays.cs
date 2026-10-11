using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;

namespace bbna_hackmw26.Server.Weather
{
    // =====================================================================================
    // GET /api/weather/similar-days: finds past Kansas City days whose weather pattern most
    // resembles the forecast for a workday, so the AI agent can say "this looks like Feb 16 2023,
    // when a refreeze caused 8.7x the usual morning-commute crashes".
    //
    // How it works:
    //   1. tools/weather-history/build_cards.py turned 2019-2024 into "event cards" (one per notable
    //      day), each with a text summary and a set of FEATURES (refreeze, ice, snow amount, alerts...).
    //   2. Here, the SAME features are computed from the forecast + alerts + storm outlook for the
    //      day being decided (DayFeatures.FromForecast).
    //   3. Past days of the same hazard type are scored on how well their features match (Rank).
    //      If a Bedrock key is configured, the forecast is also embedded with Titan and compared with
    //      each card's stored embedding, as a small tie-breaker.
    // =====================================================================================

    /// <summary>
    /// The facts used to match a forecast day with past days. Stored per card by build_cards.py
    /// (snake_case JSON) and computed from the forecast by <see cref="FromForecast"/>.
    /// The two definitions must stay in step; they're documented at the top of build_cards.py.
    /// </summary>
    public record DayFeatures
    {
        /// <summary>Any precipitation from 6 PM the evening before until 6 AM.</summary>
        public bool OvernightPrecip { get; init; }

        /// <summary>Lowest temperature during the morning commute (6-9 AM), °F.</summary>
        public double? MorningLowF { get; init; }

        /// <summary>Overnight precipitation and at or below 32°F at the morning commute: wet roads freezing (black ice).</summary>
        public bool Refreeze { get; init; }

        /// <summary>Freezing rain, freezing drizzle or sleet at some point.</summary>
        public bool Ice { get; init; }

        /// <summary>New snow, inches.</summary>
        public double SnowIn { get; init; }

        /// <summary>Lowest temperature from 6 PM the evening before until 6 PM, °F.</summary>
        public double? LowF { get; init; }

        /// <summary>LowF at or below 0°F.</summary>
        public bool ExtremeCold { get; init; }

        /// <summary>Thunderstorms at some point.</summary>
        public bool ThunderAny { get; init; }

        /// <summary>Thunderstorms during the morning or evening commute.</summary>
        public bool ThunderCommute { get; init; }

        /// <summary>Severe Thunderstorm or Tornado Watch/Warning (or, for a forecast, an SPC Slight risk or higher).</summary>
        public bool SevereAlert { get; init; }

        /// <summary>Tornado Watch or Warning.</summary>
        public bool TornadoAlert { get; init; }

        /// <summary>Flash Flood Warning.</summary>
        public bool FloodAlert { get; init; }

        /// <summary>Winter Storm, Ice Storm or Blizzard Warning (for a forecast, also a Winter Storm Watch).</summary>
        public bool WinterWarning { get; init; }

        /// <summary>Winter Weather or Freezing Rain Advisory.</summary>
        public bool WinterAdvisory { get; init; }

        /// <summary>Wind Chill Advisory/Warning or Extreme Cold Warning.</summary>
        public bool ColdAlert { get; init; }

        /// <summary>Month, 1-12 (for matching the season).</summary>
        public int Month { get; init; }

        /// <summary>A winter-type day: snow, ice, refreeze, extreme cold, or a winter/cold alert.</summary>
        public bool IsWinter => SnowIn >= 0.1 || Ice || Refreeze || ExtremeCold || WinterWarning || WinterAdvisory || ColdAlert;

        /// <summary>A severe-storm-type day: thunderstorms, or a severe storm / flash flood alert.</summary>
        public bool IsStorm => ThunderAny || SevereAlert || FloodAlert;

        // How "likely enough" a forecast chance has to be to count as expected.
        private const double ThunderChanceCutoff = 40;

        /// <summary>
        /// Computes the features for a forecast workday, using the alerts and SPC outlook that apply to it.
        /// </summary>
        /// <param name="day">The workday from /api/weather/forecast.</param>
        /// <param name="alerts">Active NWS alerts; only those overlapping the day (6 PM the evening before to 6 PM) count.</param>
        /// <param name="outlook">The SPC outlook day covering this date, if there is one (SPC only looks 3 days ahead).</param>
        public static DayFeatures FromForecast(WorkdayForecast day, IEnumerable<WeatherAlert> alerts, StormOutlookDay? outlook)
        {
            var dayStart = day.Overnight.Start;
            var dayEnd = day.EveningCommute.End;

            // Alerts in effect at some point during this day. An alert with no end time is treated as open-ended.
            var names = alerts
                .Where(a => (a.Onset ?? a.Sent ?? DateTimeOffset.MinValue) < dayEnd && (a.Ends ?? a.Expires ?? DateTimeOffset.MaxValue) > dayStart)
                .Select(a => a.Event)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var overnight = day.Overnight;
            var overnightPrecip = (overnight.PrecipInches ?? 0) >= 0.01 || (overnight.SnowInches ?? 0) > 0 || (overnight.IceInches ?? 0) > 0;
            var morningLow = day.MorningCommute.LowestTemperatureF;
            var low = day.WholeDay.LowestTemperatureF;
            var thunder = (day.WholeDay.HighestThunderChancePercent ?? 0) >= ThunderChanceCutoff || outlook?.ThunderstormsExpected == true;

            return new DayFeatures
            {
                OvernightPrecip = overnightPrecip,
                MorningLowF = morningLow,
                Refreeze = overnightPrecip && morningLow <= 32,
                Ice = (day.WholeDay.IceInches ?? 0) >= 0.01,
                SnowIn = day.WholeDay.SnowInches ?? 0,
                LowF = low,
                ExtremeCold = low <= 0,
                ThunderAny = thunder,
                ThunderCommute = Math.Max(day.MorningCommute.HighestThunderChancePercent ?? 0,
                                          day.EveningCommute.HighestThunderChancePercent ?? 0) >= ThunderChanceCutoff,
                // History counts Severe Thunderstorm/Tornado watches and warnings. A forecast day usually has
                // none yet, so SPC's Slight risk (level 2) or higher stands in as "severe storms likely".
                SevereAlert = names.Any(n => n.StartsWith("Severe Thunderstorm", StringComparison.OrdinalIgnoreCase)
                                          || n.StartsWith("Tornado", StringComparison.OrdinalIgnoreCase))
                              || (outlook?.RiskLevel ?? 0) >= 2,
                TornadoAlert = names.Any(n => n.StartsWith("Tornado", StringComparison.OrdinalIgnoreCase)),
                FloodAlert = names.Contains("Flash Flood Warning"),
                // A Winter Storm Watch is the usual heads-up a day or two before a warning, so it counts here.
                WinterWarning = names.Overlaps(["Winter Storm Warning", "Ice Storm Warning", "Blizzard Warning", "Winter Storm Watch"]),
                WinterAdvisory = names.Overlaps(["Winter Weather Advisory", "Freezing Rain Advisory"]),
                ColdAlert = names.Overlaps(["Wind Chill Advisory", "Wind Chill Warning", "Extreme Cold Warning", "Cold Weather Advisory"]),
                Month = day.Date.Month,
            };
        }
    }

    /// <summary>One past day from the history database.</summary>
    public record HistoryCard(
        string Id, DateOnly Date, string Hazard, bool IsWorkday, string Text,
        DayFeatures Features, JsonElement Details, float[]? Embedding, string? EmbeddingModel);

    /// <summary>
    /// The past-days database (read-only), loaded into memory once on first use: it's small
    /// (a few hundred cards, ~2 MB), so every search scores all of them directly.
    /// </summary>
    public class WeatherHistoryStore
    {
        private readonly Lazy<IReadOnlyList<HistoryCard>> _cards;

        public WeatherHistoryStore(IOptions<WeatherHistoryOptions> options, IWebHostEnvironment env, ILogger<WeatherHistoryStore> logger)
        {
            var path = Path.GetFullPath(options.Value.DatabasePath, env.ContentRootPath);
            _cards = new Lazy<IReadOnlyList<HistoryCard>>(() => Load(path, logger));
        }

        /// <summary>All past days. Empty if the database file is missing (the endpoint then says so).</summary>
        public IReadOnlyList<HistoryCard> Cards => _cards.Value;

        private static IReadOnlyList<HistoryCard> Load(string path, ILogger logger)
        {
            if (!File.Exists(path))
            {
                logger.LogWarning("Weather history database not found at {Path}; similar-days will return no matches. " +
                                  "Build it with tools/weather-history/build_cards.py.", path);
                return [];
            }

            // build_cards.py writes the features as snake_case JSON (overnight_precip, snow_in...).
            var json = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
            var cards = new List<HistoryCard>();

            using var conn = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Mode = SqliteOpenMode.ReadOnly }.ToString());
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT id, date, hazard, is_workday, text, features, details, embedding, embedding_model FROM event_cards";
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                float[]? embedding = null;
                if (!reader.IsDBNull(7))
                {
                    // Stored as little-endian float32 values, 4 bytes each.
                    var bytes = (byte[])reader[7];
                    embedding = new float[bytes.Length / 4];
                    Buffer.BlockCopy(bytes, 0, embedding, 0, bytes.Length);
                }
                using var details = JsonDocument.Parse(reader.GetString(6));
                cards.Add(new HistoryCard(
                    reader.GetString(0),
                    DateOnly.ParseExact(reader.GetString(1), "yyyy-MM-dd", CultureInfo.InvariantCulture),
                    reader.GetString(2),
                    reader.GetInt64(3) == 1,
                    reader.GetString(4),
                    JsonSerializer.Deserialize<DayFeatures>(reader.GetString(5), json)!,
                    details.RootElement.Clone(),
                    embedding,
                    reader.IsDBNull(8) ? null : reader.GetString(8)));
            }

            logger.LogInformation("Loaded {Count} past weather days ({Embedded} with embeddings) from {Path}.",
                cards.Count, cards.Count(c => c.Embedding is not null), path);
            return cards;
        }
    }

    /// <summary>A past day that matches the forecast, as returned to the frontend and the AI agent.</summary>
    public record SimilarPastDay
    {
        /// <summary>Card ID, e.g. "kc-2023-02-16". The agent cites days by this or by date.</summary>
        public required string Id { get; init; }
        public required DateOnly Date { get; init; }
        public required string DayOfWeek { get; init; }

        /// <summary>"winter" or "severe_storm".</summary>
        public required string Hazard { get; init; }

        /// <summary>How closely it matches, 0-1 (1 = every matching fact agrees).</summary>
        public required double Score { get; init; }

        /// <summary>Plain-language reasons it was picked, e.g. "refreeze: precipitation overnight, then below freezing at the morning commute".</summary>
        public required IReadOnlyList<string> MatchedOn { get; init; }

        /// <summary>The day's full summary: conditions per window, warnings, NOAA storm reports and injury crashes vs typical.</summary>
        public required string Summary { get; init; }

        /// <summary>NWS warnings/advisories issued for Jackson County that day.</summary>
        public required IReadOnlyList<string> Warnings { get; init; }

        /// <summary>NOAA Storm Events IDs, for looking the reports up.</summary>
        public required IReadOnlyList<string> StormEventIds { get; init; }

        /// <summary>Injuries / deaths in NOAA's storm reports for the county (not traffic crashes).</summary>
        public int Injured { get; init; }
        public int Killed { get; init; }

        /// <summary>Injury crashes in KC during the morning / evening commute vs a typical day (e.g. 8.7 = 8.7x). Null if unknown.</summary>
        public double? MorningCommuteCrashRatio { get; init; }
        public double? EveningCommuteCrashRatio { get; init; }
    }

    /// <summary>Response for GET /api/weather/similar-days.</summary>
    public record SimilarDaysResponse
    {
        public required string BuildingName { get; init; }

        /// <summary>The workday the forecast is for.</summary>
        public required DateOnly Date { get; init; }

        /// <summary>The facts computed from the forecast, alerts and storm outlook that past days were matched on.</summary>
        public required DayFeatures ForecastPattern { get; init; }

        /// <summary>True if the forecast embedding (Bedrock Titan) was used as a tie-breaker; false = rules only.</summary>
        public required bool UsedEmbeddings { get; init; }

        /// <summary>Why the list is empty or limited, e.g. "No winter or severe-storm weather is forecast". Null when there's nothing to say.</summary>
        public string? Note { get; init; }

        /// <summary>Where the history comes from.</summary>
        public required string Source { get; init; }

        /// <summary>Best matches first. Empty when the day's weather is unremarkable or nothing matches well.</summary>
        public required IReadOnlyList<SimilarPastDay> Matches { get; init; }
    }

    /// <summary>Scores past days against a forecast day's features.</summary>
    public static class SimilarDaysMatcher
    {
        public const string Source =
            "Kansas City 2019-2024: NOAA Storm Events (Jackson County), NWS warnings (Iowa Environmental Mesonet archive), " +
            "hourly observations at KC Downtown Airport, NOAA GHCN-Daily at KCI, and KCMO injury-crash records (Missouri Highway Patrol).";

        // Share of the final score from the embedding tie-breaker (the rest is the matching rules).
        private const double EmbeddingWeight = 0.15;

        /// <summary>
        /// Ranks past days by how well they match. Only days of the same hazard type as the forecast are
        /// considered (winter vs severe storm), and only workdays when the forecast day is a workday.
        /// </summary>
        public static IReadOnlyList<SimilarPastDay> Rank(
            DayFeatures forecast, bool isWorkday, IEnumerable<HistoryCard> cards, float[]? forecastEmbedding,
            double minimumScore, int limit)
        {
            var hazards = new List<string>();
            if (forecast.IsWinter) hazards.Add("winter");
            if (forecast.IsStorm) hazards.Add("severe_storm");

            var results = new List<(double Score, HistoryCard Card, List<string> Reasons)>();
            foreach (var card in cards)
            {
                if (!hazards.Contains(card.Hazard) || (isWorkday && !card.IsWorkday)) continue;

                var (rulesScore, reasons) = ScoreRules(forecast, card.Features, card.Hazard);
                if (rulesScore < minimumScore) continue;   // a weak match is worse than none

                var score = rulesScore;
                if (forecastEmbedding is not null && card.Embedding is { } e && e.Length == forecastEmbedding.Length)
                {
                    // Vectors are unit length, so the dot product is the cosine similarity. All cards share a template,
                    // so cosines bunch up around 0.75-0.95; stretch that band to 0-1 before blending.
                    var cosine = Dot(forecastEmbedding, e);
                    score = (1 - EmbeddingWeight) * rulesScore + EmbeddingWeight * Math.Clamp((cosine - 0.75) / 0.2, 0, 1);
                }
                results.Add((score, card, reasons));
            }

            return results
                .OrderByDescending(r => r.Score)
                .ThenByDescending(r => r.Card.Date)         // on a tie, prefer the more recent day
                .Take(limit)
                .Select(r => ToResult(r.Card, r.Score, r.Reasons))
                .ToList();
        }

        /// <summary>
        /// 0-1 score from the matching rules, plus plain-language reasons. Each rule has a weight; yes/no facts
        /// only count when at least one side has them (two calm days aren't "similar" just because both lack a tornado).
        /// </summary>
        private static (double Score, List<string> Reasons) ScoreRules(DayFeatures q, DayFeatures c, string hazard)
        {
            double total = 0, weights = 0;
            var reasons = new List<string>();

            void Flag(bool forecastHas, bool pastHas, double weight, string reason)
            {
                if (!forecastHas && !pastHas) return;
                weights += weight;
                if (forecastHas == pastHas) { total += weight; reasons.Add(reason); }
            }

            void Closeness(double weight, double similarity, string? reason)
            {
                weights += weight; total += weight * similarity;
                if (reason is not null) reasons.Add(reason);
            }

            // Ordered roughly by how much they matter for getting to and from work safely.
            Flag(q.Refreeze, c.Refreeze, 3, "refreeze: precipitation overnight, then below freezing at the morning commute");
            Flag(q.Ice, c.Ice, 2, "freezing rain or sleet");
            Flag(q.TornadoAlert, c.TornadoAlert, 2, "Tornado Watch/Warning");
            Flag(q.SevereAlert, c.SevereAlert, 2, "severe thunderstorm/tornado threat");
            Flag(q.ThunderCommute, c.ThunderCommute, 1.5, "thunderstorms during a commute");
            Flag(q.WinterWarning, c.WinterWarning, 1.5, "Winter Storm/Ice Storm/Blizzard Warning");
            Flag(q.ExtremeCold, c.ExtremeCold, 1.5, "extreme cold (0°F or below)");
            Flag(q.ThunderAny, c.ThunderAny, 1, "thunderstorms");
            Flag(q.FloodAlert, c.FloodAlert, 1, "Flash Flood Warning");
            Flag(q.WinterAdvisory, c.WinterAdvisory, 1, "Winter Weather/Freezing Rain Advisory");
            Flag(q.ColdAlert, c.ColdAlert, 1, "wind chill/extreme cold alert");

            if (hazard == "winter")
            {
                // Snow in rough bands: none, under 1 in, 1-3, 3-6, 6+.
                var qb = SnowBand(q.SnowIn); var cb = SnowBand(c.SnowIn);
                Closeness(2, 1 - Math.Abs(qb - cb) / 4.0,
                    qb == cb && q.SnowIn >= 0.1 ? $"similar snow ({c.SnowIn:0.#} in then, {q.SnowIn:0.#} in forecast)" : null);
            }
            if (q.LowF is { } ql && c.LowF is { } cl)
            {
                // Temperature matters more in winter (freezing or not) than for storms.
                var diff = Math.Abs(ql - cl);
                Closeness(hazard == "winter" ? 1 : 0.5, Math.Max(0, 1 - diff / 20),
                    hazard == "winter" && diff <= 5 ? $"similar low temperature ({cl:0}°F then, {ql:0}°F forecast)" : null);
            }
            var months = Math.Abs(q.Month - c.Month);
            Closeness(0.5, 1 - Math.Min(months, 12 - months) / 6.0, null);   // same time of year

            return (weights == 0 ? 0 : total / weights, reasons);
        }

        private static int SnowBand(double inches) => inches < 0.1 ? 0 : inches < 1 ? 1 : inches < 3 ? 2 : inches < 6 ? 3 : 4;

        private static double Dot(float[] a, float[] b)
        {
            double sum = 0;
            for (var i = 0; i < a.Length; i++) sum += a[i] * b[i];
            return sum;
        }

        private static SimilarPastDay ToResult(HistoryCard card, double score, List<string> reasons)
        {
            var d = card.Details;
            IReadOnlyList<string> Strings(string name) =>
                d.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array ? v.EnumerateArray().Select(x => x.GetString() ?? "").ToList() : [];
            double? Number(string name) =>
                d.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;

            return new SimilarPastDay
            {
                Id = card.Id,
                Date = card.Date,
                DayOfWeek = card.Date.DayOfWeek.ToString(),
                Hazard = card.Hazard,
                Score = Math.Round(score, 2),
                MatchedOn = reasons,
                Summary = card.Text,
                Warnings = Strings("warnings"),
                StormEventIds = Strings("storm_event_ids"),
                Injured = (int)(Number("injured") ?? 0),
                Killed = (int)(Number("killed") ?? 0),
                MorningCommuteCrashRatio = Number("morning_commute_crash_ratio"),
                EveningCommuteCrashRatio = Number("evening_commute_crash_ratio"),
            };
        }

        /// <summary>
        /// Describes the forecast day in the same format as the stored cards, so its embedding can be
        /// compared with theirs. Forecast amounts become the same weather words the cards use.
        /// </summary>
        public static string QueryText(WorkdayForecast day, DayFeatures f, IEnumerable<WeatherAlert> alerts)
        {
            string Words(ForecastWindow w)
            {
                var words = new List<string>();
                if ((w.IceInches ?? 0) > 0) words.Add("freezing rain");
                if ((w.SnowInches ?? 0) >= 2) words.Add("heavy snow"); else if ((w.SnowInches ?? 0) > 0) words.Add("snow");
                if ((w.HighestThunderChancePercent ?? 0) >= 40) words.Add("thunderstorms");
                if (words.Count == 0 && (w.HighestPrecipChancePercent ?? 0) >= 50) words.Add(w.LowestTemperatureF <= 32 ? "snow" : "rain");
                return words.Count == 0 ? "dry" : string.Join(", ", words);
            }
            string Line(string label, ForecastWindow w)
            {
                var temps = w.LowestTemperatureF is { } lo && w.HighestTemperatureF is { } hi ? $"{lo:0}-{hi:0}°F" : "temps n/a";
                var precip = (w.PrecipInches ?? 0) >= 0.01 ? $", {w.PrecipInches:0.00} in precip" : "";
                return $"- {label}: {Words(w)}, {temps}{precip}";
            }

            var kinds = new[] { ("refreeze", f.Refreeze), ("ice", f.Ice), ("snow", f.SnowIn >= 0.1), ("extreme cold", f.ExtremeCold),
                                ("thunderstorms", f.ThunderAny), ("tornado", f.TornadoAlert) }
                .Where(k => k.Item2).Select(k => k.Item1).ToList();
            var hazard = f.IsWinter ? "winter" : "severe storm";
            var alertNames = alerts.Select(a => a.Event).Distinct().ToList();

            return string.Join("\n", new[]
            {
                $"Kansas City weather event in {day.Date.ToString("MMMM", CultureInfo.InvariantCulture)} (workday).",
                $"Hazard: {hazard}" + (kinds.Count > 0 ? $" ({string.Join(", ", kinds)})" : "") + ".",
                "Conditions by window (KC Downtown Airport):",
                Line("Overnight (6 PM prior day - 6 AM)", day.Overnight),
                Line("Morning commute (6-9 AM)", day.MorningCommute),
                Line("Office hours (9 AM - 4 PM)", day.OfficeHours),
                Line("Evening commute (4-6 PM)", day.EveningCommute),
                f.SnowIn >= 0.1 ? $"Measured at KCI Airport: snow {f.SnowIn:0.#} in." : null,
                $"NWS warnings/advisories for Jackson County: {(alertNames.Count > 0 ? string.Join("; ", alertNames) : "none")}.",
            }.Where(l => l is not null));
        }
    }
}
