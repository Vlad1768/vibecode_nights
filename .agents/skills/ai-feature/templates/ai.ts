// web/src/lib/ai.ts — единая точка вызова LLM. Только для серверного кода (route.ts, server actions).
// Главное правило демо: AI никогда не роняет интерфейс. Нет ключа / ошибка / таймаут / отказ модели →
// возвращаем заготовленный ответ (fallback) и флаг demo: true.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const AI_MODEL = process.env.AI_MODEL ?? "claude-opus-5-5";
// low — быстрый ответ для интерфейса; medium/high — если качество важнее скорости.
const EFFORT = (process.env.AI_EFFORT ?? "low") as "low" | "medium" | "high";

export const isDemoMode = () => process.env.DEMO_MODE === "1" || !process.env.ANTHROPIC_API_KEY;

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ timeout: 45_000, maxRetries: 1 }));

// Серверный фолбэк Anthropic: если модель отклонит запрос, API сам повторит его на рекомендованной модели.
const SERVER_FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[],
  fallbacks: "default" as const,
};

type Msg = Anthropic.Beta.BetaMessageParam;

/** Текстовый ответ. */
export async function askText(opts: {
  system: string;
  prompt: string;
  fallback: string;
  maxTokens?: number;
}): Promise<{ text: string; demo: boolean }> {
  if (isDemoMode()) return { text: opts.fallback, demo: true };
  try {
    const res = await getClient().beta.messages.create({
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? 4000,
      output_config: { effort: EFFORT },
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      ...SERVER_FALLBACK,
    });
    if (res.stop_reason === "refusal") throw new Error("model refusal");
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    return text ? { text, demo: false } : { text: opts.fallback, demo: true };
  } catch (err) {
    console.error("[ai] askText → fallback:", err);
    return { text: opts.fallback, demo: true };
  }
}

/** Структурированный ответ строго по zod-схеме (для карточек, таблиц, рекомендаций). */
export async function askJson<S extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: S;
  fallback: z.infer<S>;
  maxTokens?: number;
}): Promise<{ data: z.infer<S>; demo: boolean }> {
  if (isDemoMode()) return { data: opts.fallback, demo: true };
  try {
    const res = await getClient().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? 8000,
      output_config: { effort: EFFORT, format: betaZodOutputFormat(opts.schema) },
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      ...SERVER_FALLBACK,
    });
    if (res.stop_reason === "refusal" || res.parsed_output == null) throw new Error(`no parsed output (${res.stop_reason})`);
    return { data: res.parsed_output as z.infer<S>, demo: false };
  } catch (err) {
    console.error("[ai] askJson → fallback:", err);
    return { data: opts.fallback, demo: true };
  }
}

/** Стриминг текста для чата: отдаёт ReadableStream, который можно вернуть из route.ts как Response. */
export function streamText(opts: {
  system: string;
  messages: Msg[];
  fallback: string;
  maxTokens?: number;
}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return new ReadableStream({
    async start(controller) {
      let sent = false;
      const push = (s: string) => { sent = true; controller.enqueue(enc.encode(s)); };
      const typeOut = async (s: string) => { for (const part of s.match(/[\s\S]{1,8}/g) ?? []) { push(part); await sleep(18); } };
      if (isDemoMode()) { await typeOut(opts.fallback); controller.close(); return; }
      try {
        const stream = getClient().beta.messages.stream({
          model: AI_MODEL,
          max_tokens: opts.maxTokens ?? 8000,
          output_config: { effort: EFFORT },
          system: opts.system,
          messages: opts.messages,
          ...SERVER_FALLBACK,
        });
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") push(ev.delta.text);
        }
        const final = await stream.finalMessage();
        if (!sent || final.stop_reason === "refusal") await typeOut(opts.fallback);
      } catch (err) {
        console.error("[ai] streamText → fallback:", err);
        if (!sent) await typeOut(opts.fallback);
        else push("\n\n_(связь с AI прервалась — показан частичный ответ)_");
      }
      controller.close();
    },
  });
}
