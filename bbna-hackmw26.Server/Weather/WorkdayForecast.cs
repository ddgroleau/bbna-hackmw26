using System.Text.Json;
using System.Xml;

namespace bbna_hackmw26.Server.Weather
{
    /// <summary>
    /// Response for GET /api/weather/forecast: the expected weather for each upcoming workday
    /// (Monday-Friday), split into the time windows that matter for a closure decision.
    /// </summary>
    public record WorkdayForecastResponse
    {
        /// <summary>Name of the federal building the forecast is for.</summary>
        public required string BuildingName { get; init; }

        /// <summary>Time zone all window times are in, e.g. "America/Chicago".</summary>
        public required string TimeZone { get; init; }

        /// <summary>When NWS last updated this forecast (NWS updates roughly hourly).</summary>
        public DateTimeOffset? ForecastUpdatedAt { get; init; }

        /// <summary>When our server fetched it from NWS (UTC; may be a few minutes old due to caching).</summary>
        public required DateTimeOffset RetrievedAt { get; init; }

        /// <summary>
        /// Upcoming workdays in date order, starting with today if its evening commute hasn't ended yet.
        /// NWS forecasts about 7 days ahead, so this usually holds 5-6 workdays.
        /// </summary>
        public required IReadOnlyList<WorkdayForecast> Days { get; init; }
    }

    /// <summary>The forecast for one workday, split into time windows.</summary>
    public record WorkdayForecast
    {
        /// <summary>The workday's date, e.g. "2026-10-12".</summary>
        public required DateOnly Date { get; init; }

        /// <summary>Day name, e.g. "Monday".</summary>
        public required string DayOfWeek { get; init; }

        /// <summary>From the evening before (EveningCommuteEnd) until the morning commute starts. Snow/ice that falls here is on the roads at commute time.</summary>
        public required ForecastWindow Overnight { get; init; }

        /// <summary>Morning commute (MorningCommuteStart -> WorkStart).</summary>
        public required ForecastWindow MorningCommute { get; init; }

        /// <summary>Office hours (WorkStart -> WorkEnd).</summary>
        public required ForecastWindow OfficeHours { get; init; }

        /// <summary>Evening commute (WorkEnd -> EveningCommuteEnd).</summary>
        public required ForecastWindow EveningCommute { get; init; }

        /// <summary>All four windows combined (start of Overnight -> end of EveningCommute): total snow/ice and the extremes for the whole period.</summary>
        public required ForecastWindow WholeDay { get; init; }
    }

    /// <summary>
    /// Expected weather for one time window. All values are in US units.
    /// A null value means NWS gave no figure for that window. For wind chill and heat index that is
    /// normal: NWS only gives them when they apply (cold and windy / hot and humid).
    /// </summary>
    public record ForecastWindow
    {
        /// <summary>When the window starts, in building local time (with UTC offset).</summary>
        public required DateTimeOffset Start { get; init; }

        /// <summary>When the window ends, in building local time (with UTC offset).</summary>
        public required DateTimeOffset End { get; init; }

        /// <summary>True if the window is already over. Its values then describe what was forecast, not what happened.</summary>
        public required bool HasEnded { get; init; }

        /// <summary>
        /// True if the NWS forecast covers the whole window. False near the end of the forecast range
        /// (about 7 days out), where totals like snow only include the part NWS has forecast so far.
        /// </summary>
        public required bool IsFullyForecast { get; init; }

        /// <summary>Total expected new snowfall, in inches.</summary>
        public double? SnowInches { get; init; }

        /// <summary>Total expected ice accumulation (freezing rain), in inches.</summary>
        public double? IceInches { get; init; }

        /// <summary>Coldest expected wind chill, in °F. Null when no wind chill is forecast.</summary>
        public double? LowestWindChillF { get; init; }

        /// <summary>Hottest expected heat index, in °F. Null when no heat index is forecast.</summary>
        public double? HighestHeatIndexF { get; init; }

        /// <summary>Strongest expected wind gust, in mph.</summary>
        public double? HighestWindGustMph { get; init; }

        /// <summary>Highest chance of precipitation (rain, snow, etc.) at any point in the window, 0-100.</summary>
        public double? HighestPrecipChancePercent { get; init; }

        /// <summary>Highest chance of thunderstorms at any point in the window, 0-100.</summary>
        public double? HighestThunderChancePercent { get; init; }
    }

    /// <summary>
    /// Builds a <see cref="WorkdayForecastResponse"/> from the raw NWS forecast grid.
    ///
    /// How the NWS data looks: each measurement (e.g. "snowfallAmount") is a list of time blocks like
    ///   { "validTime": "2026-10-10T18:00:00+00:00/PT6H", "value": 25.4 }
    /// meaning "25.4 mm of snow in the 6 hours starting 18:00 UTC". Blocks vary in length
    /// (1 hour to several days) and don't line up with our windows, so:
    ///   - Amounts (snow, ice) are shared out by overlap: if half a block falls in a window,
    ///     half its amount counts towards that window (assumes it falls at a steady rate).
    ///   - Extremes (wind chill, heat index, gusts, precip chance) take the worst value of any
    ///     block that overlaps the window at all.
    /// </summary>
    public static class WorkdayForecastBuilder
    {
        /// <summary>One NWS time block: a value that applies from Start until End.</summary>
        private record Block(DateTimeOffset Start, DateTimeOffset End, double? Value);

