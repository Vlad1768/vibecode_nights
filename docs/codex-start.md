# Старт для человека с Codex (5 минут)

## 1. В терминале (один раз)
```bash
npm i -g @openai/codex
git clone https://github.com/vlad1768/vibecode_nights.git vibecode_nights-codex
cd vibecode_nights-codex
codex
```
В первом окне Codex выбери **Sign in with ChatGPT** и войди своим аккаунтом.

## 2. Вставь в Codex (замени `<ИМЯ>` на своё имя)
```text
Я участник командного хакатона, меня зовут <ИМЯ>. Подготовь себя к работе и ничего не меняй в репозитории.

1. Прочитай целиком AGENTS.md, CLAUDE.md, TASKS.md и раздел «Если у тебя Codex» в README.md. Это правила команды, соблюдай их всегда.
2. Проверь окружение: git --version, node -v (нужен 20+), gh auth status. Если gh не залогинен, попроси меня выполнить gh auth login и дождись.
3. Выполни git pull --rebase и проверь права на пуш: git push --dry-run origin main. Если получишь 403 или «permission denied», скажи мне принять приглашение в репозиторий на github.com/notifications.
4. Проверь, что есть папка .agents/skills/. Если её нет, скажи «скиллы ещё не в main» и остановись.
5. Выполни bash scripts/tasks.sh status.
6. Если песочница блокирует сеть (git push, npm install), попроси у меня разрешение. Я подтвержу.
7. Отчитайся коротко: что работает, что нет, список скиллов из .agents/skills/.

Дальше: в TASKS.md я записываюсь как <ИМЯ>-Codex. Моя главная роль — независимое ревью и поиск багов. Команды, которые я буду давать: $peer-review all (каждые ~40 минут), $smoke (перед деплоем), $next <ИМЯ>-Codex (взять задачу), $pitch (помощь с презентацией).
```

## 3. Чтобы Codex не спрашивал разрешение на каждый git push (по желанию)
Добавь в `~/.codex/config.toml` (если файла нет, создай его):
```toml
[sandbox_workspace_write]
network_access = true
```
Затем перезапусти `codex`. На macOS эта настройка иногда не срабатывает. Тогда просто подтверждай запросы.
