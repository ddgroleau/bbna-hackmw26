export type Posture = 'normal' | 'delay' | 'early_dismissal' | 'telework' | 'closure';
export type Audience = 'teleworkReady' | 'onsite' | 'essential';

export interface Facility {
    id: string;
    name: string;
    shortName: string;
    type: string;
    organization: string;
    address: { street: string; city: string; state: string; zip: string };
    location: { county: string; nwsOffice: string; nwsGridX: number; nwsGridY: number };
    timeZone: string;
    timeZoneLabel: string;
    hours: { opens: string; closes: string; label: string; days: string[] };
    population: {
        employees: number;
        essentialPersonnel: number;
        teleworkEligible: number;
    };
    hazards: string[];
    dataNote: string;
}

export interface Trigger {
    rule: string;
    observed: string;
    threshold: string;
    crossed: boolean;
}

export interface Recommendation {
    posture: Posture;
    level: 'none' | 'advisory' | 'action' | 'critical';
    confidence: number;
    thresholdSummary: string;
    explanation: string;
    whatCouldChange: string;
    triggers: Trigger[];
    alternatives: { posture: Posture; note: string }[];
}

export interface WeatherAlert {
    event: string;
    severity: string;
    certainty: string;
    urgency: string;
    timing: string;
    area: string;
    headline: string;
}

export interface ForecastPeriod {
    period: string;
    window: string;
    shortForecast: string;
    temperatureF: number;
    windChillF: number | null;
    windDirection: string;
    windSpeedMph: number;
    windGustMph: number;
    precipChancePct: number;
    snowIn: number;
    iceIn: number;
}

export interface Weather {
    observedAt: string;
    forecastIssuedAt: string;
    roadsReportedAt: string;
    alerts: WeatherAlert[];
    current: {
        conditions: string;
        temperatureF: number;
        windChillF: number | null;
        windDirection: string;
        windSpeedMph: number;
        windGustMph: number;
        humidityPct: number;
        visibilityMi: number;
    };
    forecast: ForecastPeriod[];
    totals: { snowIn: number; iceIn: number; minWindChillF: number; maxGustMph: number };
    roads: { status: string; detail: string };
}

export interface DecisionStep {
    kind: 'assessment' | 'decision' | 'notify' | 'commute' | 'open';
    title: string;
    detail: string;
    at: string;
}

export interface DecisionWindow {
    recordId: string;
    operatingDate: string;
    operatingDayLabel: string;
    dayLabel: string;
    decisionDueAt: string;
    steps: DecisionStep[];
}

export interface People {
    resolvedAgainst: string;
    staff: {
        assigned: number;
        recipients: number;
        excluded: number;
        essential: number;
        steps: { label: string; detail: string; final?: boolean }[];
    };
    audiences: Record<Audience, number>;
    accessibility: { title: string; detail: string };
    sample: { name: string; role: string; logic: string; routing: string[]; included: boolean }[];
    dataNote: string;
}

export interface Thresholds {
    rulesetVersion: string;
    dataNote: string;
    levels: { level: string; posture: Posture; postureLabel: string; trigger: string; basis: string }[];
    sources: { owner: string; title: string; detail: string; reviewed: string }[];
}

export interface Situation {
    isMock: boolean;
    scenario: string;
    scenarios: { id: string; label: string }[];
    generatedAt: string;
    decisionWindow: DecisionWindow;
    facility: Facility;
    recommendation: Recommendation;
    weather: Weather;
    people: People;
    thresholds: Thresholds;
    messageTemplates: Record<Posture, Record<Audience, string>>;
}

export interface NotifyRequest {
    posture: Posture;
    channels: string[];
    recipients: number;
    essentialRecipients: number;
}

export interface Decision extends NotifyRequest {
    sentAt: string;
}

// What one specialist on the agent team found, and the tools it used to find it.
export interface TeamBrief {
    id: 'meteorologist' | 'workforce' | 'rules' | 'lead';
    role: string;
    brief: string;
    toolsUsed: string[];
}

// The agent team's recommendation from /api/analyze.
export interface Analysis {
    posture: Posture;
    summary: string;
    confidence: number;
    email: string;
    team: TeamBrief[];
}

export type AnalysisState =
    | { status: 'loading' }
    | { status: 'ready'; data: Analysis }
    | { status: 'error'; message: string };

export interface LiveAlert {
    id: string;
    event: string;
    severity: string;
    urgency: string;
    certainty: string;
    headline: string | null;
    areaDescription: string | null;
    ends: string | null;
    expires: string | null;
}

