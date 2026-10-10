import { useState } from 'react';
import type { Posture, Situation } from '../api';
import { Icon, PageHead } from '../components';
import { POSTURES, formatCount, formatCountdown, formatDateTime, formatTemp, formatTime, useNow } from '../format';

interface Props {
    situation: Situation;
    loading: boolean;
    onRefresh: () => void;
    onNotify: (posture: Posture) => void;
}

export function SituationPage({ situation, loading, onRefresh, onNotify }: Props) {
    const { facility, decisionWindow } = situation;
    return (
        <>
            <PageHead
                eyebrow="Facility readiness"
                title="Operating decision"
                subtitle={`Conditions affecting ${decisionWindow.operatingDayLabel} at ${facility.name}.`}
                action={
                    <button className="btn" onClick={onRefresh} disabled={loading}>
                        <Icon name="refresh" size={18} className={loading ? 'spin' : undefined} />
                        Refresh data
                    </button>
                }
            />
            <div className="split">
                <div className="stack">
                    <RecommendationCard situation={situation} onNotify={onNotify} />
                    <WeatherData situation={situation} />
                </div>
                <div className="stack">
                    <DecisionWindowCard situation={situation} />
                    <PeopleImpactCard situation={situation} />
                </div>
            </div>
        </>
    );
}

function RecommendationCard({ situation, onNotify }: Pick<Props, 'situation' | 'onNotify'>) {
    const [showAlternatives, setShowAlternatives] = useState(false);
    const rec = situation.recommendation;
    const posture = POSTURES[rec.posture];

    return (
        <section className={`card recommendation tone-${posture.tone}`}>
            <div className="rec-head">
                <div>
                    <p className="eyebrow muted">System recommendation</p>
                    <p className="rec-posture">{posture.label}</p>
                </div>
                <div className="confidence">
                    <strong>{rec.confidence}%</strong>
                    <span>Confidence</span>
                </div>
            </div>

            <p className="banner">
                <Icon name={rec.level === 'none' ? 'check' : 'alert'} />
                {rec.thresholdSummary}
            </p>

            <p className="rec-explanation">{rec.explanation}</p>

            <table className="triggers">
                <thead>
                    <tr><th>Rule checked</th><th>Observed</th><th>Threshold</th><th>Result</th></tr>
                </thead>
                <tbody>
                    {rec.triggers.map(trigger => (
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

            <p className="small"><strong>What could change this:</strong> {rec.whatCouldChange}</p>

            <div className="rec-actions">
                <button className="btn btn-primary" onClick={() => onNotify(rec.posture)}>
                    <Icon name="send" size={18} />
                    Review and notify
                </button>
                <button className="btn-link" onClick={() => setShowAlternatives(open => !open)} aria-expanded={showAlternatives}>
                    {showAlternatives ? 'Hide other postures' : 'Review other postures'}
                </button>
            </div>

            {showAlternatives && (
                <ul className="alternatives">
                    {rec.alternatives.map(alternative => (
                        <li key={alternative.posture}>
                            <div>
                                <strong>{POSTURES[alternative.posture].label}</strong>
                                <span>{alternative.note}</span>
                            </div>
                            <button className="btn btn-small" onClick={() => onNotify(alternative.posture)}>
                                Use instead
                            </button>
                        </li>
                    ))}
                </ul>
            )}
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

function PeopleImpactCard({ situation }: { situation: Situation }) {
    const { staff, families } = situation.people;
    const includedShare = (staff.recipients / staff.assigned) * 100;

    return (
        <section className="card">
            <div className="card-head">
                <h2>People impact</h2>
                <Icon name="users" size={24} />
            </div>

            <p className="big-count"><strong>{formatCount(staff.recipients)}</strong> staff to notify</p>
            <div className="meter" role="img" aria-label={`${staff.recipients} of ${staff.assigned} staff included`}>
                <span style={{ width: `${includedShare}%` }} />
            </div>
            <p className="meter-key">
                <span><i className="dot info" />{staff.recipients} included</span>
                <span><i className="dot off" />{staff.excluded} excluded</span>
            </p>

            <dl className="facts compact">
                <div><dt>Students affected</dt><dd>{formatCount(families.students)}</dd></div>
                <div><dt>Family contacts</dt><dd>{formatCount(families.guardianContacts)}</dd></div>
                <div><dt>Bus riders</dt><dd>{formatCount(families.busRiders)} on {families.busRoutes} routes</dd></div>
            </dl>

            <p className="small accent card-foot">
                {staff.essential} essential staff receive separate reporting instructions.
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
