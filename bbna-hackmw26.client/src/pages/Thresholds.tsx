import type { Situation } from '../api';
import { Icon, PageHead } from '../components';

export function ThresholdsPage({ situation }: { situation: Situation }) {
    const { thresholds } = situation;
    return (
        <>
            <PageHead
                eyebrow="Governance"
                title="Defensible thresholds"
                subtitle="Every cutoff has an operational source, owner, and review date."
            />
            <div className="stack">
                <div className="callout wide">
                    <Icon name="shield" size={26} />
                    <div>
                        <strong>Human decision remains required</strong>
                        <span>
                            Rules produce a graded recommendation. They never change facility status or send notifications
                            without an authorized manager.
                        </span>
                    </div>
                </div>

                <section className="card flush">
                    <div className="table-scroll">
                        <table className="data">
                            <thead>
                                <tr><th>Decision level</th><th>Recommended posture</th><th>Trigger</th><th>Defensible basis</th></tr>
                            </thead>
                            <tbody>
                                {thresholds.levels.map(level => (
                                    <tr key={level.posture}>
                                        <td><strong className="accent">{level.level}</strong></td>
                                        <td>{level.postureLabel}</td>
                                        <td>{level.trigger}</td>
                                        <td>{level.basis}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                <div className="source-grid">
                    {thresholds.sources.map(source => (
                        <article key={source.title} className="card">
                            <p className="eyebrow">{source.owner}</p>
                            <h3>{source.title}</h3>
                            <p className="small">{source.detail}</p>
                            <p className="small muted card-foot">Reviewed {source.reviewed}</p>
                        </article>
                    ))}
                </div>

                <p className="small muted">Ruleset {thresholds.rulesetVersion}. {thresholds.dataNote}</p>
            </div>
        </>
    );
}
