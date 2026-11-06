// Точка входа: long polling Telegram → диалог → API тренажёра.
// Запуск: BOT_TELEGRAM_TOKEN=... node bot/src/main.mjs
import http from 'node:http';
import { loadConfig } from './config.mjs';
import { createTelegram, TelegramError } from './telegram.mjs';
import { createDialog } from './dialog.mjs';
import { createMockApi } from './api/mock.mjs';
import { createHttpApi } from './api/http.mjs';

// Журнал в JSON-строках: без текстов сообщений и без секретов.
function log(level, event, fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  (level === 'error' ? console.error : console.log)(line);
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

async function main() {
  const config = loadConfig();
  if (!config.token) {
    log('error', 'config.missing_token', { hint: 'задайте BOT_TELEGRAM_TOKEN в окружении' });
    process.exit(1);
  }

  const api =
    config.apiMode === 'http'
      ? createHttpApi({ baseUrl: config.apiBaseUrl, timeoutMs: config.apiTimeoutMs })
      : createMockApi();
  if (api.mode === 'mock') log('warn', 'api.mock', { hint: 'TRAINER_API_URL не задан — демо-режим' });

  const tg = createTelegram({ token: config.token, baseUrl: config.telegramApiBase });
  const dialog = createDialog({ api });
  const stop = new AbortController();
  const inFlight = new Set();
  let lastPollOk = Date.now();

  let healthServer = null;
  if (config.healthPort) {
    healthServer = http.createServer((req, res) => {
      const fresh = Date.now() - lastPollOk < (config.pollTimeoutSec + 60) * 1000;
      res.writeHead(fresh ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: fresh, api: api.mode, lastPollOk: new Date(lastPollOk).toISOString() }));
    });
    healthServer.listen(config.healthPort, '127.0.0.1');
  }

  const shutdown = (signal) => {
    if (stop.signal.aborted) return;
    log('info', 'shutdown', { signal });
    stop.abort();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  async function process1(message) {
    const chatId = message.chat.id;
    // Только личные чаты: в группах сессии участников смешивались бы в одном окне.
    if (message.chat.type !== 'private') return;
    const userId = `tg:${message.from?.id ?? chatId}`;
    const started = Date.now();
    try {
      const typing = setInterval(() => tg.sendTyping(chatId), 4_000);
      tg.sendTyping(chatId);
      let replies;
      try {
        replies = await dialog.handle({ chatId, userId, text: message.text });
      } finally {
        clearInterval(typing);
      }
      for (const text of replies) await tg.sendMessage(chatId, text);
      log('info', 'message.handled', { chat: chatId, ms: Date.now() - started });
    } catch (err) {
      log('error', 'message.failed', { chat: chatId, error: err?.message ?? String(err) });
    }
  }

  log('info', 'bot.started', { api: api.mode });
  let offset = 0;
  let backoffMs = 1_000;
  while (!stop.signal.aborted) {
    let updates;
    try {
      updates = await tg.getUpdates(offset, config.pollTimeoutSec, stop.signal);
      lastPollOk = Date.now();
      backoffMs = 1_000;
    } catch (err) {
      if (stop.signal.aborted) break;
      if (err instanceof TelegramError && err.code === 401) {
        log('error', 'telegram.unauthorized', { hint: 'неверный BOT_TELEGRAM_TOKEN' });
        process.exitCode = 1;
        break;
      }
      const waitMs = err instanceof TelegramError && err.retryAfter ? err.retryAfter * 1000 : backoffMs;
      // 409 — запущен второй экземпляр бота с тем же токеном.
      log('error', 'telegram.poll_failed', { error: err?.message ?? String(err), waitMs });
      await sleep(waitMs, stop.signal);
      backoffMs = Math.min(backoffMs * 2, 30_000);
      continue;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      if (!update.message) continue;
      const p = process1(update.message).finally(() => inFlight.delete(p));
      inFlight.add(p);
    }
  }

  // Даём текущим ответам до 10 секунд завершиться.
  await Promise.race([Promise.allSettled([...inFlight]), sleep(10_000)]);
  healthServer?.close();
  log('info', 'bot.stopped');
}

main().catch((err) => {
  log('error', 'bot.crashed', { error: err?.message ?? String(err) });
  process.exit(1);
});
