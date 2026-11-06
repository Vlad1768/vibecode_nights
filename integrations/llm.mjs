// Выбор провайдера модели по окружению сервера: OPENAI_API_KEY → ChatGPT (OpenAI), иначе GEMINI_API_KEY → Gemini.
// LLM_PROVIDER=openai|gemini — явный выбор, если заданы оба ключа. Без ключей — null (API работает в demo).
import { createOpenAIClientFromEnv } from './openai/client.mjs';
import { createGeminiClientFromEnv } from './gemini/client.mjs';

export function llmProvider(settings = process.env) {
  const forced = String(settings.LLM_PROVIDER || '').toLowerCase();
  if (forced === 'openai' && settings.OPENAI_API_KEY) return 'openai';
  if (forced === 'gemini' && settings.GEMINI_API_KEY) return 'gemini';
  if (settings.OPENAI_API_KEY) return 'openai';
  if (settings.GEMINI_API_KEY) return 'gemini';
  return null;
}

// overrides: { timeoutMs, maxOutputTokens, maxInputChars } — общие для обоих клиентов.
export function createLlmClientFromEnv(settings = process.env, overrides = {}) {
  const provider = llmProvider(settings);
  if (provider === 'openai') return createOpenAIClientFromEnv(settings, overrides);
  if (provider === 'gemini') return createGeminiClientFromEnv(settings, overrides);
  return null;
}
