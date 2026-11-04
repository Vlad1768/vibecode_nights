// web/src/lib/use-ai-stream.ts — клиентский хук для стримингового ответа из route-chat.
"use client";
import { useCallback, useRef, useState } from "react";

export function useAiStream(url: string) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (body: unknown) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setText("");
      setError(null);
      setLoading(true);
      let full = "";
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          full += dec.decode(value, { stream: true });
          setText(full);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Не удалось получить ответ. Попробуйте ещё раз.");
      } finally {
        setLoading(false);
      }
      return full;
    },
    [url],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  return { text, loading, error, run, stop };
}
