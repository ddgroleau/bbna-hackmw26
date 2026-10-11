import { Agent, DefaultModelRetryStrategy, ExponentialBackoff, Graph, tool as strandsTool } from "@strands-agents/sdk";
import type { MessageData } from "@strands-agents/sdk";
import { z } from "zod";
import {
  DATA_GUARD,
  DECISION_GUIDE,
  JUDGMENT_MODEL_ID,
  MODEL_ID,
  NO_RULE,
  OUTPUT_GUIDE,
  POSTURE_GUIDE,
  UNITS_GUIDE,
  analysisSchema,
  buildAnalysisInput,
  contradiction,
} from "./strands.js";
import type { AnalysisInput } from "./strands.js";
import type { AnalysisSources, AnalyzeResponse, ChatRequest, ChatResponse, SpecialistId, TeamBrief } from "./types.js";

// The agent team. Three specialists gather their own evidence with tools: a meteorologist, a
// workforce analyst, and a rules analyst who holds the facility's decision matrix. For a
// recommendation they run as a Strands Graph that ends in a decision lead; for the manager's
// questions an independent conversation agent consults the same specialists as tools.
// Every agent is built per request around that request's evidence, so nothing carries over.

function requireCredentials() {
  if (!process.env.AWS_BEARER_TOKEN_BEDROCK) {
    throw new Error(
      "AWS_BEARER_TOKEN_BEDROCK environment variable is not set. " +
        "Get your API key from AWS Bedrock console (https://console.aws.amazon.com/bedrock/) " +
        "and add it to your .env file in the bbna-hackmw26.client/src/api folder.",
    );
  }
}

// The SDK retries throttling Bedrock reports mid-stream, but not a request Bedrock rejects up front
// with "Too many requests". A team run makes several calls close together, so both are retried.
class ThrottleRetry extends DefaultModelRetryStrategy {
  constructor() {
    super({ maxAttempts: 5, backoff: new ExponentialBackoff({ baseMs: 2_000, maxMs: 20_000 }) });
  }

  protected override isRetryable(error: Error): boolean {
    return super.isRetryable(error) || error.name === "ThrottlingException" || /too many requests|throttl/i.test(error.message);
  }
}

const ROLES: Record<SpecialistId, string> = {
  meteorologist: "Meteorologist",
  workforce: "Workforce analyst",
  rules: "Rules analyst",
  lead: "Decision lead",
};

// Nova wraps some of its reasoning in <thinking> tags; only the answer is shown.
function answerText(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/g, "").trim();
}

