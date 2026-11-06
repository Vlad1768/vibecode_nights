// Персонажи-инвесторы Ники (content/investor/investors.json + assets/NN-*.jpg).
// Для каждой новой сессии бот выбирает персонажа случайно (без повтора подряд).
// Персонаж задаёт тон и угол критики, но баллы ставятся по одной методике — оценки сопоставимы.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DIR = fileURLToPath(new URL('../../content/investor/', import.meta.url));

export function loadPersonas(dir = DEFAULT_DIR) {
  const file = join(dir, 'investors.json');
  if (!existsSync(file)) return [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  const assets = join(dir, 'assets');
  const images = existsSync(assets) ? readdirSync(assets).filter((f) => /\.(jpe?g|png)$/i.test(f)) : [];
  return (Array.isArray(raw) ? raw : [])
    .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
    .map((p) => {
      const [title, nick] = p.name.split(/\s+—\s+/);
      const image = images.find((f) => f.startsWith(`${p.id}-`));
      return {
        id: p.id,
        title: (title || p.name).trim(),
        nick: (nick || '').trim(),
        who: p.who ?? '', wants: p.wants ?? '', fears: p.fears ?? '', invests: p.invests ?? '', never: p.never ?? '',
        behavior: p.behavior ?? '', question: p.question ?? '',
        imagePath: image ? join(assets, image) : null,
      };
    });
}

// Случайный персонаж, по возможности не тот же, что в прошлый раз.
export function pickPersona(list, prevId = null, rand = Math.random) {
  if (!list.length) return null;
  const pool = list.length > 1 ? list.filter((p) => p.id !== prevId) : list;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

export const personaLabel = (p) => (p.nick ? `${p.nick} (${p.title.toLowerCase()})` : p.title);

export function personaCard(p) {
  return [
    `🎲 Сегодня тебя слушает: ${p.nick || p.title}`,
    p.nick ? p.title : null,
    '',
    p.who && `Кто: ${p.who}`,
    p.wants && `Хочет: ${p.wants}`,
    p.fears && `Боится: ${p.fears}`,
  ].filter((x) => x !== null && x !== undefined && x !== false).join('\n').replace(/\n{3,}/g, '\n\n');
}

// Добавка к системному промпту тренера: характер и фокус, без влияния на шкалу баллов.
export function personaPrompt(p) {
  if (!p) return '';
  return `\n\nТы играешь персонажа-инвестора «${p.nick || p.title}» (${p.title}). Кто: ${p.who} Хочет: ${p.wants} Боится: ${p.fears} Вкладывается: ${p.invests} Никогда не вложится: ${p.never} Манера: ${p.behavior}\n` +
    'Тон, формулировки критики и вопросов — в характере этого персонажа и с его фокусом. Но баллы ставь строго по методике, одинаково для любого персонажа, и без грубости к человеку.';
}
