import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";

type Tab = "situation" | "notify" | "record" | "thresholds";
type Posture = "Normal operations" | "Delayed arrival" | "Unscheduled telework" | "Full closure";
type IconName =
  | "alert"
  | "arrow"
  | "building"
  | "check"
  | "clock"
  | "cloud"
  | "document"
  | "people"
  | "refresh"
  | "river"
  | "send"
  | "settings"
  | "shield";

type AlertFeature = {
  id: string;
  properties: {
    event?: string;
    headline?: string;
    severity?: string;
    certainty?: string;
    urgency?: string;
    effective?: string;
    expires?: string;
    sent?: string;
    description?: string;
  };
};

type ForecastPeriod = {
  name: string;
  temperature: number;
  temperatureUnit: string;
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  startTime: string;
};

type FeedState = {
  alerts: AlertFeature[];
  forecast: ForecastPeriod[];
  riverStage: number | null;
  riverTime: string | null;
  fetchedAt: string | null;
  loading: boolean;
  error: string | null;
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    alert: <><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v4M12 17h.01" /></>,
    arrow: <path d="m9 18 6-6-6-6" />,
    building: <><path d="M4 21V5l8-3v19M12 8h8v13M2 21h20" /><path d="M7 7h2M7 11h2M7 15h2M15 12h2M15 16h2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    cloud: <path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 8a5 5 0 0 0 1 10Z" />,
    document: <><path d="M6 2h8l4 4v16H6zM14 2v5h4" /><path d="M9 12h6M9 16h6" /></>,
    people: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 9A7 7 0 0 1 18 6l2 6M18 15a7 7 0 0 1-11.9 3L4 12" /></>,
    river: <><path d="M3 7c3 0 3-2 6-2s3 2 6 2 3-2 6-2M3 12c3 0 3-2 6-2s3 2 6 2 3-2 6-2M3 17c3 0 3-2 6-2s3 2 6 2 3-2 6-2" /></>,
    send: <path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-5" /></>,
  };
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">{paths[name]}</g>
    </svg>
  );
}

const initialFeed: FeedState = {
  alerts: [],
  forecast: [],
  riverStage: null,
  riverTime: null,
  fetchedAt: null,
  loading: true,
  error: null,
};

const employees = [
  { name: "Maya Chen", role: "Program Specialist", status: "Include", route: "SMS · Email", reason: "Assigned on-site today" },
  { name: "Daniel Brooks", role: "County Executive Director", status: "Include", route: "SMS · Voice · Email", reason: "Essential personnel" },
  { name: "Elena Ruiz", role: "Loan Specialist", status: "Include", route: "SMS · Email", reason: "Assigned on-site today" },
  { name: "Marcus Hill", role: "IT Support", status: "Exclude", route: "—", reason: "Approved telework day" },
  { name: "Priya Shah", role: "Field Technician", status: "Exclude", route: "—", reason: "On detail in Ames" },
];

const thresholds = [
  { level: "Advisory", posture: "Monitor / normal", rule: "NWS Moderate severity or river stage ≥ 26 ft", basis: "NWS CAP severity; facility flood plan" },
  { level: "Action", posture: "Delay / telework", rule: "NWS Severe warning, ice forecast, or river stage ≥ 28 ft", basis: "NWS warning taxonomy; Iowa DOT winter guidance" },
  { level: "Critical", posture: "Full closure", rule: "NWS Extreme alert, destructive hazard, or river stage ≥ 30 ft", basis: "OPM closure posture; facility COOP plan" },
];

function formatTime(value?: string | null) {
  if (!value) return "Awaiting update";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }).format(new Date(value));
}

