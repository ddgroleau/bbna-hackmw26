import { useState } from 'react';
import type { FormEvent } from 'react';
import { recordDecision } from '../api';
import type { ChatMessage, TeamBrief, AnalysisState, Audience, DecisionRecordDetail, LiveForecast, LiveWeather, Posture, Situation } from '../api';
import { Icon, PageHead } from '../components';
import { AUDIENCES, AUDIENCE_ORDER, POSTURES, POSTURE_ORDER, formatCount, formatCountdown, formatDateTime, formatTemp, formatTime, useNow } from '../format';

interface LiveWeatherState {
    data?: LiveWeather;
    error?: string;
}

interface Props {
    situation: Situation;
    analysis: AnalysisState;
    // Present when the agent is analyzing the live feeds; absent for a mock scenario.
    liveWeather?: LiveWeatherState;
    loading: boolean;
    onRefresh: () => void;
    // Called once the decision is in the log, to move on to the notification package.
    onNotify: (posture: Posture) => void;
    record?: DecisionRecordDetail;
    recordError?: string;
    onRecorded: (record: DecisionRecordDetail) => void;
    // The note the agent's current recommendation was made with, if any.
    managerNote?: string;
    onReconsider: (note: string | undefined) => void;
    // The conversation with the agent team.
    chat: ChatMessage[];
    chatBusy: boolean;
    onAsk: (question: string) => void;
}

export function SituationPage({
    situation, analysis, liveWeather, loading, onRefresh, onNotify, record, recordError, onRecorded, managerNote, onReconsider,
    chat, chatBusy, onAsk,
}: Props) {
    const { facility, decisionWindow } = situation;
    const busy = loading || analysis.status === 'loading';
    // The impact follows the manager's decision once it is logged, and the agent's recommendation until then.
    const decidedPosture = record?.record.status === 'Decided' ? record.record.finalPosture : null;
    const impact: ImpactBasis | undefined = decidedPosture
        ? { posture: decidedPosture, basis: 'Decided' }
        : analysis.status === 'ready' ? { posture: analysis.data.posture, basis: 'Agent recommendation' } : undefined;
    return (
        <>
            <PageHead
                eyebrow="Facility readiness"
                title="Operating decision"
                subtitle={`Conditions affecting ${decisionWindow.operatingDayLabel} at ${facility.name}.`}
                action={
                    <button className="btn" onClick={onRefresh} disabled={busy}>
                        <Icon name="refresh" size={18} className={busy ? 'spin' : undefined} />
                        Refresh data
                    </button>
                }
            />
            <div className="split">
                <div className="stack">
                    <RecommendationCard
                        situation={situation}
                        analysis={analysis}
                        live={!!liveWeather}
                        onRefresh={onRefresh}
                        onNotify={onNotify}
                        record={record}
                        recordError={recordError}
                        onRecorded={onRecorded}
                        managerNote={managerNote}
                        onReconsider={onReconsider}
                    />
                    <TeamChat chat={chat} busy={chatBusy} ready={analysis.status === 'ready'} onAsk={onAsk} />
                    {liveWeather
                        ? <LiveWeatherData situation={situation} liveWeather={liveWeather} />
                        : <WeatherData situation={situation} />}
                </div>
                <div className="stack">
                    <DecisionWindowCard situation={situation} />
                    <PeopleImpactCard situation={situation} impact={impact} />
                </div>
            </div>
        </>
    );
}

type RecommendationProps = Omit<Props, 'liveWeather' | 'loading' | 'chat' | 'chatBusy' | 'onAsk'> & { live: boolean };

