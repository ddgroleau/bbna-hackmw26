using bbna_hackmw26.Server.Weather;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers();

// Weather: read the building location and NWS settings from appsettings.json...
builder.Services.Configure<BuildingOptions>(builder.Configuration.GetSection(BuildingOptions.SectionName));
builder.Services.Configure<NwsOptions>(builder.Configuration.GetSection(NwsOptions.SectionName));

// In-memory cache, used to reuse a recent weather reading instead of calling NWS on every request.
builder.Services.AddMemoryCache();

// ...and register the NWS weather service with its own HttpClient, pre-configured
// with the NWS base URL and the headers api.weather.gov expects on every request.
builder.Services.AddHttpClient<NwsWeatherService>((sp, client) =>
{
    var nws = sp.GetRequiredService<IOptions<NwsOptions>>().Value;
    client.BaseAddress = new Uri(nws.BaseUrl);
    client.DefaultRequestHeaders.UserAgent.ParseAdd(nws.UserAgent);      // NWS requires a User-Agent
    client.DefaultRequestHeaders.Accept.ParseAdd("application/geo+json"); // NWS's standard JSON format
});
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

var app = builder.Build();

app.UseDefaultFiles();
app.MapStaticAssets();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();

app.UseAuthorization();

app.MapControllers();

app.MapFallbackToFile("/index.html");

app.Run();
