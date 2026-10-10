import { useState } from 'react';
import type { AnalysisState, LiveForecast, LiveWeather, Posture, Situation } from '../api';
import { Icon, PageHead } from '../components';
import { AUDIENCES, AUDIENCE_ORDER, POSTURES, POSTURE_ORDER, formatCount, formatCountdown, formatDateTime, formatTemp, formatTime, useNow } from '../format';

interface LiveWeatherState {
    data?: LiveWeather;
    error?: string;
}

interface Props {
    situation: Situation;
    analysis: AnalysisState;
    // Present when the agent is analyzing the live feeds; absent for a mock scenario.
    liveWeather?: LiveWeatherState;
    loading: boolean;
    onRefresh: () => void;
    onNotify: (posture: Posture) => void;
}

export function SituationPage({ situation, analysis, liveWeather, loading, onRefresh, onNotify }: Props) {
    const { facility, decisionWindow } = situation;
    const busy = loading || analysis.status === 'loading';
    return (
        <>
            <PageHead
                eyebrow="Facility readiness"
                title="Operating decision"
                subtitle={`Conditions affecting ${decisionWindow.operatingDayLabel} at ${facility.name}.`}
                action={
                    <button className="btn" onClick={onRefresh} disabled={busy}>
                        <Icon name="refresh" size={18} className={busy ? 'spin' : undefined} />
                        Refresh data
                    </button>
                }
            />
            <div className="split">
                <div className="stack">
                    <RecommendationCard
                        situation={situation}
                        analysis={analysis}
                        live={!!liveWeather}
                        onRefresh={onRefresh}
                        onNotify={onNotify}
                    />
                    {liveWeather
                        ? <LiveWeatherData situation={situation} liveWeather={liveWeather} />
                        : <WeatherData situation={situation} />}
                </div>
                <div className="stack">
                    <DecisionWindowCard situation={situation} />
                    <PeopleImpactCard situation={situation} />
                </div>
            </div>
        </>
    );
}

interface RecommendationProps extends Pick<Props, 'situation' | 'analysis' | 'onRefresh' | 'onNotify'> {
    live: boolean;
}

