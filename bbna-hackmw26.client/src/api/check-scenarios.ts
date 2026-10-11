// Runs the agent team on every mock scenario, several times each, and reports its posture against
// the posture the scenario was written for (recommendation.posture in the scenario file). The model
// is not deterministic, so one good run proves little: this is the check to rerun after changing
// the prompts, the rule checks in strands.ts, or a scenario.
//
// Needs the ASP.NET backend running (it serves /api/situation) and AWS_BEARER_TOKEN_BEDROCK in
// src/api/.env. From bbna-hackmw26.client:
//   npx tsx src/api/check-scenarios.ts                     every scenario, 3 runs each
//   npx tsx src/api/check-scenarios.ts 5 tornado-warning   5 runs of the named scenarios only
// Exits with code 1 when any run misses its posture or fails.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadSources } from "./middleware.js";
import { analyzeWeather } from "./team.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = path.resolve(__dirname, "../../../bbna-hackmw26.Server/MockData/scenarios");
// Scenarios run this many at a time. Each run is several Bedrock calls, so more risks throttling.
const PARALLEL = 2;

// Arguments: an optional run count, then optional scenario ids.
const args = process.argv.slice(2);
const runs = /^\d+$/.test(args[0] ?? "") ? Number(args.shift()) : 3;
const scenarios = fs
  .readdirSync(SCENARIO_DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(fs.readFileSync(path.join(SCENARIO_DIR, file), "utf8")) as { id: string; recommendation: { posture: string } })
  .filter(({ id }) => args.length === 0 || args.includes(id));

interface Outcome {
  id: string;
  expected: string;
  got: string[]; // one entry per run: the posture and the rule the lead cited, or the error
  passed: number;
}

// One scenario, run after run, loading its evidence exactly as /api/analyze?scenario=<id> does.
async function check({ id, recommendation }: (typeof scenarios)[number]): Promise<Outcome> {
  const outcome: Outcome = { id, expected: recommendation.posture, got: [], passed: 0 };
  for (let run = 0; run < runs; run++) {
    try {
      const result = await analyzeWeather(await loadSources(id, null));
      // The lead's brief opens with "Matched rule <id>:" or "Matched no rule:".
      const lead = result.Team?.find((member) => member.id === "lead")?.brief ?? "";
      const rule = /^Matched (?:rule (\S+?)|(no rule)):/.exec(lead)?.slice(1).find(Boolean) ?? "?";
      outcome.got.push(`${result.PostureStatus} (${rule})`);
      if (result.PostureStatus === recommendation.posture) outcome.passed++;
    } catch (error) {
      outcome.got.push(`error: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log(`  ${id} run ${run + 1}/${runs}: ${outcome.got[run]}`);
  }
  return outcome;
}

// A small worker pool: PARALLEL workers take the next scenario until none are left.
const queue = [...scenarios];
const outcomes: Outcome[] = [];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      outcomes.push(await check(next));
    }
  }),
);

console.log(`\nScenario check, ${runs} run(s) each:`);
for (const { id, expected, got, passed } of outcomes.sort((a, b) => a.id.localeCompare(b.id))) {
  console.log(`${passed === runs ? "PASS" : "FAIL"}  ${id.padEnd(16)} expected ${expected.padEnd(15)} ${passed}/${runs}  ${got.join(", ")}`);
}
process.exitCode = outcomes.every(({ passed }) => passed === runs) ? 0 : 1;
