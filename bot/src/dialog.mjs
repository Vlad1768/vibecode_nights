// Диалог тренажёра в Telegram по docs/CONTRACT.md 1.0 и docs/BOT_SCENARIO.md §2, §10.
// Чистая логика без сети Telegram: на вход — сообщение или нажатие кнопки, на выход — список ответов.
// Ответ: строка или { text, buttons?, html?, photo?, action? }.
// Состояние — отдельно для каждой пары (чат, пользователь): сессии разных людей не смешиваются.
import { ApiError } from './api/errors.mjs';
import { MediaError, MEDIA_TEXTS } from './media.mjs';
import { createStore } from './store.mjs';

export const MAX_INPUT_CHARS = 4000;
export const REMIND_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

// Меню Telegram (кнопка «Меню»). В текстах сообщений команды не упоминаем.
export const COMMANDS = Object.freeze([
  ['start', 'О боте и начало'],
  ['new', 'Новый питч'],
  ['learn', 'Как подготовиться к питчу'],
  ['result', 'Последняя оценка и советы'],
  ['how', 'Как ставится оценка'],
  ['delete', 'Удалить мои данные'],
  ['help', 'Что умеет бот'],
]);

const b = (text, data) => ({ text, data });
export const BUTTONS = {
  practice: b('🔥 Приступить к практике', 'practice'),
  learn: b('📋 Открыть обучение', 'learn'),
  example: b('👀 Посмотреть на примере', 'example'),
  template: b('📝 Шаблон питча', 'template'),
  go: b('✅ Всё верно, поехали', 'go'),
  fix: b('✏️ Поправить питч', 'fix'),
  idk: b('🤷 Не знаю ответа', 'idk'),
  pause: b('⏸ Пауза', 'pause'),
  retry: b('🔁 Повторить', 'retry'),
  advice: b('✅ Мои 3 дела', 'advice'),
  criteria: b('📊 Разбор по 10 критериям', 'criteria'),
  again: b('🔄 Второй раунд', 'again'),
  newPitch: b('🆕 Новый питч', 'new'),
  remind: b('⏰ Напомнить через 2 дня', 'remind'),
  pin: b('📌 Закрепить план', 'pin'),
  how: b('❔ Как ты оцениваешь', 'how'),
  done: (i) => b(`✔ Дело ${i}`, `done:${i}`),
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
    'Один раунд — около 10 минут. Питч видите только вы.',
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
  example:
    '👀 Как выглядит раунд — на примере питча «Смена» (обучение бариста в сетях кофеен)\n\n' +
    '▰▱▱▱▱ Вопрос 1/5 · Клиент\n' +
    '«Кто в сети из 40 точек подписывает счёт на 1 500 ₽ за бариста? Должность и что у него болит».\n\n' +
    'Ответ: «Операционный директор: у него текучка и простой новых точек».\n' +
    'Инвестор: «Должность назвали — хорошо. А разговаривали с ним или додумываете?»\n\n' +
    '…ещё 4 вопроса: доказательства, деньги, конкуренты, что будет после диплома.\n\n' +
    '🏁 Итог: 53 из 100. Сильное — боль из своего опыта и реальный пилот. Слабое — неизвестно, сколько стоит контент для одной сети.\n\n' +
    'Одно из трёх дел: «За 2 дня спросите управляющего пилотной сети, кто подпишет договор на 5 точек. Готово, когда знаете должность и одно условие».\n\n' +
    'Это пример для наглядности, цифры условные.',
  welcomeFallback: 'Сегодня вас слушает злой инвестор.',
  askPitch:
    'Пришлите питч одним сообщением — текстом, голосовым или файлом (PDF, DOCX, PPTX, TXT, фото слайда).\n\n' +
    'Что важно указать: проблема и для кого, решение, что уже сделано — с цифрами, как зарабатываете.',
  template:
    'Скопируйте и заполните — достаточно 4–8 предложений:\n\n' +
    'Проблема и для кого: …\nКак её решают сейчас и сколько это стоит: …\nНаше решение: …\n' +
    'Что уже сделано (цифры: интервью, пилоты, продажи): …\nКак зарабатываем: …',
  help:
    'Что умеет бот:\n• репетиция защиты: питч → 5 вопросов → оценка и 3 дела;\n• обучение: как подготовиться к питчу;\n' +
    '• второй раунд по тому же питчу с «было → стало».\n\nВсё делается кнопками под сообщениями. В меню — те же действия.',
  confirm: 'Если всё верно — начинаем. Если что-то не так — поправьте питч и пришлите заново.',
  fix: 'Пришлите исправленный питч одним сообщением — текстом, голосовым или файлом.',
  pause: '⏸ Пауза. Вопрос никуда не денется: когда будете готовы — просто ответьте на него.',
  idkAnswer: 'Не знаю ответа на этот вопрос.',
  notText: 'Такое сообщение я не читаю. Пришлите текст, голосовое или файл.',
  answerNoFile: 'Ответ на вопрос пришлите текстом или голосовым.',
  emptyInput: 'Сообщение пустое. Напишите текстом или запишите голосовое.',
  tooLong: `Слишком длинно: уложитесь в ${MAX_INPUT_CHARS} символов.`,
  busy: 'Ещё обдумываю прошлое сообщение, подождите ответа.',
  nothingToRetry: 'Повторять нечего — можно начать новый раунд.',
  noResult: 'Оценки пока нет: пройдите раунд до конца.',
  noAgain: 'Второй раунд — после первого. Пришлите питч, чтобы начать.',
  deleted: 'Ваши питчи, ответы и напоминания удалены.',
  howFallback: 'Каждый из 10 критериев «Стартап как диплом» получает уровень от 0 до 3. Итог из 100 считает код по весам, а не модель.',
  demo: '⚠️ Модель пока не подключена: вопросы и оценка сейчас из заготовок, а не по вашему питчу всерьёз.',
  remindSet: '⏰ Напомню через 2 дня — тогда пройдём второй раунд и посмотрим, что изменилось.',
  remindNoRound: 'Напоминание про второй раунд можно поставить после первого раунда.',
  reminder: '⏰ Прошло два дня. Сделали хоть одно из трёх дел? Давайте второй раунд — посмотрим, вырастет ли балл.',
  pinned: '📌 План закреплён вверху чата.',
  unknownCommand: 'Не понял. Воспользуйтесь кнопками под сообщениями или меню.',
};

