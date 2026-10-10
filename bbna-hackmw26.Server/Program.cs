using System.Text.Json.Serialization;
using bbna_hackmw26.Server.Audit;
using bbna_hackmw26.Server.Weather;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));

// Weather: read the building location and NWS settings from appsettings.json...
builder.Services.Configure<BuildingOptions>(builder.Configuration.GetSection(BuildingOptions.SectionName));
builder.Services.Configure<NwsOptions>(builder.Configuration.GetSection(NwsOptions.SectionName));
builder.Services.Configure<WorkdayOptions>(builder.Configuration.GetSection(WorkdayOptions.SectionName));

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

// Storm Prediction Center (SPC) severe storm outlooks: read its settings and register the
// outlook service with its own HttpClient pointed at the SPC outlook folder.
builder.Services.Configure<SpcOptions>(builder.Configuration.GetSection(SpcOptions.SectionName));
builder.Services.AddHttpClient<SpcOutlookService>((sp, client) =>
{
    var spc = sp.GetRequiredService<IOptions<SpcOptions>>().Value;
    client.BaseAddress = new Uri(spc.BaseUrl);
    client.DefaultRequestHeaders.UserAgent.ParseAdd(spc.UserAgent);      // identifies our app to SPC
});
// Decision audit log: work out where its SQLite database file lives (Audit:DatabasePath in
// appsettings.json, relative to the project folder) and register the store that reads/writes it.
// The database itself is created further down, once, before the app starts serving requests.
builder.Services.Configure<AuditOptions>(builder.Configuration.GetSection(AuditOptions.SectionName));
var auditOptions = builder.Configuration.GetSection(AuditOptions.SectionName).Get<AuditOptions>() ?? new AuditOptions();
var auditDatabasePath = Path.GetFullPath(auditOptions.DatabasePath, builder.Environment.ContentRootPath);
builder.Services.AddSingleton(new DecisionLogStore(AuditDatabase.ConnectionString(auditDatabasePath)));

// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// Create the audit database once at startup. If the schema in AuditDatabase.Schema has changed since
// the database was made, the old database is backed up, dropped and recreated with the new schema.
AuditDatabase.EnsureCreated(auditDatabasePath, app.Logger);

app.UseDefaultFiles();
app.MapStaticAssets();

app.MapOpenApi();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.UseAuthorization();

app.MapControllers();

app.MapFallbackToFile("/index.html");

app.Run();
