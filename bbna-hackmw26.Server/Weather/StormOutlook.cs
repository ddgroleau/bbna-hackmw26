using System.Text.Json;

namespace bbna_hackmw26.Server.Weather
{
    /// <summary>
    /// Response for GET /api/weather/storm-outlook: the Storm Prediction Center's severe
    /// thunderstorm risk at the building for today, tomorrow and the day after.
    /// </summary>
    public record StormOutlookResponse
    {
        /// <summary>Name of the federal building the outlook is for.</summary>
        public required string BuildingName { get; init; }

        /// <summary>When our server downloaded the outlooks from SPC (UTC; may be a few minutes old due to caching).</summary>
        public required DateTimeOffset RetrievedAt { get; init; }

        /// <summary>The highest RiskLevel across all three days (0-5), for a quick "any storm risk coming?" check.</summary>
        public int HighestRiskLevel => Days.Count == 0 ? 0 : Days.Max(d => d.RiskLevel);

        /// <summary>Day 1, Day 2 and Day 3, in order.</summary>
        public required IReadOnlyList<StormOutlookDay> Days { get; init; }
    }

    /// <summary>
    /// The SPC risk at the building for one outlook day.
    ///
    /// SPC's risk categories, lowest to highest (RiskLevel in brackets):
    ///   NONE  No thunderstorms forecast             (0)
    ///   TSTM  General (non-severe) thunderstorms    (0)
    ///   MRGL  Marginal risk  - isolated severe storms possible            (1)
    ///   SLGT  Slight risk    - scattered severe storms possible           (2)
    ///   ENH   Enhanced risk  - numerous severe storms possible            (3)
    ///   MDT   Moderate risk  - widespread severe storms likely            (4)
    ///   HIGH  High risk      - widespread, long-lived, intense storms     (5)
    /// "Severe" means a tornado, hail 1 inch or larger, or wind gusts of 58 mph or more.
    /// </summary>
    public record StormOutlookDay
    {
        /// <summary>1 = today/tonight, 2 = tomorrow, 3 = the day after.</summary>
        public required int Day { get; init; }

        /// <summary>SPC's short category code: NONE, TSTM, MRGL, SLGT, ENH, MDT or HIGH.</summary>
        public required string Category { get; init; }

        /// <summary>Plain-language category, e.g. "Slight Risk".</summary>
        public required string Label { get; init; }

        /// <summary>SPC's 0-5 severe risk scale (see the table above). 0 = no severe storms expected.</summary>
        public required int RiskLevel { get; init; }

        /// <summary>True if any thunderstorms (severe or not) are forecast at the building (category TSTM or higher).</summary>
        public required bool ThunderstormsExpected { get; init; }

        /// <summary>
        /// Start of the period the outlook covers (UTC). Each SPC "day" runs 12:00 UTC to 12:00 UTC
        /// (7 AM to 7 AM Central in summer). Null if SPC published an empty map (no storms anywhere).
        /// </summary>
        public DateTimeOffset? ValidFrom { get; init; }

        /// <summary>End of the period the outlook covers (UTC).</summary>
        public DateTimeOffset? ValidUntil { get; init; }

        /// <summary>When SPC issued this outlook. SPC re-issues Day 1 several times a day.</summary>
        public DateTimeOffset? IssuedAt { get; init; }

        /// <summary>The SPC map file this came from.</summary>
        public required string SourceUrl { get; init; }
    }

    /// <summary>
    /// Works out the building's risk category from the SPC outlook maps.
    ///
    /// Each SPC map has one area per category (TSTM, MRGL, SLGT, ...), drawn as GeoJSON polygons.
    /// Higher-risk areas sit inside lower-risk ones, so the building's category is the
    /// HIGHEST category whose area contains the building's coordinates.
    /// </summary>
    public static class StormOutlookBuilder
    {
        // SPC categories, lowest to highest. A category's position here is how it's ranked.
        private static readonly string[] CategoryOrder = ["NONE", "TSTM", "MRGL", "SLGT", "ENH", "MDT", "HIGH"];

        // Plain-language labels for each category.
        private static readonly Dictionary<string, string> Labels = new()
        {
            ["NONE"] = "No Thunderstorms Forecast",
            ["TSTM"] = "General Thunderstorms",
            ["MRGL"] = "Marginal Risk",
            ["SLGT"] = "Slight Risk",
            ["ENH"] = "Enhanced Risk",
            ["MDT"] = "Moderate Risk",
            ["HIGH"] = "High Risk",
        };

