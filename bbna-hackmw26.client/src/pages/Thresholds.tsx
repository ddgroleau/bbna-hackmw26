import decisionMatrix from "../api/decision-matrix.json";
import { Icon, PageHead } from "../components";

export function ThresholdsPage() {
  // Group rules by level
  const rulesByLevel = decisionMatrix.levels.map((level) => ({
    level,
    rules: decisionMatrix.rules.filter((rule) => rule.level === level.id),
  }));

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
              Rules produce a graded recommendation. They never change facility
              status or send notifications without an authorized manager.
            </span>
          </div>
        </div>

        {rulesByLevel.map(({ level, rules }) => (
          <section key={level.id} className="card flush">
            <h2
              className="eyebrow"
              style={{ paddingLeft: "1.5rem", paddingTop: "1rem" }}
            >
              {level.title}
            </h2>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Trigger</th>
                    <th>Defensible basis</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id}>
                      <td>
                        <strong>{rule.title}</strong>
                        <p className="small">{rule.description}</p>
                      </td>
                      <td className="small">{rule.trigger}</td>
                      <td className="small">{rule.basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        <p className="small muted">{decisionMatrix.note}</p>
      </div>
    </>
  );
}
