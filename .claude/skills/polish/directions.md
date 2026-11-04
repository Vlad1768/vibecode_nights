# Дизайн-направления (выбери одно на весь продукт)

Все шрифты есть в `next/font/google` **с кириллицей** (проверено). Один режим на продукт: светлый или тёмный, не оба. Тёмную тему на хакатоне не делаем, если она не часть направления.

## Как подключить (одинаково для всех направлений)

`web/src/app/layout.tsx`:
```tsx
import { Manrope, JetBrains_Mono } from "next/font/google"; // ← шрифты выбранного направления
const body = Manrope({ subsets: ["latin", "cyrillic"], variable: "--font-body" });
const display = Manrope({ subsets: ["latin", "cyrillic"], variable: "--font-display", weight: ["600", "700", "800"] });
const code = JetBrains_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-code" });
// <html lang="ru" className={`${body.variable} ${display.variable} ${code.variable} h-full antialiased`}>
```

`web/src/app/globals.css`:
- **Без shadcn** возьми готовый полный файл `.claude/skills/kickoff/templates/globals.css` (все цвета и радиусы уже зарегистрированы) и замени в нём `:root` блоком своего направления. Ниже можно не читать.
- **С shadcn** замени значения в `:root` блоком направления, удали `.dark` и `@media (prefers-color-scheme: dark)`, если остались, и добавь:
```css
@theme inline {
  --font-sans: var(--font-body);
  --font-heading: var(--font-display);
  --font-mono: var(--font-code);
}
body { font-family: var(--font-body), system-ui, sans-serif; background: var(--background); color: var(--foreground); }
h1, h2, h3 { font-family: var(--font-display), var(--font-body), sans-serif; letter-spacing: -0.02em; }
.tabular { font-variant-numeric: tabular-nums; }
```
С shadcn зарегистрируй ещё статусные цвета: `--color-success: var(--success); --color-warning: var(--warning);` в `@theme inline`, тогда заработают `text-success` и `bg-warning/10`.

---

## 1. «Чистый продукт» — B2B-инструменты, SaaS, сервисы для сотрудников
Нейтральная база, много воздуха, один сигнальный акцент. Ощущение: «этим уже пользуются».
Шрифты: Manrope (текст и заголовки 700–800), JetBrains Mono для цифр и меток.
```css
:root {
  --background: #FAFAF9; --foreground: #17171A;
  --card: #FFFFFF; --card-foreground: #17171A;
  --popover: #FFFFFF; --popover-foreground: #17171A;
  --primary: #FF5A1F; --primary-foreground: #FFFFFF;
  --secondary: #F2F2F0; --secondary-foreground: #17171A;
  --muted: #F2F2F0; --muted-foreground: #6E6E76;
  --accent: #FFF0E8; --accent-foreground: #9A3412;
  --destructive: #DC2626; --success: #15803D; --warning: #B45309;
  --border: #E6E6E3; --input: #E6E6E3; --ring: #FF5A1F;
  --radius: 0.75rem;
}
```
Фирменная деталь: крупные цифры эффекта в mono, тонкие разделители 1px, акцентный цвет только на главной кнопке и в ключевой метрике.