const LEVELS = ['нет данных', 'заявлено', 'есть цифры', 'подтверждено'];
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(n).replace('.', ','));
export const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const progressBar = (step, total) => '▰'.repeat(Math.max(0, Math.min(total, step))) + '▱'.repeat(Math.max(0, total - step));

// Тексты на случай, если API не прислал своё сообщение (внутренние коды клиента).
const FALLBACK_ERRORS = {
  BAD_REQUEST: 'Что-то пошло не так. Начните новый раунд.',
  RATE_LIMITED: 'Слишком много запросов. Подождите минуту и повторите.',
  NETWORK: 'Инвестор недоступен. Ваш ответ сохранён — нажмите «Повторить».',
  TIMEOUT: 'Инвестор задумался слишком надолго. Ваш ответ сохранён — нажмите «Повторить».',
  BAD_RESPONSE: 'Не получилось разобрать ответ инвестора. Ваш ответ сохранён — нажмите «Повторить».',
  AI_UNAVAILABLE: 'Инвестор задумался. Ваш ответ сохранён — нажмите «Повторить».',
};

export function formatFacts(facts) {
  if (!facts) return null;
  const lines = ['Что я понял из питча:'];
  for (const k of facts.known ?? []) lines.push(`✅ ${k}`);
  for (const m of facts.missing ?? []) lines.push(`❌ нет: ${m}`);
  lines.push('', 'Других цифр у меня нет, и выдумывать их я не буду.');
  return lines.join('\n');
}

export function formatQuestion(step) {
  const topic = step.topic ? ` · ${step.topic}` : '';
  return `${progressBar(step.step, step.totalSteps)} Вопрос ${step.step}/${step.totalSteps}${topic}\n\n${step.question}`;
}

const questionReply = (step) => ({ text: formatQuestion(step), buttons: [[BUTTONS.idk, BUTTONS.pause]] });

// Итог по шагам (§10.4): крупный балл и сильное/слабое, подробности — под кнопками.
export function formatSummary(result) {
  const p = result.previousTotal;
  const arrow = p == null ? '' : result.total > p ? ' ⬆️' : result.total < p ? ' ⬇️' : '';
  const head = p != null ? `🏁 Итог: ${p} → ${result.total} из ${result.max}${arrow}` : `🏁 Итог: ${result.total} из ${result.max}`;
  const lines = [head];
  if (result.summary) lines.push('', `💪 Сильное: ${result.summary.strong}`, `🎯 Слабое: ${result.summary.weak}`);
  return lines.join('\n');
}

