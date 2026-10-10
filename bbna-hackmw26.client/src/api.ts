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

// The agent's recommendation from /api/analyze.
export interface Analysis {
    posture: Posture;
    summary: string;
    confidence: number;
    email: string;
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
}

const analysesInFlight = new Map<string, Promise<Analysis>>();

// Each analysis is a paid model call, so identical requests made while one is still running
// (React's development double-render, a double click) share that one request.
export function fetchAnalysis(scenario?: string): Promise<Analysis> {
    const query = scenario ? `?scenario=${encodeURIComponent(scenario)}` : '';
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
    };
}

export async function fetchLiveWeather(): Promise<LiveWeather> {
    const [current, alerts] = await Promise.all([fetch('/api/weather/current'), fetch('/api/weather/alerts')]);
    if (!current.ok || !alerts.ok) {
        throw new Error(`The live weather feed answered ${current.ok ? alerts.status : current.status}.`);
    }
    return { current: await current.json(), alerts: (await alerts.json()).alerts };
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
