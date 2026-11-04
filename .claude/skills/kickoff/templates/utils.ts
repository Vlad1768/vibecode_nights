import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Склеивает классы Tailwind без конфликтов: cn("p-2", cond && "p-4") → "p-4". */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
