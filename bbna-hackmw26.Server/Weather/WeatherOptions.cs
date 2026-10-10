namespace bbna_hackmw26.Server.Weather
{
    public class BuildingOptions
    {
        public const string SectionName = "Building";

        // Short code used as the prefix of decision record IDs, e.g. KC-2026-1010-0001.
        public string Code { get; set; } = "";
        public string Name { get; set; } = "";
        public string Address { get; set; } = "";
        public double Latitude { get; set; }
        public double Longitude { get; set; }
    }

    public class NwsOptions
    {
        public const string SectionName = "Nws";

        public string BaseUrl { get; set; } = "https://api.weather.gov/";

        // api.weather.gov rejects requests without a User-Agent identifying the app.
        // TODO: the configured value still needs contact info (email or URL), per NWS API guidelines.
        public string UserAgent { get; set; } = "bbna-hackmw26";
    }
}
