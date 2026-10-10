import { useState } from 'react';
import { sendNotification } from '../api';
import type { Analysis, Audience, Decision, Posture, Situation } from '../api';
import { Icon, PageHead } from '../components';
import { AUDIENCES, AUDIENCE_ORDER, POSTURES, POSTURE_ORDER, formatCount, formatTime } from '../format';

const CHANNELS = ['SMS', 'Email', 'Voice for essential personnel'];

interface Props {
    situation: Situation;
    // The agent's recommendation, once it has one.
    analysis?: Analysis;
    posture: Posture;
    onPostureChange: (posture: Posture) => void;
    edits: Record<string, string>;
    onEdit: (key: string, message: string) => void;
    decision?: Decision;
    onSent: (decision: Decision) => void;
}

export function NotificationsPage({ situation, analysis, posture, onPostureChange, edits, onEdit, decision, onSent }: Props) {
    const [selected, setSelected] = useState<Audience | 'agent'>('agent');
    const [channels, setChannels] = useState(CHANNELS);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string>();

    const { people, facility, decisionWindow } = situation;
    const recipients = people.staff.recipients;
    const essentialCount = people.audiences.essential;
    // The agent wrote its email for the posture it recommended, so its draft is only offered
    // for that posture. For any other posture the per-audience templates apply.
    const agentDraft = analysis && analysis.posture === posture ? analysis.email : undefined;
    const audience = selected === 'agent' && !agentDraft ? 'teleworkReady' : selected;
    const key = `${posture}:${audience}`;
    const message = edits[key]
        ?? (audience === 'agent'
            ? agentDraft!
            : situation.messageTemplates[posture][audience].replaceAll('{day}', decisionWindow.operatingDayLabel));

    function toggleChannel(channel: string) {
        setChannels(current => current.includes(channel) ? current.filter(c => c !== channel) : [...current, channel]);
    }

    async function send() {
        setSending(true);
        setError(undefined);
        try {
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
                                <select value={posture} onChange={e => onPostureChange(e.target.value as Posture)} disabled={!!decision}>
                                    {POSTURE_ORDER.map(id => <option key={id} value={id}>{POSTURES[id].label}</option>)}
                                </select>
                            </label>
                            <span className={`chip ${decision ? 'chip-ok' : 'chip-warn'}`}>{decision ? 'Sent' : 'Draft'}</span>
                        </div>

                        {analysis && posture !== analysis.posture && (
                            <p className="banner tone-warn">
                                <Icon name="alert" />
                                This differs from the agent's recommendation ({POSTURES[analysis.posture].label}). The change will be recorded.
                            </p>
                        )}

                        <div className="segmented" role="tablist" aria-label="Audience">
                            {agentDraft && (
                                <button role="tab" aria-selected={audience === 'agent'} onClick={() => setSelected('agent')}>
                                    Agent draft · all {formatCount(recipients)}
                                </button>
                            )}
                            {AUDIENCE_ORDER.map(id => (
                                <button key={id} role="tab" aria-selected={audience === id} onClick={() => setSelected(id)}>
                                    {AUDIENCES[id]} · {formatCount(people.audiences[id])}
                                </button>
                            ))}
                        </div>

                        <textarea
                            aria-label={audience === 'agent' ? 'Agent draft message' : `${AUDIENCES[audience]} message`}
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
                                        disabled={!!decision}
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
                            <button className="btn btn-primary btn-wide" onClick={send} disabled={sending || channels.length === 0}>
                                <Icon name="send" />
                                {sending ? 'Sending…' : `Approve and send to ${formatCount(recipients)} employees`}
                            </button>
                        )}
                        {error && <p className="error-text">{error}</p>}
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
