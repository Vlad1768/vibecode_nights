// Диалог тренажёра в Telegram по docs/CONTRACT.md 1.0. Чистая логика без сети Telegram:
// на вход — сообщение, на выход — список текстов. Состояние хранится отдельно для каждой
// пары (чат, пользователь), поэтому сессии разных людей не смешиваются.
import { ApiError } from './api/errors.mjs';

export const MAX_INPUT_CHARS = 4000;

export const COMMANDS = Object.freeze([
  ['start', 'Карточка инвестора и начало'],
  ['new', 'Новый питч'],
  ['again', 'Второй раунд по прошлому питчу'],
  ['result', 'Последняя оценка и советы'],
  ['how', 'Как считается оценка'],
  ['retry', 'Повторить запрос после сбоя'],
  ['cancel', 'Прервать раунд'],
  ['delete', 'Удалить мои питчи и ответы'],
  ['help', 'Список команд'],
]);

export const TEXTS = {
  welcomeFallback:
    'Я — злой инвестор. Задам 5 неудобных вопросов по вашему стартапу, поставлю оценку ' +
    'по 10 критериям «Стартап как диплом» и дам 3 совета, которые можно успеть до выступления.',
  askPitch:
    'Вставьте описание стартапа одним сообщением: проблема и для кого, решение, что уже сделано ' +
    'с цифрами, как зарабатываете. До 4000 знаков. Файлы и ссылки я не открываю.',
  help: 'Команды:\n' + COMMANDS.map(([c, d]) => `/${c} — ${d}`).join('\n'),
  notText: 'Я понимаю только текст: файлы, фото и стикеры не открываю. Напишите сообщением.',
  emptyInput: 'Сообщение пустое. Напишите текстом.',
  tooLong: `Слишком длинно: уложитесь в ${MAX_INPUT_CHARS} символов.`,
  busy: 'Ещё обдумываю прошлое сообщение, подождите ответа.',
  cancelled: 'Раунд прерван. /new — начать заново.',
  nothingToRetry: 'Повторять нечего. /new — новый раунд.',
  noResult: 'Оценки пока нет: пройдите раунд до конца. /new — начать.',
  noAgain: 'Второй раунд — после первого. Пришлите питч, чтобы начать.',
  deleted: 'Ваши питчи и ответы удалены. /start — начать заново.',
  howFallback: 'Каждый из 10 критериев «Стартап как диплом» получает уровень от 0 до 3. Итог из 100 считает код по весам.',
  demo: '(демо-режим: ответы из заготовок, модель не подключена)',
  unknownCommand: 'Не знаю такой команды. /help — список команд.',
  retryHint: 'Ваш ответ сохранён — отправьте /retry.',
};

// Тексты на случай, если API не прислал своё сообщение (внутренние коды клиента).
const FALLBACK_ERRORS = {
  BAD_REQUEST: 'Что-то пошло не так. Попробуйте /new.',
  RATE_LIMITED: 'Слишком много запросов. Подождите минуту и отправьте /retry.',
  NETWORK: 'Инвестор недоступен. Ваш ответ сохранён — отправьте /retry.',
  TIMEOUT: 'Инвестор задумался слишком надолго. Ваш ответ сохранён — отправьте /retry.',
  BAD_RESPONSE: 'Не получилось разобрать ответ инвестора. Ваш ответ сохранён — отправьте /retry.',
  AI_UNAVAILABLE: 'Инвестор задумался. Ваш ответ сохранён — отправьте /retry.',
};

const LEVELS = ['нет данных', 'заявлено', 'есть цифры', 'подтверждено'];
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(n).replace('.', ','));

export function formatFacts(facts) {
  if (!facts) return null;
  const lines = ['Что я понял из питча:'];
  for (const k of facts.known ?? []) lines.push(`✅ ${k}`);
  for (const m of facts.missing ?? []) lines.push(`❌ нет: ${m}`);
  lines.push('Других цифр у меня нет, и выдумывать их я не буду. Если что-то не так — /new и поправьте питч.');
  return lines.join('\n');
}

export function formatQuestion(step) {
  const topic = step.topic ? ` · ${step.topic}` : '';
  return `Вопрос ${step.step}/${step.totalSteps}${topic}\n\n${step.question}`;
}

// Ответ на Step: реакция и notice перед вопросом (контракт, раздел 5).
export function formatStep(step, { withFacts = false } = {}) {
  const out = [];
  if (withFacts) {
    if (step.demo) out.push(TEXTS.demo);
    const facts = formatFacts(step.facts);
    if (facts) out.push(facts);
  }
  const head = [step.reaction, step.notice].filter(Boolean).join('\n\n');
  out.push(head ? `${head}\n\n${formatQuestion(step)}` : formatQuestion(step));
  return out;
}

export function formatResult(result) {
  const head = result.previousTotal != null
    ? `Итог: ${result.previousTotal} → ${result.total} из ${result.max}`
    : `Итог: ${result.total} из ${result.max}`;
  const lines = [head];
  if (result.summary) {
    lines.push('', `Сильное: ${result.summary.strong}`, `Слабое: ${result.summary.weak}`);
  }
  lines.push('', 'По критериям:');
  result.criteria.forEach((c, i) => {
    const level = Number.isInteger(c.level) ? ` (${LEVELS[c.level] ?? c.level})` : '';
    const comment = c.comment ? ` — ${c.comment}` : '';
    lines.push(`${c.id ?? i + 1}. ${c.name}: ${fmt(c.score)}/${fmt(c.max)}${level}${comment}`);
  });
  lines.push('', 'Что сделать до выступления:');
  result.advice.forEach((a, i) => lines.push(`${i + 1}. ${typeof a === 'string' ? a : a.text}`));
  lines.push('', '/again — второй раунд по этому питчу, /new — новый питч.');
  return lines.join('\n');
}

