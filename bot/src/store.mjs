// Небольшое хранилище бота: прошлый раунд пользователя (для «Второго раунда»), напоминания и история сессий для профиля.
// JSON-файл с атомарной записью; без DATA_DIR живёт в памяти (тесты, локальный запуск).
// Тексты питчей и ответов хранятся не дольше 14 дней — как сессии в API; баллы для профиля остаются.
// «Удалить мои данные» стирает всё.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

export function createStore({ dir = null, now = () => Date.now() } = {}) {
  const file = dir ? join(dir, 'bot-state.json') : null;
  let data = { profiles: {}, reminders: [], users: {} };
  if (file) {
    mkdirSync(dir, { recursive: true });
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') data = { profiles: parsed.profiles ?? {}, reminders: parsed.reminders ?? [], users: parsed.users ?? {} };
    } catch {
      // файла ещё нет или он повреждён — начинаем с пустого
    }
  }

  let timer = null;
  function save() {
    if (!file || timer) return;
    timer = setTimeout(() => {
      timer = null;
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      renameSync(tmp, file);
    }, 200);
    timer.unref?.();
  }

  function prune() {
    const cutoff = now() - KEEP_MS;
    for (const [key, p] of Object.entries(data.profiles)) if ((p.updatedAt ?? 0) < cutoff) delete data.profiles[key];
    data.reminders = data.reminders.filter((r) => r.dueAt > cutoff);
    // Старые тексты удаляем, баллы оставляем.
    for (const u of Object.values(data.users)) {
      for (const sess of u.sessions ?? []) {
        if (sess.at < cutoff && sess.texts) delete sess.texts;
      }
    }
  }
  prune();

  return {
    getProfile: (key) => data.profiles[key] ?? null,
    setProfile(key, patch) {
      data.profiles[key] = { ...(data.profiles[key] ?? {}), ...patch, updatedAt: now() };
      save();
    },
    // История сессий для профиля (ТЗ §9).
    addSession(userId, name, session) {
      const u = (data.users[userId] ??= { sessions: [] });
      if (name) u.name = name;
      u.sessions.push(session);
      save();
    },
    getUser: (userId) => data.users[userId] ?? { sessions: [] },
    allUsers: () => Object.entries(data.users).map(([userId, u]) => ({ userId, name: u.name, sessions: u.sessions ?? [] })),
    deleteUser(userId) {
      delete data.users[userId];
      for (const [key, p] of Object.entries(data.profiles)) if (p.userId === userId) delete data.profiles[key];
      data.reminders = data.reminders.filter((r) => r.userId !== userId);
      save();
    },
    // Одно напоминание на пользователя: новое заменяет старое.
    addReminder({ chatId, userId, dueAt }) {
      data.reminders = data.reminders.filter((r) => r.userId !== userId);
      data.reminders.push({ chatId, userId, dueAt });
      save();
    },
    // Забирает наступившие напоминания (удаляет их из хранилища).
    takeDue() {
      const t = now();
      const due = data.reminders.filter((r) => r.dueAt <= t);
      if (due.length) {
        data.reminders = data.reminders.filter((r) => r.dueAt > t);
        save();
      }
      return due;
    },
    flush() {
      if (!file) return;
      if (timer) { clearTimeout(timer); timer = null; }
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      renameSync(tmp, file);
    },
    prune,
  };
}
