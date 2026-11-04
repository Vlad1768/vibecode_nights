// web/src/app/api/analyze/route.ts — структурированный ответ (карточки, оценки, рекомендации).
import { z } from "zod";
import { askJson } from "@/lib/ai";

// Схема = форма данных, которую рисует UI. Держи её в docs/CONTRACT.md.
const Result = z.object({
  summary: z.string().describe("Вывод в одном предложении"),
  score: z.number().describe("Оценка 0–100"),
  items: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      priority: z.enum(["high", "medium", "low"]),
    }),
  ),
});
export type AnalyzeResult = z.infer<typeof Result>;

const SYSTEM = `Ты — <эксперт>. Проанализируй входные данные и верни результат строго по схеме. Тексты — по-русски, конкретно, с цифрами из данных.`;

const FALLBACK: AnalyzeResult = {
  summary: "<заготовленный вывод для демо>",
  score: 78,
  items: [
    { title: "<пункт 1>", detail: "<деталь>", priority: "high" },
    { title: "<пункт 2>", detail: "<деталь>", priority: "medium" },
  ],
};

export async function POST(req: Request) {
  const input = await req.json();
  const { data, demo } = await askJson({
    system: SYSTEM,
    prompt: `Данные:\n${JSON.stringify(input)}`,
    schema: Result,
    fallback: FALLBACK,
  });
  return Response.json({ ...data, demo });
}
