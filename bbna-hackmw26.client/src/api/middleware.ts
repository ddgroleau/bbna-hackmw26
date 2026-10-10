import type { IncomingMessage, ServerResponse } from 'http';
import { analyzeData } from './strands.js';
import type { ApiResponse, AnalyzeResponse } from './types.js';

function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handleAnalyzeRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const data = url.searchParams.get('data');

    if (!data) {
      return sendJson(res, 400, {
        success: false,
        error: 'No data provided',
      } as ApiResponse);
    }

    console.log('📊 Analyzing data with Strands agent...');
    const summary = await analyzeData(data);

    const response: ApiResponse<AnalyzeResponse> = {
      success: true,
      data: {
        summary,
        status: 'complete',
      }
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

function handleHealthRequest(req: IncomingMessage, res: ServerResponse) {
  sendJson(res, 200, {
    success: true,
    message: 'API is healthy',
    timestamp: new Date().toISOString(),
  });
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url || '';
  
  if (url.startsWith('/api/health') && req.method === 'GET') {
    handleHealthRequest(req, res);
    return true;
  }

  if (url.startsWith('/api/analyze') && req.method === 'GET') {
    await handleAnalyzeRequest(req, res);
    return true;
  }

  if (url.startsWith('/api')) {
    sendJson(res, 404, { 
      success: false, 
      error: 'Endpoint not found' 
    } as ApiResponse);
    return true;
  }

  return false;
}
