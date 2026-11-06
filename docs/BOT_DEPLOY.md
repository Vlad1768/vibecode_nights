# Деплой API и Telegram-бота (T30)

API (`server/` + `core/`, T28) и бот (`bot/`, T27) выкатываются на сервер из `docs/BOT_SERVER.md` workflow **deploy-bot** в GitHub Actions. С ноутбука ничего запускать не нужно, бот работает на сервере и при выключенном ноутбуке.

## Настройки в GitHub

[Settings → Secrets and variables → Actions](https://github.com/Vlad1768/vibecode_nights/settings/secrets/actions):

| Имя | Тип | Что это |
|---|---|---|
| `BOT_SERVER_HOST` | Variable | Адрес сервера (задан Германом) |
| `BOT_SERVER_USER` | Variable | SSH-пользователь (задан Германом) |
| `BOT_SERVER_PASSWORD` | Secret | SSH-пароль (задан Германом) |
| `BOT_TELEGRAM_TOKEN` | Secret | Токен бота от @BotFather |
| `BOT_SERVER_PORT` | Variable, необязательно | SSH-порт, по умолчанию 22 |
| `GEMINI_API_KEY` | Secret | Ключ Gemini. С ним API работает с моделью (`live`), а бот распознаёт голосовые, PDF и фото. Без него — API в `demo`, бот принимает только текст, DOCX, PPTX, TXT |
| `GEMINI_MODEL` | Variable, необязательно | По умолчанию `gemini-4-argon` (docs/GEMINI.md) |
| `TRAINER_API_URL` | Variable, необязательно | Адрес API для бота. По умолчанию `http://127.0.0.1:8080` — API на этом же сервере |

## Деплой и повторный деплой

Actions → **deploy-bot** → Run workflow:

- `probe` — осмотреть сервер (ОС, Node, systemd, диск, память, состояние бота) без изменений;
- `deploy` — прогнать тесты, проверить токен через Telegram `getMe`, выкатить бота и дождаться health-check.

Повторный деплой — тот же запуск `deploy`. Если новая версия не прошла health-check, скрипт возвращает прошлую.

## Сервер (осмотр 06.11.2026, workflow probe)

Ubuntu 24.04.4 LTS, x86_64, systemd 255, 4 ГБ RAM, 50 ГБ свободно на `/`. SSH-порт 22, вход по паролю из секрета работает. Node.js не был установлен, его ставит первый деплой.

## Службы на сервере

| Служба | Что | Адрес (только локально) | Журнал |
|---|---|---|---|
| `investor-api` | API T28, пользователь `investorapi`, данные в `/var/lib/investor-api` (сессии 14 дней) | `http://127.0.0.1:8080/api/health` | `journalctl -u investor-api` |
| `investor-bot` | Бот T27, пользователь `investorbot`, ходит в API | `http://127.0.0.1:8081/health` | `journalctl -u investor-bot` |

Сайту (T32) API отдаёт Caddy по пути `/api` → `127.0.0.1:8080` (настраивает Влад).

## Что происходит на сервере

`deploy/bot/remote-install.sh`, от root:

1. Ставит Node.js 22 из NodeSource, если его нет (Debian/Ubuntu).
2. Создаёт системного пользователя `investorbot` без входа: бот работает не от root.
3. Кладёт настройки в `/etc/investor-bot/bot.env` (`0640 root:investorbot`). Токен передаётся через stdin ssh, а не аргументами, и в журнал Actions не попадает.
4. Код — в `/opt/investor-bot`, прошлая версия — в `/opt/investor-bot.prev`.
5. Сервис systemd `investor-bot` (`deploy/bot/investor-bot.service`): автозапуск после перезагрузки, перезапуск при падении через 5 секунд, изоляция (`ProtectSystem=strict`, `NoNewPrivileges`).
6. Health-check: `http://127.0.0.1:8081/health` доступен только на самом сервере и отвечает 200, пока бот опрашивает Telegram.

## Диагностика на сервере

```bash
systemctl status investor-bot
journalctl -u investor-bot -n 100 --no-pager
curl -s 127.0.0.1:8081/health
```

Журнал — JSON-строки без токена и без текстов сообщений пользователей.

## Безопасность

- Ключ хоста принимается при первом подключении (TOFU), его отпечаток печатается в шаге «SSH-клиент и ключ хоста». Сверьте его с сервером при первом входе.
- Пароль root передавался в переписке: после запуска лучше заменить его на SSH-ключ и обновить секрет (см. `docs/BOT_SERVER.md`).
- Общий API (T28) на этом же сервере в этой версии не разворачивается: его выкатка добавится после T28 в `deploy/api/`.
