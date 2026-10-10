import { useEffect, useRef, useState } from 'react';
import { fetchDecisionLog } from '../api';
import type { AuditEvent, DecisionRecordDetail } from '../api';
import { Icon, PageHead } from '../components';
import type { IconName } from '../components';
import { EXPORT_FORMATS, exportDecisions } from '../exportDecisions';
import type { ExportFormat } from '../exportDecisions';
import { POSTURES, formatDateTime } from '../format';

const EVENT_ICONS: Record<AuditEvent['kind'], IconName> = {
    EvidenceCaptured: 'refresh',
    RecommendationGenerated: 'shield',
    DecisionRecorded: 'check',
};

// The log stores UTC; show it in the viewer's own zone.
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const stamp = (value: string) => formatDateTime(value, ZONE);

function statusLabel({ record }: DecisionRecordDetail): string {
    if (record.status === 'AwaitingDecision') return 'Awaiting decision';
    return `${record.action === 'Overridden' ? 'Overridden' : 'Accepted'}: ${POSTURES[record.finalPosture!].label}`;
}

function integrityLabel({ integrity }: DecisionRecordDetail): string {
    return integrity.valid
        ? `Hash chain verified (${integrity.eventCount} events)`
        : `Chain broken at event ${integrity.brokenAtSeq}`;
}