function RecommendationCard({
    situation, analysis, live, onRefresh, onNotify, record, recordError, onRecorded, managerNote, onReconsider,
}: RecommendationProps) {
    const [showAlternatives, setShowAlternatives] = useState(false);
    // The posture the decision form opens with; undefined while the form is closed.
    const [formPosture, setFormPosture] = useState<Posture>();
    const [noteOpen, setNoteOpen] = useState(false);
    const decided = record?.record.status === 'Decided' ? record.record : undefined;

    function openForm(posture: Posture) {
        setShowAlternatives(false);
        setNoteOpen(false);
        setFormPosture(posture);
    }

    if (analysis.status === 'loading') {
        return (
            <section className="card recommendation tone-info">
                <p className="eyebrow muted">Agent team recommendation</p>
                <p className="rec-pending">
                    <Icon name="refresh" className="spin" />
                    The agent team is analyzing {live ? 'the live weather feeds' : 'this scenario'}{managerNote ? ' with your note' : ''}…
                </p>
                <p className="small">
                    The meteorologist and workforce analyst gather evidence, the rules analyst checks the decision matrix,
                    and the decision lead combines their findings. This takes about 15 seconds.
                </p>
            </section>
        );
    }

    if (analysis.status === 'error') {
        return (
            <section className="card recommendation tone-danger">
                <p className="eyebrow muted">Agent team recommendation</p>
                <p className="banner"><Icon name="alert" />The agent team could not produce a recommendation.</p>
                <p className="small">{analysis.message}</p>
                <div className="rec-actions">
                    <button className="btn btn-primary" onClick={onRefresh}>Try again</button>
                </div>
            </section>
        );
    }

    const { posture: recommended, summary, confidence } = analysis.data;
    const posture = POSTURES[recommended];
    // The scenario's canned rules-engine result. It describes the mock weather, so it is only
    // shown as a cross-check when the agent analyzed that same scenario.
    const rules = situation.recommendation;

    return (
        <section className={`card recommendation tone-${posture.tone}`}>
            <div className="rec-head">
                <div>
                    <p className="eyebrow muted">Agent team recommendation</p>
                    <p className="rec-posture">{posture.label}</p>
                </div>
                <div className="confidence">
                    <strong>{confidence}%</strong>
                    <span>Confidence</span>
                </div>
            </div>

            <p className="rec-explanation">{summary}</p>

            {analysis.data.team.length > 0 && <TeamBriefs team={analysis.data.team} />}

            {managerNote && (
                <p className="banner tone-info">
                    <Icon name="users" />
                    <span className="grow">Reconsidered with your note: “{managerNote}”</span>
                    {!decided && <button className="btn btn-small" onClick={() => onReconsider(undefined)}>Remove note</button>}
                </p>
            )}

            {!live && (
                <>
                    <p className="small">
                        <strong>Rules engine cross-check:</strong> {POSTURES[rules.posture].label} at {rules.confidence}% confidence.
                        {rules.posture === recommended ? ' It agrees with the agent.' : ' It differs from the agent.'}
                    </p>
                    <table className="triggers">
                        <thead>
                            <tr><th>Rule checked</th><th>Observed</th><th>Threshold</th><th>Result</th></tr>
                        </thead>
                        <tbody>
                            {rules.triggers.map(trigger => (
                                <tr key={trigger.rule}>
                                    <td>{trigger.rule}</td>
                                    <td>{trigger.observed}</td>
                                    <td>{trigger.threshold}</td>
                                    <td>
                                        <span className={`chip ${trigger.crossed ? 'chip-tone' : ''}`}>
                                            {trigger.crossed ? 'Crossed' : 'Not crossed'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}

            {decided ? (
                <div className="rec-actions">
                    <p className="banner tone-ok grow">
                        <Icon name="check" />
                        {decided.action === 'Overridden' ? 'Overridden' : 'Accepted'}: {POSTURES[decided.finalPosture!].label}.
                        Recorded as {decided.id}.
                    </p>
                    <button className="btn btn-primary" onClick={() => onNotify(decided.finalPosture!)}>
                        <Icon name="send" size={18} />
                        Continue to notifications
                    </button>
                </div>
            ) : formPosture ? (
                <DecisionForm
                    key={formPosture}
                    recommended={recommended}
                    confidence={confidence}
                    initialPosture={formPosture}
                    record={record}
                    recordError={recordError}
                    onRecorded={onRecorded}
                    onNotify={onNotify}
                    onCancel={() => setFormPosture(undefined)}
                />
            ) : noteOpen ? (
                <AgentNoteForm
                    initialNote={managerNote}
                    onSubmit={note => { setNoteOpen(false); onReconsider(note); }}
                    onCancel={() => setNoteOpen(false)}
                />
            ) : (
                <div className="rec-actions">
                    <button className="btn btn-primary" onClick={() => openForm(recommended)}>
                        <Icon name="send" size={18} />
                        Record and notify
                    </button>
                    <button className="btn-link" onClick={() => setShowAlternatives(open => !open)} aria-expanded={showAlternatives}>
                        {showAlternatives ? 'Hide other postures' : 'Review other postures'}
                    </button>
                    <button className="btn-link" onClick={() => { setShowAlternatives(false); setNoteOpen(true); }}>
                        {managerNote ? 'Change note for the agent' : 'Tell the agent something'}
                    </button>
                </div>
            )}

            {showAlternatives && !decided && !formPosture && !noteOpen && (
                <ul className="alternatives">
                    {POSTURE_ORDER.filter(id => id !== recommended).map(id => (
                        <li key={id}>
                            <div>
                                <strong>{POSTURES[id].label}</strong>
                                <span>
                                    {(!live && rules.alternatives.find(alternative => alternative.posture === id)?.note)
                                        || 'Not what the agent recommended. Choosing it is recorded as a manager override.'}
                                </span>
                            </div>
                            <button className="btn btn-small" onClick={() => openForm(id)}>
                                Use instead
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

interface DecisionFormProps extends Pick<Props, 'record' | 'recordError' | 'onRecorded' | 'onNotify'> {
    recommended: Posture;
    confidence: number;
    initialPosture: Posture;
    onCancel: () => void;
}

// Writes the human decision to the log (POST /api/decisions with the record id), then opens notifications.
// Choosing anything but the agent's recommendation is an override and needs a rationale.
function DecisionForm({
    recommended, confidence, initialPosture, record, recordError, onRecorded, onNotify, onCancel,
}: DecisionFormProps) {
    const [posture, setPosture] = useState(initialPosture);
    const [rationale, setRationale] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();

    const overriding = posture !== recommended;
    const missingRationale = overriding && !rationale.trim();

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!record || missingRationale) return;
        setSaving(true);
        setError(undefined);
        try {
            const detail = await recordDecision(record.record.id, posture, rationale.trim() || undefined);
            onRecorded(detail);
            onNotify(posture);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'The decision could not be recorded.');
            setSaving(false);
        }
    }

    return (
        <form className="decision-form" onSubmit={submit}>
            <h2>Record the decision</h2>
            <p className="small">
                The agent recommends {POSTURES[recommended].label.toLowerCase()} at {confidence}% confidence. Your decision is
                written to the decision log{record ? ` as ${record.record.id}` : ''} and cannot be changed afterwards.
                Notifications are prepared next.
            </p>

            <label className="field">
                <span className="eyebrow muted">Operating posture</span>
                <select value={posture} onChange={e => setPosture(e.target.value as Posture)} disabled={saving}>
                    {POSTURE_ORDER.map(id => (
                        <option key={id} value={id}>{POSTURES[id].label}{id === recommended ? ' (agent recommendation)' : ''}</option>
                    ))}
                </select>
            </label>

            {overriding && (
                <p className="banner tone-warn">
                    <Icon name="alert" />
                    This overrides the agent's recommendation ({POSTURES[recommended].label}). A rationale is required.
                </p>
            )}

            <label className="stacked">
                <span className="eyebrow muted">Rationale{overriding ? '' : ' (optional)'}</span>
                <textarea
                    value={rationale}
                    onChange={e => setRationale(e.target.value)}
                    placeholder={overriding
                        ? "Why is the agent's recommendation being changed?"
                        : 'Anything the after-action review should know.'}
                    rows={3}
                    required={overriding}
                    disabled={saving}
                />
            </label>

            {!record && (
                <p className={recordError ? 'error-text' : 'small muted'}>
                    {recordError ? `The decision log is unavailable: ${recordError}` : 'Opening the decision record…'}
                </p>
            )}
            {error && <p className="error-text">{error}</p>}

            <div className="rec-actions">
                <button type="submit" className="btn btn-primary" disabled={saving || !record || missingRationale}>
                    <Icon name="check" size={18} />
                    {saving ? 'Recording…' : 'Record and notify'}
                </button>
                <button type="button" className="btn-link" onClick={onCancel} disabled={saving}>Cancel</button>
            </div>
        </form>
    );
}

// Local context the feeds cannot see. The agent analyzes again with it and may change its recommendation.
function AgentNoteForm({ initialNote, onSubmit, onCancel }: {
    initialNote?: string;
    onSubmit: (note: string) => void;
    onCancel: () => void;
}) {
    const [note, setNote] = useState(initialNote ?? '');

    function submit(event: FormEvent) {
        event.preventDefault();
        if (note.trim()) onSubmit(note.trim());
    }

    return (
        <form className="decision-form" onSubmit={submit}>
            <h2>Tell the agent something</h2>
            <p className="small">
                Add what the weather feeds cannot see, such as a power outage, an unplowed parking garage, or a transit
                suspension. The agent analyzes again with it, and the note is kept in the decision record.
            </p>
            <label className="stacked">
                <span className="eyebrow muted">Note for the agent</span>
                <textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="e.g. Building management reports the parking garage ramp is iced over."
                    rows={3}
                    maxLength={500}
                    required
                />
            </label>
            <div className="rec-actions">
                <button type="submit" className="btn btn-primary" disabled={!note.trim()}>
                    <Icon name="refresh" size={18} />
                    Ask the agent to reconsider
                </button>
                <button type="button" className="btn-link" onClick={onCancel}>Cancel</button>
            </div>
        </form>
    );
}

const TOOL_LABELS: Record<string, string> = {
    get_current_observation: 'station reading',
    get_active_alerts: 'NWS alerts',
    get_decision_day_forecast: 'forecast',
    get_facility_schedule: 'facility schedule',
    get_staffing: 'staffing',
    get_rule_checks: 'decision matrix',
    get_manager_note: 'manager note',
    get_decision_history: 'decision history',
};

// What each specialist found and which tools it used, so the manager can see how the
// recommendation was reached. The same briefs are kept in the decision record.
function TeamBriefs({ team }: { team: TeamBrief[] }) {
    return (
        <details className="team-briefs">
            <summary>How the team reached this · {team.length} specialists</summary>
            <ol>
                {team.map(member => (
                    <li key={member.id}>
                        <div className="team-role">
                            <strong>{member.role}</strong>
                            {member.toolsUsed.length > 0 && (
                                <span>Checked {member.toolsUsed.map(name => TOOL_LABELS[name] ?? name).join(', ')}</span>
                            )}
                        </div>
                        <p>{member.brief}</p>
                    </li>
                ))}
            </ol>
        </details>
    );
}

const SUGGESTED_QUESTIONS = [
    'Why not a delayed start instead?',
    'Who still has to come in?',
    'What would change the recommendation?',
];

// The conversation agent: answers the manager's questions by consulting the specialists.
function TeamChat({ chat, busy, ready, onAsk }: { chat: ChatMessage[]; busy: boolean; ready: boolean; onAsk: (question: string) => void }) {
    const [draft, setDraft] = useState('');

    function submit(event: FormEvent) {
        event.preventDefault();
        const question = draft.trim();
        if (!question || busy) return;
        setDraft('');
        onAsk(question);
    }

    return (
        <section className="card team-chat">
            <div className="card-head">
                <h2>Ask the team</h2>
                <Icon name="users" size={24} />
            </div>
            <p className="small">
                A conversation agent answers by consulting the meteorologist, workforce analyst and rules analyst. It advises; you decide.
            </p>

            {chat.length > 0 && (
                <ol className="chat-log" aria-live="polite">
                    {chat.map((message, index) => (
                        <li key={index} className={`chat-${message.role}${message.failed ? ' chat-failed' : ''}`}>
                            <p>{message.text}</p>
                            {message.consulted && message.consulted.length > 0 && (
                                <span className="chat-consulted">Consulted {message.consulted.map(member => member.role).join(', ')}</span>
                            )}
                        </li>
                    ))}
                    {busy && (
                        <li className="chat-assistant chat-pending">
                            <p><Icon name="refresh" size={16} className="spin" /> Consulting the team…</p>
                        </li>
                    )}
                </ol>
            )}

            {chat.length === 0 && ready && (
                <div className="chat-suggestions">
                    {SUGGESTED_QUESTIONS.map(question => (
                        <button key={question} type="button" className="btn btn-small" onClick={() => onAsk(question)} disabled={busy}>
                            {question}
                        </button>
                    ))}
                </div>
            )}

            <form className="chat-form" onSubmit={submit}>
                <input
                    type="text"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder={ready ? 'Ask about the conditions, the rules, or who is affected' : 'Available once the team has a recommendation'}
                    maxLength={1000}
                    disabled={!ready}
                    aria-label="Question for the agent team"
                />
                <button type="submit" className="btn btn-primary" disabled={!ready || busy || !draft.trim()}>
                    <Icon name="send" size={18} />
                    Ask
                </button>
            </form>
        </section>
    );
}

function DecisionWindowCard({ situation }: { situation: Situation }) {
    const now = useNow();
    const { decisionWindow, facility } = situation;
    const zone = facility.timeZone;
    const remaining = Date.parse(decisionWindow.decisionDueAt) - now;

    return (
        <section className="card">
            <div className="card-head">
                <h2>Decision window</h2>
                <span className="small accent">{decisionWindow.dayLabel}</span>
            </div>

            <div className={`countdown ${remaining <= 0 ? 'overdue' : ''}`}>
                <span>Time left to decide</span>
                <strong>{remaining > 0 ? formatCountdown(remaining) : 'Overdue'}</strong>
                <span>
                    Due {formatDateTime(decisionWindow.decisionDueAt, zone)} {facility.timeZoneLabel}
                </span>
            </div>

            <dl className="facts compact">
                <div><dt>Current time</dt><dd>{formatTime(now, zone)} {facility.timeZoneLabel}</dd></div>
                <div><dt>Deciding for</dt><dd>{decisionWindow.operatingDayLabel}</dd></div>
            </dl>

            <ol className="timeline">
                {decisionWindow.steps.map(step => {
                    const passed = Date.parse(step.at) <= now;
                    const state = passed ? 'done' : step.kind === 'decision' ? 'due' : 'upcoming';
                    return (
                        <li key={step.kind} className={state}>
                            <time>{formatTime(step.at, zone)}</time>
                            <span className="marker" />
                            <div>
                                <strong>{step.title}</strong>
                                <span>{step.detail}</span>
                            </div>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}

interface ImpactBasis {
    posture: Posture;
    basis: 'Decided' | 'Agent recommendation';
}

// What each group does under each posture. Mirrors MockData/message-templates.json; `changed`
// marks a workday that differs from a normal day.
const IMPACT: Record<Posture, Record<Audience, { outcome: string; changed: boolean }>> = {
    normal: {
        teleworkReady: { outcome: 'Regular schedule', changed: false },
        onsite: { outcome: 'Report at regular time', changed: false },
        essential: { outcome: 'Report at regular time', changed: false },
    },
    delay: {
        teleworkReady: { outcome: 'Arrive by 10 AM or telework', changed: true },
        onsite: { outcome: 'Arrive by 10 AM', changed: true },
        essential: { outcome: 'Report at normal time', changed: false },
    },
    early_dismissal: {
        teleworkReady: { outcome: 'Leave by 1 PM, telework the rest', changed: true },
        onsite: { outcome: 'Released at 1 PM', changed: true },
        essential: { outcome: 'Secure building, leave by 2 PM', changed: true },
    },
    telework: {
        teleworkReady: { outcome: 'May telework or take leave', changed: true },
        onsite: { outcome: 'Report or take leave', changed: true },
        essential: { outcome: 'Report at normal time', changed: false },
    },
    closure: {
        teleworkReady: { outcome: 'Telework full day', changed: true },
        onsite: { outcome: 'Weather and safety leave', changed: true },
        essential: { outcome: 'Report as directed by voice call', changed: true },
    },
};

function PeopleImpactCard({ situation, impact }: { situation: Situation; impact?: ImpactBasis }) {
    const { staff, audiences } = situation.people;
    const includedShare = (staff.recipients / staff.assigned) * 100;
    const outcomes = impact && IMPACT[impact.posture];
    const tone = impact && POSTURES[impact.posture].tone;
    const changed = outcomes && AUDIENCE_ORDER.reduce((sum, id) => sum + (outcomes[id].changed ? audiences[id] : 0), 0);

    return (
        <section className="card">
            <div className="card-head">
                <h2>People impact</h2>
                <Icon name="users" size={24} />
            </div>
            <p className="small accent impact-basis">
                {impact
                    ? `Under ${POSTURES[impact.posture].label.toLowerCase()} · ${impact.basis}`
                    : 'Waiting for the agent’s recommendation…'}
            </p>

            <p className="big-count"><strong>{formatCount(staff.recipients)}</strong> employees to notify</p>
            <div className="meter" role="img" aria-label={`${staff.recipients} of ${staff.assigned} employees included`}>
                <span style={{ width: `${includedShare}%` }} />
            </div>
            <p className="meter-key">
                <span><i className="dot info" />{staff.recipients} included</span>
                <span><i className="dot off" />{staff.excluded} excluded</span>
            </p>

            <ul className="impact-groups">
                {AUDIENCE_ORDER.map(id => {
                    const outcome = outcomes?.[id];
                    return (
                        <li key={id}>
                            <i className={`dot ${outcome?.changed ? tone : 'off'}`} />
                            <div>
                                <strong>{AUDIENCES[id]}</strong>
                                <span>{outcome?.outcome ?? '—'}</span>
                            </div>
                            <span className="impact-count">{formatCount(audiences[id])}</span>
                        </li>
                    );
                })}
            </ul>

            <p className="small accent card-foot">
                {changed !== undefined && `${formatCount(changed)} of ${formatCount(staff.recipients)} employees have a changed workday. `}
                {staff.essential} essential personnel also get a voice call.
            </p>
        </section>
    );
}

function WeatherData({ situation }: { situation: Situation }) {
    const { weather, facility, decisionWindow } = situation;
    const zone = facility.timeZone;
    const { current, totals } = weather;
    const stamp = (value: string) => formatDateTime(value, zone);

    return (
        <section className="stack">
            <div className="section-head">
                <div>
                    <h2>Weather data</h2>
                    <p className="small">
                        Raw values behind the recommendation for {decisionWindow.operatingDayLabel}, with source and observation time.
                    </p>
                </div>
                <span className="small">
                    NWS {facility.location.nwsOffice} grid {facility.location.nwsGridX},{facility.location.nwsGridY}
                </span>
            </div>

            <article className="card evidence">
                <span className="tile-icon"><Icon name="alert" /></span>
                <div>
                    <p className="source">National Weather Service alerts <time>{stamp(weather.observedAt)}</time></p>
                    {weather.alerts.length === 0 && (
                        <>
                            <h3>No active alerts</h3>
                            <p className="small">No watches, warnings, or advisories for {facility.location.county}.</p>
                        </>
                    )}
                    {weather.alerts.map(alert => (
                        <div key={alert.event} className="alert-item">
                            <h3>{alert.event} <span className="chip">{alert.timing}</span></h3>
                            <p className="small">{alert.headline}</p>
                            <p className="small muted">
                                Severity {alert.severity} · Certainty {alert.certainty} · Urgency {alert.urgency} · {alert.area}
                            </p>
                        </div>
                    ))}
                </div>
            </article>

            <article className="card evidence">
                <span className="tile-icon"><Icon name="cloud" /></span>
                <div>
                    <p className="source">Current conditions <time>{stamp(weather.observedAt)}</time></p>
                    <h3>{formatTemp(current.temperatureF)} · {current.conditions}</h3>
                    <dl className="stats">
                        <div><dt>Wind chill</dt><dd>{formatTemp(current.windChillF)}</dd></div>
                        <div><dt>Wind</dt><dd>{current.windDirection} {current.windSpeedMph} mph</dd></div>
                        <div><dt>Gusts</dt><dd>{current.windGustMph} mph</dd></div>
                        <div><dt>Humidity</dt><dd>{current.humidityPct}%</dd></div>
                        <div><dt>Visibility</dt><dd>{current.visibilityMi} mi</dd></div>
                    </dl>
                </div>
            </article>

            <article className="card evidence">
                <span className="tile-icon"><Icon name="wind" /></span>
                <div>
                    <p className="source">NWS point forecast <time>{stamp(weather.forecastIssuedAt)}</time></p>
                    <h3>Forecast for {decisionWindow.operatingDayLabel}</h3>
                    <div className="table-scroll">
                        <table className="data nowrap">
                            <thead>
                                <tr>
                                    <th>Period</th><th>Forecast</th><th>Temp</th><th>Wind chill</th>
                                    <th>Wind</th><th>Gusts</th><th>Precip</th><th>Snow</th><th>Ice</th>
                                </tr>
                            </thead>
                            <tbody>
                                {weather.forecast.map(period => (
                                    <tr key={period.period}>
                                        <td><strong>{period.period}</strong><span>{period.window}</span></td>
                                        <td>{period.shortForecast}</td>
                                        <td>{formatTemp(period.temperatureF)}</td>
                                        <td>{formatTemp(period.windChillF)}</td>
                                        <td>{period.windDirection} {period.windSpeedMph} mph</td>
                                        <td>{period.windGustMph} mph</td>
                                        <td>{period.precipChancePct}%</td>
                                        <td>{period.snowIn} in</td>
                                        <td>{period.iceIn} in</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td colSpan={3}><strong>Day total</strong></td>
                                    <td>Low {formatTemp(totals.minWindChillF)}</td>
                                    <td />
                                    <td>Peak {totals.maxGustMph} mph</td>
                                    <td />
                                    <td>{totals.snowIn} in</td>
                                    <td>{totals.iceIn} in</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            </article>

            <article className="card evidence">
                <span className="tile-icon"><Icon name="pin" /></span>
                <div>
                    <p className="source">MoDOT road conditions <time>{stamp(weather.roadsReportedAt)}</time></p>
                    <h3>{weather.roads.status}</h3>
                    <p className="small">{weather.roads.detail}</p>
                </div>
            </article>
        </section>
    );
}

function withUnit(value: number | null, unit: string): string {
    return value === null ? '—' : `${value} ${unit}`;
}

function LiveWeatherData({ situation, liveWeather }: { situation: Situation; liveWeather: LiveWeatherState }) {
    const zone = situation.facility.timeZone;
    const { data, error } = liveWeather;

    return (
        <section className="stack">
            <div className="section-head">
                <div>
                    <h2>Weather data</h2>
                    <p className="small">Live National Weather Service feeds the agent analyzed.</p>
                </div>
                {data && <span className="small">{data.current.stationName}</span>}
            </div>

            {error && <p className="banner tone-danger"><Icon name="alert" />{error}</p>}
            {!data && !error && <p className="small muted">Loading live weather…</p>}

            {data && (
                <>
                    <article className="card evidence">
                        <span className="tile-icon"><Icon name="alert" /></span>
                        <div>
                            <p className="source">National Weather Service alerts</p>
                            {data.alerts.length === 0 && (
                                <>
                                    <h3>No active alerts</h3>
                                    <p className="small">No watches, warnings, or advisories at the facility.</p>
                                </>
                            )}
                            {data.alerts.map(alert => {
                                const until = alert.ends ?? alert.expires;
                                return (
                                    <div key={alert.id} className="alert-item">
                                        <h3>
                                            {alert.event}
                                            {until && <span className="chip">Until {formatDateTime(until, zone)}</span>}
                                        </h3>
                                        {alert.headline && <p className="small">{alert.headline}</p>}
                                        <p className="small muted">
                                            Severity {alert.severity} · Certainty {alert.certainty} · Urgency {alert.urgency}
                                            {alert.areaDescription && ` · ${alert.areaDescription}`}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>
                    </article>

                    <article className="card evidence">
                        <span className="tile-icon"><Icon name="cloud" /></span>
                        <div>
                            <p className="source">Current conditions <time>{formatDateTime(data.current.observedAt, zone)}</time></p>
                            <h3>{formatTemp(data.current.temperatureF)} · {data.current.conditions ?? 'Conditions not reported'}</h3>
                            <dl className="stats">
                                <div><dt>Feels like</dt><dd>{formatTemp(data.current.feelsLikeF)}</dd></div>
                                <div><dt>Wind</dt><dd>{data.current.windDirection} {withUnit(data.current.windSpeedMph, 'mph')}</dd></div>
                                <div><dt>Gusts</dt><dd>{withUnit(data.current.windGustMph, 'mph')}</dd></div>
                                <div><dt>Humidity</dt><dd>{withUnit(data.current.humidityPercent, '%')}</dd></div>
                                <div><dt>Visibility</dt><dd>{withUnit(data.current.visibilityMiles, 'mi')}</dd></div>
                            </dl>
                        </div>
                    </article>

                    <LiveForecastCard situation={situation} forecast={data.forecast} />
                </>
            )}
        </section>
    );
}

const FORECAST_WINDOWS = [
    ['overnight', 'Overnight'],
    ['morningCommute', 'Morning commute'],
    ['officeHours', 'Office hours'],
    ['eveningCommute', 'Evening commute'],
    ['wholeDay', 'Whole day'],
] as const;

// Shows the forecast for the day being decided, which is the same slice the agent is given.
function LiveForecastCard({ situation, forecast }: { situation: Situation; forecast: LiveForecast | null }) {
    const { decisionWindow, facility } = situation;
    const zone = facility.timeZone;
    const day = forecast?.days.find(entry => entry.date === decisionWindow.operatingDate);

    return (
        <article className="card evidence">
            <span className="tile-icon"><Icon name="wind" /></span>
            <div>
                <p className="source">
                    NWS workday forecast
                    {forecast?.forecastUpdatedAt && <time>{formatDateTime(forecast.forecastUpdatedAt, zone)}</time>}
                </p>
                {day ? (
                    <>
                        <h3>Forecast for {decisionWindow.operatingDayLabel}</h3>
                        <div className="table-scroll">
                            <table className="data nowrap">
                                <thead>
                                    <tr>
                                        <th>Window</th><th>Snow</th><th>Ice</th><th>Wind chill</th>
                                        <th>Heat index</th><th>Gusts</th><th>Precip</th><th>Thunder</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {FORECAST_WINDOWS.map(([key, label]) => {
                                        const slot = day[key];
                                        return (
                                            <tr key={key}>
                                                <td>
                                                    <strong>{label}</strong>
                                                    <span>{formatTime(slot.start, zone)}–{formatTime(slot.end, zone)}</span>
                                                </td>
                                                <td>{withUnit(slot.snowInches, 'in')}</td>
                                                <td>{withUnit(slot.iceInches, 'in')}</td>
                                                <td>{formatTemp(slot.lowestWindChillF)}</td>
                                                <td>{formatTemp(slot.highestHeatIndexF)}</td>
                                                <td>{withUnit(slot.highestWindGustMph, 'mph')}</td>
                                                <td>{withUnit(slot.highestPrecipChancePercent, '%')}</td>
                                                <td>{withUnit(slot.highestThunderChancePercent, '%')}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <p className="small muted">Road conditions have no live feed yet.</p>
                    </>
                ) : (
                    <>
                        <h3>Forecast unavailable</h3>
                        <p className="small">
                            {forecast
                                ? `The forecast feed has no entry for ${decisionWindow.operatingDayLabel}.`
                                : 'The forecast feed could not be reached.'}
                            {' '}The agent decided from the current reading and active alerts.
                        </p>
                    </>
                )}
            </div>
        </article>
    );
}
