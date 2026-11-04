# Пресеты стека

Команды пресета A проверены на Next.js 16.4, Tailwind 4 и `@anthropic-ai/sdk` 1.4 (ноябрь 2026): они выполняются без интерактивных вопросов. Остальные пресеты используй, только если кейс без них не решается.

## A. Веб-приложение (по умолчанию): Next.js + TypeScript + Tailwind + shadcn/ui

Одно приложение в `web/` даёт и фронт, и API-роуты (ключ к LLM остаётся на сервере), и деплой на Vercel в один клик.

```bash
# 1. Каркас: ~2 мин, вопросов не задаёт. Запускать из корня репозитория.
npx -y create-next-app@latest web --yes --ts --tailwind --eslint --app --src-dir \
  --use-npm --disable-git --no-agent-feedback --import-alias "@/*"

# 2. Next.js пишет правила для агентов в web/AGENTS.md, а Claude Code читает CLAUDE.md: подключаем импортом
printf '@AGENTS.md\n' > web/CLAUDE.md

# 3. UI-кит. Нужен доступ к ui.shadcn.com. Если команда упала или задаёт вопросы, пропусти: хватит Tailwind
cd web
npx -y shadcn@latest init -d -y --no-monorepo
npx -y shadcn@latest add button card input textarea badge dialog tabs sonner skeleton \
  avatar select table dropdown-menu tooltip progress separator sheet -y

# 4. AI и схемы (если в продукте есть AI)
npm i @anthropic-ai/sdk zod
```

### Обязательные правки после каркаса (проверено: без них сборка падает)
1. **`web/next.config.ts`**: поставь `cacheComponents: false` и удали строку `partialPrefetching: true`. Шаблон включает Cache Components, а в этом режиме любой `new Date()` или `Date.now()` в серверном компоненте роняет `npm run build` с ошибкой «unstable value … while prerendering». Кроме того, тогда запрещены `export const dynamic` и `export const runtime`. Для хакатона это лишние грабли.
2. **`web/src/app/layout.tsx`**: `lang="ru"`, у шрифтов `subsets: ["latin", "cyrillic"]`. Без `cyrillic` русский текст рисуется запасным шрифтом. Также поменяй `metadata`.
3. **`web/src/app/globals.css`**: шаблон задаёт `body { font-family: Arial, Helvetica, sans-serif; }`, и этот шрифт перебивает подключённые. Подключи шрифты и токены по готовому рецепту из `.claude/skills/polish/directions.md`, раздел «Как подключить» (проверен скриншотом).
4. Удали демо-содержимое `page.tsx` и `public/*.svg`.
5. После `shadcn init` загляни в `web/components.json` и в `src/components/ui/`. Перед использованием компонента прочитай его файл: в новых версиях по умолчанию база Base UI, где вместо `asChild` используется проп `render`.

### Зоны (кто что правит)
```
web/src/app/layout.tsx           ведущий (навигация, шрифты, провайдеры)
web/src/app/globals.css          ведущий (токены из DESIGN.md)
web/src/app/page.tsx             главный экран, отдельная задача
web/src/app/<маршрут>/           по папке на задачу
web/src/app/api/<имя>/route.ts   API, по файлу на задачу
web/src/components/ui/           shadcn: только `npx shadcn add`, руками не править
web/src/components/<фича>/       компоненты фичи, владелец — задача фичи
web/src/lib/types.ts             типы из CONTRACT (ведущий)
web/src/lib/api.ts               доступ к данным (ведущий/бэк, сигнатуры не менять)
web/src/lib/ai.ts                LLM-клиент с демо-режимом
web/src/data/                    моки, фикстуры, демо-данные
pitch/                           презентация
```

### Команды для CLAUDE.md
- Запуск: `cd web && npm run dev` → http://localhost:3000
- Проверка перед пушем: `cd web && npm run build` (~15 сек, включает проверку TypeScript) и `npm run lint`
- Скриншоты: `node scripts/shot.mjs / /<маршрут>` при запущенном dev-сервере

### Особенности Next.js 16, о которых агенты забывают
- Интерактивный компонент (useState, onClick, хуки) начинается с `"use client";`.
- `params` и `searchParams` в page — это Promise: `const { id } = await params;`.
- Есть глобальные типы `PageProps<"/orders/[id]">` и `LayoutProps<"/">`.
- POST-роуты динамические по умолчанию, `export const dynamic` не нужен.
- Если сомневаешься в API, читай `web/AGENTS.md` и затем `web/node_modules/next/dist/docs/`.

## B. Нужен Python (ML, обработка данных, готовая Python-библиотека)
`web/` — пресет A, а `api/` — FastAPI. Фронт ходит в API через `NEXT_PUBLIC_API_URL`.
```bash
mkdir api && cd api && python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install fastapi "uvicorn[standard]" pydantic anthropic && pip freeze > requirements.txt
uvicorn main:app --reload --port 8000
```
В `main.py` сразу подключи CORS: `app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])`.
Проверка: `python -c "import main"` и `curl localhost:8000/docs`. Деплой сложнее, чем у A: Render/Railway или туннель с ноутбука (см. `/deploy`). Если Python нужен только ради вызова LLM, бери пресет A.

## C. Telegram-бот
`bot/` на aiogram 3: `pip install aiogram anthropic`. Токен получи у @BotFather **заранее**. На демо покажи бота через трансляцию экрана телефона. Если останется время, добавь веб-админку из пресета A.

## D. Дашборд или аналитика
Пресет A плюс графики: `npm i recharts` (или shadcn charts). Это красивее и гибче Streamlit, а по времени примерно то же.

## Просят мобильное приложение
Делай адаптивный веб (пресет A) с вёрсткой mobile-first и показывай с телефона по ссылке или QR. Expo бери, только если нативность прямо указана в критериях.