// Read-only tools over one request's evidence. Each returns a slice, so a specialist has to
// decide what it needs instead of being handed everything. Every agent gets its own set, which
// records the tools that agent called (a graph resets an agent's messages after it runs).
function evidenceTools(input: AnalysisInput, history: unknown[] | null, used: Set<string> = new Set()) {
  const none = z.object({});
  const tool = <T>(config: { name: string; description: string; inputSchema: typeof none; callback: () => T }) =>
    strandsTool({
      ...config,
      callback: () => {
        used.add(config.name);
        return config.callback() as never;
      },
    });
  const live = "station" in input;
  return {
    observation: tool({
      name: "get_current_observation",
      description: `The latest weather reading at the facility's National Weather Service station. ${UNITS_GUIDE}`,
      inputSchema: none,
      callback: () => ({
        source: live ? "live NWS feed" : "mock scenario",
        ...(live ? { station: input.station, retrievedAt: input.retrievedAt } : {}),
        observation: input.observation ?? "unavailable",
      }),
    }),
    alerts: tool({
      name: "get_active_alerts",
      description: "The National Weather Service alerts in effect at the facility, with their timing. An empty list means none are active.",
      inputSchema: none,
      callback: () => ({ alerts: input.alerts ?? "unavailable" }),
    }),
    forecast: tool({
      name: "get_decision_day_forecast",
      description:
        "The forecast for the day being decided, split into overnight, morning commute, office hours and evening commute windows (or a list of periods with totals), and the roads report when there is one.",
      inputSchema: none,
      callback: () => ({
        forecast: input.forecast ?? "unavailable",
        ...("forecastTotals" in input ? { forecastTotals: input.forecastTotals } : {}),
        roads: input.roads ?? "no roads report",
      }),
    }),
    schedule: tool({
      name: "get_facility_schedule",
      description: "The facility's name, address, time zone and operating hours, and the decision window: which day is being decided and when the decision is due.",
      inputSchema: none,
      callback: () => ({ facility: input.facility ?? "unavailable", decisionWindow: input.decisionWindow ?? "unavailable" }),
    }),
    staffing: tool({
      name: "get_staffing",
      description: "How many employees are assigned, how many receive notifications, and the audiences: telework-ready, on-site only, and essential personnel.",
      inputSchema: none,
      callback: () => ({ staffing: input.staffing ?? "unavailable" }),
    }),
    rules: tool({
      name: "get_rule_checks",
      description:
        "The facility's decision matrix. Each rule has an id, a level (Advisory, Action or Critical), a hazard, a trigger in US units, the posture it supports, and a numericCheck that has already compared its numeric cutoffs with the decision-day data.",
      inputSchema: none,
      callback: () => ({ decisionMatrix: input.decisionMatrix }),
    }),
    note: tool({
      name: "get_manager_note",
      description: "Local context the facility manager added that the weather feeds cannot see, such as a power outage. Empty when there is none.",
      inputSchema: none,
      callback: () => ({ managerNote: input.managerNote || "No manager note." }),
    }),
    history: tool({
      name: "get_decision_history",
      description:
        "Recent records from the facility's decision log: what was recommended, what the manager decided, whether it was an override, and the rationale given.",
      inputSchema: none,
      callback: () => ({ decisions: history ?? "unavailable" }),
    }),
  };
}

type Tools = ReturnType<typeof evidenceTools>;

// An agent with its own recording tool set; `used` lists the tools it called.
interface Specialist {
  agent: Agent;
  used: Set<string>;
}

function specialist(build: (tools: Tools) => Agent, input: AnalysisInput, history: unknown[] | null): Specialist {
  const used = new Set<string>();
  return { agent: build(evidenceTools(input, history, used)), used };
}

const BRIEF_RULES = `Gather your evidence with your tools before answering; do not guess what they would return. Answer in at most 120 words of plain text with numbers and times: no headings, bold, or bullet symbols. Say plainly when something you need is unavailable. You advise; the facility manager decides. ${DATA_GUARD}`;

function meteorologist(tools: Tools) {
  return new Agent({
    id: "meteorologist",
    name: "meteorologist",
    description:
      "The team's meteorologist. Ask about current conditions, active NWS alerts, the decision-day forecast, and when hazards start and end relative to the commutes and office hours.",
    model: MODEL_ID,
    printer: false,
    retryStrategy: new ThrottleRetry(),
    tools: [tools.observation, tools.alerts, tools.forecast, tools.schedule],
    systemPrompt: `You are the meteorologist on a team advising a federal facility manager about severe weather. Assess the hazards for the day being decided: what they are, how severe (with numbers), and when they start and end against the overnight period, the morning commute, office hours and the evening commute. Report conditions only; do not recommend an operating posture, which is the rules analyst's and the decision lead's job. ${UNITS_GUIDE} ${BRIEF_RULES}`,
  });
}

function workforceAnalyst(tools: Tools) {
  return new Agent({
    id: "workforce",
    name: "workforce_analyst",
    description:
      "The team's workforce analyst. Ask who is affected by each operating posture: how many employees, how many can telework, how many must be on site, and the essential personnel.",
    model: MODEL_ID,
    printer: false,
    retryStrategy: new ThrottleRetry(),
    tools: [tools.schedule, tools.staffing],
    systemPrompt: `You are the workforce analyst on a team advising a federal facility manager about severe weather. Explain who each posture affects: how many employees are assigned and notified, how many can keep working by telework, how many must be on site, and which essential personnel report regardless. Use the facility's hours and the day being decided. Describe the impact of the postures; do not pick one, which is the decision lead's job. ${POSTURE_GUIDE} ${BRIEF_RULES}`,
  });
}

