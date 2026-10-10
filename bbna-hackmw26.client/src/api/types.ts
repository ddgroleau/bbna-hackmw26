export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AnalyzeRequest {
  data: unknown;
}

export interface AnalyzeResponse {
  summary: string;
  status: 'pending' | 'processing' | 'complete';
}
