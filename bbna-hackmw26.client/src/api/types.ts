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
  // What each specialist on the agent team found, in the order they reported.
  Team: TeamBrief[];
}

export type SpecialistId = 'meteorologist' | 'workforce' | 'rules' | 'lead';

export interface TeamBrief {
  id: SpecialistId;
  role: string;
  brief: string;
  // The tools the specialist called to gather its evidence.
  toolsUsed: string[];
}

// One past exchange in the conversation with the team.
export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatRequest {
  scenario?: string | null;
  managerNote?: string | null;
  // The recommendation the manager is looking at, so the conversation can discuss it.
  recommendation?: { posture: PostureStatus; summary: string; confidence: number } | null;
  history: ChatTurn[];
  question: string;
}

export interface ChatResponse {
  reply: string;
  // The specialists the conversation agent asked while answering.
  consulted: { id: SpecialistId; role: string }[];
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
  // Recent records from the decision log (/api/decisions), for the rules analyst. Null when unavailable.
  history: unknown[] | null;
}