export default function App() {
  const [tab, setTab] = useState<Tab>("situation");
  const [feed, setFeed] = useState<FeedState>(initialFeed);
  const [decided, setDecided] = useState(false);
  const [posture, setPosture] = useState<Posture>("Delayed arrival");
  const [messageSent, setMessageSent] = useState(false);

  const refreshFeeds = useCallback(async () => {
    setFeed((current) => ({ ...current, loading: true, error: null }));
    try {
      const headers = { Accept: "application/geo+json" };
      const [alertsResult, pointResult, riverResult] = await Promise.all([
        fetch("https://api.weather.gov/alerts/active?point=41.5868,-93.6250", { headers }).then((response) => response.json()),
        fetch("https://api.weather.gov/points/41.5868,-93.6250", { headers }).then((response) => response.json()),
        fetch("https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items?f=json&monitoring_location_id=USGS-05484650&parameter_code=00065").then((response) => response.json()),
      ]);
      const forecastUrl = pointResult?.properties?.forecast;
      const forecastResult = forecastUrl
        ? await fetch(forecastUrl, { headers }).then((response) => response.json())
        : null;
      const riverFeature = riverResult?.features?.[0]?.properties;
      setFeed({
        alerts: alertsResult?.features ?? [],
        forecast: forecastResult?.properties?.periods?.slice(0, 4) ?? [],
        riverStage: riverFeature?.value ? Number(riverFeature.value) : null,
        riverTime: riverFeature?.time ?? null,
        fetchedAt: new Date().toISOString(),
        loading: false,
        error: null,
      });
    } catch {
      setFeed((current) => ({
        ...current,
        loading: false,
        error: "One or more live feeds could not be reached. Last known values remain visible.",
        fetchedAt: new Date().toISOString(),
      }));
    }
  }, []);

  useEffect(() => {
    refreshFeeds();
  }, [refreshFeeds]);

  const assessment = useMemo(() => {
    const topAlert = feed.alerts[0]?.properties;
    const severeAlert = feed.alerts.find(({ properties }) =>
      ["Extreme", "Severe"].includes(properties.severity ?? ""),
    )?.properties;
    const forecastText = feed.forecast.map((period) => period.shortForecast).join(" ").toLowerCase();
    const maxWind = Math.max(0, ...feed.forecast.map((period) => Number(period.windSpeed.match(/\d+/)?.[0] ?? 0)));
    const river = feed.riverStage ?? 0;

    if (severeAlert?.severity === "Extreme" || river >= 30) {
      return {
        posture: "Full closure" as Posture,
        confidence: 94,
        reason: `${severeAlert?.event ?? "Critical conditions"} meets the facility's critical threshold. Conditions present an unacceptable risk for normal arrival and on-site operations.`,
        threshold: severeAlert?.severity === "Extreme" ? "NWS Extreme severity threshold crossed" : `River stage is ${(river - 30).toFixed(1)} ft above closure threshold`,
      };
    }
    if (severeAlert || river >= 28 || /ice|snow|thunderstorm/.test(forecastText) || maxWind >= 35) {
      return {
        posture: "Unscheduled telework" as Posture,
        confidence: feed.alerts.length ? 88 : 76,
        reason: `${severeAlert?.event ?? topAlert?.event ?? "Forecast conditions"} and local travel exposure support keeping telework-eligible employees off the roads while essential staff follow continuity procedures.`,
        threshold: severeAlert ? `NWS ${severeAlert.severity} alert threshold crossed` : river >= 28 ? `River stage is ${(river - 28).toFixed(1)} ft above action threshold` : "Forecast hazard screening threshold crossed",
      };
    }
    if (topAlert || river >= 26 || maxWind >= 25) {
      return {
        posture: "Delayed arrival" as Posture,
        confidence: 82,
        reason: `${topAlert?.event ?? "Elevated travel conditions"} warrants additional morning travel time. A two-hour delay reduces commuting exposure while preserving essential on-site services.`,
        threshold: topAlert ? `Active ${topAlert.event}` : river >= 26 ? `River stage is ${(river - 26).toFixed(1)} ft above advisory threshold` : `Forecast wind ${maxWind} mph exceeds 25 mph screening level`,
      };
    }
    return {
      posture: "Normal operations" as Posture,
      confidence: 91,
      reason: "No active NWS alert or operational threshold currently supports a change in posture. Continue monitoring because forecast conditions can change before the morning commute.",
      threshold: "No operating threshold crossed",
    };
  }, [feed]);

  useEffect(() => {
    if (!decided) setPosture(assessment.posture);
  }, [assessment.posture, decided]);

  function adoptRecommendation() {
    setPosture(assessment.posture);
    setDecided(true);
    setTab("notify");
  }

  const message = `${posture.toUpperCase()} — Des Moines USDA Service Center\n\nDue to expected weather and travel conditions, the facility will operate under ${posture.toLowerCase()} on the next business day. Employees scheduled on-site should not report before 10:00 AM unless contacted by their supervisor. Telework-eligible employees should begin work at their normal start time. Essential personnel should follow their continuity instructions.\n\nSupervisors will provide any updates by 7:00 AM. Please confirm receipt.`;

  return (
    <main className="closure-app">
      <header className="app-header">
        <div className="wordmark">
          <div className="seal"><Icon name="shield" size={21} /></div>
          <div><strong>Closure Call</strong><span>USDA Facility Operations</span></div>
        </div>
        <nav className="tabs" aria-label="Primary">
          <TabButton active={tab === "situation"} label="Situation" onClick={() => setTab("situation")} />
          <TabButton active={tab === "notify"} label="Notifications" count={27} onClick={() => setTab("notify")} />
          <TabButton active={tab === "record"} label="Decision record" onClick={() => setTab("record")} />
          <TabButton active={tab === "thresholds"} label="Thresholds" onClick={() => setTab("thresholds")} />
        </nav>
        <div className="header-tools">
          <span className="live-pill"><i />Live feeds</span>
          <button className="icon-btn" aria-label="Settings"><Icon name="settings" /></button>
          <button className="profile" aria-label="Profile">AM</button>
        </div>
      </header>

      <div className="app-body">
        <aside className="facility-rail">
          <p className="rail-label">Active facility</p>
          <div className="facility-block">
            <div className="facility-icon"><Icon name="building" size={19} /></div>
            <div><strong>Des Moines Service Center</strong><span>210 Walnut St, Des Moines, IA</span></div>
          </div>
          <dl className="facility-facts">
            <div><dt>Local time</dt><dd>{new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} CT</dd></div>
            <div><dt>Hours</dt><dd>8:00 AM–4:30 PM</dd></div>
            <div><dt>Assigned</dt><dd>34 employees</dd></div>
            <div><dt>Essential</dt><dd>4 personnel</dd></div>
          </dl>
          <div className="rail-divider" />
          <p className="rail-label">Current posture</p>
          <div className={`posture-state ${decided ? "confirmed" : ""}`}>
            <i />
            <div><strong>{decided ? posture : "Normal operations"}</strong><span>{decided ? "Manager confirmed" : "No active decision"}</span></div>
          </div>
          <div className="rail-spacer" />
          <div className="next-review">
            <Icon name="clock" size={16} />
            <div><span>Next scheduled review</span><strong>5:30 AM CT</strong></div>
          </div>
        </aside>

        <section className="main-content">
          {tab === "situation" && (
            <Situation
              assessment={assessment}
              feed={feed}
              onAdopt={adoptRecommendation}
              onRefresh={refreshFeeds}
            />
          )}
          {tab === "notify" && (
            <Notifications
              message={message}
              onSend={() => setMessageSent(true)}
              posture={posture}
              sent={messageSent}
              setPosture={setPosture}
            />
          )}
          {tab === "record" && <DecisionRecord decided={decided} posture={posture} feed={feed} />}
          {tab === "thresholds" && <Thresholds />}
        </section>
      </div>
    </main>
  );
}

