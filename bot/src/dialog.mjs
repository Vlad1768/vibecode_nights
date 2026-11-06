// Диалог тренажёра в Telegram. Чистая логика без сети: на вход — сообщение,
// на выход — список текстов для ответа. Состояние хранится отдельно для каждой
// пары (чат, пользователь), поэтому сессии разных людей не смешиваются.
import { ApiError } from './api/errors.mjs';

export const MAX_INPUT_CHARS = 4000;

export const TEXTS = {
  welcome:
    'Я — злой инвестор. Задам 5 неудобных вопросов по вашему стартапу, поставлю оценку ' +
    'по 10 критериям «Стартап как диплом» и дам 3 совета, которые можно успеть до выступления.\n\n' +
    'Пришлите описание стартапа одним сообщением: проблема, решение, для кого, что уже сделано и цифры.',
  help:
    'Команды:\n/start — начать заново\n/new — новый раунд\n/retry — повторить последний запрос после ошибки\n' +
    '/cancel — прервать раунд\n/help — эта справка',
  askPitch: 'Пришлите описание стартапа одним сообщением.',
  notText: 'Я понимаю только текст. Пришлите описание или ответ сообщением.',
  emptyInput: 'Сообщение пустое. Напишите текстом.',
  tooLong: `Слишком длинно: уложитесь в ${MAX_INPUT_CHARS} символов.`,
  busy: 'Ещё обдумываю прошлое сообщение, подождите ответа.',
  cancelled: 'Раунд прерван. /new — начать новый.',
  nothingToRetry: 'Повторять нечего. /new — новый раунд.',
  demo: '(демо-режим: вопросы и оценка условные, AI-ядро не подключено)',
  unknownCommand: 'Не знаю такой команды. /help — список команд.',
};

const ERROR_TEXTS = {
  EMPTY_PITCH: 'Описание пустое. Расскажите о проекте: проблема, решение, клиент, цифры.',
  PITCH_TOO_LONG: 'Описание слишком длинное, сократите его.',
  EMPTY_ANSWER: 'Ответ пустой. Ответьте на вопрос текстом.',
  ANSWER_TOO_LONG: 'Ответ слишком длинный, сократите его.',
  SESSION_NOT_FOUND: 'Раунд не найден или уже завершён. Пришлите описание стартапа, чтобы начать заново.',
  RATE_LIMITED: 'Слишком много запросов. Подождите минуту и отправьте /retry.',
};
const RETRY_TEXT = 'Не получилось получить ответ инвестора. Ваш ответ сохранён — отправьте /retry.';

export function formatQuestion({ step, totalSteps, question }) {
  return `Вопрос ${step}/${totalSteps}\n\n${question}`;
}

export function formatResult(result) {
  const lines = [`Итог: ${result.total}/${result.max}`, ''];
  result.criteria.forEach((c, i) => {
    const comment = c.comment ? ` — ${c.comment}` : '';
    lines.push(`${i + 1}. ${c.name}: ${c.score}/${c.max}${comment}`);
  });
  lines.push('', 'Что сделать до выступления:');
  result.advice.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
  lines.push('', 'Новый раунд — /new');
  return lines.join('\n');
}

export function createDialog({ api }) {
  // key → { phase: 'idle'|'pitch'|'answer', sessionId, pending, busy }
  const states = new Map();
  const isDemo = api.mode === 'mock';

  const keyOf = (chatId, userId) => `${chatId}:${userId}`;
  function stateOf(key) {
    let s = states.get(key);
    if (!s) {
      s = { phase: 'idle', sessionId: null, pending: null, busy: false };
      states.set(key, s);
    }
    return s;
  }
  function reset(s, phase) {
    s.phase = phase;
    s.sessionId = null;
    s.pending = null;
  }

  async function callApi(s, userId, request) {
    s.pending = request;
    try {
      const data =
        request.kind === 'start'
          ? await api.start({ userId, pitch: request.text })
          : await api.answer({ sessionId: s.sessionId, userId, answer: request.text });
      s.pending = null;
      if (data.done) {
        reset(s, 'idle');
        return [formatResult(data.result)];
      }
      s.phase = 'answer';
      s.sessionId = data.sessionId;
      const out = [formatQuestion(data)];
      if (request.kind === 'start' && isDemo) out.unshift(TEXTS.demo);
      return out;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'BAD_RESPONSE';
      if (err instanceof ApiError && !err.retryable) {
        s.pending = null;
        if (code === 'SESSION_NOT_FOUND') reset(s, 'pitch');
        return [ERROR_TEXTS[code] ?? RETRY_TEXT];
      }
      // Повторяемая ошибка: состояние и введённый текст сохраняются для /retry.
      return [ERROR_TEXTS[code] ?? RETRY_TEXT];
    }
  }

  async function handleUnlocked(s, userId, text) {
    if (typeof text !== 'string') return [TEXTS.notText];
    const trimmed = text.trim();
    const command = trimmed.startsWith('/') ? trimmed.split(/[\s@]/)[0].toLowerCase() : null;

    switch (command) {
      case null:
        break;
      case '/start':
      case '/new':
        reset(s, 'pitch');
        return [TEXTS.welcome];
      case '/help':
        return [TEXTS.help];
      case '/cancel':
        reset(s, 'idle');
        return [TEXTS.cancelled];
      case '/retry':
        if (!s.pending) return [TEXTS.nothingToRetry];
        return callApi(s, userId, s.pending);
      default:
        return [TEXTS.unknownCommand];
    }

    if (!trimmed) return [TEXTS.emptyInput];
    if (trimmed.length > MAX_INPUT_CHARS) return [TEXTS.tooLong];

    if (s.phase === 'answer') return callApi(s, userId, { kind: 'answer', text: trimmed });
    // idle или ожидание описания: текст считается описанием стартапа.
    return callApi(s, userId, { kind: 'start', text: trimmed });
  }

  return {
    // userId — строка вида "tg:<id>": API различает пользователей разных каналов.
    async handle({ chatId, userId, text }) {
      const s = stateOf(keyOf(chatId, userId));
      if (s.busy) return [TEXTS.busy];
      s.busy = true;
      try {
        return await handleUnlocked(s, userId, text);
      } finally {
        s.busy = false;
      }
    },
    // Для тестов и диагностики.
    _states: states,
  };
}
