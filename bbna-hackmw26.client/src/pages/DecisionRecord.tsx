import { useEffect, useState } from 'react';
import { fetchDecisionLog } from '../api';
import type { DecisionRecordDetail } from '../api';
import { Icon, PageHead } from '../components';
import { openDecisionPdf } from '../exportDecisions';
import { POSTURES, formatDateTime } from '../format';

// The log stores UTC; show it in the viewer's own zone.
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const stamp = (value: string) => formatDateTime(value, ZONE);

function statusLabel({ record }: DecisionRecordDetail): string {
    if (record.status === 'AwaitingDecision') return 'Awaiting decision';
    return `${record.action === 'Overridden' ? 'Overridden' : 'Accepted'}: ${POSTURES[record.finalPosture!].label}`;
}

// The decision log (GET /api/decisions), newest first. Each record opens as a PDF report.
// `current` is the record this session is working on; the list reloads when it changes.
export function DecisionRecordPage({ current }: { current?: DecisionRecordDetail }) {
    const [log, setLog] = useState<DecisionRecordDetail[]>();
    const [error, setError] = useState<string>();
    const [loading, setLoading] = useState(true);
    const [reloads, setReloads] = useState(0);
    const [opening, setOpening] = useState<string>();
    const [pdfError, setPdfError] = useState<string>();

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

    async function openPdf(detail: DecisionRecordDetail) {
        setOpening(detail.record.id);
        setPdfError(undefined);
        try {
            await openDecisionPdf(detail);
        } catch (e) {
            setPdfError(`Could not build the PDF for ${detail.record.id}: ${e instanceof Error ? e.message : 'unknown error'}`);
        } finally {
            setOpening(undefined);
        }
    }

    return (
        <>
            <PageHead
                eyebrow="Audit trail"
                title="Decision record"
                subtitle="Every recommendation and decision, as logged. Open a record for its full PDF report."
                action={
                    <button className="btn" onClick={reload} disabled={loading}>
                        <Icon name="refresh" size={18} className={loading ? 'spin' : undefined} />
                        Reload
                    </button>
                }
            />
            <div className="stack">
                {error && (
                    <p className="banner tone-danger">
                        <Icon name="alert" />Could not load the decision log: {error}
                        {log && ' Showing the last data received.'}
                    </p>
                )}
                {pdfError && <p className="banner tone-danger"><Icon name="alert" />{pdfError}</p>}

                {!log && !error && <p className="card">Loading the decision log…</p>}
                {log?.length === 0 && <p className="card">The decision log is empty. A record opens when a recommendation is generated.</p>}

                {log && log.length > 0 && (
                    <section className="card flush">
                        <div className="table-scroll">
                            <table className="data">
                                <thead>
                                    <tr><th>Record</th><th>Recommended</th><th>Outcome</th><th>Decided by</th><th>Integrity</th></tr>
                                </thead>
                                <tbody>
                                    {log.map(item => {
                                        const { record } = item;
                                        return (
                                            <tr key={record.id}>
                                                <td>
                                                    <button
                                                        className="btn-link log-id"
                                                        onClick={() => openPdf(item)}
                                                        disabled={opening === record.id}
                                                        title={`Open the PDF report for ${record.id}`}
                                                    >
                                                        <Icon name="file" size={16} />
                                                        {opening === record.id ? 'Opening…' : record.id}
                                                    </button>
                                                    <span>{stamp(record.createdAt)}{record.id === current?.record.id && ' · current'}</span>
                                                </td>
                                                <td>{POSTURES[record.recommendedPosture].label}</td>
                                                <td>
                                                    <span className={`chip ${record.status === 'Decided' ? 'chip-ok' : 'chip-warn'}`}>
                                                        {statusLabel(item)}
                                                    </span>
                                                </td>
                                                <td>{record.decidedBy ? <>{record.decidedBy}<span className="cell-note">{stamp(record.decidedAt!)}</span></> : '—'}</td>
                                                <td>
                                                    {item.integrity.valid
                                                        ? 'Verified'
                                                        : <span className="chip chip-danger">Broken at event {item.integrity.brokenAtSeq}</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <p className="small muted card-foot log-foot">
                            {log.length} {log.length === 1 ? 'record' : 'records'}, newest first. Times in {ZONE}. Each entry is
                            chained to the previous one by a SHA-256 hash, so a later change to the log shows as broken.
                        </p>
                    </section>
                )}
            </div>
        </>
    );
}
