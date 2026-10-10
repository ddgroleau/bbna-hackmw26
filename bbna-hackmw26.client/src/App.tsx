import { useEffect, useRef, useState } from 'react';
import { ensureDecisionRecord, fetchSituation } from './api';
import type { Decision, DecisionRecordDetail, Posture, Situation } from './api';
import { Icon } from './components';
import { POSTURES, formatCount, formatTime, useNow } from './format';
import { DecisionRecordPage } from './pages/DecisionRecord';
import { NotificationsPage } from './pages/Notifications';
import { SituationPage } from './pages/Situation';
import { ThresholdsPage } from './pages/Thresholds';

const TABS = [
    { id: 'situation', label: 'Situation' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'record', label: 'Decision record' },
    { id: 'thresholds', label: 'Thresholds' },
] as const;

type Tab = typeof TABS[number]['id'];

// The tab lives in the URL hash so a refresh or a shared link lands on the same section.
function tabFromHash(): Tab {
    return TABS.find(item => item.id === window.location.hash.slice(1))?.id ?? 'situation';
}

function App() {
    const [tab, setTab] = useState<Tab>(tabFromHash);
    const [scenario, setScenario] = useState<string>();
    const [reloads, setReloads] = useState(0);
    const [situation, setSituation] = useState<Situation>();
    const [error, setError] = useState<string>();
    const [loading, setLoading] = useState(true);
    const [draftPosture, setDraftPosture] = useState<Posture>();
    const [edits, setEdits] = useState<Record<string, string>>({});
    const [decision, setDecision] = useState<Decision>();
    const [record, setRecord] = useState<DecisionRecordDetail>();
    const [recordError, setRecordError] = useState<string>();
    // The recommendation the current record was opened for. Refreshing evidence that leads to the
    // same recommendation keeps the record; a new recommendation opens a new one.
    const recordFor = useRef<string>(undefined);

    useEffect(() => {
        let cancelled = false;

        function openRecord(data: Situation) {
            const key = `${data.scenario}:${data.recommendation.posture}:${data.thresholds.rulesetVersion}`;
            if (recordFor.current === key) return;
            recordFor.current = key;
            setRecordError(undefined);
            ensureDecisionRecord(data)
                .then(detail => {
                    if (recordFor.current === key) setRecord(detail);
                })
                .catch((e: Error) => {
                    if (recordFor.current !== key) return;
                    recordFor.current = undefined; // let the next refresh try again
                    setRecordError(e.message);
                });
        }

        fetchSituation(scenario)
            .then(data => {
                if (cancelled) return;
                setSituation(data);
                setError(undefined);
                openRecord(data);
            })
            .catch((e: Error) => {
                if (!cancelled) setError(e.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [scenario, reloads]);

    function refresh() {
        setLoading(true);
        setReloads(count => count + 1);
    }

    // A different scenario is a different day's evidence, so the draft and decision start over.
    function changeScenario(id: string) {
        setLoading(true);
        setScenario(id);
        setDraftPosture(undefined);
        setEdits({});
        setDecision(undefined);
        setRecord(undefined);
        setRecordError(undefined);
    }

    function selectTab(id: Tab) {
        setTab(id);
        window.history.replaceState(null, '', '#' + id);
    }

    function openNotifications(posture: Posture) {
        setDraftPosture(posture);
        selectTab('notifications');
    }

    if (!situation) {
        return (
            <div className="app">
                <div className="state">
                    {error ? (
                        <>
                            <h1>Could not load the situation</h1>
                            <p>{error}</p>
                            <p className="small">Check that the ASP.NET server is running and has been restarted since the last pull.</p>
                            <button className="btn btn-primary" onClick={refresh}>Try again</button>
                        </>
                    ) : (
                        <p>Loading facility situation…</p>
                    )}
                </div>
            </div>
        );
    }

    const { facility, people } = situation;
    const posture = draftPosture ?? situation.recommendation.posture;

    return (
        <div className="app">
            <header className="topbar">
                <div className="brand">
                    <span className="brand-mark"><Icon name="shield" size={26} /></span>
                    <div>
                        <strong>Closure Call</strong>
                        <span>{facility.organization}</span>
                    </div>
                </div>
                <nav className="tabs" aria-label="Sections">
                    {TABS.map(item => (
                        <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} onClick={() => selectTab(item.id)}>
                            {item.label}
                            {item.id === 'notifications' && <span className="badge">{people.staff.recipients}</span>}
                        </button>
                    ))}
                </nav>
                <label className="scenario">
                    <span><i className="dot warn" />Mock feeds</span>
                    <select value={situation.scenario} onChange={e => changeScenario(e.target.value)}>
                        {situation.scenarios.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                </label>
            </header>

            <div className="layout">
                <Sidebar situation={situation} decision={decision} />
                <main>
                    {error && <p className="banner tone-danger"><Icon name="alert" />{error} Showing the last data received.</p>}
                    {tab === 'situation' && (
                        <SituationPage situation={situation} loading={loading} onRefresh={refresh} onNotify={openNotifications} />
                    )}
                    {tab === 'notifications' && (
                        <NotificationsPage
                            situation={situation}
                            posture={decision?.posture ?? record?.record.finalPosture ?? posture}
                            onPostureChange={setDraftPosture}
                            edits={edits}
                            onEdit={(key, message) => setEdits(current => ({ ...current, [key]: message }))}
                            decision={decision}
                            onSent={setDecision}
                            record={record}
                            recordError={recordError}
                            onRecorded={setRecord}
                        />
                    )}
                    {tab === 'record' && <DecisionRecordPage situation={situation} decision={decision} record={record} recordError={recordError} />}
                    {tab === 'thresholds' && <ThresholdsPage situation={situation} />}
                </main>
            </div>
        </div>
    );
}

function Sidebar({ situation, decision }: { situation: Situation; decision?: Decision }) {
    const now = useNow();
    const { facility, decisionWindow } = situation;
    const { population } = facility;
    const zone = facility.timeZone;
    const current = POSTURES[decision?.posture ?? 'normal'];
    const nextReview = decisionWindow.steps.find(step => step.kind === 'assessment');

    return (
        <aside className="sidebar">
            <p className="eyebrow muted">Active facility</p>
            <div className="facility">
                <span className="tile-icon"><Icon name="building" size={24} /></span>
                <div>
                    <strong>{facility.name}</strong>
                    <span>{facility.address.street}, {facility.address.city}, {facility.address.state}</span>
                </div>
            </div>

            <dl className="facts">
                <div><dt>Local time</dt><dd>{formatTime(now, zone)} {facility.timeZoneLabel}</dd></div>
                <div><dt>Operating hours</dt><dd>{facility.hours.label}</dd></div>
                <div><dt>Employees</dt><dd>{formatCount(population.employees)}</dd></div>
                <div><dt>Essential personnel</dt><dd>{formatCount(population.essentialPersonnel)}</dd></div>
                <div><dt>Telework eligible</dt><dd>{formatCount(population.teleworkEligible)}</dd></div>
                <div><dt>Primary hazards</dt><dd>{facility.hazards.join(', ')}</dd></div>
            </dl>
            <p className="small muted">{facility.dataNote}</p>

            <hr />

            <p className="eyebrow muted">Current posture</p>
            <div className="posture-box">
                <i className={`dot ${current.tone}`} />
                <div>
                    <strong>{current.label}</strong>
                    <span>
                        {decision
                            ? `Decided ${formatTime(decision.sentAt, zone)} for ${decisionWindow.operatingDayLabel}`
                            : 'No active decision'}
                    </span>
                </div>
            </div>

            {nextReview && (
                <div className="callout next-review">
                    <Icon name="clock" size={22} />
                    <div>
                        <span>Next scheduled review</span>
                        <strong>{formatTime(nextReview.at, zone)} {facility.timeZoneLabel}</strong>
                    </div>
                </div>
            )}
        </aside>
    );
}

export default App;
