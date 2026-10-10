import { useState } from 'react';
import { recordDecision, sendNotification } from '../api';
import type { Audience, Decision, DecisionRecordDetail, Posture, Situation } from '../api';
import { Icon, PageHead } from '../components';
import { AUDIENCES, AUDIENCE_ORDER, POSTURES, POSTURE_ORDER, formatCount, formatTime } from '../format';

const CHANNELS = ['SMS', 'Email', 'Voice for essential personnel'];

interface Props {
    situation: Situation;
    posture: Posture;
    onPostureChange: (posture: Posture) => void;
    edits: Record<string, string>;
    onEdit: (key: string, message: string) => void;
    decision?: Decision;
    onSent: (decision: Decision) => void;
    record?: DecisionRecordDetail;
    recordError?: string;
    onRecorded: (record: DecisionRecordDetail) => void;
}

export function NotificationsPage({
    situation, posture, onPostureChange, edits, onEdit, decision, onSent, record, recordError, onRecorded,
}: Props) {
    const [audience, setAudience] = useState<Audience>('teleworkReady');
    const [channels, setChannels] = useState(CHANNELS);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string>();
    const [rationale, setRationale] = useState('');

    const { people, facility, decisionWindow } = situation;
    const recipients = people.staff.recipients;
    const essentialCount = people.audiences.essential;
    const key = `${posture}:${audience}`;
    const message = edits[key]
        ?? situation.messageTemplates[posture][audience].replaceAll('{day}', decisionWindow.operatingDayLabel);
    const overriding = posture !== situation.recommendation.posture;
    // Once the decision is in the log it cannot change, even if the release itself has to be retried.
    const decided = record?.record.status === 'Decided';
    const locked = !!decision || decided;

    function toggleChannel(channel: string) {
        setChannels(current => current.includes(channel) ? current.filter(c => c !== channel) : [...current, channel]);
    }

    // The decision goes into the log before anything is released, so every release has a record behind it.
    async function send() {
        if (!record) return;
        setSending(true);
        setError(undefined);
        try {
            if (!decided) {
                onRecorded(await recordDecision(record.record.id, posture, overriding ? rationale.trim() : undefined));
            }
            onSent(await sendNotification({ posture, channels, recipients, essentialRecipients: essentialCount }));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'The notification request failed.');
        } finally {
            setSending(false);
        }
    }

    return (
        <>
            <PageHead
                eyebrow="Notification package"
                title="Reach the right people"
                subtitle="Review audience logic, channels, and instructions before release."
            />
            <div className="split">
                <div className="stack">
                    <section className="card">
                        <div className="compose-head">
                            <label className="field">
                                <span className="eyebrow muted">Operating posture</span>
                                <select value={posture} onChange={e => onPostureChange(e.target.value as Posture)} disabled={locked}>
                                    {POSTURE_ORDER.map(id => <option key={id} value={id}>{POSTURES[id].label}</option>)}
                                </select>
                            </label>
                            <span className={`chip ${decision ? 'chip-ok' : 'chip-warn'}`}>{decision ? 'Sent' : 'Draft'}</span>
                        </div>

                        {overriding && (
                            <>
                                <p className="banner tone-warn">
                                    <Icon name="alert" />
                                    This differs from the system recommendation ({POSTURES[situation.recommendation.posture].label}). The change will be recorded.
                                </p>
                                <textarea
                                    className="rationale"
                                    aria-label="Reason for changing the recommendation"
                                    placeholder="Required: why are you changing the recommended posture?"
                                    value={rationale}
                                    onChange={e => setRationale(e.target.value)}
                                    readOnly={locked}
                                    rows={3}
                                />
                            </>
                        )}

                        <div className="segmented" role="tablist" aria-label="Audience">
                            {AUDIENCE_ORDER.map(id => (
                                <button key={id} role="tab" aria-selected={audience === id} onClick={() => setAudience(id)}>
                                    {AUDIENCES[id]} · {formatCount(people.audiences[id])}
                                </button>
                            ))}
                        </div>

                        <textarea
                            aria-label={`${AUDIENCES[audience]} message`}
                            value={message}
                            onChange={e => onEdit(key, e.target.value)}
                            readOnly={!!decision}
                            rows={9}
                        />

                        <fieldset className="channels">
                            <legend>Route through</legend>
                            {CHANNELS.map(channel => (
                                <label key={channel}>
                                    <input
                                        type="checkbox"
                                        checked={channels.includes(channel)}
                                        onChange={() => toggleChannel(channel)}
                                        disabled={locked}
                                    />
                                    {channel}
                                </label>
                            ))}
                        </fieldset>

                        {decision ? (
                            <p className="banner tone-ok">
                                <Icon name="check" />
                                Released at {formatTime(decision.sentAt, facility.timeZone)} {facility.timeZoneLabel} to {formatCount(decision.recipients)} employees,
                                including {formatCount(decision.essentialRecipients)} essential personnel. Simulated: no messages left the system.
                            </p>
                        ) : (
                            <button
                                className="btn btn-primary btn-wide"
                                onClick={send}
                                disabled={sending || !record || channels.length === 0 || (overriding && !decided && !rationale.trim())}
                            >
                                <Icon name="send" />
                                {sending ? 'Sending…' : `Approve and send to ${formatCount(recipients)} employees`}
                            </button>
                        )}
                        {error && <p className="error-text">{error}</p>}
                        {!decision && !record && (
                            <p className={recordError ? 'error-text' : 'small muted card-foot'}>
                                {recordError
                                    ? `The decision log is unavailable, so nothing can be released: ${recordError}`
                                    : 'Opening the decision record…'}
                            </p>
                        )}
                    </section>

                    <section className="card">
                        <div className="section-head">
                            <div>
                                <h2>Recipient review</h2>
                                <p className="small">{people.sample.length} representative records from the employee roster.</p>
                            </div>
                            <span className="small">{people.staff.recipients} included · {people.staff.excluded} excluded</span>
                        </div>
                        <div className="table-scroll">
                            <table className="data">
                                <thead>
                                    <tr><th>Employee</th><th>Decision logic</th><th>Routing</th><th>Status</th></tr>
                                </thead>
                                <tbody>
                                    {people.sample.map(person => (
                                        <tr key={person.name}>
                                            <td><strong>{person.name}</strong><span>{person.role}</span></td>
                                            <td>{person.logic}</td>
                                            <td>{person.routing.join(' · ') || '—'}</td>
                                            <td>
                                                <span className={`chip ${person.included ? 'chip-ok' : ''}`}>
                                                    {person.included ? 'Include' : 'Exclude'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="small muted card-foot">{people.dataNote}</p>
                    </section>
                </div>

                <section className="card">
                    <h2>Audience logic</h2>
                    <p className="small">{people.resolvedAgainst}</p>
                    <ol className="steps">
                        {people.staff.steps.map((step, index) => (
                            <li key={step.label} className={step.final ? 'final' : undefined}>
                                <span className="marker">{step.final ? <Icon name="check" size={16} /> : index + 1}</span>
                                <div>
                                    <strong>{step.label}</strong>
                                    <span>{step.detail}</span>
                                </div>
                            </li>
                        ))}
                    </ol>
                    <dl className="facts compact">
                        {AUDIENCE_ORDER.map(id => (
                            <div key={id}><dt>{AUDIENCES[id]}</dt><dd>{formatCount(people.audiences[id])}</dd></div>
                        ))}
                    </dl>
                    <div className="callout">
                        <Icon name="users" />
                        <div>
                            <strong>{people.accessibility.title}</strong>
                            <span>{people.accessibility.detail}</span>
                        </div>
                    </div>
                </section>
            </div>
        </>
    );
}
