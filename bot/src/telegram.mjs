// Минимальный клиент Telegram Bot API без зависимостей (long polling).
// Токен входит только в URL запроса и никогда не попадает в тексты ошибок.

export const TELEGRAM_MAX_TEXT = 4096;

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

export function createTelegram({ token, fetchImpl = globalThis.fetch, baseUrl = 'https://api.telegram.org' }) {
  if (!token) throw new Error('BOT_TELEGRAM_TOKEN не задан');

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
    const data = await res.json().catch(() => null);
    if (!data?.ok) {
      throw new TelegramError(
        method,
        data?.error_code ?? res.status,
        data?.description ?? 'bad response',
        data?.parameters?.retry_after,
      );
    }
    return data.result;
  }

  return {
    getUpdates: (offset, timeoutSec, signal) =>
      call(
        'getUpdates',
        { offset, timeout: timeoutSec, allowed_updates: ['message'] },
        { timeoutMs: (timeoutSec + 10) * 1000, signal },
      ),
    async sendMessage(chatId, text) {
      for (const part of splitText(text)) {
        await call('sendMessage', { chat_id: chatId, text: part, link_preview_options: { is_disabled: true } });
      }
    },
    sendTyping: (chatId) => call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {}),
  };
}
