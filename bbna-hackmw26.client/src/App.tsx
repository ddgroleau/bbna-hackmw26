import { useEffect, useRef, useState } from 'react';
import { ensureDecisionRecord, fetchAnalysis, fetchLiveWeather, fetchSituation } from './api';
import type { AnalysisState, Decision, DecisionRecordDetail, LiveWeather, Posture, Situation } from './api';
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

// The data source the agent analyzes: the live NWS feeds, or the id of a mock scenario.
const LIVE = 'live';

// The tab lives in the URL hash so a refresh or a shared link lands on the same section.
function tabFromHash(): Tab {
    return TABS.find(item => item.id === window.location.hash.slice(1))?.id ?? 'situation';
}

function App() {
    const [tab, setTab] = useState<Tab>(tabFromHash);
    const [source, setSource] = useState(LIVE);
    const scenario = source === LIVE ? undefined : source;
    const [reloads, setReloads] = useState(0);
    const [situation, setSituation] = useState<Situation>();
    const [error, setError] = useState<string>();
    const [loading, setLoading] = useState(true);
    const [draftPosture, setDraftPosture] = useState<Posture>();
    const [edits, setEdits] = useState<Record<string, string>>({});
    const [decision, setDecision] = useState<Decision>();
    const [analysis, setAnalysis] = useState<AnalysisState>({ status: 'loading' });
    const [liveWeather, setLiveWeather] = useState<{ data?: LiveWeather; error?: string }>({});
    const [record, setRecord] = useState<DecisionRecordDetail>();
    const [recordError, setRecordError] = useState<string>();
    // The recommendation the current record was opened for. Refreshing evidence that leads to the
    // same recommendation keeps the record; a new recommendation opens a new one.
    const recordFor = useRef<string>(undefined);

    useEffect(() => {
        let cancelled = false;
        fetchAnalysis(scenario)
            .then(data => {
                if (!cancelled) setAnalysis({ status: 'ready', data });
            })
            .catch((e: Error) => {
                if (!cancelled) setAnalysis({ status: 'error', message: e.message });
            });
        return () => { cancelled = true; };
    }, [scenario, reloads]);

    // Only the live source shows the live reading; a scenario brings its own weather.
    useEffect(() => {
        if (scenario) return;
        let cancelled = false;
        fetchLiveWeather()
            .then(data => {
                if (!cancelled) setLiveWeather({ data });
            })
            .catch((e: Error) => {
                if (!cancelled) setLiveWeather({ error: e.message });
            });
        return () => { cancelled = true; };
    }, [scenario, reloads]);

    useEffect(() => {
        let cancelled = false;

        fetchSituation(scenario)
            .then(data => {
                if (cancelled) return;
                setSituation(data);
                setError(undefined);
            })
            .catch((e: Error) => {
                if (!cancelled) setError(e.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [scenario, reloads]);

    // The decision record is opened for the agent's recommendation, so it waits for the analysis.
    const liveReading = liveWeather.data;
    useEffect(() => {
        if (!situation || analysis.status !== 'ready') return;
        // A scenario's analysis can arrive before that scenario's situation has replaced the previous one.
        if (scenario && situation.scenario !== scenario) return;

        const key = `${source}:${analysis.data.posture}:${situation.thresholds.rulesetVersion}`;
        if (recordFor.current === key) return;
        recordFor.current = key;
        ensureDecisionRecord({ situation, analysis: analysis.data, live: !scenario, liveWeather: liveReading })
            .then(detail => {
                if (recordFor.current !== key) return;
                setRecord(detail);
                setRecordError(undefined);
            })
            .catch((e: Error) => {
                if (recordFor.current !== key) return;
                recordFor.current = undefined; // let the next refresh try again
                setRecordError(e.message);
            });
    }, [situation, analysis, source, scenario, liveReading]);

    function refresh() {
        setLoading(true);
        setAnalysis({ status: 'loading' });
        setReloads(count => count + 1);
    }

    // A different source is different evidence, so the analysis, draft and decision start over.
    function changeSource(id: string) {
        setLoading(true);
        setAnalysis({ status: 'loading' });
        setSource(id);
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
    const recommended = analysis.status === 'ready' ? analysis.data : undefined;
    const posture = draftPosture ?? recommended?.posture ?? 'normal';

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
                            {/* Pending recipients until the package is sent, then a check so the tab no longer reads as unsent. */}
                            {item.id === 'notifications' && (decision
                                ? <span className="badge badge-sent" aria-label="Sent"><Icon name="check" size={14} /></span>
                                : <span className="badge">{people.staff.recipients}</span>)}
                        </button>
                    ))}
                </nav>
                <label className="scenario">
                    <span><i className={`dot ${scenario ? 'warn' : 'ok'}`} />{scenario ? 'Mock scenario' : 'Live feeds'}</span>
                    <select value={source} onChange={e => changeSource(e.target.value)}>
                        <option value={LIVE}>Live NWS feeds</option>
                        {situation.scenarios.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                </label>
            </header>

            <div className="layout">
                <Sidebar situation={situation} decision={decision} />
                <main>
                    {error && <p className="banner tone-danger"><Icon name="alert" />{error} Showing the last data received.</p>}
                    {tab === 'situation' && (
                        <SituationPage
                            situation={situation}
                            analysis={analysis}
                            liveWeather={scenario ? undefined : liveWeather}
                            loading={loading}
                            onRefresh={refresh}
                            onNotify={openNotifications}
                        />
                    )}
                    {tab === 'notifications' && (
                        <NotificationsPage
                            situation={situation}
                            analysis={recommended}
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
                    {tab === 'record' && <DecisionRecordPage current={record} />}
                    {tab === 'thresholds' && <ThresholdsPage />}
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
