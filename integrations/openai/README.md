# Серверный клиент OpenAI (ChatGPT)

Основной провайдер модели для API (`server/`) и распознавания в боте. Без npm-зависимостей, Node.js 22+.

- `client.mjs` — `generateText`, `generateJSON`, `transcribe` (речь → текст, `/audio/transcriptions`). Интерфейс тот же, что у `integrations/gemini/`, поэтому ядро (`core/llm.mjs`) не менялось.
- `responses.mjs` — текстовый `generateJSON` через Responses API: `store:false`, строгая JSON-схема и локальная проверка полей. По умолчанию `gpt-6.1-sol`, reasoning `low`, 8192 токена и тайм-аут 30 секунд. Инструкция Ивану и критерии — [docs/OPENAI.md](../../docs/OPENAI.md).
- PDF уходит в чат файлом, фото — `image_url`, голос — моделью речи `whisper-1` (`OPENAI_TRANSCRIBE_MODEL`).
- Модели с рассуждениями (`gpt-5*`, `o*`) получают запас токенов и `reasoning_effort: low`.
- Ключ — только в окружении сервера (`OPENAI_API_KEY`), в ошибки и журналы не попадает.
- `../llm.mjs` выбирает провайдера: `OPENAI_API_KEY` → OpenAI, иначе `GEMINI_API_KEY` → Gemini; `LLM_PROVIDER` — явный выбор.

```bash
node --test integrations/openai/*.test.mjs   # без сети и настоящих ключей
```