// The live National Weather Service reading and alerts the agent analyzes.
export interface LiveWeather {
    current: {
        stationName: string;
        observedAt: string;
        conditions: string | null;
        temperatureF: number | null;
        feelsLikeF: number | null;
        humidityPercent: number | null;
        windSpeedMph: number | null;
        windGustMph: number | null;
        windDirection: string | null;
        visibilityMiles: number | null;
    };
    alerts: LiveAlert[];
    // Null when the forecast feed could not be reached; the reading and alerts still show.
    forecast: LiveForecast | null;
}

// One slice of a workday from /api/weather/forecast. A null value was not forecast or does not apply.
export interface ForecastWindow {
    start: string;
    end: string;
    snowInches: number | null;
    iceInches: number | null;
    lowestWindChillF: number | null;
    highestHeatIndexF: number | null;
    highestWindGustMph: number | null;
    highestPrecipChancePercent: number | null;
    highestThunderChancePercent: number | null;
}

export interface ForecastDay {
    date: string;
    dayOfWeek: string;
    overnight: ForecastWindow;
    morningCommute: ForecastWindow;
    officeHours: ForecastWindow;
    eveningCommute: ForecastWindow;
    wholeDay: ForecastWindow;
}

export interface LiveForecast {
    forecastUpdatedAt: string | null;
    days: ForecastDay[];
}

const analysesInFlight = new Map<string, Promise<Analysis>>();

// Each analysis is a paid model call, so identical requests made while one is still running
// (React's development double-render, a double click) share that one request.
// A manager note is something the feeds cannot see (a power outage, a closed garage); the agent weighs it.
export function fetchAnalysis(scenario?: string, managerNote?: string): Promise<Analysis> {
    const params = new URLSearchParams();
    if (scenario) params.set('scenario', scenario);
    if (managerNote) params.set('data', managerNote);
    const query = params.size ? `?${params}` : '';
    let request = analysesInFlight.get(query);
    if (!request) {
        request = requestAnalysis(query).finally(() => analysesInFlight.delete(query));
        analysesInFlight.set(query, request);
    }
    return request;
}

async function requestAnalysis(query: string): Promise<Analysis> {
    const response = await fetch(`/api/analyze${query}`);
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
        throw new Error(body?.error ?? `The agent endpoint answered ${response.status}.`);
    }
    return {
        posture: body.data.PostureStatus,
        summary: body.data.Summary,
        confidence: body.data.ConfidencePercentage,
        email: body.data.EmailNotification,
        team: body.data.Team ?? [],
    };
}

// One exchange with the conversation agent. `consulted` lists the specialists it asked.
export interface ChatMessage {
    role: 'user' | 'assistant';
    text: string;
    consulted?: { id: TeamBrief['id']; role: string }[];
    failed?: boolean;
}

export interface ChatContext {
    scenario?: string;
    managerNote?: string;
    recommendation?: Analysis;
}

// Asks the conversation agent, which consults the specialists to answer. The server is stateless,
// so the earlier turns travel with each question; failed turns are left out.
export async function askTeam(question: string, history: ChatMessage[], context: ChatContext): Promise<ChatMessage> {
    const { recommendation } = context;
    const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            question,
            scenario: context.scenario ?? null,
            managerNote: context.managerNote ?? null,
            recommendation: recommendation
                ? { posture: recommendation.posture, summary: recommendation.summary, confidence: recommendation.confidence }
                : null,
            history: history.filter(turn => !turn.failed).map(({ role, text }) => ({ role, text })),
        }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
        throw new Error(body?.error ?? `The agent endpoint answered ${response.status}.`);
    }
    return { role: 'assistant', text: body.data.reply, consulted: body.data.consulted };
}

export async function fetchLiveWeather(): Promise<LiveWeather> {
    const [current, alerts, forecast] = await Promise.all([
        fetch('/api/weather/current'),
        fetch('/api/weather/alerts'),
        fetch('/api/weather/forecast')
            .then(response => (response.ok ? response.json() : null))
            .catch(() => null),
    ]);
    if (!current.ok || !alerts.ok) {
        throw new Error(`The live weather feed answered ${current.ok ? alerts.status : current.status}.`);
    }
    return { current: await current.json(), alerts: (await alerts.json()).alerts, forecast };
}

// Decision log (server/Audit). Each record holds the captured evidence, the recommendation,
// and the human decision as a hash-chained list of events.

export interface DecisionRecord {
    id: string;
    facilityCode: string;
    facilityName: string;
    status: 'AwaitingDecision' | 'Decided';
    recommendedPosture: Posture;
    recommendationReason: string;
    rulesetVersion: string;
    finalPosture: Posture | null;
    action: 'Accepted' | 'Overridden' | null;
    decidedBy: string | null;
    decidedAt: string | null;
    createdAt: string;
}

