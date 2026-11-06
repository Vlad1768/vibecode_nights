// Лимиты из контракта: 10 новых сессий в час на userId и 60 запросов в минуту на IP.

/** Скользящее окно: не больше `max` событий за `windowMs` на ключ. */
export function createWindow({ max, windowMs, now = Date.now }) {
  const hits = new Map();
  const fresh = (key) => {
    const edge = now() - windowMs;
    const list = (hits.get(key) || []).filter((t) => t > edge);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list;
  };
  const sweep = setInterval(() => { for (const key of [...hits.keys()]) fresh(key); }, windowMs);
  sweep.unref();
  return {
    /** Сколько секунд ждать, если лимит исчерпан; 0 — можно. */
    wait(key) {
      const list = fresh(key);
      if (list.length < max) return 0;
      return Math.max(1, Math.ceil((list[0] + windowMs - now()) / 1000));
    },
    hit(key) {
      const list = fresh(key);
      list.push(now());
      hits.set(key, list);
    },
    close: () => clearInterval(sweep),
  };
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * IP клиента для лимита. Caddy на том же сервере добавляет X-Forwarded-For.
 * Запрос с loopback без X-Forwarded-For — это бот на том же сервере: лимит по IP к нему
 * не применяется (иначе все пользователи Telegram делили бы один IP), лимит по userId остаётся.
 * @returns {string | null}
 */
export function clientIp(req) {
  const remote = req.socket?.remoteAddress || '';
  if (!LOOPBACK.has(remote)) return remote || null;
  const xff = req.headers['x-forwarded-for'];
  if (!xff) return null;
  return String(xff).split(',')[0].trim() || null;
}