function Situation({
  assessment,
  feed,
  onAdopt,
  onRefresh,
}: {
  assessment: { posture: Posture; confidence: number; reason: string; threshold: string };
  feed: FeedState;
  onAdopt: () => void;
  onRefresh: () => void;
}) {
  const currentForecast = feed.forecast[0];
  const alert = feed.alerts[0]?.properties;
  return (
    <>
      <div className="page-heading">
        <div><p className="kicker">Facility readiness</p><h1>Morning operating decision</h1><p>Conditions affecting the next reporting window at Des Moines Service Center.</p></div>
        <button className="secondary-btn" disabled={feed.loading} onClick={onRefresh}><Icon name="refresh" size={16} />{feed.loading ? "Refreshing…" : "Refresh live data"}</button>
      </div>
      {feed.error && <div className="feed-error"><Icon name="alert" size={16} />{feed.error}</div>}

      <div className="situation-grid">
        <div className="primary-column">
          <article className="recommendation-card">
            <div className="recommendation-top">
              <div><span className="card-label">System recommendation</span><h2>{assessment.posture}</h2></div>
              <div className="confidence"><span>{assessment.confidence}%</span><small>confidence</small></div>
            </div>
            <div className="risk-band"><Icon name="alert" size={17} /><strong>{assessment.threshold}</strong></div>
            <p className="rationale">{assessment.reason}</p>
            <div className="change-note"><strong>What could change this:</strong> A new NWS warning, forecast escalation, or river stage crossing the next facility threshold.</div>
            <div className="card-actions">
              <button className="primary-btn" onClick={onAdopt}>Use this recommendation <Icon name="arrow" size={16} /></button>
              <button className="text-btn">Review other postures</button>
            </div>
          </article>

          <div className="section-heading"><div><h2>Evidence at decision time</h2><p>Every value is retained with its source and observation time.</p></div><span>3 sources</span></div>
          <div className="evidence-list">
            <EvidenceCard
              icon="cloud"
              source="National Weather Service"
              status={alert ? `${alert.event}` : "No active alerts"}
              detail={alert ? `${alert.severity ?? "Unknown"} severity · ${alert.certainty ?? "Unknown"} certainty · ${alert.urgency ?? "Unknown"} urgency` : "No watches, warnings, or advisories at the facility point."}
              time={formatTime(alert?.sent ?? feed.fetchedAt)}
              live
            />
            <EvidenceCard
              icon="cloud"
              source="NWS point forecast"
              status={currentForecast ? `${currentForecast.temperature}°${currentForecast.temperatureUnit} · ${currentForecast.shortForecast}` : "Forecast loading"}
              detail={currentForecast ? `Wind ${currentForecast.windDirection} ${currentForecast.windSpeed}. Evaluated against ice, wind, and severe-weather rules.` : "Waiting for the Des Moines forecast office."}
              time={formatTime(currentForecast?.startTime ?? feed.fetchedAt)}
              live
            />
            <EvidenceCard
              icon="river"
              source="USGS Water Data"
              status={feed.riverStage == null ? "Gauge unavailable" : `${feed.riverStage.toFixed(2)} ft river stage`}
              detail={feed.riverStage == null ? "Raccoon River gauge has not returned a value." : `${Math.abs(28 - feed.riverStage).toFixed(2)} ft ${feed.riverStage >= 28 ? "above" : "below"} the facility action threshold. Provisional reading.`}
              time={formatTime(feed.riverTime)}
              live
            />
          </div>
        </div>

        <aside className="side-column">
          <article className="timeline-card">
            <div className="card-title"><h2>Decision window</h2><span>Tomorrow</span></div>
            <div className="weather-hero">
              <Icon name="cloud" size={30} />
              <div><strong>{currentForecast ? `${currentForecast.temperature}°` : "—"}</strong><span>{currentForecast?.shortForecast ?? "Loading forecast"}</span></div>
            </div>
            <div className="time-row"><span>4:30 AM</span><div><i className="done" /><strong>Automated assessment</strong><small>Feeds captured</small></div></div>
            <div className="time-row"><span>5:30 AM</span><div><i className="active" /><strong>Manager decision due</strong><small>Before commute window</small></div></div>
            <div className="time-row"><span>6:00 AM</span><div><i /><strong>Notification target</strong><small>SMS, voice, and email</small></div></div>
            <div className="time-row"><span>8:00 AM</span><div><i /><strong>Normal opening</strong><small>If posture is unchanged</small></div></div>
          </article>
          <article className="impact-card">
            <div className="card-title"><h2>People impact</h2><Icon name="people" size={18} /></div>
            <div className="impact-number"><strong>27</strong><span>employees to notify</span></div>
            <div className="impact-bars"><span style={{ width: "79%" }} /><i style={{ width: "21%" }} /></div>
            <div className="impact-legend"><span><i className="include" />27 included</span><span><i className="exclude" />7 excluded</span></div>
            <p>4 essential personnel receive separate reporting instructions.</p>
          </article>
        </aside>
      </div>
    </>
  );
}

