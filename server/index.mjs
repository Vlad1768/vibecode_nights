#!/usr/bin/env node
// API «Злой инвестор» (T28): общее ядро для сайта и бота.
//
//   node server/index.mjs                                   → http://127.0.0.1:8080, режим demo
//   node --env-file=.env.local server/index.mjs             → с ключом OpenAI или Gemini, режим live
//
// Настройки — переменные окружения, полный список в server/README.md.
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../core/content.mjs';
import { createTrainer } from '../core/trainer.mjs';
import { createLlmEngine } from '../core/llm.mjs';
import { createLlmClientFromEnv, llmProvider } from '../integrations/llm.mjs';
import { createFileStore } from './store.mjs';
import { createHandler } from './handler.mjs';

const env = process.env;
const log = (msg) => console.error(JSON.stringify({ ts: new Date().toISOString(), ...msg }));

export function createApp(settings = env) {
  const dataDir = settings.DATA_DIR || fileURLToPath(new URL('./.data/', import.meta.url));
  mkdirSync(dataDir, { recursive: true });
  const eventsFile = join(dataDir, 'events.jsonl');
  // Журнал для метрик: только события, id сессии и числа, без текстов питчей и ответов.
  const onEvent = (event, data) => {
    try { appendFileSync(eventsFile, JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + '\n'); }
    catch (err) { log({ level: 'error', msg: 'не удалось записать событие', code: err?.code }); }
  };

  const content = loadContent(settings.CONTENT_FILE);
  // Провайдер модели: OPENAI_API_KEY → ChatGPT, иначе GEMINI_API_KEY → Gemini (integrations/llm.mjs).
  const live = settings.DEMO_MODE !== '1' && Boolean(llmProvider(settings));
  const engine = live
    ? createLlmEngine(createLlmClientFromEnv(settings, {
      maxOutputTokens: Math.max(Number(settings.OPENAI_MAX_OUTPUT_TOKENS || settings.GEMINI_MAX_OUTPUT_TOKENS || 0), 2048),
      maxInputChars: 30000,
    }))
    : null;
  const store = createFileStore({ file: join(dataDir, 'sessions.json'), log });
  const trainer = createTrainer({ content, store, engine, fallback: settings.AI_FALLBACK !== 'off', onEvent, log });
  const handler = createHandler(trainer, { log });
  return { trainer, store, handler, close: () => { handler.close(); store.close(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = Number(env.PORT || 8080);
  const host = env.HOST || '127.0.0.1';
  const server = createServer(app.handler);
  server.requestTimeout = 60_000;
  server.listen(port, host, () => log({ level: 'info', msg: `API «Злой инвестор» ${app.trainer.mode}: http://${host}:${port}/api/health` }));
  const stop = () => {
    server.close(() => { app.close(); process.exit(0); });
    setTimeout(() => { app.close(); process.exit(0); }, 5000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