## 2. «Тёплый редакционный» — образование, здоровье, HR, сервисы для людей
Кремовый фон, засечный заголовок, терракота. Ощущение: «сделано с заботой».
Шрифты: заголовки — Playfair Display (или Literata), текст — Onest.
```css
:root {
  --background: #F7F3EC; --foreground: #1F1B16;
  --card: #FFFDF9; --card-foreground: #1F1B16;
  --popover: #FFFDF9; --popover-foreground: #1F1B16;
  --primary: #B4532A; --primary-foreground: #FFFDF9;
  --secondary: #EDE6DA; --secondary-foreground: #1F1B16;
  --muted: #EDE6DA; --muted-foreground: #6B6257;
  --accent: #DCE8E2; --accent-foreground: #2F5D50;
  --destructive: #B42318; --success: #2F5D50; --warning: #B7791F;
  --border: #E2D9CB; --input: #E2D9CB; --ring: #B4532A;
  --radius: 0.875rem;
}
```
Фирменная деталь: крупный засечный заголовок с курсивным словом, мягкие тени `0 1px 2px rgb(31 27 22 / .06), 0 8px 24px rgb(31 27 22 / .06)`, второй акцент лесной зелёный (#2F5D50) для статусов «успех».

## 3. «Тёмный техно» — devtools, безопасность, аналитика, AI-агенты
Почти чёрный фон, кислотный акцент, моноширинные метки. Ощущение: «мощный инструмент».
Шрифты: заголовки — Unbounded (600–700), текст — Inter, метки и цифры — JetBrains Mono.
```css
:root {
  --background: #0B0D10; --foreground: #E6E8EB;
  --card: #13161B; --card-foreground: #E6E8EB;
  --popover: #13161B; --popover-foreground: #E6E8EB;
  --primary: #B8FF3B; --primary-foreground: #0B0D10;
  --secondary: #1B1F26; --secondary-foreground: #E6E8EB;
  --muted: #1B1F26; --muted-foreground: #8A93A0;
  --accent: #1E2A12; --accent-foreground: #B8FF3B;
  --destructive: #FF5C5C; --success: #3DDC97; --warning: #FFC145;
  --border: #232832; --input: #232832; --ring: #B8FF3B;
  --radius: 0.625rem;
}
```
Фирменная деталь: фон-сетка (`background-image: linear-gradient(#ffffff08 1px, transparent 1px), linear-gradient(90deg, #ffffff08 1px, transparent 1px); background-size: 32px 32px;`), метки КАПСОМ в mono 11px, мягкое свечение у ключевой цифры (`text-shadow: 0 0 24px rgb(184 255 59 / .35)`).

## 4. «Финтех / доверие» — банки, страхование, госсервисы, финансы, B2B-аналитика
Строго, точно, табличные цифры. Ощущение: «этому можно доверить деньги».
Шрифты: IBM Plex Sans (текст и заголовки 600), IBM Plex Mono для сумм (`weight: ["400","500","600"]`).
```css
:root {
  --background: #F5F7FA; --foreground: #0B1B2B;
  --card: #FFFFFF; --card-foreground: #0B1B2B;
  --popover: #FFFFFF; --popover-foreground: #0B1B2B;
  --primary: #0A6E5C; --primary-foreground: #FFFFFF;
  --secondary: #E9EEF3; --secondary-foreground: #0B1B2B;
  --muted: #E9EEF3; --muted-foreground: #5B6B7C;
  --accent: #E3F4EF; --accent-foreground: #0A6E5C;
  --destructive: #D92D20; --success: #12A150; --warning: #B54708;
  --border: #DCE3EA; --input: #DCE3EA; --ring: #0A6E5C;
  --radius: 0.5rem;
}
```
Фирменная деталь: суммы в mono с `tabular-nums`, рост зелёным (#12A150), падение красным со стрелками, спарклайны в карточках метрик, аккуратные таблицы с зеброй `bg-muted/40`.

## 5. «Яркий дружелюбный» — потребительские сервисы, студенты, еда, события, экология
Насыщенные цвета, круглые формы, «стикеры». Ощущение: «хочется потыкать».
Шрифты: заголовки — Unbounded (700) или Rubik (800), текст — Rubik или Nunito.
```css
:root {
  --background: #FFFBF5; --foreground: #1A1A2E;
  --card: #FFFFFF; --card-foreground: #1A1A2E;
  --popover: #FFFFFF; --popover-foreground: #1A1A2E;
  --primary: #FF4D6D; --primary-foreground: #FFFFFF;
  --secondary: #FFF1C9; --secondary-foreground: #1A1A2E;
  --muted: #F3EEE6; --muted-foreground: #66667A;
  --accent: #D6FFF1; --accent-foreground: #05795B;
  --destructive: #E11D48; --success: #05795B; --warning: #C2410C;
  --border: #1A1A2E; --input: #E7E1D8; --ring: #FF4D6D;
  --radius: 1.25rem;
}
```
Фирменная деталь: «плотные» тени `4px 4px 0 #1A1A2E` у карточек и кнопок, обводка 2px, кнопки-пилюли, цветные бейджи-стикеры (жёлтый #FFD166, мятный #06D6A0) с лёгким поворотом `rotate-[-2deg]`.