// Разбор по критериям — HTML с раскрывающейся цитатой Telegram.
export function formatCriteriaHtml(result) {
  const rows = result.criteria.map((c, i) => {
    const level = Number.isInteger(c.level) ? ` (${LEVELS[c.level] ?? c.level})` : '';
    const quote = c.evidence && c.evidence.length > 180 ? `${c.evidence.slice(0, 180)}…` : c.evidence;
    const evidence = quote ? `\n«${escapeHtml(quote)}»` : '';
    const comment = c.comment ? `\n${escapeHtml(c.comment)}` : '';
    return `<b>${c.id ?? i + 1}. ${escapeHtml(c.name)}</b>: ${fmt(c.score)}/${fmt(c.max)}${level}${evidence}${comment}`;
  });
  return `📊 <b>Разбор по 10 критериям</b>\n<blockquote expandable>${rows.join('\n\n')}</blockquote>`;
}

export function formatAdvice(result, done = []) {
  const lines = ['✅ Три дела до выступления', ''];
  result.advice.forEach((a, i) => {
    lines.push(`${done.includes(i + 1) ? '☑️' : `${i + 1}.`} ${typeof a === 'string' ? a : a.text}`, '');
  });
  return lines.join('\n').trimEnd();
}

// Полный итог одним текстом (диагностика и совместимость).
export function formatResult(result) {
  const lines = [formatSummary(result), '', 'По критериям:'];
  result.criteria.forEach((c, i) => {
    const level = Number.isInteger(c.level) ? ` (${LEVELS[c.level] ?? c.level})` : '';
    lines.push(`${c.id ?? i + 1}. ${c.name}: ${fmt(c.score)}/${fmt(c.max)}${level}${c.comment ? ` — ${c.comment}` : ''}`);
  });
  lines.push('', formatAdvice(result));
  return lines.join('\n');
}

const adviceButtons = (result) => [
  result.advice.map((_, i) => BUTTONS.done(i + 1)),
  [BUTTONS.remind, BUTTONS.pin],
  [BUTTONS.again],
];
const summaryButtons = [[BUTTONS.advice], [BUTTONS.criteria]];

function errorText(err) {
  if (!(err instanceof ApiError)) return FALLBACK_ERRORS.BAD_RESPONSE;
  let text = err.fromServer && err.message ? err.message : FALLBACK_ERRORS[err.code] ?? err.message;
  if (err.missing.length) text += '\n\nНе хватает:\n' + err.missing.map((m) => `• ${m}`).join('\n');
  if (err.code === 'RATE_LIMITED' && err.retryAfterSec) text += `\n\nПовторите через ${err.retryAfterSec} с.`;
  return text;
}

