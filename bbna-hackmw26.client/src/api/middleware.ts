import http from 'http';
import https from 'https';
import type { IncomingMessage, ServerResponse } from 'http';
import { analyzeWeather } from './strands.js';
import type { AnalysisSources, ApiResponse, AnalyzeResponse } from './types.js';

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
function fetchServerJson(pathname: string): Promise<Record<string, unknown>> {
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

async function handleAnalyzeRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '', 'http://localhost');

  const scenario = url.searchParams.get('scenario');
  const managerNote = url.searchParams.get('data')?.trim() || null;

  let sources: AnalysisSources;
  try {
    if (scenario) {
      // A named scenario replaces the live feeds with that scenario's mock weather.
      const situation = await fetchServerJson(`/api/situation?scenario=${encodeURIComponent(scenario)}`);
      sources = { weather: null, alerts: null, situation, managerNote };
    } else {
      // The raw reading is required. Alerts and facility context sharpen the analysis but must
      // not block it, so a failure there reaches the agent as null and it reports the gap.
      const [weather, alerts, situation] = await Promise.all([
        fetchServerJson('/api/weather/raw'),
        fetchServerJson('/api/weather/alerts').catch(() => null),
        fetchServerJson('/api/situation').catch(() => null),
      ]);
      sources = { weather, alerts, situation, managerNote };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Weather data unavailable';
    console.error('❌ Error fetching weather data:', errorMessage);
    return sendJson(res, 502, {
      success: false,
      error: errorMessage,
    } as ApiResponse);
  }

  try {
    console.log('📊 Analyzing weather data with Strands agent...');
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

  return false;
}
