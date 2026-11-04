#!/usr/bin/env node
// Скриншоты страниц + ошибки консоли. Нужен playwright (см. ниже).
//
//   node scripts/shot.mjs                      → http://localhost:3000/
//   node scripts/shot.mjs / /list /chat        → несколько страниц
//   node scripts/shot.mjs --base http://localhost:5173 / /about
//   node scripts/shot.mjs --mobile-only /      (или --desktop-only)
//
// Результат: .shots/<страница>-desktop.png и -mobile.png + сводка ошибок.
// Код выхода 1, если были ошибки консоли / упавшие запросы / страница не открылась.
//
// Если playwright не установлен (один раз на компьютер):
//   npm i -g playwright && playwright install chromium
import { createRequire } from "node:module";
import { mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const args = process.argv.slice(2);
let base = "http://localhost:3000";
let modes = ["desktop", "mobile"];
const pages = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--base") base = args[++i];
  else if (a === "--mobile-only") modes = ["mobile"];
  else if (a === "--desktop-only") modes = ["desktop"];
  else pages.push(a);
}
if (pages.length === 0) pages.push("/");
base = base.replace(/\/$/, "");

function loadPlaywright() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const roots = [process.cwd(), path.join(process.cwd(), "web"), path.resolve(here, "..", "web"), here];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    try { return createRequire(pathToFileURL(path.join(r, "noop.js")))("playwright"); } catch {}
  }
  try { // глобальная установка: npm i -g playwright
    const g = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return createRequire(pathToFileURL(path.join(g, "noop.js")))(path.join(g, "playwright"));
  } catch {}
  console.error("Нет playwright. Установи один раз: npm i -g playwright && playwright install chromium");
  process.exit(2);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const outDir = path.resolve(process.cwd(), ".shots");
mkdirSync(outDir, { recursive: true });

const viewports = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

let problems = 0;
for (const p of pages) {
  const url = p.startsWith("http") ? p : base + (p.startsWith("/") ? p : "/" + p);
  const slug = (new URL(url).pathname.replace(/^\/|\/$/g, "").replace(/[^\w-]+/g, "_") || "home");
  for (const mode of modes) {
    const ctx = await browser.newContext({ ...viewports[mode], locale: "ru-RU" });
    const page = await ctx.newPage();
    const errs = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 300)); });
    page.on("pageerror", (e) => errs.push("pageerror: " + String(e.message || e).slice(0, 300)));
    page.on("response", (r) => { if (r.status() >= 400) errs.push(`http ${r.status()}: ${r.url()}`); });
    page.on("requestfailed", (r) => errs.push(`failed: ${r.url()} (${r.failure()?.errorText})`));
    let status = "?";
    try {
      const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      status = resp ? resp.status() : "?";
      await page.waitForTimeout(500);
    } catch (e) {
      errs.push("goto: " + String(e.message || e).split("\n")[0]);
    }
    const file = path.join(outDir, `${slug}-${mode}.png`);
    try { await page.screenshot({ path: file, fullPage: true }); } catch (e) { errs.push("screenshot: " + e.message); }
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1).catch(() => false);
    if (hscroll) errs.push("layout: горизонтальная прокрутка (что-то шире экрана)");
    problems += errs.length;
    console.log(`${errs.length ? "✗" : "✓"} ${url} [${mode}] HTTP ${status} → ${path.relative(process.cwd(), file)}`);
    for (const e of errs) console.log("    " + e);
    await ctx.close();
  }
}
await browser.close();
console.log(problems ? `Проблем: ${problems}. Открой скриншоты (Read .shots/*.png) и исправь.` : "Ошибок нет. Посмотри скриншоты глазами (Read .shots/*.png).");
process.exit(problems ? 1 : 0);
