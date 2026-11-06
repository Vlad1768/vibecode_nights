// Что делать с кнопками сообщения после нажатия (§10.2 BOT_SCENARIO: «после нажатия кнопки гаснут или меняются»).
// Возвращает новый reply_markup, null — убрать все кнопки, undefined — ничего не менять.

// Кнопки, после которых сообщение остаётся «живым» (можно нажать ещё что-то под ним).
const KEEP = new Set(['profile', 'advice', 'criteria', 'how', 'learn', 'template', 'pause']);

export function buttonsAfterPress(markup, data) {
  const rows = markup?.inline_keyboard;
  if (!Array.isArray(rows)) return undefined;
  if (KEEP.has(data)) return undefined;
  if (/^done:\d$/.test(data)) {
    // «✔ Дело 2» → «☑️ 2»: остальные дела и кнопки остаются.
    return { inline_keyboard: rows.map((row) => row.map((btn) => (btn.callback_data === data ? { ...btn, text: `☑️ ${data.slice(5)}` } : btn))) };
  }
  if (data === 'pin' || data === 'remind') {
    // Эти кнопки исчезают, остальное (дела, второй раунд) остаётся.
    const left = rows.map((row) => row.filter((btn) => btn.callback_data !== data)).filter((row) => row.length);
    return { inline_keyboard: left };
  }
  return null;
}