function rulesAnalyst(tools: Tools) {
  return new Agent({
    id: "rules",
    name: "rules_analyst",
    description:
      "The team's rules analyst. Ask which rules in the facility's decision matrix are met, how close conditions are to a trigger, whether a proposed posture is supported, and how past decisions went.",
    model: JUDGMENT_MODEL_ID,
    printer: false,
    retryStrategy: new ThrottleRetry(),
    tools: [tools.rules, tools.alerts, tools.note, tools.history],
    systemPrompt: `You are the rules analyst on a team advising a federal facility manager about severe weather. You hold the facility's decision matrix. Report which rules are met and by what evidence, the most severe met rule and the posture it supports, or, when none is met, the closest trigger and how far short conditions are. Weigh the manager note when there is one. Check the decision history for past overrides in similar conditions and mention a pattern if there is one. ${DECISION_GUIDE} ${POSTURE_GUIDE} ${BRIEF_RULES}`,
  });
}

function decisionLead(tools: Tools) {
  return new Agent({
    id: "lead",
    name: "decision_lead",
    model: JUDGMENT_MODEL_ID,
    printer: false,
    retryStrategy: new ThrottleRetry(),
    tools: [tools.rules, tools.schedule, tools.staffing, tools.note],
    structuredOutputSchema: analysisSchema,
    systemPrompt: `You lead a team advising the manager of a federal facility on its operating posture during severe weather. The manager makes the final decision; you recommend one and explain why.

You receive the task followed by briefs from your specialists, each introduced by [node: meteorologist], [node: workforce] or [node: rules]. Build the recommendation from their briefs. Check the decision matrix yourself with get_rule_checks before naming the matched rule, and use get_facility_schedule and get_staffing for the names, times and numbers in the email. Where the specialists disagree, say so in the summary and lower your confidence.

${POSTURE_GUIDE}

${DECISION_GUIDE}

MatchedRule must be the id of the rule that drove the posture, or "${NO_RULE}".

${OUTPUT_GUIDE}

${DATA_GUARD}`,
  });
}

function briefFrom(id: SpecialistId, used: Set<string>, text: string): TeamBrief {
  return { id, role: ROLES[id], brief: answerText(text), toolsUsed: [...used] };
}

function nodeText(content: readonly { type: string }[]): string {
  return content.flatMap((block) => (block.type === "textBlock" ? [(block as unknown as { text: string }).text] : [])).join("\n");
}

const SEVERITY: Record<string, number> = { Advisory: 1, Action: 2, Critical: 3 };

// The review step after the lead answers: a more severe rule whose numeric cutoff is met may have been
// overlooked. Its full trigger can still fail on timing, so this is a challenge, not a veto.
function overlookedRule(input: AnalysisInput, matchedRule: string): string | undefined {
  const cited = input.decisionMatrix.find((rule) => rule.id === matchedRule);
  const citedLevel = cited ? (SEVERITY[cited.level] ?? 0) : 0;
  const [missed] = input.decisionMatrix
    .filter((rule) => rule.numericCheck === "met" && (SEVERITY[rule.level] ?? 0) > citedLevel)
    .sort((a, b) => (SEVERITY[b.level] ?? 0) - (SEVERITY[a.level] ?? 0));
  if (!missed) return undefined;
  return `rule "${missed.id}" (${missed.level}, supports "${missed.posture}") has a numeric check that is met (${missed.measured ?? "see get_rule_checks"}) and is more severe than the rule you cited. The most severe met rule decides unless the rest of its trigger fails. Check its full trigger against the alerts and timing, then either choose it or say in the summary why it does not apply`;
}

function task(input: AnalysisInput): string {
  const facility = (input.facility as { name?: string } | null)?.name ?? "the facility";
  const day = (input.decisionWindow as { operatingDayLabel?: string } | null)?.operatingDayLabel ?? "the next operating day";
  const note = input.managerNote ? " The manager added a note about local conditions; the rules analyst and decision lead should read it." : "";
  return `Recommend an operating posture for ${facility} for ${day}.${note}`;
}

