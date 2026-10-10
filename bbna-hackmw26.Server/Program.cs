using bbna_hackmw26.Server.Weather;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers();

builder.Services.Configure<BuildingOptions>(builder.Configuration.GetSection(BuildingOptions.SectionName));
builder.Services.Configure<NwsOptions>(builder.Configuration.GetSection(NwsOptions.SectionName));
builder.Services.AddHttpClient<NwsWeatherService>((sp, client) =>
{
    var nws = sp.GetRequiredService<IOptions<NwsOptions>>().Value;
    client.BaseAddress = new Uri(nws.BaseUrl);
    client.DefaultRequestHeaders.UserAgent.ParseAdd(nws.UserAgent);
    client.DefaultRequestHeaders.Accept.ParseAdd("application/geo+json");
});
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
builder.Services.AddSwaggerGen();

var app = builder.Build();

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
