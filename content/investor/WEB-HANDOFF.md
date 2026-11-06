# Investfy: главное для продолжения за Никой

Прямое поручение Ники, 06.11.2026: **пять персонажей**, бренд **Investfy**, тёмный фон, красный/оранжевый/чёрный, немного синего, минимум жёлтого. Картинки и видео Ника будет генерировать сама в сервисе, который называет «синтакс». Эта страница — актуальное уточнение арт-дирекции; при расхождении со старыми формулировками в пакете приоритет здесь.

## Передача Герману и Владу: T26 / T32

Владелец реализации сайта — Герман; согласование и интеграция — Влад. Ника передаёт визуал и требования, не правит чужую `web/`.

### Референсы: что взять

1. **https://craft.wild.as/** — пиксельный след за курсором, проявление цветных пиксельных лиц при наведении, крупные изображения с короткими подписями. Страница открыта и проверена в браузере; на ней шесть canvas. В публичном HTML есть `getContext('2d')`, `pointermove`, отрисовка и сеточные эффекты. Предлагаем собственный Canvas 2D trail, а не тяжёлый 3D-движок и не копирование кода. Названия Cell/Brush и цветные пиксельные лица наблюдаются на странице. Точный алгоритм авторов не заявляем как полностью восстановленный.
2. **https://giga.ai/** — тёмная основа с тёплой красно-оранжевой подсветкой, крупная растровая типографика. В вычисленном стиле h1 проверен **Geist Pixel Line**, основной шрифт **Geist**. Это название шрифта референса, не обещание его кириллицы. Для русского безопасная предложенная пара — Press Start 2P для коротких меток и Golos Text для длинных текстов. Герману проверить нужные глифы выбранного файла; Investfy латиницей можно оформить Geist Pixel Line после проверки лицензии поставки.
3. **https://illoca.com/** — спокойная режиссура hero, плавные переходы, большой визуал. На текущей версии сайт Plamo; в браузере обнаружен autoplay loop **MP4** `plamo-trailer.mp4` и canvas. Кадр с женщиной за ноутбуком, описанный Никой, отдельно не подтверждён: версия сайта могла измениться. Для Investfy берём короткое собственное видео/петлю с постером, не обещаем идентичный движок.
4. **https://follow.art/** — референс Ники для композиции плавающих картинок вокруг основного содержания. Текст страницы получен, но визуальный просмотр упёрся в Cloudflare. Конкретный движок и поведение hover не подтверждены; размещение плавающих предметов ниже — наше предложение по запросу Ники.

### Точное задание на эффекты

- Фон `#09090D`, панели `#19181F`, текст `#F5F1ED`, красный `#F04452`, оранжевый `#FF6A22`, синий `#4263FF`. Жёлтая большая заливка запрещена; золотой возможен лишь в мелком аксессуаре персонажа.
- Сетка курсорного следа 8–12 CSS px, квадратные частицы. Основные цвета красный/оранжевый, до 10% синих. Время жизни 300–500 ms, частиц максимум 80. Один `canvas`, `pointer-events:none`, `requestAnimationFrame`; ограничить DPR до 2 и переиспользовать буфер. Это бюджет реализации, не факт о коде референса.
- След только в промо/hero, не поверх вопросов, ответов, кнопок и текста. Системный курсор сохраняется. На touch и `prefers-reduced-motion` след выключается, при скрытии вкладки цикл останавливается.
- Пять арт-карточек с PNG/WebP от Ники. В покое — приглушённый/дизеринг-вариант, на hover/focus/tap — цветная версия, сдвиг максимум 4–6 px и переход 180–250 ms. Через `mask-image`/две версии картинки можно получить пиксельное проявление; это предложенная реализация, а не подтверждённая технология сайта wild.
- Два маленьких лица/щита «Критика» и «Защита» проявляются цветом при hover **и keyboard focus**; на телефоне — по нажатию. Информация доступна без наведения.
- Один аккуратный красный световой ореол за hero, спокойный фон. Не превращать страницу в постоянно мигающую сцену. Плавающие предметы — 3–5: жетон, щит, печать, график без цифр, кристалл; не закрывают заголовок или CTA.
- Пять карточек — знакомство с концептами. В рабочем тренажёре по кейсу **один подтверждённый инвестор**. Остальные помечены «концепт», не становятся работающим выбором пяти AI-режимов без решения ведущего.
- Анимации боя: возражение → атака в щит проекта, подтверждённый ответ → блок, честный пробел → уклонение без бонуса. `reaction` в API — текст, не типизированный боевой исход: не угадывать победу по ключевым словам; до согласования с ядром использовать нейтральную сцену.