function errorText(err) {
  if (!(err instanceof ApiError)) return FALLBACK_ERRORS.BAD_RESPONSE;
  let text = err.fromServer && err.message ? err.message : FALLBACK_ERRORS[err.code] ?? err.message;
  if (err.missing.length) text += '\n\nНе хватает:\n' + err.missing.map((m) => `• ${m}`).join('\n');
  if (err.code === 'RATE_LIMITED' && err.retryAfterSec) text += `\n\nПовторите через ${err.retryAfterSec} с: /retry.`;
  else if (err.retryable && err.fromServer) text += `\n\n${TEXTS.retryHint}`;
  return text;
}

export function createDialog({ api }) {
  // key → { phase: 'idle'|'pitch'|'answer', sessionId, step, pending, busy, lastDone, lastResult }
  const states = new Map();
  let personaCache = null;

  const keyOf = (chatId, userId) => `${chatId}:${userId}`;
  function stateOf(key) {
    let s = states.get(key);
    if (!s) {
      s = { phase: 'idle', sessionId: null, step: null, pending: null, busy: false, lastDone: null, lastResult: null };
      states.set(key, s);
    }
    return s;
  }
  function reset(s, phase) {
    s.phase = phase;
    s.sessionId = null;
    s.step = null;
    s.pending = null;
  }

  async function persona() {
    if (personaCache) return personaCache;
    try {
      personaCache = await api.persona();
    } catch {
      return null; // карточка не критична: покажем общий текст
    }
    return personaCache;
  }

  // Применяет ответ API (Step или Done) к состоянию и возвращает тексты.
  function applyView(s, data, { withFacts = false, pitch } = {}) {
    if (data.done) {
      s.lastDone = { sessionId: data.sessionId, pitch: pitch ?? s.lastDone?.pitch ?? s.pitch };
      s.lastResult = data.result;
      reset(s, 'idle');
      return [formatResult(data.result)];
    }
    s.phase = 'answer';
    s.sessionId = data.sessionId;
    s.step = data.step;
    return formatStep(data, { withFacts });
  }

  async function callApi(s, userId, request) {
    s.pending = request;
    try {
      let data;
      if (request.kind === 'start') {
        data = await api.start({ userId, pitch: request.text, previousSessionId: request.previousSessionId ?? null });
        s.pitch = request.text;
      } else {
        data = await api.answer({ sessionId: request.sessionId, userId, step: request.step, answer: request.text });
      }
      s.pending = null;
      return applyView(s, data, { withFacts: request.kind === 'start', pitch: s.pitch });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'BAD_RESPONSE';
      if (err instanceof ApiError && err.retryable) return [errorText(err)]; // pending сохранён для /retry
      s.pending = null;
      if (code === 'STEP_MISMATCH' || code === 'SESSION_DONE') return resync(s, userId, request.sessionId);
      if (code === 'SESSION_NOT_FOUND') reset(s, 'pitch');
      return [errorText(err)];
    }
  }

  // Ответ уже принят или раунд закончен: берём актуальное состояние из API.
  async function resync(s, userId, sessionId) {
    try {
      const data = await api.get({ sessionId, userId });
      return applyView(s, data);
    } catch (err) {
      reset(s, 'pitch');
      return [errorText(err)];
    }
  }

  async function command(s, userId, name) {
    switch (name) {
      case '/start': {
        reset(s, 'pitch');
        const p = await persona();
        return [p ? `${p.intro}\n\n${TEXTS.askPitch}` : `${TEXTS.welcomeFallback}\n\n${TEXTS.askPitch}`];
      }
      case '/new':
        reset(s, 'pitch');
        return [TEXTS.askPitch];
      case '/again':
        if (!s.lastDone) return [TEXTS.noAgain];
        reset(s, 'pitch');
        return callApi(s, userId, { kind: 'start', text: s.lastDone.pitch, previousSessionId: s.lastDone.sessionId });
      case '/result':
        return s.lastResult ? [formatResult(s.lastResult)] : [TEXTS.noResult];
      case '/how': {
        const p = await persona();
        return [p?.howScored ?? TEXTS.howFallback];
      }
      case '/retry':
        if (!s.pending) return [TEXTS.nothingToRetry];
        return callApi(s, userId, s.pending);
      case '/cancel':
        reset(s, 'idle');
        return [TEXTS.cancelled];
      case '/delete':
        try {
          await api.deleteUser({ userId });
        } catch (err) {
          return [errorText(err)];
        }
        reset(s, 'idle');
        s.lastDone = null;
        s.lastResult = null;
        s.pitch = null;
        return [TEXTS.deleted];
      case '/help':
        return [TEXTS.help];
      default:
        return [TEXTS.unknownCommand];
    }
  }

  async function handleUnlocked(s, userId, text) {
    if (typeof text !== 'string') return [TEXTS.notText];
    const trimmed = text.trim();
    if (trimmed.startsWith('/')) return command(s, userId, trimmed.split(/[\s@]/)[0].toLowerCase());
    if (!trimmed) return [TEXTS.emptyInput];
    if (trimmed.length > MAX_INPUT_CHARS) return [TEXTS.tooLong];

    if (s.phase === 'answer') {
      return callApi(s, userId, { kind: 'answer', sessionId: s.sessionId, step: s.step, text: trimmed });
    }
    // idle или ожидание питча: текст считается описанием стартапа.
    return callApi(s, userId, { kind: 'start', text: trimmed });
  }

  return {
    // userId — строка вида "tg:<id>" (контракт, раздел 6).
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
