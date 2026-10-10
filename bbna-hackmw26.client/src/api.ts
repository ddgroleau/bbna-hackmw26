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

async function createDecisionRecord(situation: Situation): Promise<DecisionRecordDetail> {
    const { recommendation, weather, thresholds } = situation;
    const alerts = weather.alerts.length;
    const response = await fetch('/api/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            recommendedPosture: recommendation.posture,
            reason: `${recommendation.confidence}% confidence. ${recommendation.thresholdSummary}`,
            rulesetVersion: thresholds.rulesetVersion,
            evidence: {
                summary: `${alerts} active NWS ${alerts === 1 ? 'alert' : 'alerts'}, ${weather.forecast.length} forecast periods, and 1 road report retained.`,
                sources: { scenario: situation.scenario, capturedAt: situation.generatedAt, weather, recommendation },
            },
        }),
    });
    if (!response.ok) throw await failure(response, 'the new decision record');
    return response.json();
}

const pendingRecords = new Map<string, Promise<DecisionRecordDetail>>();

// Reuses the open record when it is still waiting on the same recommendation, so refreshing the
// evidence does not pile up records. Anything else (decided, or a different recommendation) starts a new one.
export function ensureDecisionRecord(situation: Situation): Promise<DecisionRecordDetail> {
    const { posture } = situation.recommendation;
    const { rulesetVersion } = situation.thresholds;
    const key = `${posture}:${rulesetVersion}`;

    // React runs effects twice in development; share the request so only one record is created.
    let pending = pendingRecords.get(key);
    if (!pending) {
        pending = (async () => {
            const response = await fetch('/api/decisions');
            if (!response.ok) throw await failure(response, 'the decision log');
            const [latest]: DecisionRecordDetail[] = await response.json();
            if (latest?.record.status === 'AwaitingDecision' && latest.record.recommendedPosture === posture
                && latest.record.rulesetVersion === rulesetVersion) {
                return latest;
            }
            return createDecisionRecord(situation);
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
