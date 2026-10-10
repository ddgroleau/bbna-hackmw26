import type { AuditEvent, Decision, DecisionRecordDetail, Situation } from '../api';
import { Icon, PageHead } from '../components';
import type { IconName } from '../components';
import { POSTURES, formatCount, formatDateTime } from '../format';

interface RecordEvent {
    key: string;
    icon: IconName;
    when: string;
    title: string;
    detail: string;
}

const EVENT_ICONS: Record<AuditEvent['kind'], IconName> = {
    EvidenceCaptured: 'refresh',
    RecommendationGenerated: 'shield',
    DecisionRecorded: 'check',
};

interface Props {
    situation: Situation;
    decision?: Decision;
    record?: DecisionRecordDetail;
    recordError?: string;
}

// The timeline is read from the decision log. Only the notification release, which is simulated
// and never reaches the server's log, comes from this session.
export function DecisionRecordPage({ situation, decision, record, recordError }: Props) {
    const { facility, thresholds } = situation;
    const stamp = (value: string) => formatDateTime(value, facility.timeZone);

    const events: RecordEvent[] = (record?.events ?? []).map(event => ({
        key: `log-${event.seq}`,
        icon: EVENT_ICONS[event.kind] ?? 'file',
        when: `${stamp(event.occurredAt)} · ${event.actor}`,
        title: event.title,
        detail: event.detail,
    }));

    if (record?.record.status === 'AwaitingDecision') {
        events.push({
            key: 'pending',
            icon: 'clock',
            when: 'Pending',
            title: 'Human decision required',
            detail: 'The recommendation has not been accepted or changed.',
        });
    }

    if (decision) {
        events.push({
            key: 'notified',
            icon: 'send',
            when: stamp(decision.sentAt),
            title: 'Notifications released (simulated)',
            detail: `${formatCount(decision.recipients)} employees, including ${formatCount(decision.essentialRecipients)} essential personnel, through ${decision.channels.join(', ')}.`,
        });
    }

    function exportRecord(detail: DecisionRecordDetail) {
        const json = JSON.stringify({ exportedAt: new Date().toISOString(), detail }, null, 2);
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${detail.record.id}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }

    const integrity = record?.integrity;
    const status = !record ? '—'
        : record.record.status === 'Decided'
            ? `${record.record.action === 'Overridden' ? 'Overridden' : 'Accepted'}: ${POSTURES[record.record.finalPosture!].label}`
            : 'Awaiting decision';

    return (
        <>
            <PageHead
                eyebrow="Audit trail"
                title="Decision record"
                subtitle="A reconstructable record of what was known, when, and by whom."
                action={record && (
                    <button className="btn" onClick={() => exportRecord(record)}><Icon name="file" size={18} />Export record</button>
                )}
            />
            <div className="stack">
                {recordError && <p className="banner tone-danger"><Icon name="alert" />Could not open the decision record: {recordError}</p>}

                <dl className="card meta-grid">
                    <div><dt>Record ID</dt><dd>{record?.record.id ?? (recordError ? 'Unavailable' : 'Opening…')}</dd></div>
                    <div><dt>Facility</dt><dd>{facility.shortName}</dd></div>
                    <div><dt>Status</dt><dd>{status}</dd></div>
                    <div>
                        <dt>Integrity</dt>
                        <dd>
                            {!integrity ? '—'
                                : integrity.valid ? `Hash chain verified (${integrity.eventCount} events)`
                                    : `Chain broken at event ${integrity.brokenAtSeq}`}
                        </dd>
                    </div>
                </dl>

                <ol className="card events">
                    {events.map(event => (
                        <li key={event.key}>
                            <span className="tile-icon round"><Icon name={event.icon} /></span>
                            <div>
                                <time>{event.when}</time>
                                <strong>{event.title}</strong>
                                <span>{event.detail}</span>
                            </div>
                        </li>
                    ))}
                </ol>

                <div className="callout wide">
                    <Icon name="shield" size={26} />
                    <div>
                        <strong>Record integrity</strong>
                        <span>
                            Every entry is written to an append-only log and chained to the one before it by a SHA-256 hash,
                            so any later change to the record is detected. Source payloads and ruleset
                            version {thresholds.rulesetVersion} are retained for after-action review.
                        </span>
                    </div>
                </div>
            </div>
        </>
    );
}
