# Closure Call

Weather-driven facility decisions and notification, built at Hack Midwest 2026.

When severe weather threatens a federal facility, someone has to decide whether to open, delay, send people home, or close, and then tell every affected employee before they leave the house. Closure Call puts everything that decision needs in one place, recommends a posture, drafts the notification, and keeps a record of what was known and what was decided.

## Team

| Name | Email |
| --- | --- |
| Muhammad Chaudhry | muhammadchaudhary263@gmail.com |
| Nirmaha Mukherjee | nirmaha@outlook.com |
| Ibaad Khatib | ibaadkhatib03@icloud.com |
| Curtis Been | Lbeenc@gmail.com |
| Dan Groleau | ddgroleau@gmail.com |

## What the app does

Closure Call is a decision-support tool for a facility manager. It does not make the decision; it makes sure the person who does has the inputs, the reasoning, and the outgoing message ready. The demo facility is the USDA Economic Research Service office in Kansas City, MO.

- **Live weather.** Pulls current observations, active alerts, and the workday forecast for the facility's location from the National Weather Service API.
- **Graded recommendation.** Evaluates conditions against the team's decision matrix and recommends one of five postures: normal operations, delayed arrival, early dismissal, unscheduled telework, or closure. An AI agent returns the posture, a plain-language summary a manager could paste into an email, a confidence percentage, and a drafted notification.
- **Notification package.** Shows who will be notified and why, with separate instructions for telework-ready, on-site, and essential personnel, and the channels each message goes out on. The manager can accept the recommendation or override it; an override requires a written reason.
- **Decision record.** Logs the evidence, the recommendation, and the manager's decision in an append-only log. Each entry is chained to the one before it by a SHA-256 hash, so a later change is detected. Records export as PDF, Excel, or JSON.
- **Threshold defensibility.** Lists every rule in the decision matrix alongside the source it is anchored to, such as NWS alert severity and OPM operating-status categories.
- **Similar past days.** Finds past Kansas City days whose weather looked like the forecast, such as a refreeze before the morning commute or thunderstorms at rush hour, and shows the agent what happened then: the warnings issued, NOAA storm reports, and injury crashes compared with a typical day. See [Similar past days](#similar-past-days-retrieval-augmented-generation).

The top bar switches between the live NWS feeds and eight mock scenarios (clear day, morning ice, afternoon snow, extreme cold, winter storm, evening severe storms, tornado warning, flash flooding), so every posture can be shown on a calm day.

What is not real yet: the employee roster and staffing counts are synthetic, the decision matrix holds prototype cutoffs, road conditions exist only in the mock scenarios, and notifications are simulated, so nothing is actually sent. The backend also serves the NOAA Storm Prediction Center's Day 1–3 severe thunderstorm outlook, but it is not yet shown on screen or given to the agent.

## Challenges

We are competing in two sponsor challenges and the general Hack Midwest award categories.

### Closure Call: Weather-Driven Facility Decisions and Notification

The problem question: when severe weather threatens a federal facility, how does the decision to close, and the notification of every employee assigned to that building, happen fast enough, consistently enough, and with a clear enough record of why?

The goal is not to automate the decision. It is to give the person making it everything they need in one place, in time, and to get whatever they decide to the right people fast. This is how the app answers each deliverable:

| Deliverable | In Closure Call |
| --- | --- |
| Working system on real NWS data | The Situation screen reads live observations, alerts, and forecasts from api.weather.gov for the facility's coordinates. |
| Recommendation with reasoning | One of five graded postures with a confidence percentage and a paste-ready rationale that states the conditions, the rule that drove the call, and what would change it. The weather inputs are shown beside it with their source and observation time. |
| Notification package | The Notifications screen shows who is included and why, a drafted message for each audience, and channel routing. |
| Decision record | The Decision record screen keeps the evidence, the recommendation, and the decision in a hash-chained SQLite log, with PDF, Excel, and JSON export. |
| Threshold defensibility | The Thresholds screen lists each rule with its anchor: NWS alert fields, state DOT road-condition categories, and OPM operating statuses. |

We followed the challenge's advice to go deep rather than broad: one facility profile, handled well.

### Best Use of Strands Agents SDK

The recommendation is produced by a team of agents built with the Strands Agents SDK (TypeScript), running Amazon Nova on Amazon Bedrock.

- **Specialists with their own evidence tools.** A meteorologist, a workforce analyst, and a rules analyst each gather what they need through read-only tools: the current observation, active alerts, the decision-day forecast, the facility schedule, staffing, the decision matrix, the decision history, and similar past days. They run as a Strands graph that ends in a decision lead, which returns structured output: posture, summary, confidence, and a drafted email. A separate conversation agent answers the manager's follow-up questions by consulting the same specialists.
- **Checks done in code, not by the model.** Numeric cutoffs, the timing a trigger names (for example "during the morning commute"), and whether an active alert meets a rule are all computed in code and handed to the agents as facts. A small, fast model is not trusted with arithmetic or with reading the clock.
- **Answers are checked before they reach the manager.** The lead must name the rule behind its posture. An answer that fails the schema, contradicts the matrix, or is less severe than a rule an active alert meets is sent back to the lead, and refused if it still contradicts the matrix.
- **Past days are evidence, not rules.** Similar past days reach only the meteorologist, as context for the summary. They can never meet a rule or change the posture.
- `bbna-hackmw26.client/src/api/check-scenarios.ts` runs every mock scenario several times against the team and reports whether each comes back with its intended posture. With Nova Pro as the judgment model, all eight scenarios returned their intended posture on 3 of 3 runs.

### Award categories

Best in Show, Best AI, Best Use of Data, Best Design, Most Impactful, and Most Innovative.

## Similar past days (retrieval-augmented generation)

A threshold table answers "is a rule met?". A manager also wants to know "what happened the last time it looked like this?". Closure Call answers that by retrieving past Kansas City days whose weather pattern matches the forecast and giving them to the agent team as evidence. For example, a forecast of rain overnight followed by temperatures dropping below freezing before the commute retrieves February 16, 2023. That day had no warning-level snowfall, yet the morning commute saw 14 injury crashes against a typical 1.6.

### What is in the history

332 notable days from 2019 to 2024: every day with a NOAA storm report or an NWS warning or advisory for Jackson County, or a weather-related spike in crashes. Each day is built from public data:

| Source | What it contributes |
| --- | --- |
| NOAA NCEI Storm Events Database | Event types, magnitudes, tornado ratings, injuries, and the written narrative |
| NWS warnings, archived by the Iowa Environmental Mesonet | Every watch, warning, and advisory for the county (storms) and forecast zone (winter), with times |
| Hourly observations at KC Downtown Airport (Iowa Environmental Mesonet) | Weather and temperature in each window of the day |
| NOAA GHCN-Daily at KCI Airport (AWS Open Data) | Measured snowfall, snow depth, precipitation, and peak gust |
| Kansas City Road Casualties open data (Missouri Highway Patrol) | Injury and fatal crashes per window, compared with a typical day for the same weekday and hour |

Each day becomes a short summary in the same windows the forecast uses: overnight, morning commute, office hours, and evening commute.

```
Kansas City weather event in February (workday).
Hazard: winter (refreeze, snow).
- Overnight (6 PM prior day - 6 AM): unknown precipitation, 28-37°F; injury crashes 7 vs ~4.0 typical (1.7x)
- Morning commute (6-9 AM): dry, 25-27°F; injury crashes 14 vs ~1.6 typical (8.7x)
...
NWS warnings/advisories for Jackson County: Winter Weather Advisory Wed 09:00 PM - Thu 06:00 PM.
```

### How a match is found

1. The same facts are computed for every past day and for the forecast day: refreeze (precipitation overnight, then 32°F or below at the morning commute), freezing rain or sleet, snow amount, extreme cold, thunderstorms during a commute, and Tornado, Severe Thunderstorm, Flash Flood, winter, and cold alerts. For a forecast day these come from `/api/weather/forecast`, the active alerts, and the SPC outlook.
2. Past days of the same hazard type, winter or severe storm, are scored on how many of those facts agree. Weak matches are dropped, and a calm forecast returns no matches.
3. As a tie-breaker, the forecast is embedded with Amazon Titan Text Embeddings V2 on Bedrock and compared with each past day's stored embedding. This is 15% of the score: the rules find the right kind of day, and the embeddings help order them.
4. The top three are returned, each with the plain-language reasons it matched.

The past days are stored with their embeddings in a read-only SQLite file, `bbna-hackmw26.Server/WeatherHistory/kc-weather-history.db` (about 2 MB). Without a Bedrock key, matching runs on the rules alone.

### How the agent team uses it

The meteorologist gets a `get_similar_past_days` tool and cites the closest match in its brief. The decision lead may repeat it in the summary as background. Past days never meet a rule, never change the posture, and never appear in the employee email. The tool only exists when the forecast matched past days, so the agents have nothing to invent when there are none.

### Why crash history

Before building this we checked whether weather really shows up in Kansas City's crash records, hour by hour, for 2019–2024:

| Weather in that hour | Injury crashes vs a normal hour |
| --- | --- |
| Severe Thunderstorm Warning in effect | 1.8x |
| Heavy rain (0.25 in/hour or more) | 1.7x |
| Thunderstorm at the airport | 1.6x |
| Freezing rain or sleet falling | 1.3x |
| Snow falling | 1.25x |
| Below freezing after recent precipitation | 1.2x |

All six were statistically significant. Snow totals alone predicted little, because people stay home, while refreeze mornings and commute-hour thunderstorms produced the biggest spikes. That is why the matching focuses on timing and ice rather than inches of snow.

### Limits

- Past days inform the explanation, not the decision. Only the decision matrix can change the posture.
- Matches are only fetched for the live feeds, not the mock scenarios. The app decides for the next workday, so when that day is calm there are no past days to show.
- The history is Kansas City only, from one airport station, and has few rare events (8 tornado days).
- Crash data covers injury and fatal crashes inside city limits, through 2024. Fender-benders are not included, so the effect on icy days is understated.
- The matching facts are separate from the decision matrix. Linking each past day to the matrix rules it would have met is a planned next step.

### API and rebuilding

```
GET /api/weather/similar-days?date=2026-10-14&limit=3
```

It returns the facts computed for the forecast day, whether embeddings were used, and the matches, each with its date, score, reasons, summary, warnings, and commute crash ratios.

To rebuild the history, from the repository root (downloads are cached in `tools/weather-history/.cache`, which git ignores):

```bash
python -I tools/weather-history/build_cards.py
```

```bash
python -I tools/weather-history/embed_cards.py
```

The second step needs `AWS_BEARER_TOKEN_BEDROCK`, read from the environment or from `bbna-hackmw26.client/src/api/.env`.

## Technologies

| Area | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite |
| Backend | ASP.NET Core Web API on .NET 10 (C#) |
| AI | Amazon Bedrock (Amazon Nova Lite and Nova Pro) through the Strands Agents SDK for TypeScript, with Zod-validated structured output; Amazon Titan Text Embeddings V2 for similar past days |
| Weather data | National Weather Service API (api.weather.gov) and NOAA Storm Prediction Center outlooks |
| Historical data | NOAA Storm Events, NWS warning and hourly observation archives (Iowa Environmental Mesonet), NOAA GHCN-Daily (AWS Open Data), Kansas City crash records |
| Storage | SQLite for the hash-chained decision log and the past-days history |
| Exports | jsPDF and ExcelJS |
| API docs | OpenAPI and Swagger UI |
| Design | Figma Make prototype |

## Running locally

You need the .NET 10 SDK, Node.js 22 or later, and an Amazon Bedrock API key.

1. Copy `bbna-hackmw26.client/src/api/.env.example` to `.env` in the same folder and set `AWS_BEARER_TOKEN_BEDROCK`. For the most reliable recommendations, also set `BEDROCK_JUDGMENT_MODEL_ID=us.amazon.nova-pro-v1:0`; the default is Nova Lite. The server reads the same key for the past-days embeddings.
2. Install the client dependencies:

   ```bash
   npm install --prefix bbna-hackmw26.client
   ```

3. Trust the ASP.NET development certificate (once per machine):

   ```bash
   dotnet dev-certs https --trust
   ```

4. Start the server, which also starts the Vite client:

   ```bash
   dotnet run --project bbna-hackmw26.Server
   ```

5. Open https://localhost:55630.

To check that the agent team returns the intended posture for every mock scenario (3 runs each, with the server running):

```bash
cd bbna-hackmw26.client
```

```bash
npx tsx src/api/check-scenarios.ts
```

`Properties/launchSettings.json` is gitignored. If the server starts on port 5000 and the client does not launch, create one for the server project with `applicationUrl` set to `https://localhost:7008` and `ASPNETCORE_HOSTINGSTARTUPASSEMBLIES` set to `Microsoft.AspNetCore.SpaProxy`.