### Приёмка

390 px и desktop; кнопки доступны с клавиатуры; карточки понятны без hover; вопрос читается при движущемся курсоре; reduced-motion отключает движение; нет утечек canvas/обработчиков при переходах; изображения с постерами, lazy loading ниже первого экрана; одновременно проигрывается максимум одна основная петля. Реальные шрифты проверены на «Ё Й Д Ж ₽». Вторая сессия продолжает работать без анимаций. Макеты и эффекты ещё не внедрены — это задание владельцам сайта.

## Пять главных картинок: копировать в генератор

Формат каждой: **4:5, 1024×1280**, один персонаж в полный рост, запас по краям, одна высота камеры. Эти промо-карточки отличаются от технических 2:3 спрайтов в PROMPTS.md: карточки — для знакомства/презентации, спрайты — для боя. Нужны общие свет, детализация и масштаб во всех пяти. Текст и подписи добавляем на сайте, не генератором.

**Общий стиль — вставлять перед каждым описанием:**

```text
Create one premium pixel-art fashion character card for INVESTFY, a startup pitch training arena. Original adult character, full body, three-quarter view facing slightly left, bold editorial pose. Late-1990s 16-bit fighting-game aesthetic with crisp square pixel clusters, carefully art-directed silhouette, rich but controlled costume details, no smooth 3D. Near-black charcoal studio-arena background #09090D, subtle deep-red glow behind the figure, orange rim light and a tiny electric-blue edge accent. No yellow background. Keep the face readable, shoes visible, 12 percent clear margin and lower area uncluttered for a caption added later. One signature prop and at most two small floating pixel objects. Portrait 4:5, 1024x1280. No text, no logo, no watermark, no charts with numbers, no existing game characters, no extra limbs, no blur. Use the same rendering style, camera height and character scale across all five images.
```

### 1. Бизнес-ангел — «Золотой локоть»
```text
An adult silver-templed entrepreneur with a sharp skeptical half-smile and one raised eyebrow. Burgundy double-breasted suit, cream silk shirt with open collar, orange boxing hand wraps, a single gold signet ring. Confident relaxed stance, one hand adjusting the cuff as if about to ask a difficult question. A single arcade investment token floats near his shoulder; a small dark leather briefcase rests beside one foot. Refined, charismatic, slightly intimidating, never a caricature of wealth. Red-orange side lighting, sparse dark space around him.
```
Подпись: **«Вкладывает свои. Проверяет, не бросишь ли ты проект после диплома».**

### 2. Корпорация — «Мадам Протокол»
```text
An adult female corporate innovation director, sleek short dark hair, calm precise gaze, almost imperceptible polite smile. Architectural graphite trouser suit with exaggerated angular shoulders, black high-neck top, orange blank lanyard, electric-blue pointed shoes. She holds a chrome tablet like a shield. One tiny pixel padlock and one abstract connector float beside her, no symbols with lettering. Tall controlled posture, premium futuristic business fashion, minimal dark corporate arena, red glow behind the silhouette.
```
Подпись: **«Вежлива до первого вопроса про данные, внедрение и согласования».**