// Everything on this page is read from the decision log (GET /api/decisions).
// `current` is the record this session is working on; the page opens on it and reloads when it changes.
export function DecisionRecordPage({ current }: { current?: DecisionRecordDetail }) {
    const [log, setLog] = useState<DecisionRecordDetail[]>();
    const [error, setError] = useState<string>();
    const [loading, setLoading] = useState(true);
    const [reloads, setReloads] = useState(0);
    const [selectedId, setSelectedId] = useState<string>();

    const currentKey = current && `${current.record.id}:${current.record.status}`;

    useEffect(() => {
        let cancelled = false;
        fetchDecisionLog()
            .then(records => {
                if (cancelled) return;
                setLog(records);
                setError(undefined);
            })
            .catch((e: Error) => {
                if (!cancelled) setError(e.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [currentKey, reloads]);

    function reload() {
        setLoading(true);
        setReloads(count => count + 1);
    }

    const selected = log?.find(item => item.record.id === (selectedId ?? current?.record.id)) ?? log?.[0];

    return (
        <>
            <PageHead
                eyebrow="Audit trail"
                title="Decision record"
                subtitle="A reconstructable record of what was known, when, and by whom."
                action={selected && log && <ExportMenu selected={selected} log={log} />}
            />
            <div className="stack">
                {error && (
                    <p className="banner tone-danger">
                        <Icon name="alert" />Could not load the decision log: {error}
                        {log && ' Showing the last data received.'}
                    </p>
                )}

                {!log && !error && <p className="card">Loading the decision log…</p>}
                {log?.length === 0 && <p className="card">The decision log is empty. A record opens when a recommendation is generated.</p>}

                {selected && <RecordDetail detail={selected} />}

                {log && log.length > 0 && (
                    <section className="card">
                        <div className="section-head">
                            <div>
                                <h2>Decision log</h2>
                                <p className="small">{log.length} {log.length === 1 ? 'record' : 'records'}, newest first. Times in {ZONE}.</p>
                            </div>
                            <button className="btn btn-small" onClick={reload} disabled={loading}>
                                <Icon name="refresh" size={16} />{loading ? 'Loading…' : 'Reload'}
                            </button>
                        </div>
                        <div className="table-scroll">
                            <table className="data">
                                <thead>
                                    <tr><th>Record</th><th>Recommended</th><th>Outcome</th><th>Integrity</th></tr>
                                </thead>
                                <tbody>
                                    {log.map(item => {
                                        const { record } = item;
                                        const isSelected = item === selected;
                                        return (
                                            <tr key={record.id} aria-selected={isSelected}>
                                                <td>
                                                    <button className="btn-link log-id" onClick={() => setSelectedId(record.id)} aria-current={isSelected || undefined}>
                                                        {record.id}
                                                    </button>
                                                    <span>{stamp(record.createdAt)}{record.id === current?.record.id && ' · current'}</span>
                                                </td>
                                                <td>{POSTURES[record.recommendedPosture].label}</td>
                                                <td>
                                                    <span className={`chip ${record.status === 'Decided' ? 'chip-ok' : 'chip-warn'}`}>
                                                        {statusLabel(item)}
                                                    </span>
                                                </td>
                                                <td>{item.integrity.valid ? 'Verified' : `Broken at ${item.integrity.brokenAtSeq}`}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}
            </div>
        </>
    );
}

// Export the selected record or the whole log as a PDF report, an Excel workbook, or JSON.
function ExportMenu({ selected, log }: { selected: DecisionRecordDetail; log: DecisionRecordDetail[] }) {
    const menu = useRef<HTMLDetailsElement>(null);
    const [scope, setScope] = useState<'record' | 'log'>('record');
    const [busy, setBusy] = useState<ExportFormat>();
    const [error, setError] = useState<string>();

    async function run(format: ExportFormat) {
        setBusy(format);
        setError(undefined);
        try {
            if (scope === 'record') {
                await exportDecisions([selected], format, selected.record.id);
            } else {
                await exportDecisions(log, format, `decision-log-${new Date().toISOString().slice(0, 10)}`);
            }
            menu.current?.removeAttribute('open');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'The export failed.');
        } finally {
            setBusy(undefined);
        }
    }

    return (
        <details className="export-menu" ref={menu}>
            <summary className="btn"><Icon name="file" size={18} />Export</summary>
            <div className="export-panel">
                <fieldset>
                    <legend className="eyebrow muted">Include</legend>
                    <label>
                        <input type="radio" name="export-scope" checked={scope === 'record'} onChange={() => setScope('record')} />
                        This record ({selected.record.id})
                    </label>
                    <label>
                        <input type="radio" name="export-scope" checked={scope === 'log'} onChange={() => setScope('log')} />
                        Entire log ({log.length} {log.length === 1 ? 'record' : 'records'})
                    </label>
                </fieldset>
                <ul>
                    {EXPORT_FORMATS.map(format => (
                        <li key={format.id}>
                            <button type="button" onClick={() => run(format.id)} disabled={!!busy}>
                                <strong>{busy === format.id ? 'Preparing…' : format.label}</strong>
                                <span>{format.detail}</span>
                            </button>
                        </li>
                    ))}
                </ul>
                {error && <p className="error-text">{error}</p>}
            </div>
        </details>
    );
}

function RecordDetail({ detail }: { detail: DecisionRecordDetail }) {
    const { record, events } = detail;

    return (
        <>
            <dl className="card meta-grid">
                <div><dt>Record ID</dt><dd>{record.id}</dd></div>
                <div><dt>Facility</dt><dd>{record.facilityName}</dd></div>
                <div><dt>Status</dt><dd>{statusLabel(detail)}</dd></div>
                <div><dt>Integrity</dt><dd>{integrityLabel(detail)}</dd></div>
            </dl>

            {!detail.integrity.valid && (
                <p className="banner tone-danger">
                    <Icon name="alert" />
                    Event {detail.integrity.brokenAtSeq} no longer matches its hash. The log was changed after it was written.
                </p>
            )}

            <ol className="card events">
                {events.map(event => (
                    <li key={event.seq}>
                        <span className="tile-icon round"><Icon name={EVENT_ICONS[event.kind] ?? 'file'} /></span>
                        <div>
                            <time>{stamp(event.occurredAt)} · {event.actor}</time>
                            <strong>{event.title}</strong>
                            <span>{event.detail}</span>
                        </div>
                    </li>
                ))}
                {record.status === 'AwaitingDecision' && (
                    <li>
                        <span className="tile-icon round"><Icon name="clock" /></span>
                        <div>
                            <time>Pending</time>
                            <strong>Human decision required</strong>
                            <span>The recommendation has not been accepted or changed.</span>
                        </div>
                    </li>
                )}
            </ol>

            <div className="callout wide">
                <Icon name="shield" size={26} />
                <div>
                    <strong>Record integrity</strong>
                    <span>
                        Every entry is written to an append-only log and chained to the one before it by a SHA-256 hash,
                        so any later change to the record is detected. Source payloads and ruleset
                        version {record.rulesetVersion} are retained for after-action review.
                    </span>
                </div>
            </div>
        </>
    );
}