function RecommendationCard({ situation, analysis, live, onRefresh, onNotify }: RecommendationProps) {
    const [showAlternatives, setShowAlternatives] = useState(false);

    if (analysis.status === 'loading') {
        return (
            <section className="card recommendation tone-info">
                <p className="eyebrow muted">Agent recommendation</p>
                <p className="rec-pending">
                    <Icon name="refresh" className="spin" />
                    Analyzing {live ? 'the live weather feeds' : 'this scenario'}…
                </p>
            </section>
        );
    }

    if (analysis.status === 'error') {
        return (
            <section className="card recommendation tone-danger">
                <p className="eyebrow muted">Agent recommendation</p>
                <p className="banner"><Icon name="alert" />The agent could not produce a recommendation.</p>
                <p className="small">{analysis.message}</p>
                <div className="rec-actions">
                    <button className="btn btn-primary" onClick={onRefresh}>Try again</button>
                </div>
            </section>
        );
    }

    const { posture: recommended, summary, confidence } = analysis.data;
    const posture = POSTURES[recommended];
    // The scenario's canned rules-engine result. It describes the mock weather, so it is only
    // shown as a cross-check when the agent analyzed that same scenario.
    const rules = situation.recommendation;

    return (
        <section className={`card recommendation tone-${posture.tone}`}>
            <div className="rec-head">
                <div>
                    <p className="eyebrow muted">Agent recommendation</p>
                    <p className="rec-posture">{posture.label}</p>
                </div>
                <div className="confidence">
                    <strong>{confidence}%</strong>
                    <span>Confidence</span>
                </div>
            </div>

            <p className="rec-explanation">{summary}</p>

            {!live && (
                <>
                    <p className="small">
                        <strong>Rules engine cross-check:</strong> {POSTURES[rules.posture].label} at {rules.confidence}% confidence.
                        {rules.posture === recommended ? ' It agrees with the agent.' : ' It differs from the agent.'}
                    </p>
                    <table className="triggers">
                        <thead>
                            <tr><th>Rule checked</th><th>Observed</th><th>Threshold</th><th>Result</th></tr>
                        </thead>
                        <tbody>
                            {rules.triggers.map(trigger => (
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
                </>
            )}

            <div className="rec-actions">
                <button className="btn btn-primary" onClick={() => onNotify(recommended)}>
                    <Icon name="send" size={18} />
                    Review and notify
                </button>
                <button className="btn-link" onClick={() => setShowAlternatives(open => !open)} aria-expanded={showAlternatives}>
                    {showAlternatives ? 'Hide other postures' : 'Review other postures'}
                </button>
            </div>

            {showAlternatives && (
                <ul className="alternatives">
                    {POSTURE_ORDER.filter(id => id !== recommended).map(id => (
                        <li key={id}>
                            <div>
                                <strong>{POSTURES[id].label}</strong>
                                <span>
                                    {(!live && rules.alternatives.find(alternative => alternative.posture === id)?.note)
                                        || 'Not what the agent recommended. Choosing it is recorded as a manager override.'}
                                </span>
                            </div>
                            <button className="btn btn-small" onClick={() => onNotify(id)}>
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
    const { staff, audiences } = situation.people;
    const includedShare = (staff.recipients / staff.assigned) * 100;

    return (
        <section className="card">
            <div className="card-head">
                <h2>People impact</h2>
                <Icon name="users" size={24} />
            </div>

            <p className="big-count"><strong>{formatCount(staff.recipients)}</strong> employees to notify</p>
            <div className="meter" role="img" aria-label={`${staff.recipients} of ${staff.assigned} employees included`}>
                <span style={{ width: `${includedShare}%` }} />
            </div>
            <p className="meter-key">
                <span><i className="dot info" />{staff.recipients} included</span>
                <span><i className="dot off" />{staff.excluded} excluded</span>
            </p>

            <dl className="facts compact">
                {AUDIENCE_ORDER.map(id => (
                    <div key={id}><dt>{AUDIENCES[id]}</dt><dd>{formatCount(audiences[id])}</dd></div>
                ))}
            </dl>

            <p className="small accent card-foot">
                Each group receives instructions for its assignment. {staff.essential} essential personnel also get a voice call.
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

function withUnit(value: number | null, unit: string): string {
    return value === null ? '—' : `${value} ${unit}`;
}

function LiveWeatherData({ situation, liveWeather }: { situation: Situation; liveWeather: LiveWeatherState }) {
    const zone = situation.facility.timeZone;
    const { data, error } = liveWeather;

    return (
        <section className="stack">
            <div className="section-head">
                <div>
                    <h2>Weather data</h2>
                    <p className="small">Live National Weather Service feeds the agent analyzed.</p>
                </div>
                {data && <span className="small">{data.current.stationName}</span>}
            </div>

            {error && <p className="banner tone-danger"><Icon name="alert" />{error}</p>}
            {!data && !error && <p className="small muted">Loading live weather…</p>}

            {data && (
                <>
                    <article className="card evidence">
                        <span className="tile-icon"><Icon name="alert" /></span>
                        <div>
                            <p className="source">National Weather Service alerts</p>
                            {data.alerts.length === 0 && (
                                <>
                                    <h3>No active alerts</h3>
                                    <p className="small">No watches, warnings, or advisories at the facility.</p>
                                </>
                            )}
                            {data.alerts.map(alert => {
                                const until = alert.ends ?? alert.expires;
                                return (
                                    <div key={alert.id} className="alert-item">
                                        <h3>
                                            {alert.event}
                                            {until && <span className="chip">Until {formatDateTime(until, zone)}</span>}
                                        </h3>
                                        {alert.headline && <p className="small">{alert.headline}</p>}
                                        <p className="small muted">
                                            Severity {alert.severity} · Certainty {alert.certainty} · Urgency {alert.urgency}
                                            {alert.areaDescription && ` · ${alert.areaDescription}`}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>
                    </article>

                    <article className="card evidence">
                        <span className="tile-icon"><Icon name="cloud" /></span>
                        <div>
                            <p className="source">Current conditions <time>{formatDateTime(data.current.observedAt, zone)}</time></p>
                            <h3>{formatTemp(data.current.temperatureF)} · {data.current.conditions ?? 'Conditions not reported'}</h3>
                            <dl className="stats">
                                <div><dt>Feels like</dt><dd>{formatTemp(data.current.feelsLikeF)}</dd></div>
                                <div><dt>Wind</dt><dd>{data.current.windDirection} {withUnit(data.current.windSpeedMph, 'mph')}</dd></div>
                                <div><dt>Gusts</dt><dd>{withUnit(data.current.windGustMph, 'mph')}</dd></div>
                                <div><dt>Humidity</dt><dd>{withUnit(data.current.humidityPercent, '%')}</dd></div>
                                <div><dt>Visibility</dt><dd>{withUnit(data.current.visibilityMiles, 'mi')}</dd></div>
                            </dl>
                        </div>
                    </article>

                    <LiveForecastCard situation={situation} forecast={data.forecast} />
                </>
            )}
        </section>
    );
}

const FORECAST_WINDOWS = [
    ['overnight', 'Overnight'],
    ['morningCommute', 'Morning commute'],
    ['officeHours', 'Office hours'],
    ['eveningCommute', 'Evening commute'],
    ['wholeDay', 'Whole day'],
] as const;

// Shows the forecast for the day being decided, which is the same slice the agent is given.
function LiveForecastCard({ situation, forecast }: { situation: Situation; forecast: LiveForecast | null }) {
    const { decisionWindow, facility } = situation;
    const zone = facility.timeZone;
    const day = forecast?.days.find(entry => entry.date === decisionWindow.operatingDate);

    return (
        <article className="card evidence">
            <span className="tile-icon"><Icon name="wind" /></span>
            <div>
                <p className="source">
                    NWS workday forecast
                    {forecast?.forecastUpdatedAt && <time>{formatDateTime(forecast.forecastUpdatedAt, zone)}</time>}
                </p>
                {day ? (
                    <>
                        <h3>Forecast for {decisionWindow.operatingDayLabel}</h3>
                        <div className="table-scroll">
                            <table className="data nowrap">
                                <thead>
                                    <tr>
                                        <th>Window</th><th>Snow</th><th>Ice</th><th>Wind chill</th>
                                        <th>Heat index</th><th>Gusts</th><th>Precip</th><th>Thunder</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {FORECAST_WINDOWS.map(([key, label]) => {
                                        const slot = day[key];
                                        return (
                                            <tr key={key}>
                                                <td>
                                                    <strong>{label}</strong>
                                                    <span>{formatTime(slot.start, zone)}–{formatTime(slot.end, zone)}</span>
                                                </td>
                                                <td>{withUnit(slot.snowInches, 'in')}</td>
                                                <td>{withUnit(slot.iceInches, 'in')}</td>
                                                <td>{formatTemp(slot.lowestWindChillF)}</td>
                                                <td>{formatTemp(slot.highestHeatIndexF)}</td>
                                                <td>{withUnit(slot.highestWindGustMph, 'mph')}</td>
                                                <td>{withUnit(slot.highestPrecipChancePercent, '%')}</td>
                                                <td>{withUnit(slot.highestThunderChancePercent, '%')}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <p className="small muted">Road conditions have no live feed yet.</p>
                    </>
                ) : (
                    <>
                        <h3>Forecast unavailable</h3>
                        <p className="small">
                            {forecast
                                ? `The forecast feed has no entry for ${decisionWindow.operatingDayLabel}.`
                                : 'The forecast feed could not be reached.'}
                            {' '}The agent decided from the current reading and active alerts.
                        </p>
                    </>
                )}
            </div>
        </article>
    );
}
