import type { Analysis, Decision, Situation } from '../api';
import { Icon, PageHead } from '../components';
import type { IconName } from '../components';
import { POSTURES, formatCount, formatDateTime } from '../format';

interface RecordEvent {
    icon: IconName;
    when: string;
    title: string;
    detail: string;
}

interface Props {
    situation: Situation;
    // The agent's recommendation, once it has one.
    analysis?: Analysis;
    // True when the agent analyzed the live feeds rather than a mock scenario.
    live: boolean;
    decision?: Decision;
}

export function DecisionRecordPage({ situation, analysis, live, decision }: Props) {
    const { facility, weather, decisionWindow, thresholds } = situation;
    const stamp = (value: string) => formatDateTime(value, facility.timeZone);
    const recommended = analysis ? POSTURES[analysis.posture].label : undefined;

    const events: RecordEvent[] = [
        {
            icon: 'refresh',
            when: stamp(situation.generatedAt),
            title: 'Automated evidence capture completed',
            detail: live
                ? 'Latest NWS station reading and active alerts retained from the live feeds.'
                : `${weather.alerts.length} active NWS ${weather.alerts.length === 1 ? 'alert' : 'alerts'}, ${weather.forecast.length} forecast periods, and 1 road report retained from the mock scenario.`,
        },
        analysis
            ? {
                icon: 'shield',
                when: stamp(situation.generatedAt),
                title: 'AI agent generated recommendation',
                detail: `${recommended} at ${analysis.confidence}% confidence, judged against threshold table ${thresholds.rulesetVersion}.`,
            }
            : {
                icon: 'clock',
                when: 'Pending',
                title: 'AI agent recommendation not available',
                detail: 'The agent has not returned an analysis for this evidence.',
            },
    ];

    if (decision) {
        const chosen = POSTURES[decision.posture].label;
        events.push(
            {
                icon: 'check',
                when: stamp(decision.sentAt),
                title: `Manager approved ${chosen.toLowerCase()}`,
                detail: !analysis
                    ? 'The decision was made without an agent recommendation.'
                    : decision.posture === analysis.posture
                        ? 'The recommendation was accepted without change.'
                        : `The manager changed the posture from the recommended ${POSTURES[analysis.posture].label.toLowerCase()}.`,
            },
            {
                icon: 'send',
                when: stamp(decision.sentAt),
                title: 'Notifications released (simulated)',
                detail: `${formatCount(decision.recipients)} employees, including ${formatCount(decision.essentialRecipients)} essential personnel, through ${decision.channels.join(', ')}.`,
            },
        );
    } else {
        events.push({
            icon: 'clock',
            when: 'Pending',
            title: 'Human decision required',
            detail: 'The recommendation has not been accepted, changed, or rejected.',
        });
    }

    function exportRecord() {
        const record = {
            recordId: decisionWindow.recordId,
            facility: { id: facility.id, name: facility.name },
            operatingDate: decisionWindow.operatingDate,
            source: live ? 'live' : situation.scenario,
            capturedAt: situation.generatedAt,
            rulesetVersion: thresholds.rulesetVersion,
            agentRecommendation: analysis ?? null,
            // The situation's weather is mock data, so it is only evidence for a scenario run.
            scenarioWeather: live ? null : weather,
            decision: decision ?? null,
        };
        const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${decisionWindow.recordId}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }

    return (
        <>
            <PageHead
                eyebrow="Audit trail"
                title="Decision record"
                subtitle="A reconstructable record of what was known, when, and by whom."
                action={<button className="btn" onClick={exportRecord}><Icon name="file" size={18} />Export record</button>}
            />
            <div className="stack">
                <dl className="card meta-grid">
                    <div><dt>Record ID</dt><dd>{decisionWindow.recordId}</dd></div>
                    <div><dt>Facility</dt><dd>{facility.shortName}</dd></div>
                    <div><dt>Status</dt><dd>{decision ? 'Decision recorded' : 'Awaiting decision'}</dd></div>
                    <div><dt>Integrity</dt><dd>Inputs timestamped</dd></div>
                </dl>

                <ol className="card events">
                    {events.map(event => (
                        <li key={event.title}>
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
                            Source payloads, ruleset version {thresholds.rulesetVersion}, recipient resolution, message content,
                            and acknowledgements are retained for after-action review.
                        </span>
                    </div>
                </div>
            </div>
        </>
    );
}
