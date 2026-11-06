// Точка входа: long polling Telegram → диалог → API тренажёра.
// Запуск: BOT_TELEGRAM_TOKEN=... node bot/src/main.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { createTelegram, TelegramError } from './telegram.mjs';
import { createDialog, COMMANDS } from './dialog.mjs';
import { createMockApi } from './api/mock.mjs';
import { createHttpApi } from './api/http.mjs';
import { createMediaReader } from './media.mjs';
import { inputFromMessage } from './input.mjs';
import { createStore } from './store.mjs';
import { createCoach } from './coach.mjs';
import { loadPersonas } from './personas.mjs';
import { buttonsAfterPress } from './buttons.mjs';
import { createLlmClientFromEnv, llmProvider } from '../../integrations/llm.mjs';

// Картинки инвесторов от Ники (content/investor/assets): id персонажа из API → файл.
const PERSONA_IMAGES = { angel: '01-angel.jpg', corporate: '02-corporate.jpg', grant: '03-grant.jpg', venture: '04-venture.jpg' };
const INVESTOR_ASSETS = fileURLToPath(new URL('../../content/investor/assets/', import.meta.url));
function personaPhotoSource(id) {
  const name = PERSONA_IMAGES[id];
  const path = name && `${INVESTOR_ASSETS}${name}`;
  return path && existsSync(path) ? { path, filename: name, mimeType: 'image/jpeg' } : null;
}

// Фото приветствия: BOT_WELCOME_PHOTO (file_id или https-ссылка) или файл bot/assets/welcome.{jpg,jpeg,png}.
const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url));
function welcomePhotoSource(env) {
  if (env.BOT_WELCOME_PHOTO) return env.BOT_WELCOME_PHOTO.trim();
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const path = `${ASSETS}welcome.${ext}`;
    if (existsSync(path)) return { path, filename: `welcome.${ext}`, mimeType: ext === 'png' ? 'image/png' : 'image/jpeg' };
  }
  return null;
}


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
  // Распознавание голоса, PDF и фото — той же моделью, что у API: OPENAI_API_KEY (ChatGPT) или GEMINI_API_KEY.
  let llm = null;
  try {
    llm = createLlmClientFromEnv(process.env, { timeoutMs: 30_000, maxOutputTokens: 4096 });
  } catch (err) {
    log('warn', 'llm.config_invalid', { error: err?.code ?? err?.message });
  }
  if (!llm) log('warn', 'media.no_recognition', { hint: 'нет OPENAI_API_KEY/GEMINI_API_KEY — голос, PDF и фото не распознаются' });
  const media = createMediaReader({ gemini: llm, download: (fileId, max) => tg.downloadFile(fileId, max) });
  // BOT_DATA_DIR — куда сохранять прошлые раунды и напоминания (на сервере /var/lib/investor-bot).
  const store = createStore({ dir: process.env.BOT_DATA_DIR || null });
  // Тренер (оценка питча и ответов по ТЗ) работает на той же модели — без ключа бот честно скажет, что недоступен.
  const coach = llm ? createCoach({ llm }) : null;
  // Персонажи Ники: для каждой новой сессии — случайный (content/investor/investors.json).
  const personas = loadPersonas();
  const dialog = createDialog({ api, coach, media, store, personas });

  const welcomeSource = welcomePhotoSource(process.env);
  const photoIds = new Map(); // путь к файлу → file_id Telegram после первой загрузки
  // pressed — сообщение с нажатой кнопкой (для «Закрепить план» и «Сделал ✔»).
  async function sendReply(chatId, reply, pressed) {
    if (typeof reply === 'string') return tg.sendMessage(chatId, reply);
    if (reply.action === 'pin') {
      if (pressed) await tg.pinMessage(chatId, pressed.message_id).catch((err) => log('warn', 'telegram.pin_failed', { error: err?.message }));
      return;
    }
    if (reply.action === 'markDone') return; // кнопку уже поменяли в buttonsAfterPress
    const source = reply.photo === 'welcome' ? welcomeSource
      : reply.photo === 'persona' && reply.imagePath && existsSync(reply.imagePath)
        ? { path: reply.imagePath, filename: reply.imagePath.split('/').pop(), mimeType: 'image/jpeg' }
        : reply.photo === 'persona' ? personaPhotoSource(reply.personaId) : null;
    if (source) {
      try {
        const key = typeof source === 'string' ? source : source.path;
        const photo = typeof source === 'string' ? source : photoIds.get(key) ?? { buffer: await readFile(source.path), filename: source.filename, mimeType: source.mimeType };
        // Подпись к фото — до 1024 знаков; длиннее — фото отдельно, текст с кнопками следом.
        const fits = reply.text.length <= 1024;
        const id = await tg.sendPhoto(chatId, photo, fits ? { caption: reply.text, buttons: reply.buttons } : {});
        if (id && typeof source !== 'string') photoIds.set(key, id);
        if (fits) return;
      } catch (err) {
        log('warn', 'photo.failed', { kind: reply.photo, error: err?.message });
      }
    }
    return tg.sendMessage(chatId, reply.text, { buttons: reply.buttons, html: reply.html });
  }
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

  async function process1(chat, from, input, callback) {
    const chatId = chat.id;
    // Только личные чаты: в группах сессии участников смешивались бы в одном окне.
    if (chat.type !== 'private') return;
    const userId = `tg:${from?.id ?? chatId}`;
    const started = Date.now();
    try {
      if (callback) {
        tg.answerCallback(callback.id);
        // Нажатая кнопка гаснет или меняется, чтобы её нельзя было нажать дважды (§10.2).
        const markup = buttonsAfterPress(callback.message?.reply_markup, input.callback);
        if (markup !== undefined) tg.editButtons(chatId, callback.message.message_id, markup);
      }
      const typing = setInterval(() => tg.sendTyping(chatId), 4_000);
      tg.sendTyping(chatId);
      let replies;
      try {
        replies = await dialog.handle({ chatId, userId, name: from?.first_name, ...input });
      } finally {
        clearInterval(typing);
      }
      for (const reply of replies) await sendReply(chatId, reply, callback?.message);
      log('info', 'message.handled', { chat: chatId, kind: input.callback ? 'button' : input.media?.kind ?? 'text', ms: Date.now() - started });
    } catch (err) {
      log('error', 'message.failed', { chat: chatId, error: err?.message ?? String(err) });
    }
  }

  log('info', 'bot.started', { personas: personas.length, api: api.mode, recognition: llm ? llmProvider(process.env) : false, welcomePhoto: !!welcomeSource });
  tg.setCommands(COMMANDS).catch((err) => log('warn', 'telegram.set_commands_failed', { error: err?.message }));
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
      let p;
      if (update.message) {
        p = process1(update.message.chat, update.message.from, inputFromMessage(update.message));
      } else if (update.callback_query?.message) {
        const cq = update.callback_query;
        p = process1(cq.message.chat, cq.from, { callback: String(cq.data ?? '') }, cq);
      } else continue;
      p = p.finally(() => inFlight.delete(p));
      inFlight.add(p);
    }
  }

  // Даём текущим ответам до 10 секунд завершиться.
  await Promise.race([Promise.allSettled([...inFlight]), sleep(10_000)]);
  store.flush();
  healthServer?.close();
  log('info', 'bot.stopped');
}

main().catch((err) => {
  log('error', 'bot.crashed', { error: err?.message ?? String(err) });
  process.exit(1);
});
