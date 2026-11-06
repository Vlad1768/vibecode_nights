// Диалог тренажёра в Telegram по docs/CONTRACT.md 1.0. Чистая логика без сети Telegram:
// на вход — сообщение, на выход — список текстов. Состояние хранится отдельно для каждой
// пары (чат, пользователь), поэтому сессии разных людей не смешиваются.
import { ApiError } from './api/errors.mjs';
import { MediaError, MEDIA_TEXTS } from './media.mjs';

export const MAX_INPUT_CHARS = 4000;

export const COMMANDS = Object.freeze([
  ['start', 'О боте и начало'],
  ['learn', 'Как подготовиться к питчу'],
  ['new', 'Новый питч'],
  ['again', 'Второй раунд по прошлому питчу'],
  ['result', 'Последняя оценка и советы'],
  ['how', 'Как считается оценка'],
  ['retry', 'Повторить запрос после сбоя'],
  ['cancel', 'Прервать раунд'],
  ['delete', 'Удалить мои питчи и ответы'],
  ['help', 'Список команд'],
]);

// Кнопки под сообщениями (callback_data ≤ 64 байт).
export const BUTTONS = {
  learn: { text: '📋 Открыть обучение', data: 'learn' },
  practice: { text: '🔥 Приступить к практике', data: 'practice' },
};