export interface AuditEvent {
    seq: number;
    occurredAt: string;
    kind: 'EvidenceCaptured' | 'RecommendationGenerated' | 'DecisionRecorded';
    actor: string;
    title: string;
    detail: string;
    payload: unknown;
    prevHash: string | null;
    hash: string;
}

export interface DecisionRecordDetail {
    record: DecisionRecord;
    events: AuditEvent[];
    integrity: { valid: boolean; eventCount: number; brokenAtSeq: number | null };
}

export async function fetchSituation(scenario?: string): Promise<Situation> {
    const query = scenario ? `?scenario=${encodeURIComponent(scenario)}` : '';
    const response = await fetch(`/api/situation${query}`);
    if (!response.ok) {
        throw new Error(`The server answered ${response.status} for /api/situation.`);
    }
    return response.json();
}

export async function sendNotification(request: NotifyRequest): Promise<Decision> {
    const response = await fetch('/api/situation/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });
    if (!response.ok) {
        throw new Error(`The server answered ${response.status} for the notification request.`);
    }
    return response.json();
}

// Problem responses from ASP.NET carry the reason in "title".
async function failure(response: Response, what: string): Promise<Error> {
    const problem = await response.json().catch(() => undefined);
    return new Error(problem?.title ?? `The server answered ${response.status} for ${what}.`);
}

// What a decision record is opened for: the agent's recommendation and the evidence behind it.
export interface RecordEvidence {
    situation: Situation;
    analysis: Analysis;
    // True when the agent analyzed the live feeds rather than the situation's mock scenario.
    live: boolean;
    liveWeather?: LiveWeather;
    // What the manager told the agent, when the recommendation was reconsidered with a note.
    managerNote?: string;
}

async function createDecisionRecord({ situation, analysis, live, liveWeather, managerNote }: RecordEvidence): Promise<DecisionRecordDetail> {
    const { weather, thresholds } = situation;
    const alerts = weather.alerts.length;
    const response = await fetch('/api/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            recommendedPosture: analysis.posture,
            reason: `${analysis.confidence}% confidence. ${analysis.summary}`,
            rulesetVersion: thresholds.rulesetVersion,
            evidence: {
                summary: (live
                    ? `Latest NWS station reading, active alerts${liveWeather?.forecast ? ', and workday forecast' : ''} retained from the live feeds.`
                    : `${alerts} active NWS ${alerts === 1 ? 'alert' : 'alerts'}, ${weather.forecast.length} forecast periods, and 1 road report retained from the mock scenario.`)
                    + (managerNote ? ` The agent also weighed a manager note: "${managerNote}"` : ''),
                sources: {
                    source: live ? 'live' : situation.scenario,
                    capturedAt: situation.generatedAt,
                    // The situation's weather is mock data, so it is only evidence for a scenario run.
                    weather: live ? liveWeather ?? null : weather,
                    recommendation: analysis,
                    managerNote: managerNote ?? null,
                },
            },
        }),
    });
    if (!response.ok) throw await failure(response, 'the new decision record');
    return response.json();
}

// Every record in the log with its events and integrity check, newest first.
export async function fetchDecisionLog(): Promise<DecisionRecordDetail[]> {
    const response = await fetch('/api/decisions');
    if (!response.ok) throw await failure(response, 'the decision log');
    return response.json();
}

const pendingRecords = new Map<string, Promise<DecisionRecordDetail>>();

// Reuses the open record when it is still waiting on the same recommendation, so refreshing the
// evidence does not pile up records. Anything else (decided, or a different recommendation) starts a new one.
export function ensureDecisionRecord(evidence: RecordEvidence): Promise<DecisionRecordDetail> {
    const { posture } = evidence.analysis;
    const { rulesetVersion } = evidence.situation.thresholds;
    const note = evidence.managerNote ?? '';
    const key = `${posture}:${rulesetVersion}:${note}`;

    // React runs effects twice in development; share the request so only one record is created.
    let pending = pendingRecords.get(key);
    if (!pending) {
        pending = (async () => {
            const [latest] = await fetchDecisionLog();
            // A recommendation reconsidered with a manager note always gets its own record, so the note is logged.
            if (!note && latest?.record.status === 'AwaitingDecision' && latest.record.recommendedPosture === posture
                && latest.record.rulesetVersion === rulesetVersion) {
                return latest;
            }
            return createDecisionRecord(evidence);
        })().finally(() => pendingRecords.delete(key));
        pendingRecords.set(key, pending);
    }
    return pending;
}

// The same endpoint that opens records; the recordId tells the server this is the decision on one.
export async function recordDecision(recordId: string, finalPosture: Posture, rationale?: string): Promise<DecisionRecordDetail> {
    const response = await fetch('/api/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId, finalPosture, rationale: rationale || null }),
    });
    if (!response.ok) throw await failure(response, 'the decision');
    return response.json();
}