### 3. Грантовый фонд — «Комиссар Смета»
```text
An adult grant evaluator with square glasses, neatly parted hair and an unamused meticulous expression. Long bottle-green tailored coat over a burnt-orange turtleneck, black wide trousers and polished heavy boots. A sculptural copper approval stamp in one hand, a slim folder with red tabs under the other arm. One blank calendar tile floats near the shoulder. Stands perfectly upright as if inspecting a budget, theatrical severity with editorial elegance, no military insignia, no written labels.
```
Подпись: **«У каждого рубля — назначение. У каждого обещания — срок».**

### 4. Венчурный фонд — «Леди Икс»
```text
An adult female venture capital partner, sharp cheekbones, short sculptural haircut, impatient analytical gaze. Asymmetric ivory trouser suit over black silk, narrow orange visor glasses, black pointed boots, one small electric-blue lightning earring. She leans forward with one hand extended, asking for evidence. A single red ascending pixel staircase and a small blue faceted crystal float behind her. Strong runway-fashion silhouette, energetic but controlled, no literal numbers or dollar signs, restrained near-black arena.
```
Подпись: **«Ей нужен большой рынок. “Для всех” за ответ не считается».**

### 5. Авторский — «Хайп-Алхимик»
```text
An eccentric adult independent investor with a violet mullet, dark roots, alert eyes and a mischievous razor-sharp grin. Oversized tangerine faux-fur coat over a black Hawaiian shirt with red tropical flowers, black-and-cream checkerboard trousers, mismatched orange and electric-blue sneakers. Transparent cross-body bag holding toy arcade tokens. One glossy red hype bubble floats beside him and bursts into a few square pixels; a tiny blue repeat-arrow object hovers by the other shoulder. Maximalist fashion editorial, chaotic styling but intelligent confident posture, no drug paraphernalia. Clean strong silhouette on near-black with a dim red halo.
```
Подпись: **«Хайп закончился. Кто из клиентов вернулся?»**

## Короткий промпт для видео

Сначала прикрепить выбранную готовую картинку как референс. Получить один короткий клип, не пытаться генерировать весь сайт.

```text
Animate this approved INVESTFY pixel-art character without changing face, outfit, accessories, palette or pixel scale. Locked camera, four-second seamless idle loop. Tiny breathing motion, one blink, subtle shift of weight, coat edge moving by one or two pixel steps. One floating prop makes a very small slow orbit. Keep the feet fixed, no camera zoom, no morphing, no new objects, no text. First and last poses should match. Preserve hard pixel edges and the near-black red-lit background. No sound required.
```

Бой, 3 секунды: `Using the approved investor and adult student references on the same side-view pixel arena: investor anticipates, makes one theatrical strike into a geometric evidence shield, student blocks, both return to guard. Locked camera, stable identities, one orange pixel spark, no injury, no text. Critique attacks the project shield, not the student's body.`

Экспорт: PNG-мастер, MP4 для видео, GIF при необходимости; прозрачность только если реально поддерживается. Генератор может не обеспечить бесшовность и точную пиксельную сетку: проверить первый/последний кадры и края перед передачей разработчикам.

## Где всё остальное и что ещё сделать

- [Полные пять характеров](CAST.md), [все позы/сцены/промпты](PROMPTS.md), [арт-система и план one-pager](ART-DIRECTION.md).
- [Голоса студентов, критерии, шкала и метрики](../../docs/INVESTOR.md), [контрольные примеры](../../samples/investor/REFERENCE.md).
- Основной персонаж и веса пока кандидат: Влад уточняет жеребьёвку. Это единственная причина, почему T29 не отмечена готовой; сайт/бот не должны молча переключать правила.
- Ника генерирует пять картинок, утверждает сходство и передаёт файлы. Пока файлов картинок/видео в пакете нет. Герман реализует эффекты в T26, Влад проверяет интеграцию в T32.
- T31: собрать одну страницу, максимум две, с реальным кадром и ссылками. Материалы позволяют продолжить за Никой, но финальный deck/PDF не объявлен готовым.
