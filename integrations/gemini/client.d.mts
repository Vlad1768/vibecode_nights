export const DEFAULT_MODEL: 'gemini-4-argon';
export type GeminiErrorCode = 'CONFIG' | 'INPUT' | 'AUTH' | 'ACCESS' | 'QUOTA'
  | 'MODEL' | 'REQUEST' | 'PROVIDER' | 'NETWORK' | 'TIMEOUT' | 'CANCELLED'
  | 'BLOCKED' | 'INCOMPLETE' | 'RESPONSE';
export class GeminiError extends Error {
  constructor(code: GeminiErrorCode, options?: { httpStatus?: number; retryable?: boolean });
  code: GeminiErrorCode;
  httpStatus: number;
  retryable: boolean;
}
export interface GeminiClientOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  maxInputChars?: number;
  fetchImpl?: typeof fetch;
}
export interface GenerationRequest {
  prompt: string;
  system?: string;
  signal?: AbortSignal;
  /** Base64 audio, PDF or image parts sent before the prompt (up to 4, ~18 MB in total). */
  media?: Array<{ mimeType: string; data: string }>;
}
export interface GeminiResult<T> {
  data: T;
  modelVersion: string;
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
}
export interface GeminiClient {
  readonly model: string;
  generateText(request: GenerationRequest): Promise<GeminiResult<string>>;
  generateJSON(request: GenerationRequest & { schema: Record<string, unknown> }): Promise<GeminiResult<unknown>>;
}
export function createGeminiClient(options: GeminiClientOptions): GeminiClient;
export function createGeminiClientFromEnv(
  settings?: Record<string, string | undefined>,
  overrides?: Partial<GeminiClientOptions>,
): GeminiClient;