export function createDialog({ api, media = null, store = createStore(), now = () => Date.now() }) {
  const states = new Map();
  let personaCache = null;

  const keyOf = (chatId, userId) => `${chatId}:${userId}`;
  function stateOf(chatId, userId) {
    const key = keyOf(chatId, userId);
    let s = states.get(key);
    if (!s) {
      const saved = store.getProfile(key);
      s = {
        key, chatId, userId, phase: 'idle', sessionId: null, step: null, pending: null, held: null, busy: false,
        pitch: saved?.pitch ?? null, lastDone: saved?.lastDone ?? null, lastResult: saved?.lastResult ?? null, done: saved?.done ?? [],
      };
      states.set(key, s);
    }
    return s;
  }
  function reset(s, phase) {
    s.phase = phase;
    s.sessionId = null;
    s.step = null;
    s.pending = null;
    s.held = null;
  }
  const persist = (s) =>
    store.setProfile(s.key, { userId: s.userId, chatId: s.chatId, pitch: s.pitch, lastDone: s.lastDone, lastResult: s.lastResult, done: s.done });

  async function persona() {
    if (personaCache) return personaCache;
    try {
      personaCache = await api.persona();
    } catch {
      return null; // карточка не критична: покажем общий текст
    }
    return personaCache;
  }

  // Ответ API (Step или Done) → состояние и сообщения.
  function applyView(s, data, { fromStart = false } = {}) {
    if (data.done) {
      s.lastDone = { sessionId: data.sessionId, pitch: s.pitch };
      s.lastResult = data.result;
      s.done = [];
      reset(s, 'idle');
      persist(s);
      return [{ text: formatSummary(data.result), buttons: summaryButtons }];
    }
    s.sessionId = data.sessionId;
    s.step = data.step;
    const out = [];
    if (fromStart) {
      if (data.demo) out.push(TEXTS.demo);
      const facts = formatFacts(data.facts);
      if (facts) {
        // Сверка фактов (§2.3): вопрос 1 придержан до «Всё верно, поехали».
        s.phase = 'confirm';
        s.held = data;
        if (data.notice) out.push(data.notice);
        out.push({ text: `${facts}\n\n${TEXTS.confirm}`, buttons: [[BUTTONS.go], [BUTTONS.fix]] });
        return out;
      }
    }
    s.phase = 'answer';
    if (data.reaction) out.push(data.reaction);
    if (data.notice) out.push(data.notice);
    out.push(questionReply(data));
    return out;
  }

  async function callApi(s, request) {
    s.pending = request;
    try {
      let data;
      if (request.kind === 'start') {
        data = await api.start({ userId: s.userId, pitch: request.text, previousSessionId: request.previousSessionId ?? null });
        s.pitch = request.text;
      } else {
        data = await api.answer({ sessionId: request.sessionId, userId: s.userId, step: request.step, answer: request.text });
      }
      s.pending = null;
      return applyView(s, data, { fromStart: request.kind === 'start' });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'BAD_RESPONSE';
      if (!(err instanceof ApiError) || err.retryable) return [{ text: errorText(err), buttons: [[BUTTONS.retry]] }]; // pending сохранён
      s.pending = null;
      if (code === 'STEP_MISMATCH' || code === 'SESSION_DONE') return resync(s, request.sessionId);
      if (code === 'SESSION_NOT_FOUND') {
        reset(s, 'pitch');
        return [{ text: errorText(err), buttons: [[BUTTONS.newPitch]] }];
      }
      if (code === 'EMPTY_PITCH' || code === 'NOT_A_PITCH') return [{ text: errorText(err), buttons: [[BUTTONS.template]] }];
      return [errorText(err)];
    }
  }

  // Ответ уже принят или раунд закончен: берём актуальное состояние из API.
  async function resync(s, sessionId) {
    try {
      return applyView(s, await api.get({ sessionId, userId: s.userId }));
    } catch (err) {
      reset(s, 'pitch');
      return [{ text: errorText(err), buttons: [[BUTTONS.newPitch]] }];
    }
  }

  async function startPractice(s) {
    reset(s, 'pitch');
    const p = await persona();
    const card = p ? `Сегодня вас слушает ${p.name}, ${String(p.title ?? '').toLowerCase()}.\n\n${p.intro}` : TEXTS.welcomeFallback;
    return [{ photo: 'persona', personaId: p?.id ?? null, text: `${card}\n\n${TEXTS.askPitch}`, buttons: [[BUTTONS.template, BUTTONS.example]] }];
  }

  const welcome = () => [{ photo: 'welcome', text: TEXTS.welcome, buttons: [[BUTTONS.practice], [BUTTONS.learn], [BUTTONS.example]] }];

  async function deleteData(s) {
    try {
      await api.deleteUser({ userId: s.userId });
    } catch (err) {
      return [{ text: errorText(err), buttons: [[BUTTONS.retry]] }];
    }
    store.deleteUser(s.userId);
    reset(s, 'idle');
    Object.assign(s, { lastDone: null, lastResult: null, pitch: null, done: [] });
    return [{ text: TEXTS.deleted, buttons: [[BUTTONS.practice]] }];
  }

  // Кнопки и команды меню — одни и те же действия.
  async function action(s, name) {
    switch (name) {
      case 'start':
        reset(s, 'idle');
        return welcome();
      case 'learn':
        return [{ text: TEXTS.learn, buttons: [[BUTTONS.practice]] }];
      case 'example':
        return [{ text: TEXTS.example, buttons: [[BUTTONS.practice]] }];
      case 'template':
        return [TEXTS.template];
      case 'practice':
      case 'new':
        return startPractice(s);
      case 'go':
        if (s.phase !== 'confirm' || !s.held) return [TEXTS.nothingToRetry];
        s.phase = 'answer';
        return [questionReply(s.held)];
      case 'fix':
        reset(s, 'pitch');
        return [TEXTS.fix];
      case 'idk':
        if (s.phase !== 'answer') return [TEXTS.unknownCommand];
        return callApi(s, { kind: 'answer', sessionId: s.sessionId, step: s.step, text: TEXTS.idkAnswer });
      case 'pause':
        return [TEXTS.pause];
      case 'retry':
        if (!s.pending) return [{ text: TEXTS.nothingToRetry, buttons: [[BUTTONS.newPitch]] }];
        return callApi(s, s.pending);
      case 'advice':
        if (!s.lastResult) return [TEXTS.noResult];
        return [{ text: formatAdvice(s.lastResult, s.done), buttons: adviceButtons(s.lastResult) }];
      case 'criteria':
        if (!s.lastResult) return [TEXTS.noResult];
        return [{ text: formatCriteriaHtml(s.lastResult), html: true, buttons: [[BUTTONS.advice]] }];
      case 'result':
        if (!s.lastResult) return [{ text: TEXTS.noResult, buttons: [[BUTTONS.practice]] }];
        return [{ text: formatSummary(s.lastResult), buttons: summaryButtons }];
      case 'again':
        if (!s.lastDone) return [TEXTS.noAgain];
        reset(s, 'pitch');
        return callApi(s, { kind: 'start', text: s.lastDone.pitch, previousSessionId: s.lastDone.sessionId });
      case 'remind':
        if (!s.lastDone) return [TEXTS.remindNoRound];
        store.addReminder({ chatId: s.chatId, userId: s.userId, dueAt: now() + REMIND_AFTER_MS });
        return [TEXTS.remindSet];
      case 'pin':
        return [{ action: 'pin' }, TEXTS.pinned];
      case 'how': {
        const p = await persona();
        return [p?.howScored ?? TEXTS.howFallback];
      }
      case 'delete':
        return deleteData(s);
      case 'help':
        return [{ text: TEXTS.help, buttons: [[BUTTONS.practice], [BUTTONS.learn]] }];
      default: {
        const m = /^done:(\d)$/.exec(name);
        if (m && s.lastResult) {
          const i = Number(m[1]);
          if (!s.done.includes(i)) s.done.push(i);
          persist(s);
          const left = s.lastResult.advice.length - s.done.length;
          const reply = left > 0
            ? `☑️ Дело ${i} — сделано. Осталось: ${left}.`
            : { text: '🏆 Все три дела сделаны. Самое время для второго раунда.', buttons: [[BUTTONS.again]] };
          return [{ action: 'markDone', index: i }, reply];
        }
        return [TEXTS.unknownCommand];
      }
    }
  }

  // Голосовое или файл → текст. Возвращает { text, note } или { reply }.
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

  async function handleUnlocked(s, input) {
    if (input.callback) return action(s, input.callback);

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
    if (!note && trimmed.startsWith('/')) {
      const [cmd, arg] = trimmed.slice(1).split(/\s+/);
      const name = cmd.split('@')[0].toLowerCase();
      if (name === 'start' && arg === 'demo') return action(s, 'example'); // t.me/…?start=demo для QR на слайде
      return action(s, name);
    }
    if (!trimmed) return [TEXTS.emptyInput];
    if (trimmed.length > MAX_INPUT_CHARS) return note ? [note, TEXTS.tooLong] : [TEXTS.tooLong];

    const out = note ? [note] : [];
    if (s.phase === 'answer') {
      return [...out, ...(await callApi(s, { kind: 'answer', sessionId: s.sessionId, step: s.step, text: trimmed }))];
    }
    // idle, ожидание питча или «поправить» на сверке фактов: текст — это (новый) питч.
    return [...out, ...(await callApi(s, { kind: 'start', text: trimmed }))];
  }

  return {
    // input: { chatId, userId, text?, media?, callback? }
    async handle({ chatId, userId, ...input }) {
      const s = stateOf(chatId, userId);
      if (s.busy) return [TEXTS.busy];
      s.busy = true;
      try {
        return await handleUnlocked(s, input);
      } finally {
        s.busy = false;
      }
    },
    // Сообщение-напоминание о втором раунде.
    reminderReply: () => ({ text: TEXTS.reminder, buttons: [[BUTTONS.again], [BUTTONS.newPitch]] }),
    _states: states,
  };
}
