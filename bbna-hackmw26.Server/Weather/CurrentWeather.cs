using System.Text.Json;

namespace bbna_hackmw26.Server.Weather
{
    /// <summary>
    /// A simplified, frontend-friendly version of the latest weather reading.
    /// Returned by GET /api/weather/current.
    ///
    /// Every measurement is a plain number in US units (°F, mph, inHg, miles), with both
    /// °F and °C given for temperature. Any value the station didn't report is null,
    /// so the frontend should show a placeholder (e.g. "—") for nulls.
    /// </summary>
    public record CurrentWeather
    {
        // --- Where the reading is for / came from ---

        /// <summary>Name of the federal building, e.g. "USDA Economic Research Service – Kansas City Facility".</summary>
        public required string BuildingName { get; init; }

        /// <summary>Station code that took the reading, e.g. "KMKC".</summary>
        public required string StationId { get; init; }

        /// <summary>Human-readable station name, e.g. "Kansas City, Kansas City Downtown Airport".</summary>
        public required string StationName { get; init; }

        /// <summary>When the station took the reading (UTC). Stations usually report about once an hour.</summary>
        public DateTimeOffset? ObservedAt { get; init; }

        /// <summary>When our server fetched the reading from NWS (UTC).</summary>
        public required DateTimeOffset RetrievedAt { get; init; }

        // --- Sky / conditions ---

        /// <summary>Short description of conditions, e.g. "Clear", "Light Rain".</summary>
        public string? Conditions { get; init; }

        /// <summary>URL of an NWS weather icon image for the current conditions.</summary>
        public string? IconUrl { get; init; }

        // --- Temperature ---

        public double? TemperatureF { get; init; }
        public double? TemperatureC { get; init; }

        /// <summary>
        /// What it feels like outside, in °F: the heat index when it's hot and humid,
        /// the wind chill when it's cold and windy, otherwise the actual temperature.
        /// </summary>
        public double? FeelsLikeF { get; init; }

        public double? DewpointF { get; init; }

        /// <summary>Relative humidity, 0-100.</summary>
        public double? HumidityPercent { get; init; }

        // --- Wind ---

        public double? WindSpeedMph { get; init; }
        public double? WindGustMph { get; init; }

        /// <summary>Direction the wind is blowing FROM, in degrees (0 = north, 90 = east).</summary>
        public double? WindDirectionDegrees { get; init; }

        /// <summary>The same direction as a compass label, e.g. "SW".</summary>
        public string? WindDirection { get; init; }

        // --- Other ---

        /// <summary>Air pressure in inches of mercury (what US weather reports use).</summary>
        public double? PressureInHg { get; init; }

        public double? VisibilityMiles { get; init; }

        /// <summary>
        /// Builds a CurrentWeather from a raw NWS reading, converting every value to plain numbers.
        /// </summary>
        public static CurrentWeather FromRaw(RawObservation raw, BuildingOptions building)
        {
            // All the actual weather values live under "properties" in the NWS response.
            var p = raw.Data.GetProperty("properties");

            // Read each measurement in the unit NWS uses. ReadValue returns null if the
            // station didn't report it, or if NWS ever switches units, so we never show a wrong number.
            var tempC = ReadValue(p, "temperature", "wmoUnit:degC");
            var heatIndexC = ReadValue(p, "heatIndex", "wmoUnit:degC");
            var windChillC = ReadValue(p, "windChill", "wmoUnit:degC");
            var windDegrees = ReadValue(p, "windDirection", "wmoUnit:degree_(angle)");

            return new CurrentWeather
            {
                BuildingName = building.Name,
                StationId = raw.Station.Id,
                StationName = raw.Station.Name,
                ObservedAt = ReadTimestamp(p, "timestamp"),
                RetrievedAt = raw.RetrievedAt,

                Conditions = ReadString(p, "textDescription"),
                IconUrl = ReadString(p, "icon"),

                TemperatureF = Round(CToF(tempC)),
                TemperatureC = Round(tempC),
                // Heat index and wind chill are only reported when they apply; otherwise fall back to the real temperature.
                FeelsLikeF = Round(CToF(heatIndexC ?? windChillC ?? tempC)),
                DewpointF = Round(CToF(ReadValue(p, "dewpoint", "wmoUnit:degC"))),
                HumidityPercent = Round(ReadValue(p, "relativeHumidity", "wmoUnit:percent"), 0),

                WindSpeedMph = Round(KmhToMph(ReadValue(p, "windSpeed", "wmoUnit:km_h-1"))),
                WindGustMph = Round(KmhToMph(ReadValue(p, "windGust", "wmoUnit:km_h-1"))),
                WindDirectionDegrees = windDegrees,
                WindDirection = ToCompass(windDegrees),

                PressureInHg = Round(PaToInHg(ReadValue(p, "barometricPressure", "wmoUnit:Pa")), 2),
                VisibilityMiles = Round(MetersToMiles(ReadValue(p, "visibility", "wmoUnit:m"))),
            };
        }

        // ---------------------------------------------------------------------
        // Helpers for reading the NWS JSON
        // ---------------------------------------------------------------------

        /// <summary>
        /// Reads an NWS measurement, which looks like: "temperature": { "unitCode": "wmoUnit:degC", "value": 31 }.
        /// Returns null if the field is missing, the value is null, or the unit isn't the one we expect.
        /// </summary>
        private static double? ReadValue(JsonElement props, string name, string expectedUnit)
        {
            if (!props.TryGetProperty(name, out var measurement)) return null;
            if (!measurement.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.Number) return null;

            // Guard against unit changes: only trust the number if it's in the unit we convert from.
            var unit = measurement.TryGetProperty("unitCode", out var u) ? u.GetString() : null;
            if (unit != expectedUnit) return null;

            return value.GetDouble();
        }

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

        // ---------------------------------------------------------------------
        // Unit conversions (null in -> null out)
        // ---------------------------------------------------------------------

        private static double? CToF(double? c) => c * 9 / 5 + 32;
        private static double? KmhToMph(double? kmh) => kmh / 1.609344;
        private static double? PaToInHg(double? pa) => pa / 3386.389;
        private static double? MetersToMiles(double? m) => m / 1609.344;

        /// <summary>Rounds to the given number of decimal places (default 1) so the frontend gets tidy numbers.</summary>
        private static double? Round(double? value, int decimals = 1) =>
            value is null ? null : Math.Round(value.Value, decimals);

        /// <summary>Turns a wind direction in degrees into one of 16 compass labels (N, NNE, NE, ... NNW).</summary>
        private static string? ToCompass(double? degrees)
        {
            if (degrees is null) return null;
            string[] labels = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

            // Each label covers 22.5° (360 / 16). Adding half a slice (11.25°) centres the slices on each label.
            var index = (int)Math.Floor((degrees.Value % 360 + 11.25) / 22.5) % 16;
            return labels[index];
        }
    }
}
