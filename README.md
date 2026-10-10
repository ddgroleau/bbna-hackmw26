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

The top bar switches between the live NWS feeds and five mock scenarios (clear day, morning ice, afternoon snow, extreme cold, winter storm), so every posture can be shown on a calm day.

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

The recommendation is produced by an agent built with the Strands Agents SDK (TypeScript), running Amazon Nova Lite on Amazon Bedrock.

- The agent receives the facility profile, the live reading, active alerts, the forecast for the day being decided, and the team's decision matrix. It returns structured output: posture, summary, confidence, and a drafted email.
- Numeric threshold comparisons are done in code and handed to the agent as facts, so a small, fast model is not trusted with arithmetic.
- The agent must name the rule behind its posture. An answer that fails the schema, or that contradicts the matrix or the computed comparisons, is discarded and the analysis is run again before anything reaches the manager.
- The agent runs with no tools, files, or memory. It reads feed data and advises; a person decides.

### Award categories

Best in Show, Best AI, Best Use of Data, Best Design, Most Impactful, and Most Innovative.

## Technologies

| Area | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite |
| Backend | ASP.NET Core Web API on .NET 10 (C#) |
| AI | Amazon Bedrock (Amazon Nova Lite) through the Strands Agents SDK for TypeScript, with Zod-validated structured output |
| Weather data | National Weather Service API (api.weather.gov) and NOAA Storm Prediction Center outlooks |
| Storage | SQLite for the hash-chained decision log |
| Exports | jsPDF and ExcelJS |
| API docs | OpenAPI and Swagger UI |
| Design | Figma Make prototype |

## Running locally

You need the .NET 10 SDK, Node.js 22 or later, and an Amazon Bedrock API key.

1. Copy `bbna-hackmw26.client/src/api/.env.example` to `.env` in the same folder and set `AWS_BEARER_TOKEN_BEDROCK`.
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

`Properties/launchSettings.json` is gitignored. If the server starts on port 5000 and the client does not launch, create one for the server project with `applicationUrl` set to `https://localhost:7008` and `ASPNETCORE_HOSTINGSTARTUPASSEMBLIES` set to `Microsoft.AspNetCore.SpaProxy`.
