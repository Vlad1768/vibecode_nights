// Проверки ввода до модели: длина, пустой питч, «не питч», попытки выпросить балл и подменить правила.
// Работают без сети, поэтому одинаково в режимах live и demo.
import { clean, normalize } from './text.mjs';

export const MAX_PITCH = 4000;
export const MAX_ANSWER = 2000;
export const TOTAL_STEPS = 5;

export class TrainerError extends Error {
  /** @param {number} status HTTP-статус из контракта  @param {string} code код ошибки контракта */
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const PITCH_PARTS = Object.freeze(['проблема и для кого', 'решение', 'что сделано, с цифрами', 'как зарабатываете']);

// Подписи полей формы заявки (docs/case/pitch-dataset.md). Их убираем, чтобы считать только то, что написал автор.
const FORM_LABELS = [
  /опишите проект:?\s*проблема,\s*решение,\s*для кого/giu,
  /что уже сделано,?\s*цифры/giu,
  /модель монетизации/giu,
  /что хотите получить/giu,
  /^\s*\*\*(проект|команда|стадия):?\*\*:?/gimu,
  /^#+.*$/gmu,
];

/** Текст питча без подписей формы, разметки и прочерков. */
export function authorText(pitch) {
  let t = String(pitch ?? '');
  for (const re of FORM_LABELS) t = t.replace(re, ' ');
  return t.replace(/[*_#>|]+/g, ' ').replace(/^\s*[-—–]+(\s+|$)/gmu, ' ').replace(/\s+/g, ' ').trim();
}

const SEE_DECK = /(см\.?|смотрите|смотри|в)\s+(в\s+)?(презентаци|файл|вложени|приложени)|прикрепил\p{L}*\s+(файл|презентаци)|расскажу\s+устно/iu;
const REQUEST = /(помогите|помоги|составь(те)?|напиши(те)?|сделай(те)?|подготовь(те)?|распиши(те)?)\s+(мне\s+)?(\p{L}+\s+){0,2}(план|расписани|эссе|курсов|реферат|текст|диплом|домашк|конспект)/iu;
const BUSINESS = /клиент|покупател|пользовател|продаж|выручк|₽|руб|подписк|комисси|рынок|рынк|конкурент|аналог|стартап|сервис|платформ|приложени|продукт|монетиз|пилот|b2b|b2c|сеть|сетям|бизнес/giu;

const BEGGING = /(высок\p{L}*|максимальн\p{L}*|хорош\p{L}*|высш\p{L}*|отличн\p{L}*)\s+(балл|оценк|отметк)|постав\p{L}*\s+(мне\s+|нам\s+)?(100|сотню|высок|макс|пятерк|отлично)|оцени\p{L}*\s+(его\s+|нас\s+|проект\s+)?по\s+максимуму|не\s+трат\p{L}*\s+врем\p{L}*\s+на\s+вопрос/iu;
const INJECTION = /игнорируй|забудь\s+(все\s+)?(правила|инструкци)|ignore\s+(all\s+|previous\s+)?instructions|system\s*prompt|системн\p{L}*\s+промпт|ты\s+теперь\s+не\s+инвестор|новые\s+правила:/iu;

export const NOTICE_BEGGING = 'Балл получают ответами, а не просьбами. На защите тоже попросят цифры.';
export const NOTICE_INJECTION = 'Правила оценки задаёт код, текстом их не переписать. Продолжаем по питчу.';

/** Одна фраза для notice, если в тексте попытка выпросить балл или подменить правила. */
export function noticeFor(text) {
  if (INJECTION.test(text)) return NOTICE_INJECTION;
  if (BEGGING.test(text)) return NOTICE_BEGGING;
  return null;
}

/** Каких частей питча не видно в тексте автора. */
export function missingParts(text) {
  const t = normalize(text);
  const checks = [
    [/проблем|боль|страда|тратит|теряет|не успева|приходится|ищет|негде|дорог|текучк/u, PITCH_PARTS[0]],
    [/помога|сервис|платформ|приложени|бот|устройств|датчик|маркетплейс|курс|мы делаем|решени/u, PITCH_PARTS[1]],
    [/\d/u, PITCH_PARTS[2]],
    [/₽|руб|подписк|комисси|цен[аы]|стоит|платят|платит|лицензи|продаж|монетиз/u, PITCH_PARTS[3]],
  ];
  return checks.filter(([re]) => !re.test(t)).map(([, label]) => label);
}

/**
 * Проверяет питч. Бросает TrainerError с кодом контракта или возвращает очищенный текст и notice.
 * @returns {{ pitch: string, notice: string | null }}
 */
export function checkPitch(rawPitch) {
  const pitch = clean(rawPitch);
  const emptyMessage = 'Здесь нечего прожаривать: файлы и презентации я не открываю. Вставьте суть текстом.';
  if (!pitch) throw new TrainerError(422, 'EMPTY_PITCH', 'Пустое описание. Вставьте питч текстом.', { missing: [...PITCH_PARTS] });
  if (pitch.length > MAX_PITCH) {
    throw new TrainerError(422, 'PITCH_TOO_LONG', `Питч длиннее ${MAX_PITCH} символов. Сократите, я не обрезаю текст.`);
  }
  const own = authorText(pitch);
  const business = (own.match(BUSINESS) || []).length;
  if (REQUEST.test(own) && business < 2) {
    throw new TrainerError(422, 'NOT_A_PITCH', 'Это просьба, а не стартап. Я прожариваю питчи: вставьте описание своего проекта.');
  }
  const missing = missingParts(own);
  const deck = SEE_DECK.test(own);
  if (own.length < 80 || (deck && own.length < 300) || missing.length === PITCH_PARTS.length) {
    throw new TrainerError(422, 'EMPTY_PITCH', deck ? emptyMessage : 'Слишком мало, чтобы задавать вопросы. Вставьте суть проекта текстом.', {
      missing: missing.length ? missing : [...PITCH_PARTS],
    });
  }
  return { pitch, notice: noticeFor(pitch) };
}

/** Проверяет ответ на вопрос. */
export function checkAnswer(rawAnswer) {
  const answer = clean(rawAnswer);
  if (!answer) throw new TrainerError(422, 'EMPTY_ANSWER', 'Пустой ответ. Если не знаете, так и напишите.');
  if (answer.length > MAX_ANSWER) {
    throw new TrainerError(422, 'ANSWER_TOO_LONG', `Ответ длиннее ${MAX_ANSWER} символов. Коротко и с цифрами.`);
  }
  return { answer, notice: noticeFor(answer) };
}

const DONT_KNOW = /^(не\s+знаю|без\s+понятия|хз|пока\s+нет|нет\s+данных|не\s+считал\p{L}*|не\s+помню)/iu;
export const isDontKnow = (answer) => DONT_KNOW.test(clean(answer));
