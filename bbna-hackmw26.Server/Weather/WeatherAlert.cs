using System.Text.Json;

namespace bbna_hackmw26.Server.Weather
{
    /// <summary>
    /// Response for GET /api/weather/alerts: every National Weather Service alert
    /// (watch, warning, advisory...) currently in effect at the building, most serious first.
    /// </summary>
    public record WeatherAlertsResponse
    {
        /// <summary>Name of the federal building the alerts are for.</summary>
        public required string BuildingName { get; init; }

        /// <summary>When our server fetched the alerts from NWS (UTC; may be up to a minute old due to caching).</summary>
        public required DateTimeOffset RetrievedAt { get; init; }

        /// <summary>Number of alerts in the list. 0 means no active alerts (the normal state on a calm day).</summary>
        public int Count => Alerts.Count;

        /// <summary>True if any alert is Extreme or Severe, so the frontend can show a banner without checking each one.</summary>
        public bool HasSevereAlerts => Alerts.Any(a => a.IsSevere);

        /// <summary>The alerts, sorted most serious first (by severity, then urgency, then start time).</summary>
        public required IReadOnlyList<WeatherAlert> Alerts { get; init; }
    }

    /// <summary>
    /// One NWS alert, e.g. a Tornado Warning or Severe Thunderstorm Watch, in a simple shape.
    ///
    /// Severity, Urgency and Certainty use NWS's standard words (from the Common Alerting Protocol):
    ///   Severity:  Extreme, Severe, Moderate, Minor, Unknown   (how bad)
    ///   Urgency:   Immediate, Expected, Future, Past, Unknown  (how soon to act)
    ///   Certainty: Observed, Likely, Possible, Unlikely, Unknown (how sure NWS is)
    /// </summary>
    public record WeatherAlert
    {
        /// <summary>Unique NWS ID for the alert. Stays the same if NWS re-sends it, so it's safe to use as a list key.</summary>
        public required string Id { get; init; }

        /// <summary>Type of alert, e.g. "Tornado Warning", "Severe Thunderstorm Watch", "Heat Advisory".</summary>
        public required string Event { get; init; }

        public required string Severity { get; init; }
        public required string Urgency { get; init; }
        public required string Certainty { get; init; }

        /// <summary>True when Severity is Extreme or Severe, i.e. a threat to life or property.</summary>
        public bool IsSevere => Severity is "Extreme" or "Severe";

        /// <summary>One-line summary, e.g. "Tornado Warning issued October 10 at 3:05PM CDT until 3:45PM CDT by NWS Kansas City/Pleasant Hill MO".</summary>
        public string? Headline { get; init; }

        /// <summary>Full NWS text describing the hazard, where and when. Contains line breaks.</summary>
        public string? Description { get; init; }

        /// <summary>What people should do, e.g. "TAKE COVER NOW!". Not every alert has one.</summary>
        public string? Instruction { get; init; }

        /// <summary>Counties/areas the alert covers, e.g. "Jackson, MO; Wyandotte, KS".</summary>
        public string? AreaDescription { get; init; }

        /// <summary>"Alert" for a new alert, "Update" when NWS changes an existing one.</summary>
        public string? MessageType { get; init; }

        /// <summary>The NWS office that issued it, e.g. "NWS Kansas City/Pleasant Hill MO".</summary>
        public string? SenderName { get; init; }

        /// <summary>When NWS issued this message.</summary>
        public DateTimeOffset? Sent { get; init; }

        /// <summary>When the hazard is expected to start (may be in the future for watches).</summary>
        public DateTimeOffset? Onset { get; init; }

        /// <summary>When this message expires (NWS may re-issue or extend it before then).</summary>
        public DateTimeOffset? Expires { get; init; }

        /// <summary>When the hazard itself is expected to end. Often null; fall back to Expires.</summary>
        public DateTimeOffset? Ends { get; init; }

        // --- Storm details. NWS only includes these on storm-related alerts (mainly Tornado and
        // --- Severe Thunderstorm Warnings); on every other alert they are null.

        /// <summary>How the tornado was detected: "RADAR INDICATED" (radar shows rotation) or "OBSERVED" (a tornado has been seen).</summary>
        public string? TornadoDetection { get; init; }

        /// <summary>
        /// Extra tornado threat tag on the most dangerous warnings: "CONSIDERABLE" (a "particularly dangerous
        /// situation") or "CATASTROPHIC" (a Tornado Emergency: a confirmed, violent tornado heading for a populated area).
        /// </summary>
        public string? TornadoDamageThreat { get; init; }

        /// <summary>Severe thunderstorm damage tag: "CONSIDERABLE" or "DESTRUCTIVE" (e.g. 80+ mph winds or baseball-size hail).</summary>
        public string? ThunderstormDamageThreat { get; init; }

        /// <summary>Largest expected hail, in inches (e.g. 1.75 = golf ball size).</summary>
        public double? MaxHailSizeInches { get; init; }

        /// <summary>Strongest expected wind gust, in mph.</summary>
        public double? MaxWindGustMph { get; init; }

        /// <summary>True if a tornado has actually been seen, not just indicated on radar.</summary>
        public bool IsConfirmedTornado => TornadoDetection == "OBSERVED";