export const TEXTS = {
  // Подпись к фото приветствия: не длиннее 1024 знаков.
  welcome:
    'Злой инвестор — тренажёр защиты стартапа\n\n' +
    'Перед предзащитой или демо-днём здесь можно отрепетировать самое трудное — вопросы жюри. ' +
    'Наедине, без зрителей и без поблажек.\n\n' +
    'Как это работает:\n' +
    '1. Вы присылаете питч — текстом, голосовым или файлом.\n' +
    '2. Инвестор задаёт 5 вопросов по вашему проекту и вашим ответам. Отвечать можно текстом или голосом.\n' +
    '3. Вы получаете оценку по 10 критериям конкурса «Стартап как диплом» и 3 дела, которые можно успеть до выступления.\n' +
    '4. Через пару дней — второй раунд: видно, что стало лучше.\n\n' +
    'Один раунд — около 10 минут. Начните с обучения или сразу переходите к практике.',
  learn:
    '📋 Как подготовиться к питчу\n\n' +
    'Что должно быть готово:\n' +
    '1. Одна фраза о проекте — 4–8 слов. Человек со стороны должен суметь её повторить.\n' +
    '2. Проблема глазами клиента: кто именно, как решает задачу сейчас и сколько это ему стоит.\n' +
    '3. Доказательства: интервью, пилоты, продажи, возвраты — с числами. Одна главная метрика лучше десяти.\n' +
    '4. Деньги: кто платит, сколько стоит привлечь клиента, когда выход в ноль. Рынок — снизу вверх: клиенты × чек × частота.\n' +
    '5. Конкуренты есть всегда, хотя бы «как сейчас» и Excel. Отличие одной фразой: «В отличие от …, мы …».\n' +
    '6. Главный риск: самая рискованная гипотеза и как вы её проверите.\n' +
    '7. Команда: почему именно вы и что будет с проектом после защиты.\n\n' +
    'Как отвечать на вопросы:\n' +
    '• Одна фраза. Вторая — только чтобы вернуться к своей сильной стороне.\n' +
    '• Цифры и факты из прошлого, а не планы и сравнения «мы как Uber для…».\n' +
    '• Не знаете — скажите честно и как проверите. Это лучше долгого ухода от ответа.\n' +
    '• Заранее выберите 3 сильные стороны проекта и возвращайтесь к ним.\n\n' +
    'И главное: произнесите ответы на трудные вопросы вслух хотя бы раз. Для этого и нужна практика.',
  welcomeFallback: 'Сегодня вас слушает злой инвестор.',
  askPitch:
    'Пришлите питч одним сообщением — текстом, голосовым или файлом (PDF, DOCX, PPTX, TXT, фото слайда).\n\n' +
    'Что важно указать: проблема и для кого, решение, что уже сделано — с цифрами, как зарабатываете.',
  help: 'Команды:\n' + COMMANDS.map(([c, d]) => `/${c} — ${d}`).join('\n'),
  notText: 'Такое сообщение я не читаю. Пришлите текст, голосовое или файл.',
  answerNoFile: 'Ответ на вопрос пришлите текстом или голосовым.',
  emptyInput: 'Сообщение пустое. Напишите текстом или запишите голосовое.',
  tooLong: `Слишком длинно: уложитесь в ${MAX_INPUT_CHARS} символов.`,
  busy: 'Ещё обдумываю прошлое сообщение, подождите ответа.',
  cancelled: 'Раунд прерван. /new — начать заново.',
  nothingToRetry: 'Повторять нечего. /new — новый раунд.',
  noResult: 'Оценки пока нет: пройдите раунд до конца. /new — начать.',
  noAgain: 'Второй раунд — после первого. Пришлите питч, чтобы начать.',
  deleted: 'Ваши питчи и ответы удалены. /start — начать заново.',
  howFallback: 'Каждый из 10 критериев «Стартап как диплом» получает уровень от 0 до 3. Итог из 100 считает код по весам.',
  demo: '⚠️ Модель пока не подключена: вопросы и оценка сейчас из заготовок, а не по вашему питчу всерьёз.',
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

// Ответ диалога: строка или объект { text, buttons?, photo? } (photo: 'welcome' — фото приветствия, если задано).
export function createDialog({ api, media = null }) {
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

  // Начало практики: карточка инвестора и просьба прислать питч.
  async function startPractice(s) {
    reset(s, 'pitch');
    const p = await persona();
    const card = p ? `Сегодня вас слушает ${p.name}, ${String(p.title ?? '').toLowerCase()}.\n\n${p.intro}` : TEXTS.welcomeFallback;
    return [`${card}\n\n${TEXTS.askPitch}`];
  }

  const welcome = () => [{ photo: 'welcome', text: TEXTS.welcome, buttons: [[BUTTONS.learn], [BUTTONS.practice]] }];
  const learn = () => [{ text: TEXTS.learn, buttons: [[BUTTONS.practice]] }];

  async function command(s, userId, name) {
    switch (name) {
      case '/start':
        reset(s, 'idle');
        return welcome();
      case '/learn':
        return learn();
      case '/new':
        return startPractice(s);
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

  // Голосовое или файл → текст. Возвращает { text, note } или { reply } с сообщением об ошибке.
  async function readMedia(s, item) {
    if (s.phase === 'answer' && !['voice', 'audio'].includes(item.kind)) return { reply: [TEXTS.answerNoFile] };
    if (!media) return { reply: [MEDIA_TEXTS.NO_RECOGNITION] };
    try {
      const r = await media.toText(item);
      const quote = r.text.length > 300 ? `${r.text.slice(0, 300)}…` : r.text;
      const note = r.source === 'voice'
        ? `🎙 Расслышал так:\n«${quote}»`
        : `📄 Взял текст из файла (${r.text.length} знаков)${r.shortened ? ', длинный — сократил до сути, проверьте' : ''}:\n«${quote}»`;
      return { text: r.text, note };
    } catch (err) {
      return { reply: [err instanceof MediaError ? err.message : MEDIA_TEXTS.FAILED] };
    }
  }

  async function handleUnlocked(s, userId, input) {
    if (input.callback === 'learn') return learn();
    if (input.callback === 'practice') return startPractice(s);
    if (input.callback) return [TEXTS.unknownCommand];

    let text = input.text;
    let note = null;
    if (input.media) {
      const r = await readMedia(s, input.media);
      if (r.reply) return r.reply;
      ({ text, note } = r);
    } else if (typeof text !== 'string') {
      return [TEXTS.notText];
    }
    const trimmed = text.trim();
    if (!note && trimmed.startsWith('/')) return command(s, userId, trimmed.split(/[\s@]/)[0].toLowerCase());
    if (!trimmed) return [TEXTS.emptyInput];
    if (trimmed.length > MAX_INPUT_CHARS) return note ? [note, TEXTS.tooLong] : [TEXTS.tooLong];

    const out = note ? [note] : [];
    if (s.phase === 'answer') {
      return [...out, ...(await callApi(s, userId, { kind: 'answer', sessionId: s.sessionId, step: s.step, text: trimmed }))];
    }
    // idle или ожидание питча: текст считается описанием стартапа.
    return [...out, ...(await callApi(s, userId, { kind: 'start', text: trimmed }))];
  }

  return {
    // userId — строка вида "tg:<id>" (контракт, раздел 6).
    // input: { chatId, userId, text?, media?, callback? }
    async handle({ chatId, userId, ...input }) {
      const s = stateOf(keyOf(chatId, userId));
      if (s.busy) return [TEXTS.busy];
      s.busy = true;
      try {
        return await handleUnlocked(s, userId, input);
      } finally {
        s.busy = false;
      }
    },
    // Для тестов и диагностики.
    _states: states,
  };
}