function EvidenceCard({ detail, icon, live, source, status, time }: { detail: string; icon: IconName; live?: boolean; source: string; status: string; time: string }) {
  return (
    <article className="evidence-card">
      <div className="evidence-icon"><Icon name={icon} size={19} /></div>
      <div className="evidence-copy"><div><span>{source}</span>{live && <b><i />LIVE</b>}</div><strong>{status}</strong><p>{detail}</p></div>
      <time>{time}</time>
    </article>
  );
}

function Notifications({ message, onSend, posture, sent, setPosture }: { message: string; onSend: () => void; posture: Posture; sent: boolean; setPosture: (value: Posture) => void }) {
  return (
    <>
      <div className="page-heading"><div><p className="kicker">Notification package</p><h1>Reach the right people</h1><p>Review audience logic, channels, and employee instructions before release.</p></div></div>
      <div className="notify-grid">
        <div>
          <article className="composer-card">
            <div className="composer-top">
              <div><span className="card-label">Operating posture</span><select value={posture} onChange={(event) => setPosture(event.target.value as Posture)}><option>Normal operations</option><option>Delayed arrival</option><option>Unscheduled telework</option><option>Full closure</option></select></div>
              <span className="draft-pill">Draft</span>
            </div>
            <label>Employee message</label>
            <textarea defaultValue={message} rows={11} />
            <div className="channel-row"><span>Route through</span><label><input defaultChecked type="checkbox" /> SMS</label><label><input defaultChecked type="checkbox" /> Email</label><label><input defaultChecked type="checkbox" /> Voice for essential staff</label></div>
            <button className={`primary-btn send-btn ${sent ? "sent" : ""}`} onClick={onSend}>{sent ? <><Icon name="check" size={17} />Package queued at all channels</> : <><Icon name="send" size={16} />Approve and send to 27 employees</>}</button>
          </article>
          <article className="recipient-card">
            <div className="section-heading"><div><h2>Recipient review</h2><p>Five representative records from the facility roster.</p></div><span>27 included · 7 excluded</span></div>
            <div className="employee-table">
              <div className="employee-head"><span>Employee</span><span>Decision logic</span><span>Routing</span><span>Status</span></div>
              {employees.map((employee) => (
                <div className="employee-row" key={employee.name}>
                  <span><strong>{employee.name}</strong><small>{employee.role}</small></span>
                  <span>{employee.reason}</span><span>{employee.route}</span>
                  <b className={employee.status.toLowerCase()}>{employee.status}</b>
                </div>
              ))}
            </div>
          </article>
        </div>
        <aside className="audience-card">
          <h2>Audience logic</h2>
          <p>Roster resolved against today's work-status file at 4:31 AM.</p>
          <AudienceStep number="1" title="34 assigned to facility" detail="HR facility roster" />
          <AudienceStep number="2" title="− 5 scheduled telework" detail="No commute impact" />
          <AudienceStep number="3" title="− 2 away or on detail" detail="Different duty location" />
          <AudienceStep number="4" title="27 final recipients" detail="4 get essential-personnel addendum" final />
          <div className="accessibility-note"><Icon name="people" size={17} /><p><strong>Accessibility routing</strong>2 employees receive text-first messages and TTY-compatible email.</p></div>
        </aside>
      </div>
    </>
  );
}

