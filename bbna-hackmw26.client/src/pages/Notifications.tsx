import { useState } from 'react';
import { sendNotification } from '../api';
import type { Audience, Decision, Posture, Situation } from '../api';
import { Icon, PageHead } from '../components';
import { POSTURES, POSTURE_ORDER, formatCount, formatTime } from '../format';

const CHANNELS = ['SMS', 'Email', 'Voice for essential staff'];

interface Props {
    situation: Situation;
    posture: Posture;
    onPostureChange: (posture: Posture) => void;
    edits: Record<string, string>;
    onEdit: (key: string, message: string) => void;
    decision?: Decision;
    onSent: (decision: Decision) => void;
}

export function NotificationsPage({ situation, posture, onPostureChange, edits, onEdit, decision, onSent }: Props) {
    const [audience, setAudience] = useState<Audience>('staff');
    const [channels, setChannels] = useState(CHANNELS);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string>();

    const { people, facility, decisionWindow } = situation;
    const staffCount = people.staff.recipients;
    const familyCount = people.families.guardianContacts;
    const key = `${posture}:${audience}`;
    const message = edits[key]
        ?? situation.messageTemplates[posture][audience].replaceAll('{day}', decisionWindow.operatingDayLabel);

    function toggleChannel(channel: string) {
        setChannels(current => current.includes(channel) ? current.filter(c => c !== channel) : [...current, channel]);
    }

    async function send() {
        setSending(true);
        setError(undefined);
        try {
            onSent(await sendNotification({ posture, channels, staffRecipients: staffCount, familyContacts: familyCount }));
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

                        {posture !== situation.recommendation.posture && (
                            <p className="banner tone-warn">
                                <Icon name="alert" />
                                This differs from the system recommendation ({POSTURES[situation.recommendation.posture].label}). The change will be recorded.
                            </p>
                        )}

                        <div className="segmented" role="tablist" aria-label="Audience">
                            <button role="tab" aria-selected={audience === 'staff'} onClick={() => setAudience('staff')}>
                                Staff message · {formatCount(staffCount)}
                            </button>
                            <button role="tab" aria-selected={audience === 'families'} onClick={() => setAudience('families')}>
                                Family message · {formatCount(familyCount)}
                            </button>
                        </div>

                        <textarea
                            aria-label={`${audience === 'staff' ? 'Staff' : 'Family'} message`}
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
                                Released at {formatTime(decision.sentAt, facility.timeZone)} {facility.timeZoneLabel} to {formatCount(decision.staffRecipients)} staff
                                and {formatCount(decision.familyContacts)} family contacts. Simulated: no messages left the system.
                            </p>
                        ) : (
                            <button className="btn btn-primary btn-wide" onClick={send} disabled={sending || channels.length === 0}>
                                <Icon name="send" />
                                {sending ? 'Sending…' : `Approve and send to ${formatCount(staffCount)} staff and ${formatCount(familyCount)} family contacts`}
                            </button>
                        )}
                        {error && <p className="error-text">{error}</p>}
                    </section>

                    <section className="card">
                        <div className="section-head">
                            <div>
                                <h2>Recipient review</h2>
                                <p className="small">{people.sample.length} representative records from the staff roster.</p>
                            </div>
                            <span className="small">{people.staff.recipients} included · {people.staff.excluded} excluded</span>
                        </div>
                        <div className="table-scroll">
                            <table className="data">
                                <thead>
                                    <tr><th>Staff member</th><th>Decision logic</th><th>Routing</th><th>Status</th></tr>
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
                        <div><dt>Students</dt><dd>{formatCount(people.families.students)}</dd></div>
                        <div><dt>Family contacts</dt><dd>{formatCount(familyCount)}</dd></div>
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
