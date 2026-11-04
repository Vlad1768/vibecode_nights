// web/src/app/api/chat/route.ts — стриминговый чат. Клиент: use-ai-stream.ts
import { streamText } from "@/lib/ai";
import type Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `Ты — <роль ассистента в продукте>. Отвечай по-русски, коротко и по делу: 3–6 предложений или список.
Опирайся только на данные из контекста. Если данных не хватает — скажи, чего не хватает.`;

// Заготовленный ответ для демо-режима и любых сбоев. Пиши его как идеальный ответ на главный вопрос демо.
const FALLBACK = `<идеальный ответ на главный вопрос демо-сценария>`;

export async function POST(req: Request) {
  const { messages, context } = (await req.json()) as {
    messages: Anthropic.Beta.BetaMessageParam[];
    context?: unknown;
  };
  const system = context ? `${SYSTEM}\n\nКонтекст (JSON):\n${JSON.stringify(context)}` : SYSTEM;
  return new Response(streamText({ system, messages, fallback: FALLBACK }), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}
