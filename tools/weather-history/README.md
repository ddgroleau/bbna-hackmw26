# Weather history for similar past days

These scripts build `bbna-hackmw26.Server/WeatherHistory/kc-weather-history.db`, the history behind `GET /api/weather/similar-days`. That endpoint finds past Kansas City days whose weather pattern matches the forecast for a workday, and the agent team's meteorologist cites the closest one as evidence.

## What is in the history

332 notable days from 2019 to 2024: every day with a NOAA storm report or an NWS warning or advisory for Jackson County, or a weather-related spike in crashes. Each day is built from public data:

| Source | What it contributes |
| --- | --- |
| NOAA NCEI Storm Events Database | Event types, magnitudes, tornado ratings, injuries, and the written narrative |
| NWS warnings, archived by the Iowa Environmental Mesonet | Every watch, warning, and advisory for the county (storms, MOC095) and forecast zone (winter, MOZ037), with times |
| Hourly observations at KC Downtown Airport (Iowa Environmental Mesonet) | Weather and temperature in each window of the day |
| NOAA GHCN-Daily at KCI Airport (AWS Open Data) | Measured snowfall, snow depth, precipitation, and peak gust |
| Kansas City Road Casualties open data (Missouri Highway Patrol) | Injury and fatal crashes per window, compared with a typical day for the same weekday and hour |

Each day is stored as a short summary in the same windows the forecast uses (overnight, morning commute, office hours, evening commute), a set of matching facts, details of what happened, and a Titan Text Embeddings V2 vector:

```
Kansas City weather event in February (workday).
Hazard: winter (refreeze, snow).
- Overnight (6 PM prior day - 6 AM): unknown precipitation, 28-37°F; injury crashes 7 vs ~4.0 typical (1.7x)
- Morning commute (6-9 AM): dry, 25-27°F; injury crashes 14 vs ~1.6 typical (8.7x)
...
NWS warnings/advisories for Jackson County: Winter Weather Advisory Wed 09:00 PM - Thu 06:00 PM.
```

## How a match is found

1. The same facts are computed for every past day (`build_cards.py`) and for the forecast day (`Weather/SimilarDays.cs`): refreeze (precipitation overnight, then 32°F or below at the morning commute), freezing rain or sleet, snow amount, extreme cold, thunderstorms during a commute, and Tornado, Severe Thunderstorm, Flash Flood, winter, and cold alerts. The two definitions must stay in step; they are listed at the top of `build_cards.py`.
2. Past days of the same hazard type (winter or severe storm) are scored on how many facts agree. Matches below `WeatherHistory:MinimumScore` are dropped, and a calm forecast returns none.
3. If the server has a Bedrock key, the forecast is embedded with Titan and compared with each day's stored vector. This counts for 15% of the score and mainly orders matches the rules already found.

## Why crash history

Before building this, we checked hour by hour (2019–2024) whether weather shows up in Kansas City's injury-crash records:

| Weather in that hour | Injury crashes vs a normal hour |
| --- | --- |
| Severe Thunderstorm Warning in effect | 1.8x |
| Heavy rain (0.25 in/hour or more) | 1.7x |
| Thunderstorm at the airport | 1.6x |
| Freezing rain or sleet falling | 1.3x |
| Snow falling | 1.25x |
| Below freezing after recent precipitation | 1.2x |

All six were statistically significant. Snow totals alone predicted little, because people stay home, while refreeze mornings and commute-hour thunderstorms produced the largest spikes. That is why matching focuses on timing and ice rather than inches of snow.

## Limits

- Kansas City only, from one airport station, with few rare events (8 tornado days).
- Crash data covers injury and fatal crashes inside city limits, through 2024. Property-damage-only crashes are not included, so the effect on icy days is understated.
- The matching facts are separate from the decision matrix.

## Rebuilding

From the repository root. Downloads are cached in `tools/weather-history/.cache`, which git ignores.

```bash
python -I tools/weather-history/build_cards.py
```

```bash
python -I tools/weather-history/embed_cards.py
```

The second step adds the embeddings and needs `AWS_BEARER_TOKEN_BEDROCK`, read from the environment or from `bbna-hackmw26.client/src/api/.env`. Re-running either step only redoes what changed.
