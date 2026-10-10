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

// What the agent is given. Anything null was unavailable or not provided, and the agent is
// told to treat it as missing data.
export interface AnalysisSources {
  // The live reading from /api/weather/raw. Null when a scenario was requested, in which
  // case the scenario weather inside `situation` is analyzed instead.
  weather: Record<string, unknown> | null;
  alerts: Record<string, unknown> | null;
  // The live workday forecast from /api/weather/forecast, about a week of workdays.
  forecast: Record<string, unknown> | null;
  situation: Record<string, unknown> | null;
  // Free text from the `data` query parameter, e.g. something the feeds cannot see.
  managerNote: string | null;
}
