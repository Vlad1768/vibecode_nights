// Настройки бота читаются только из окружения. Секреты не логируются.

function intFrom(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function loadConfig(env = process.env) {
  const token = String(env.BOT_TELEGRAM_TOKEN ?? '').trim();
  const apiBaseUrl = String(env.TRAINER_API_URL ?? '').trim().replace(/\/+$/, '');
  return {
    token,
    // Без TRAINER_API_URL бот работает на встроенной заглушке API (демо-режим).
    apiMode: apiBaseUrl ? 'http' : 'mock',
    apiBaseUrl,
    apiTimeoutMs: intFrom(env.TRAINER_API_TIMEOUT_MS, 60_000, { min: 1_000, max: 300_000 }),
    pollTimeoutSec: intFrom(env.BOT_POLL_TIMEOUT_SEC, 30, { min: 1, max: 50 }),
    // Только для локальной проверки с поддельным сервером; в проде не задаётся.
    telegramApiBase: String(env.TELEGRAM_API_BASE ?? '').trim() || 'https://api.telegram.org',
    // Необязательный health-check для деплоя (T30): GET http://127.0.0.1:<порт>/health
    healthPort: env.BOT_HEALTH_PORT ? intFrom(env.BOT_HEALTH_PORT, 0, { min: 1, max: 65_535 }) : 0,
  };
}
