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

A threshold table answers "is a rule met?". A manager also wants to know what happened the last time conditions looked like this. Closure Call retrieves past Kansas City days whose weather matched the forecast and gives them to the agent team as evidence. For example, rain overnight followed by a freeze before the commute retrieves February 16, 2023, when the morning commute saw 14 injury crashes against a typical 1.6.

- **History.** 332 notable Kansas City days from 2019 to 2024, built from NOAA storm reports, archived NWS warnings, airport observations, and city injury-crash records, and stored in SQLite with Amazon Titan embeddings.
- **Matching.** The same facts (refreeze, ice, snow, commute thunderstorms, and tornado, severe storm, flood, and winter alerts) are computed for each past day and for the forecast day, and past days of the same hazard type are ranked on them. Embedding similarity is a small tie-breaker. A calm forecast returns no matches.
- **Use.** The meteorologist cites the closest match through a `get_similar_past_days` tool, and the decision lead may repeat it in the summary. Past days are evidence only: they never meet a rule, change the posture, or appear in the employee email.
- **Limits.** Matches are only fetched for the live feeds, not the mock scenarios. The history comes from one station, includes few rare events, and its crash data stops at 2024.

Details, data sources, the crash analysis behind the matching, and rebuild steps are in [tools/weather-history/README.md](tools/weather-history/README.md). The endpoint is `GET /api/weather/similar-days?date=yyyy-MM-dd`.

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
