// Текстовые помощники ядра: нормализация, предложения, числа, проверка цитат.

/** Приводит текст к виду для сравнения: нижний регистр, ё → е, одни кавычки и тире, один пробел. */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»“”„"'*_`]/g, '')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/ | /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const clean = (value) => String(value ?? '').trim();

/** Делит текст на предложения и строки. */
export function sentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.replace(/^[\s*#>-]+|\*+$/g, '').trim())
    .filter(Boolean);
}

/** Все числа в тексте как строки без разделителей: «1 500» даёт «1» и «500», «2,5» даёт «2,5». */
export function numbersIn(text) {
  return (String(text ?? '').match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace('.', ','));
}

/**
 * Каждое число из candidate встречается в source. Так код ловит выдуманные цифры
 * в вопросах, реакциях и фактах.
 */
export function numbersCovered(candidate, source) {
  const known = new Set(numbersIn(source));
  return numbersIn(candidate).every((n) => known.has(n));
}

/** Цитата есть в тексте источника (после нормализации) и не короче 8 символов. */
export function quoteFound(quote, source) {
  const q = normalize(quote).replace(/[.!?…,;:]+$/, '');
  if (q.length < 8) return false;
  return normalize(source).includes(q);
}

export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Обрезает строку по словам, если модель прислала слишком длинный текст. */
export function limit(text, max) {
  const t = clean(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).trim() + '…';
}
