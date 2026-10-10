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
