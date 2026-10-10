export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export type PostureStatus = 'normal' | 'delay' | 'early_dismissal' | 'telework' | 'closure';

export interface AnalyzeResponse {
  PostureStatus: PostureStatus;
  Summary: string;
  ConfidencePercentage: number;
  EmailNotification: string;
}

// What the agent is given. Only `weather` is required; the rest is null when the
// server could not provide it, and the agent is told to treat that as missing data.
export interface AnalysisSources {
  weather: Record<string, unknown>;
  alerts: Record<string, unknown> | null;
  situation: Record<string, unknown> | null;
  // Free text from the `data` query parameter, e.g. something the feeds cannot see.
  managerNote: string | null;
}
