// Минимальный клиент Telegram Bot API без зависимостей (long polling).
// Токен входит только в URL запроса и никогда не попадает в тексты ошибок.

export const TELEGRAM_MAX_TEXT = 4096;
export const TELEGRAM_MAX_CAPTION = 1024;
// Bot API отдаёт ботам файлы до 20 МБ.
export const TELEGRAM_MAX_DOWNLOAD = 20 * 1024 * 1024;

export class TelegramError extends Error {
  constructor(method, code, description, retryAfter) {
    super(`Telegram ${method}: ${code} ${description}`);
    this.name = 'TelegramError';
    this.method = method;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

// Делит длинный текст по абзацам/строкам, чтобы уложиться в лимит Telegram.
export function splitText(text, limit = TELEGRAM_MAX_TEXT) {
  const parts = [];
  let rest = String(text);
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut <= 0) cut = rest.lastIndexOf('\n', limit);
    if (cut <= 0) cut = limit;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest.length || !parts.length) parts.push(rest);
  return parts;
}

// buttons: [[{ text, data }]] → inline_keyboard под сообщением.
export function inlineKeyboard(buttons) {
  if (!buttons?.length) return undefined;
  return { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) };
}

export function createTelegram({ token, fetchImpl = globalThis.fetch, baseUrl = 'https://api.telegram.org' }) {
  if (!token) throw new Error('BOT_TELEGRAM_TOKEN не задан');

  async function parse(method, res) {
    const data = await res.json().catch(() => null);
    if (!data?.ok) {
      throw new TelegramError(method, data?.error_code ?? res.status, data?.description ?? 'bad response', data?.parameters?.retry_after);
    }
    return data.result;
  }

  async function call(method, params, { timeoutMs = 15_000, signal } = {}) {
    const timeout = AbortSignal.timeout(timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      throw new TelegramError(method, 'NETWORK', err?.name ?? 'fetch failed');
    }
    return parse(method, res);
  }

  // multipart — только для загрузки фото с диска.
  async function upload(method, fields, fileField, file) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    form.set(fileField, new Blob([file.buffer], { type: file.mimeType ?? 'application/octet-stream' }), file.filename ?? 'file');
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/bot${token}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      throw new TelegramError(method, 'NETWORK', err?.name ?? 'fetch failed');
    }
    return parse(method, res);
  }

  return {
    getUpdates: (offset, timeoutSec, signal) =>
      call(
        'getUpdates',
        { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] },
        { timeoutMs: (timeoutSec + 10) * 1000, signal },
      ),
    // html: true — разметка Telegram HTML (жирный, раскрывающаяся цитата). Возвращает message_id последней части.
    async sendMessage(chatId, text, { buttons, html = false } = {}) {
      const parts = html ? [text] : splitText(text);
      let last = null;
      for (let i = 0; i < parts.length; i++) {
        const isLast = i === parts.length - 1;
        last = await call('sendMessage', {
          chat_id: chatId,
          text: parts[i],
          parse_mode: html ? 'HTML' : undefined,
          link_preview_options: { is_disabled: true },
          reply_markup: isLast ? inlineKeyboard(buttons) : undefined,
        });
      }
      return last?.message_id ?? null;
    },
    // Заменить или убрать кнопки под уже отправленным сообщением (markup: inline_keyboard или null).
    editButtons: (chatId, messageId, markup) =>
      call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: markup ?? { inline_keyboard: [] } }).catch(() => {}),
    pinMessage: (chatId, messageId) =>
      call('pinChatMessage', { chat_id: chatId, message_id: messageId, disable_notification: true }),
    // photo: file_id или URL (строка) либо { buffer, filename, mimeType }. Возвращает file_id для повторного использования.
    async sendPhoto(chatId, photo, { caption, buttons } = {}) {
      const fields = { chat_id: String(chatId), caption, reply_markup: inlineKeyboard(buttons) };
      const result = typeof photo === 'string'
        ? await call('sendPhoto', { ...fields, chat_id: chatId, photo })
        : await upload('sendPhoto', fields, 'photo', photo);
      return result?.photo?.at(-1)?.file_id ?? null;
    },
    answerCallback: (id, text) => call('answerCallbackQuery', { callback_query_id: id, text }).catch(() => {}),
    // Меню команд в клиенте Telegram: [[команда, описание], ...]
    setCommands: (commands) =>
      call('setMyCommands', { commands: commands.map(([command, description]) => ({ command, description })) }),
    sendTyping: (chatId) => call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {}),
    // Скачивание файла пользователя (голосовое, документ, фото).
    async downloadFile(fileId, maxBytes = TELEGRAM_MAX_DOWNLOAD) {
      const info = await call('getFile', { file_id: fileId });
      if (!info?.file_path) throw new TelegramError('getFile', 'NO_PATH', 'file is not available');
      if (info.file_size && info.file_size > maxBytes) throw new TelegramError('getFile', 'TOO_BIG', 'file is too big');
      let res;
      try {
        res = await fetchImpl(`${baseUrl}/file/bot${token}/${info.file_path}`, { signal: AbortSignal.timeout(60_000) });
      } catch (err) {
        throw new TelegramError('downloadFile', 'NETWORK', err?.name ?? 'fetch failed');
      }
      if (!res.ok) throw new TelegramError('downloadFile', res.status, 'download failed');
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > maxBytes) throw new TelegramError('downloadFile', 'TOO_BIG', 'file is too big');
      return { buffer, filePath: info.file_path };
    },
  };
}
