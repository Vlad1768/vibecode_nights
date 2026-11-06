// Хранилище сессий. Сессии живут в памяти и сохраняются в JSON-файл, чтобы пережить перезапуск API.
// Запись атомарная (временный файл + rename), сессии старше 14 дней удаляются (docs/CONTRACT.md, раздел 8).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function createMemoryStore({ ttlMs = TTL_MS, now = Date.now } = {}) {
  const sessions = new Map();
  const api = {
    async get(id) {
      const s = sessions.get(id);
      return s ? structuredClone(s) : null;
    },
    async save(session) {
      sessions.set(session.id, structuredClone(session));
      api.changed();
    },
    async deleteUser(userId) {
      let n = 0;
      for (const [id, s] of sessions) if (s.userId === userId) { sessions.delete(id); n++; }
      if (n) api.changed();
      return n;
    },
    purge() {
      const edge = now() - ttlMs;
      let n = 0;
      for (const [id, s] of sessions) if ((s.updatedAt ?? 0) < edge) { sessions.delete(id); n++; }
      if (n) api.changed();
      return n;
    },
    size: () => sessions.size,
    changed() {},
    _all: () => sessions,
  };
  return api;
}

/** Хранилище с записью в файл. flush() пишет немедленно; close() — финальная запись при остановке. */
export function createFileStore({ file, ttlMs = TTL_MS, now = Date.now, debounceMs = 100, log = () => {} }) {
  const store = createMemoryStore({ ttlMs, now });
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      for (const s of data.sessions ?? []) if (s && typeof s.id === 'string') store._all().set(s.id, s);
    } catch {
      log({ level: 'error', msg: 'файл сессий повреждён, начинаем с пустого', file });
      renameSync(file, `${file}.broken-${now()}`);
    }
  }

  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, sessions: [...store._all().values()] }), { mode: 0o600 });
    renameSync(tmp, file);
  };
  store.changed = () => {
    if (!timer) timer = setTimeout(() => {
      try { flush(); } catch (err) { log({ level: 'error', msg: 'не удалось сохранить сессии', code: err?.code }); }
    }, debounceMs);
  };
  store.purge();
  const purgeTimer = setInterval(() => store.purge(), 60 * 60 * 1000);
  purgeTimer.unref();
  store.flush = flush;
  store.close = () => {
    clearInterval(purgeTimer);
    if (timer) flush();
  };
  return store;
}
