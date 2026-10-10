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
    }
}