        /// <summary>Builds the response from the three raw outlook maps.</summary>
        public static StormOutlookResponse Build(IReadOnlyList<RawSpcOutlook> outlooks, BuildingOptions building) => new()
        {
            BuildingName = building.Name,
            RetrievedAt = outlooks.Min(o => o.RetrievedAt),
            Days = outlooks.OrderBy(o => o.Day).Select(o => BuildDay(o, building)).ToList(),
        };

        /// <summary>Finds the building's category on one day's map.</summary>
        private static StormOutlookDay BuildDay(RawSpcOutlook outlook, BuildingOptions building)
        {
            var category = "NONE";
            DateTimeOffset? validFrom = null, validUntil = null, issuedAt = null;

            foreach (var feature in outlook.Data.GetProperty("features").EnumerateArray())
            {
                var props = feature.GetProperty("properties");

                // Every area on the map shares the same valid/issue times, so read them from any of them.
                validFrom ??= ReadTimestamp(props, "VALID_ISO");
                validUntil ??= ReadTimestamp(props, "EXPIRE_ISO");
                issuedAt ??= ReadTimestamp(props, "ISSUE_ISO");

                // Keep this area's category if it's higher than what we've found so far AND the building is inside it.
                var label = props.TryGetProperty("LABEL", out var l) ? l.GetString() ?? "" : "";
                if (Rank(label) > Rank(category) && Contains(feature.GetProperty("geometry"), building.Longitude, building.Latitude))
                    category = label;
            }

            var rank = Rank(category);
            return new StormOutlookDay
            {
                Day = outlook.Day,
                Category = category,
                Label = Labels[category],
                // NONE and TSTM are both 0 (no severe storms); MRGL..HIGH are 1..5.
                RiskLevel = Math.Max(0, rank - 1),
                ThunderstormsExpected = rank >= 1,
                ValidFrom = validFrom,
                ValidUntil = validUntil,
                IssuedAt = issuedAt,
                SourceUrl = outlook.SourceUrl,
            };
        }

        /// <summary>A category's position in CategoryOrder; anything unrecognised (e.g. a new SPC label) ranks below NONE so it's ignored.</summary>
        private static int Rank(string category) => Array.IndexOf(CategoryOrder, category);

        // ---------------------------------------------------------------------
        // "Is the building inside this map area?"
        // ---------------------------------------------------------------------

        /// <summary>
        /// True if the point (longitude, latitude) is inside a GeoJSON Polygon or MultiPolygon.
        /// GeoJSON lists coordinates as [longitude, latitude].
        /// </summary>
        private static bool Contains(JsonElement geometry, double lon, double lat)
        {
            var type = geometry.GetProperty("type").GetString();
            var coords = geometry.GetProperty("coordinates");
            return type switch
            {
                "Polygon" => PolygonContains(coords, lon, lat),
                // A MultiPolygon is a list of separate polygons; inside any one of them counts.
                "MultiPolygon" => coords.EnumerateArray().Any(polygon => PolygonContains(polygon, lon, lat)),
                _ => false,
            };
        }

        /// <summary>
        /// A GeoJSON polygon is a list of rings: the first is the outline, any others are holes cut out of it.
        /// The point is inside if it's inside the outline and not inside any hole.
        /// </summary>
        private static bool PolygonContains(JsonElement rings, double lon, double lat)
        {
            var inside = false;
            var index = 0;
            foreach (var ring in rings.EnumerateArray())
            {
                var inRing = RingContains(ring, lon, lat);
                if (index == 0)
                {
                    if (!inRing) return false;  // outside the outline: definitely not inside
                    inside = true;
                }
                else if (inRing)
                {
                    return false;               // inside a hole: not inside the polygon
                }
                index++;
            }
            return inside;
        }

        /// <summary>
        /// Standard "ray casting" test: draw a line from the point eastwards and count how many
        /// edges of the ring it crosses. An odd count means the point is inside.
        /// </summary>
        private static bool RingContains(JsonElement ring, double lon, double lat)
        {
            var points = ring.EnumerateArray().Select(p => (X: p[0].GetDouble(), Y: p[1].GetDouble())).ToList();
            var inside = false;
            for (int i = 0, j = points.Count - 1; i < points.Count; j = i++)
            {
                var (xi, yi) = points[i];
                var (xj, yj) = points[j];

                // Does the edge from point j to point i cross the horizontal line at the point's latitude,
                // to the east of the point?
                if ((yi > lat) != (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
                    inside = !inside;
            }
            return inside;
        }

        /// <summary>Reads a date/time property; returns null if it's missing or not a valid date.</summary>
        private static DateTimeOffset? ReadTimestamp(JsonElement props, string name) =>
            props.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String && value.TryGetDateTimeOffset(out var time)
                ? time
                : null;
    }
}