        /// <summary>True for a Tornado Emergency, the most serious tornado alert NWS issues.</summary>
        public bool IsTornadoEmergency => TornadoDamageThreat == "CATASTROPHIC";

        /// <summary>
        /// Builds the alerts response from the raw NWS alerts JSON (a GeoJSON "FeatureCollection"
        /// with one "feature" per alert), sorted most serious first.
        /// </summary>
        public static WeatherAlertsResponse ListFromRaw(RawAlerts raw, BuildingOptions building)
        {
            var alerts = raw.Data.GetProperty("features")
                .EnumerateArray()
                .Select(feature => FromFeature(feature.GetProperty("properties")))
                // Most serious first: worst severity, then most urgent, then whichever starts soonest.
                .OrderBy(a => Rank(a.Severity, SeverityOrder))
                .ThenBy(a => Rank(a.Urgency, UrgencyOrder))
                .ThenBy(a => a.Onset ?? a.Sent ?? DateTimeOffset.MaxValue)
                .ToList();

            return new WeatherAlertsResponse
            {
                BuildingName = building.Name,
                RetrievedAt = raw.RetrievedAt,
                Alerts = alerts
            };
        }

        /// <summary>Converts one alert's NWS "properties" object into a WeatherAlert.</summary>
        private static WeatherAlert FromFeature(JsonElement p) => new()
        {
            Id = ReadString(p, "id") ?? "",
            Event = ReadString(p, "event") ?? "Unknown alert",
            Severity = ReadString(p, "severity") ?? "Unknown",
            Urgency = ReadString(p, "urgency") ?? "Unknown",
            Certainty = ReadString(p, "certainty") ?? "Unknown",
            Headline = ReadString(p, "headline"),
            Description = ReadString(p, "description"),
            Instruction = ReadString(p, "instruction"),
            AreaDescription = ReadString(p, "areaDesc"),
            MessageType = ReadString(p, "messageType"),
            SenderName = ReadString(p, "senderName"),
            Sent = ReadTimestamp(p, "sent"),
            Onset = ReadTimestamp(p, "onset"),
            Expires = ReadTimestamp(p, "expires"),
            Ends = ReadTimestamp(p, "ends"),

            // Storm details live in the alert's "parameters" object (absent on most alerts).
            TornadoDetection = ReadParameter(p, "tornadoDetection"),
            TornadoDamageThreat = ReadParameter(p, "tornadoDamageThreat"),
            ThunderstormDamageThreat = ReadParameter(p, "thunderstormDamageThreat"),
            MaxHailSizeInches = ReadNumber(ReadParameter(p, "maxHailSize")),   // e.g. "1.00" or "Up to .75"
            MaxWindGustMph = ReadNumber(ReadParameter(p, "maxWindGust")),      // e.g. "70 MPH"
        };

        /// <summary>
        /// Reads one value from the alert's "parameters" object. NWS stores each parameter as a list
        /// of text values, e.g. "maxWindGust": ["70 MPH"]; we take the first. Null if absent.
        /// </summary>
        private static string? ReadParameter(JsonElement props, string name)
        {
            if (!props.TryGetProperty("parameters", out var parameters) || parameters.ValueKind != JsonValueKind.Object) return null;
            if (!parameters.TryGetProperty(name, out var values) || values.ValueKind != JsonValueKind.Array) return null;

            foreach (var value in values.EnumerateArray())
            {
                if (value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString()))
                    return value.GetString()!.Trim().ToUpperInvariant();
            }
            return null;
        }

        /// <summary>
        /// Pulls the first number out of NWS text like "70 MPH", "1.00" or "UP TO .75". Null if there's no number.
        /// </summary>
        private static double? ReadNumber(string? text)
        {
            if (text is null) return null;
            var match = System.Text.RegularExpressions.Regex.Match(text, @"\d*\.?\d+");
            return match.Success && double.TryParse(match.Value, System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var number)
                ? number
                : null;
        }

        // ---------------------------------------------------------------------
        // Sorting helpers
        // ---------------------------------------------------------------------

        // NWS's standard values, most serious first. Their position in the array is their sort rank.
        private static readonly string[] SeverityOrder = ["Extreme", "Severe", "Moderate", "Minor", "Unknown"];
        private static readonly string[] UrgencyOrder = ["Immediate", "Expected", "Future", "Past", "Unknown"];

        /// <summary>Position of a value in one of the orders above; anything unrecognised sorts last.</summary>
        private static int Rank(string value, string[] order)
        {
            var index = Array.IndexOf(order, value);
            return index >= 0 ? index : order.Length;
        }

        // ---------------------------------------------------------------------
        // Helpers for reading the NWS JSON (same approach as CurrentWeather)
        // ---------------------------------------------------------------------

        /// <summary>Reads a plain text field; returns null if it's missing or empty.</summary>
        private static string? ReadString(JsonElement props, string name)
        {
            if (!props.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String) return null;
            var text = value.GetString();
            return string.IsNullOrWhiteSpace(text) ? null : text;
        }

        /// <summary>Reads a date/time field; returns null if it's missing or not a valid date.</summary>
        private static DateTimeOffset? ReadTimestamp(JsonElement props, string name)
        {
            if (!props.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String) return null;
            return value.TryGetDateTimeOffset(out var time) ? time : null;
        }
    }
}
