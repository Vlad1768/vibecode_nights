// Слабые заявления, которые не поднимают уровень выше «заявлено» (1).
// Источник — банк вопросов Ивана (pitch/research/question-bank.md, «Признаки ответа»)
// по гайду YC-интервью: аналогия, рынок сверху вниз, планы вместо фактов, «конкурентов нет».

const TOP_DOWN = /при\s+конверси\p{L}*|\d+(?:[.,]\d+)?\s*%\s+(от|рынка|аудитори|населени)|если\s+(хотя\s+бы\s+)?\d+(?:[.,]\d+)?\s*%|(доля|долю)\s+(в\s+)?\d+(?:[.,]\d+)?\s*%|рынок\s+(в\s+)?\d+(?:[.,]\d+)?\s*(млрд|трлн)|больше\s+\d+\s*млн\s+человек/iu;
const ANALOGY = /(как|типа|вроде|аналог)\s+[«"]?(uber|убер|airbnb|эйрбиэнби|авито|amazon|амазон|tinder|тиндер|яндекс[\s.-]?\p{L}*|ozon|озон|wildberries|вайлдберриз|netflix|нетфликс|spotify|duolingo|дуолинго|chatgpt)[»"]?\s+(для|в\s+мире|среди)/iu;
const NO_COMPETITORS = /конкурент\p{L}*\s+(почти\s+|практически\s+|вообще\s+)?(нет|не\s+существует)|аналог\p{L}*\s+(почти\s+|практически\s+|вообще\s+)?нет|(у\s+нас\s+)?нет\s+(прямых\s+)?конкурент|без\s+конкурент|конкурент\p{L}*\s+не\s+(видим|вижу)/iu;
const PLANS = /(планиру\p{L}*|собира\p{L}*сь|будем|хотим|намерены|в\s+планах)\s/iu;

/** Почему это заявление не подтверждение: 'top_down' | 'analogy' | 'no_competitors' | null. */
export function weakClaim(text) {
  const t = String(text ?? '');
  if (NO_COMPETITORS.test(t)) return 'no_competitors';
  if (TOP_DOWN.test(t)) return 'top_down';
  if (ANALOGY.test(t)) return 'analogy';
  return null;
}

/** План без единого факта: «будем», «планируем», а цифр о сделанном нет. */
export const planNotFact = (text) => PLANS.test(String(text ?? '')) && !/\d/.test(String(text ?? ''));

export const WEAK_COMMENT = {
  top_down: 'Рынок посчитан сверху вниз («1% от…») — это заявление, а не расчёт.',
  analogy: 'Сравнение с известной компанией — не доказательство.',
  no_competitors: '«Конкурентов нет» для жюри значит «рынок не изучен».',
};

/** Найти в тексте первое слабое заявление нужного вида. */
export function findWeak(sentences, kind) {
  return sentences.find((s) => weakClaim(s) === kind) || null;
}