// Runs the team as a graph: the meteorologist and the workforce analyst work in parallel, the rules
// analyst starts from the meteorologist's brief, and the decision lead combines all three.
export async function analyzeWeather(sources: AnalysisSources): Promise<AnalyzeResponse> {
  requireCredentials();
  const input = buildAnalysisInput(sources);
  const specialists = {
    meteorologist: specialist(meteorologist, input, sources.history),
    workforce: specialist(workforceAnalyst, input, sources.history),
    rules: specialist(rulesAnalyst, input, sources.history),
  };
  let lead = specialist(decisionLead, input, sources.history);

  const graph = new Graph({
    nodes: [specialists.meteorologist.agent, specialists.workforce.agent, specialists.rules.agent, lead.agent],
    edges: [
      ["meteorologist", "rules"],
      ["meteorologist", "lead"],
      ["workforce", "lead"],
      ["rules", "lead"],
    ],
    timeout: 180_000,
    nodeTimeout: 90_000,
    maxSteps: 10,
  });

  const run = await graph.invoke(task(input));
  const result = (id: string) => run.results.find((node) => node.nodeId === id);
  const failed = run.results.find((node) => node.status !== "COMPLETED");
  if (run.status !== "COMPLETED" || failed) {
    throw new Error(`The agent team did not finish (${failed?.nodeId ?? "graph"}: ${failed?.error?.message ?? run.status}).`);
  }

  const team = (["meteorologist", "workforce", "rules"] as const).map((id) =>
    briefFrom(id, specialists[id].used, nodeText(result(id)!.content)),
  );

  // The lead must name the rule behind its posture. An answer that contradicts the matrix or the
  // computed numeric checks is the model inventing or misreading a threshold, so the lead is asked
  // again with the same briefs before giving up. The specialists are not rerun. An answer that
  // passes over a more severe met rule is challenged once; a second answer that still does is kept.
  let structured = result("lead")!.structuredOutput;
  let problem = "";
  let challenged = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { MatchedRule, ...analysis } = analysisSchema.parse(structured);
    let found = contradiction(input, MatchedRule, analysis.PostureStatus);
    if (!found && !challenged) {
      found = overlookedRule(input, MatchedRule);
      challenged = !!found;
    }
    if (!found) {
      const leadBrief = briefFrom("lead", lead.used, `Matched ${MatchedRule === NO_RULE ? "no rule" : `rule ${MatchedRule}`}: ${analysis.Summary}`);
      return {
        ...analysis,
        // The model sometimes opens with a subject line despite the instructions; this field is the body only.
        EmailNotification: analysis.EmailNotification.replace(/^\s*subject:.*\n+/i, ""),
        Team: [...team, leadBrief],
      };
    }

    problem = found;
    console.warn(`⚠️ Sending the recommendation back to the decision lead: ${problem}.`);
    if (attempt === 2) break;
    lead = specialist(decisionLead, input, sources.history);
    const briefs = team.map((brief) => `[node: ${brief.id}]\n${brief.brief}`).join("\n\n");
    const retry = await lead.agent.invoke(
      `${task(input)}\n\n${briefs}\n\nYour earlier answer was sent back because ${problem}. Check get_rule_checks and answer again.`,
    );
    structured = retry.structuredOutput;
  }

  throw new Error(`The agent team's recommendation contradicted the decision matrix (${problem}). Try again.`);
}

const MAX_HISTORY = 12;

// The teammates the conversation agent called since message index `start`.
function consultedSince(agent: Agent, start: number, byToolName: Record<string, SpecialistId>): SpecialistId[] {
  const names = agent.messages
    .slice(start)
    .flatMap((message) => message.content.flatMap((block) => (block.type === "toolUseBlock" ? [block.name] : [])));
  return [...new Set(names.flatMap((name) => (byToolName[name] ? [byToolName[name]] : [])))];
}

