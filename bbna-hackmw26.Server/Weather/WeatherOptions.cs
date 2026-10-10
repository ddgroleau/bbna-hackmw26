namespace bbna_hackmw26.Server.Weather
{
    /// <summary>
    /// The federal building we report weather for.
    /// Loaded from the "Building" section of appsettings.json, so the location
    /// can be changed without touching code.
    /// </summary>
    public class BuildingOptions
    {
        // Name of the section in appsettings.json these values are read from.
        public const string SectionName = "Building";

        // Short code used as the prefix of decision record IDs, e.g. KC-2026-1010-0001.
        public string Code { get; set; } = "";
        // Display name, e.g. "USDA Economic Research Service – Kansas City Facility".
        public string Name { get; set; } = "";

        // Street address of the building (for display only; lookups use the coordinates below).
        public string Address { get; set; } = "";

        // Coordinates of the building (from the U.S. Census geocoder).
        // These are what we send to the weather service to find the nearest station.
        public double Latitude { get; set; }
        public double Longitude { get; set; }
    }

    /// <summary>
    /// Settings for the National Weather Service (NWS) API at api.weather.gov.
    /// Loaded from the "Nws" section of appsettings.json. The API is free and needs no key.
    /// </summary>
    public class NwsOptions
    {
        // Name of the section in appsettings.json these values are read from.
        public const string SectionName = "Nws";

        // Root address of the NWS API. All request paths are relative to this.
        public string BaseUrl { get; set; } = "https://api.weather.gov/";

        // api.weather.gov rejects requests without a User-Agent identifying the app.
        // TODO: the configured value still needs contact info (email or URL), per NWS API guidelines.
        public string UserAgent { get; set; } = "bbna-hackmw26";

        // How long (in minutes) to reuse a weather reading before asking NWS again.
        // Stations only report about once an hour, so a few minutes of caching loses nothing.
        public int CacheMinutes { get; set; } = 5;

        // How long (in minutes) to reuse the active alerts list before asking NWS again.
        // Kept short because warnings like tornado warnings are time-critical.
        public int AlertsCacheMinutes { get; set; } = 1;

        // How long (in minutes) to reuse the multi-day forecast before asking NWS again.
        // NWS updates the forecast roughly once an hour, so 15 minutes keeps it fresh.
        public int ForecastCacheMinutes { get; set; } = 15;
    }

    /// <summary>
    /// The building's working day, used by GET /api/weather/forecast to split each
    /// workday into time windows. Loaded from the "Workday" section of appsettings.json.
    ///
    /// With the defaults, each workday is split into:
    ///   Overnight       18:00 the evening before -> 06:00   (snow/ice building up before anyone leaves home)
    ///   Morning commute 06:00 -> 09:00
    ///   Office hours    09:00 -> 16:00
    ///   Evening commute 16:00 -> 18:00
    /// All times are local building time (see TimeZone).
    /// </summary>
    public class WorkdayOptions
    {
        // Name of the section in appsettings.json these values are read from.
        public const string SectionName = "Workday";

        // IANA time zone of the building. Kansas City is US Central time (handles daylight saving automatically).
        public string TimeZone { get; set; } = "America/Chicago";

        // When the morning commute starts (= when the overnight window ends).
        public TimeOnly MorningCommuteStart { get; set; } = new(6, 0);

        // When office hours start (= when the morning commute ends).
        public TimeOnly WorkStart { get; set; } = new(9, 0);

        // When office hours end (= when the evening commute starts).
        public TimeOnly WorkEnd { get; set; } = new(16, 0);

        // When the evening commute ends (= when the next overnight window starts).
        public TimeOnly EveningCommuteEnd { get; set; } = new(18, 0);
    }
}