function AudienceStep({ detail, final, number, title }: { detail: string; final?: boolean; number: string; title: string }) {
  return <div className={`audience-step ${final ? "final" : ""}`}><i>{final ? <Icon name="check" size={14} /> : number}</i><div><strong>{title}</strong><span>{detail}</span></div></div>;
}

function DecisionRecord({ decided, feed, posture }: { decided: boolean; feed: FeedState; posture: Posture }) {
  return (
    <>
      <div className="page-heading"><div><p className="kicker">Audit trail</p><h1>Decision record</h1><p>A reconstructable record of what was known, when, and by whom.</p></div><button className="secondary-btn"><Icon name="document" size={16} />Export record</button></div>
      <article className="record-summary">
        <div><span>Record ID</span><strong>DSM-2026-1010-0430</strong></div><div><span>Facility</span><strong>Des Moines Service Center</strong></div><div><span>Status</span><strong className={decided ? "approved" : ""}>{decided ? "Decision confirmed" : "Awaiting decision"}</strong></div><div><span>Integrity</span><strong>Inputs timestamped</strong></div>
      </article>
      <article className="audit-card">
        <AuditItem icon="refresh" time={formatTime(feed.fetchedAt)} title="Automated evidence capture completed" detail={`${feed.alerts.length} active NWS alerts, ${feed.forecast.length} forecast periods, and 1 USGS gauge reading retained.`} />
        <AuditItem icon="shield" time={formatTime(feed.fetchedAt)} title="Rules engine generated recommendation" detail="Recommendation scored against approved facility thresholds. No input was manually suppressed." />
        {decided ? <AuditItem icon="check" time={formatTime(new Date().toISOString())} title={`Manager selected: ${posture}`} detail="Decision confirmed by A. Mitchell. Recommendation and underlying evidence retained without modification." active /> : <AuditItem icon="clock" time="Pending" title="Human decision required" detail="The recommendation has not been accepted, changed, or rejected." active />}
      </article>
      <div className="integrity-banner"><Icon name="shield" size={20} /><div><strong>Record integrity</strong><p>Source payloads, ruleset version 1.4, recipient resolution, message content, and acknowledgements are retained for after-action review.</p></div></div>
    </>
  );
}