        /// <summary>
        /// Converts the raw NWS forecast grid into per-workday windows.
        /// </summary>
        /// <param name="raw">The forecast grid from <see cref="NwsWeatherService.GetForecastGridAsync"/>.</param>
        /// <param name="building">The building (for its name).</param>
        /// <param name="workday">Time zone and window times.</param>
        /// <param name="now">The current time; passed in (rather than read here) so it's easy to test.</param>
        public static WorkdayForecastResponse Build(
            RawForecastGrid raw, BuildingOptions building, WorkdayOptions workday, DateTimeOffset now)
        {
            var p = raw.Data.GetProperty("properties");
            var tz = TimeZoneInfo.FindSystemTimeZoneById(workday.TimeZone);

            // Read each measurement in the unit NWS uses. ReadBlocks returns an empty list if NWS
            // ever switches units, so the matching values come back null rather than wrong.
            var snow = ReadBlocks(p, "snowfallAmount", "wmoUnit:mm");
            var ice = ReadBlocks(p, "iceAccumulation", "wmoUnit:mm");
            var windChill = ReadBlocks(p, "windChill", "wmoUnit:degC");
            var heatIndex = ReadBlocks(p, "heatIndex", "wmoUnit:degC");
            var gusts = ReadBlocks(p, "windGust", "wmoUnit:km_h-1");
            var precipChance = ReadBlocks(p, "probabilityOfPrecipitation", "wmoUnit:percent");
            // NWS sends thunder chance without a unit label; it's always a 0-100 percentage.
            var thunderChance = ReadBlocks(p, "probabilityOfThunder", "wmoUnit:percent", allowMissingUnit: true);

            // The overall time range the forecast covers, e.g. "2026-10-10T12:00:00+00:00/P7DT13H" (7 days 13 hours).
            var coverage = ParseValidTime(p.GetProperty("validTimes").GetString()!);

            // Local-time helper: a date + a time of day at the building -> an exact moment.
            DateTimeOffset At(DateOnly date, TimeOnly time)
            {
                var local = date.ToDateTime(time);
                return new DateTimeOffset(local, tz.GetUtcOffset(local));
            }

            // Builds one window's summary from all the measurements.
            ForecastWindow Window(DateTimeOffset start, DateTimeOffset end) => new()
            {
                Start = start,
                End = end,
                HasEnded = end <= now,
                IsFullyForecast = coverage is { } c && c.Start <= start && c.End >= end,
                SnowInches = Round(MmToInches(Total(snow, start, end)), 2),
                IceInches = Round(MmToInches(Total(ice, start, end)), 2),
                LowestWindChillF = Round(CToF(Lowest(windChill, start, end))),
                HighestHeatIndexF = Round(CToF(Highest(heatIndex, start, end))),
                HighestWindGustMph = Round(KmhToMph(Highest(gusts, start, end))),
                HighestPrecipChancePercent = Round(Highest(precipChance, start, end), 0),
                HighestThunderChancePercent = Round(Highest(thunderChance, start, end), 0),
            };

            // Walk day by day from today (building time) to the last day the forecast reaches.
            var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, tz).DateTime);
            var lastDay = coverage is { } range
                ? DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(range.End, tz).DateTime)
                : today;

            var days = new List<WorkdayForecast>();
            for (var date = today; date <= lastDay; date = date.AddDays(1))
            {
                // Workdays only. (Federal holidays are not excluded.)
                if (date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) continue;

                // The four windows, end to end: evening before -> morning commute -> office -> evening commute.
                var overnightStart = At(date.AddDays(-1), workday.EveningCommuteEnd);
                var morningStart = At(date, workday.MorningCommuteStart);
                var workStart = At(date, workday.WorkStart);
                var workEnd = At(date, workday.WorkEnd);
                var eveningEnd = At(date, workday.EveningCommuteEnd);

                // Skip today if it's already over; stop once we're past what NWS has forecast.
                if (eveningEnd <= now) continue;
                if (coverage is { } cov && overnightStart >= cov.End) break;

                days.Add(new WorkdayForecast
                {
                    Date = date,
                    DayOfWeek = date.DayOfWeek.ToString(),
                    Overnight = Window(overnightStart, morningStart),
                    MorningCommute = Window(morningStart, workStart),
                    OfficeHours = Window(workStart, workEnd),
                    EveningCommute = Window(workEnd, eveningEnd),
                    WholeDay = Window(overnightStart, eveningEnd),
                });
            }

            return new WorkdayForecastResponse
            {
                BuildingName = building.Name,
                TimeZone = workday.TimeZone,
                ForecastUpdatedAt = p.TryGetProperty("updateTime", out var u) && u.TryGetDateTimeOffset(out var updated)
                    ? updated : null,
                RetrievedAt = raw.RetrievedAt,
                Days = days,
            };
        }

        // ---------------------------------------------------------------------
        // Combining blocks into a window
        // ---------------------------------------------------------------------

        /// <summary>
        /// Total amount in the window (for snow/ice). Each block counts in proportion to how much
        /// of it overlaps the window. Null if no block with a value overlaps the window.
        /// </summary>
        private static double? Total(List<Block> blocks, DateTimeOffset start, DateTimeOffset end)
        {
            double? total = null;
            foreach (var b in blocks)
            {
                if (b.Value is not { } value) continue;

                // How much of this block falls inside the window (zero or negative = no overlap).
                var overlap = Min(b.End, end) - Max(b.Start, start);
                if (overlap <= TimeSpan.Zero) continue;

                var fraction = overlap / (b.End - b.Start);
                total = (total ?? 0) + value * fraction;
            }
            return total;
        }

        /// <summary>Lowest value of any block that overlaps the window (for wind chill). Null if none.</summary>
        private static double? Lowest(List<Block> blocks, DateTimeOffset start, DateTimeOffset end) =>
            Overlapping(blocks, start, end).Select(v => (double?)v).Min();

        /// <summary>Highest value of any block that overlaps the window (for heat index, gusts, precip chance). Null if none.</summary>
        private static double? Highest(List<Block> blocks, DateTimeOffset start, DateTimeOffset end) =>
            Overlapping(blocks, start, end).Select(v => (double?)v).Max();

        /// <summary>The values of all blocks that overlap the window at all, skipping blocks with no value.</summary>
        private static IEnumerable<double> Overlapping(List<Block> blocks, DateTimeOffset start, DateTimeOffset end) =>
            blocks.Where(b => b.Value is not null && b.Start < end && b.End > start).Select(b => b.Value!.Value);

        private static DateTimeOffset Min(DateTimeOffset a, DateTimeOffset b) => a < b ? a : b;
        private static DateTimeOffset Max(DateTimeOffset a, DateTimeOffset b) => a > b ? a : b;

        // ---------------------------------------------------------------------
        // Reading the NWS JSON
        // ---------------------------------------------------------------------

        /// <summary>
        /// Reads one measurement's time blocks, e.g. "snowfallAmount": { "uom": "wmoUnit:mm", "values": [...] }.
        /// Returns an empty list if the measurement is missing or isn't in the unit we expect.
        /// Set allowMissingUnit for measurements NWS sends without a "uom" label (e.g. probabilityOfThunder);
        /// a label that's present but different is still rejected.
        /// </summary>
        private static List<Block> ReadBlocks(JsonElement props, string name, string expectedUnit, bool allowMissingUnit = false)
        {
            var blocks = new List<Block>();
            if (!props.TryGetProperty(name, out var series)) return blocks;

            // Guard against unit changes: only trust the numbers if they're in the unit we convert from.
            var unit = series.TryGetProperty("uom", out var u) ? u.GetString() : null;
            if (unit != expectedUnit && !(unit is null && allowMissingUnit)) return blocks;

            foreach (var item in series.GetProperty("values").EnumerateArray())
            {
                var range = ParseValidTime(item.GetProperty("validTime").GetString()!);
                if (range is not { } r) continue;

                var value = item.GetProperty("value");
                blocks.Add(new Block(r.Start, r.End, value.ValueKind == JsonValueKind.Number ? value.GetDouble() : null));
            }
            return blocks;
        }

        /// <summary>
        /// Parses an NWS time range like "2026-10-10T18:00:00+00:00/PT6H" (a start time, then an
        /// ISO 8601 duration: PT6H = 6 hours, P2DT18H = 2 days 18 hours). Returns null if malformed.
        /// </summary>
        private static (DateTimeOffset Start, DateTimeOffset End)? ParseValidTime(string validTime)
        {
            var parts = validTime.Split('/');
            if (parts.Length != 2 || !DateTimeOffset.TryParse(parts[0], out var start)) return null;
            try
            {
                // XmlConvert understands ISO 8601 durations, which .NET's TimeSpan.Parse does not.
                return (start, start + XmlConvert.ToTimeSpan(parts[1]));
            }
            catch (FormatException)
            {
                return null;
            }
        }

        // ---------------------------------------------------------------------
        // Unit conversions (null in -> null out)
        // ---------------------------------------------------------------------

        private static double? MmToInches(double? mm) => mm / 25.4;
        private static double? CToF(double? c) => c * 9 / 5 + 32;
        private static double? KmhToMph(double? kmh) => kmh / 1.609344;

        /// <summary>Rounds to the given number of decimal places (default 1) so the frontend gets tidy numbers.</summary>
        private static double? Round(double? value, int decimals = 1) =>
            value is null ? null : Math.Round(value.Value, decimals);
    }
}