// The conversation agent: an independent specialist in talking with the manager. It has no evidence
// tools of its own; it answers by consulting the other specialists, so every answer is grounded in
// what they look up.
export async function askTeam(sources: AnalysisSources, request: ChatRequest): Promise<ChatResponse> {
  requireCredentials();
  const input = buildAnalysisInput(sources);
  const specialists = {
    meteorologist: specialist(meteorologist, input, sources.history),
    workforce: specialist(workforceAnalyst, input, sources.history),
    rules: specialist(rulesAnalyst, input, sources.history),
  };

  const current = request.recommendation;
  const recommendationTool = strandsTool({
    name: "get_current_recommendation",
    description: "The recommendation the agent team gave the manager: the posture, the summary and the confidence.",
    inputSchema: z.object({}),
    callback: () => current ?? { recommendation: "The team has not made a recommendation yet." },
  });

  const history: MessageData[] = request.history.slice(-MAX_HISTORY).map((turn) => ({
    role: turn.role,
    content: [{ text: turn.text }],
  }));

  const conversation = new Agent({
    id: "conversation",
    name: "conversation_agent",
    model: JUDGMENT_MODEL_ID,
    printer: false,
    retryStrategy: new ThrottleRetry(),
    messages: history,
    tools: [specialists.meteorologist.agent, specialists.workforce.agent, specialists.rules.agent, recommendationTool],
    systemPrompt: `You are the conversation specialist on a team advising the manager of a federal facility about its operating posture during severe weather. The manager asks you questions while deciding. Answer them by consulting your teammates, who look up the evidence:
- meteorologist: conditions, alerts, the forecast and hazard timing.
- workforce_analyst: who each posture affects.
- rules_analyst: the facility's decision matrix, how close conditions are to a trigger, and past decisions.
Use get_current_recommendation when the question is about the team's recommendation.

Consult your teammates on every question about the facility, including follow-ups: earlier answers in this conversation are not evidence for a new question. Ask whichever teammates the question needs, and more than one when it spans their areas. A question about why one posture rather than another always needs the rules_analyst, and the meteorologist when timing matters. Do not answer facts from memory. For a "what if" question, pass the changed condition to the relevant teammates, have them reason about it, and say clearly that the answer is hypothetical.

Answer in plain text, at most 150 words. Name the teammate each finding came from, and only name teammates you consulted for this question. You advise and never decide: the manager makes and records the decision. If a question is not about the facility's operating decision, say that you can only help with that.

${POSTURE_GUIDE}

${DATA_GUARD}`,
  });

  const byToolName: Record<string, SpecialistId> = {
    meteorologist: "meteorologist",
    workforce_analyst: "workforce",
    rules_analyst: "rules",
  };

  // Every finding should come from a teammate consulted for this question. An answer that consulted
  // nobody, or names a teammate it did not ask, is sent back once; a second answer is returned as is.
  // A refusal of an off-topic question needs no teammate.
  const before = conversation.messages.length;
  let reply = answerText(String(await conversation.invoke(request.question)));
  let consultedIds = consultedSince(conversation, before, byToolName);
  const uncited = Object.keys(byToolName).filter(
    (name) => reply.includes(name) && !consultedIds.includes(byToolName[name]),
  );
  const refused = /only help with|can.t help|cannot help|only assist/i.test(reply);
  if (uncited.length > 0 || (consultedIds.length === 0 && !refused)) {
    const correction = uncited.length > 0
      ? `You named ${uncited.join(" and ")} without consulting them for this question.`
      : "You answered without consulting any teammate.";
    reply = answerText(
      String(
        await conversation.invoke(
          `${correction} Consult the teammates this question needs now (the rules_analyst holds past decisions), then answer the question again.`,
        ),
      ),
    );
    consultedIds = consultedSince(conversation, before, byToolName);
  }

  return {
    reply: reply || "The team did not produce an answer. Try asking again.",
    consulted: consultedIds.map((id) => ({ id, role: ROLES[id] })),
  };
}