function AuditItem({ active, detail, icon, time, title }: { active?: boolean; detail: string; icon: IconName; time: string; title: string }) {
  return <div className={`audit-item ${active ? "active" : ""}`}><div className="audit-icon"><Icon name={icon} size={17} /></div><div><span>{time}</span><strong>{title}</strong><p>{detail}</p></div></div>;
}

function Thresholds() {
  return (
    <>
      <div className="page-heading"><div><p className="kicker">Governance</p><h1>Defensible thresholds</h1><p>Every cutoff has an operational source, owner, and review date.</p></div><button className="secondary-btn"><Icon name="document" size={16} />View policy sources</button></div>
      <article className="threshold-intro"><Icon name="shield" size={22} /><div><strong>Human decision remains required</strong><p>Rules produce a graded recommendation. They never change facility status or send notifications without an authorized manager.</p></div></article>
      <article className="threshold-card">
        <div className="threshold-head"><span>Decision level</span><span>Recommended posture</span><span>Trigger</span><span>Defensible basis</span></div>
        {thresholds.map((item) => <div className="threshold-row" key={item.level}><strong>{item.level}</strong><span>{item.posture}</span><span>{item.rule}</span><span>{item.basis}</span></div>)}
      </article>
      <div className="policy-grid">
        <article><span>NWS</span><strong>CAP alert fields</strong><p>Severity, certainty, and urgency provide structured, nationally consistent hazard screening.</p><small>Reviewed Sep 2026</small></article>
        <article><span>OPM</span><strong>Operating status categories</strong><p>Postures align to delayed arrival, unscheduled telework/leave, early dismissal, and closure.</p><small>Reviewed Aug 2026</small></article>
        <article><span>FACILITY COOP</span><strong>Local continuity plan</strong><p>River-stage thresholds and essential-personnel exceptions reflect site-specific exposure.</p><small>Reviewed Oct 2026</small></article>
      </div>
    </>
  );
}

function TabButton({ active, count, label, onClick }: { active: boolean; count?: number; label: string; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{label}{count && <span>{count}</span>}</button>;
}
