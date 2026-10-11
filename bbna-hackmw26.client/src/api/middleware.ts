import http from 'http';
import https from 'https';
import type { IncomingMessage, ServerResponse } from 'http';
import { analyzeWeather, askTeam } from './team.js';
import type { AnalysisSources, ApiResponse, AnalyzeResponse, ChatRequest, ChatResponse, ChatTurn } from './types.js';

function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Where the ASP.NET server listens, resolved the same way vite.config.ts picks its proxy target.
function serverOrigin(): string {
  if (process.env.WEATHER_SERVER_URL) {
    return process.env.WEATHER_SERVER_URL;
  }
  if (process.env.ASPNETCORE_HTTPS_PORT) {
    return `https://localhost:${process.env.ASPNETCORE_HTTPS_PORT}`;
  }
  return process.env.ASPNETCORE_URLS?.split(';')[0] || 'https://localhost:7008';
}

// The ASP.NET server redirects HTTP to HTTPS and serves the development certificate, which
// Node does not trust. Certificate checks are skipped for that case only: a loopback address.
function fetchServerJson<T = Record<string, unknown>>(pathname: string): Promise<T> {
  const url = new URL(pathname, serverOrigin());
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.get(url, { rejectUnauthorized: !isLoopback, timeout: 20_000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`${url} answered ${response.statusCode}.`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`${url} did not return JSON.`));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('timed out')));
    request.on('error', (error) => {
      reject(new Error(`Could not reach ${url} (${error.message}). Is the ASP.NET server running? Set WEATHER_SERVER_URL in src/api/.env if it listens elsewhere.`));
    });
  });
}

// The decision log, reduced to what the rules analyst needs to spot a pattern in past decisions.
interface LoggedRecord {
  record: { id: string; createdAt: string; recommendedPosture: string; finalPosture: string | null; action: string | null };
  events: { kind: string; detail: string }[];
}

async function decisionHistory(): Promise<unknown[] | null> {
  try {
    const log = await fetchServerJson<LoggedRecord[]>('/api/decisions');
    return log
      .filter(({ record }) => record.finalPosture)
      .slice(0, 10)
      .map(({ record, events }) => ({
        id: record.id,
        createdAt: record.createdAt,
        recommended: record.recommendedPosture,
        decided: record.finalPosture,
        action: record.action,
        decision: events.find((event) => event.kind === 'DecisionRecorded')?.detail ?? null,
      }));
  } catch {
    return null;
  }
}

// The evidence the agent team works from: a mock scenario, or the live feeds.
async function loadSources(scenario: string | null, managerNote: string | null): Promise<AnalysisSources> {
  const history = decisionHistory();
  if (scenario) {
    // A named scenario replaces the live feeds with that scenario's mock weather.
    const situation = await fetchServerJson(`/api/situation?scenario=${encodeURIComponent(scenario)}`);
    return { weather: null, alerts: null, forecast: null, situation, managerNote, history: await history };
  }
  // The raw reading is required. Alerts and facility context sharpen the analysis but must
  // not block it, so a failure there reaches the agent as null and it reports the gap.
  const [weather, alerts, forecast, situation] = await Promise.all([
    fetchServerJson('/api/weather/raw'),
    fetchServerJson('/api/weather/alerts').catch(() => null),
    fetchServerJson('/api/weather/forecast').catch(() => null),
    fetchServerJson('/api/situation').catch(() => null),
  ]);
  return { weather, alerts, forecast, situation, managerNote, history: await history };
}

async function handleAnalyzeRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '', 'http://localhost');

  const scenario = url.searchParams.get('scenario');
  const managerNote = url.searchParams.get('data')?.trim() || null;

  let sources: AnalysisSources;
  try {
    sources = await loadSources(scenario, managerNote);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Weather data unavailable';
    console.error('❌ Error fetching weather data:', errorMessage);
    return sendJson(res, 502, {
      success: false,
      error: errorMessage,
    } as ApiResponse);
  }

  try {
    console.log('📊 Analyzing weather data with the Strands agent team...');
    const response: ApiResponse<AnalyzeResponse> = {
      success: true,
      data: await analyzeWeather(sources),
    };

    return sendJson(res, 200, response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('❌ Error analyzing data:', errorMessage);
    return sendJson(res, 500, {
      success: false,
      error: errorMessage,
    } as ApiResponse);
  }
}

const MAX_BODY_BYTES = 64 * 1024;

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('The request is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('The request body is not JSON.'));
      }
    });
    req.on('error', reject);
  });
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// Checks the shape of a chat request; anything the client should not control is dropped.
function parseChatRequest(body: unknown): ChatRequest | string {
  const data = (body ?? {}) as Record<string, unknown>;
  const question = text(data.question, 1000);
  if (!question) return 'A question is required.';

  const history: ChatTurn[] = (Array.isArray(data.history) ? data.history : [])
    .filter((turn): turn is { role: string; text: string } =>
      !!turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string')
    .map((turn) => ({ role: turn.role as ChatTurn['role'], text: text(turn.text, 2000) }));

  const rec = data.recommendation as Record<string, unknown> | null | undefined;
  return {
    scenario: text(data.scenario, 100) || null,
    managerNote: text(data.managerNote, 500) || null,
    recommendation: rec && typeof rec.posture === 'string'
      ? { posture: rec.posture as never, summary: text(rec.summary, 2000), confidence: Number(rec.confidence) || 0 }
      : null,
    history,
    question,
  };
}

async function handleChatRequest(req: IncomingMessage, res: ServerResponse) {
  let request: ChatRequest;
  try {
    const parsed = parseChatRequest(await readJsonBody(req));
    if (typeof parsed === 'string') {
      return sendJson(res, 400, { success: false, error: parsed } as ApiResponse);
    }
    request = parsed;
  } catch (error) {
    return sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : 'Bad request' } as ApiResponse);
  }

  let sources: AnalysisSources;
  try {
    sources = await loadSources(request.scenario ?? null, request.managerNote ?? null);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Weather data unavailable';
    return sendJson(res, 502, { success: false, error: errorMessage } as ApiResponse);
  }

  try {
    console.log('💬 Asking the Strands agent team...');
    const response: ApiResponse<ChatResponse> = { success: true, data: await askTeam(sources, request) };
    return sendJson(res, 200, response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('❌ Error answering the chat:', errorMessage);
    return sendJson(res, 500, { success: false, error: errorMessage } as ApiResponse);
  }
}

function handleHealthRequest(res: ServerResponse) {
  sendJson(res, 200, {
    success: true,
    message: 'API is healthy',
    timestamp: new Date().toISOString(),
  });
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url || '';

  if (url.startsWith('/api/health') && req.method === 'GET') {
    handleHealthRequest(res);
    return true;
  }

  if (url.startsWith('/api/analyze') && req.method === 'GET') {
    await handleAnalyzeRequest(req, res);
    return true;
  }

  if (url.startsWith('/api/chat') && req.method === 'POST') {
    await handleChatRequest(req, res);
    return true;
  }

  return false;
}
