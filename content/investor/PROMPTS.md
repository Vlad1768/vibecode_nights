# Промпты: персонажи, 15 кадров, анимации и сцены

## Как пользоваться

1. Сначала утвердить лицо и костюм одного инвестора в полном росте. Для пяти инвесторов — пять готовых промптов ниже.
2. Если нужно **15 картинок на каждого**, использовать утверждённый мастер каждого инвестора и 15 вариаций A01–A15: получится 75 кадров. Это не 75 разных персонажей. Для демо достаточно одного мастера, 6 движений и 1 петли.
3. Все промпты ниже независимы от конкретного сервиса. В «синтекс» сначала проверить название модели, поддержку image-to-image, референса персонажа, alpha, длительности и петли. Мы не предполагаем доступность функций только по названию сервиса.
4. Инвестор по умолчанию справа и смотрит влево; студент слева и смотрит вправо. Зафиксировать одинаковый размер, линию пола, ракурс и свет. Сохранять мастер как референс при каждом следующем запросе. Если референс не поддерживается, повторить всё описание, но одинаковость лица гарантировать нельзя.
5. Буквы, имена, KPI, числа, вопросы и HUD добавляются монтажом/интерфейсом, а не генератором. Медиа должны работать и без звука.
6. Мастер на однотонном фоне — не готовый прозрачный спрайт. Если нужен alpha: запросить прозрачность у поддерживающей её модели либо отдельно вырезать фон. Не называть чёрный фон прозрачным. GIF с прозрачностью может давать грубые края; для сайта предпочесть PNG/WebP-спрайты.

## 5 готовых промптов инвесторов

### I01 — Бизнес-ангел — Золотой локоть

```text
Create one original character for INVESTFY, a fashion-forward 1990s 16-bit arcade fighting game about defending a startup pitch. Full body, three-quarter view, facing screen-left, feet fully visible, ready-to-spar pose, centered with 12 percent clear padding. An adult silver-templed entrepreneur, burgundy double-breasted suit, open cream silk collar, gold boxing hand wraps, one heavy signet ring, compact confident stance, skeptical raised eyebrow, original face. Crisp intentional square pixel clusters, limited 24-color palette, strong readable silhouette, two-step cel shading, dark wine shadows, warm orange rim light, premium editorial costume design. Match a 128 by 192 logical sprite grid inside a 768 by 1152 export canvas; if exact pixel grid cannot be guaranteed, preserve clean flat clusters for later pixel cleanup. Plain solid near-black background #0B0909; clean separable silhouette. No lettering, no logos, no watermark, no UI, no charts, no frame, no photographic rendering, no smooth gradients, no blur, no gore, no duplicated limbs, no cropped hands or feet. Original adult human, not an existing game character or celebrity.
```

### I02 — Корпорация — Мадам Протокол

```text
Create one original character for INVESTFY, a fashion-forward 1990s 16-bit arcade fighting game about defending a startup pitch. Full body, three-quarter view, facing screen-left, feet fully visible, ready-to-spar pose, centered with 12 percent clear padding. An adult female corporate innovation director, sculptural charcoal power suit with exaggerated angular shoulders, blank burnt-orange lanyard, polished boots, chrome tablet held like a shield, precise slick hair, calm intimidating smile, original face. Crisp intentional square pixel clusters, limited 24-color palette, strong readable silhouette, two-step cel shading, dark wine shadows, warm orange rim light, premium editorial costume design. Match a 128 by 192 logical sprite grid inside a 768 by 1152 export canvas; if exact pixel grid cannot be guaranteed, preserve clean flat clusters for later pixel cleanup. Plain solid near-black background #0B0909; clean separable silhouette. No lettering, no logos, no watermark, no UI, no charts, no frame, no photographic rendering, no smooth gradients, no blur, no gore, no duplicated limbs, no cropped hands or feet. Original adult human, not an existing game character or celebrity.
```

### I03 — Грантовый фонд — Комиссар Смета

```text
Create one original character for INVESTFY, a fashion-forward 1990s 16-bit arcade fighting game about defending a startup pitch. Full body, three-quarter view, facing screen-left, feet fully visible, ready-to-spar pose, centered with 12 percent clear padding. An adult grant evaluator in a long bottle-green tailored coat, coral turtleneck, square spectacles, structured briefcase with color tabs, oversized copper approval stamp with no lettering, severe upright posture, original face. Crisp intentional square pixel clusters, limited 24-color palette, strong readable silhouette, two-step cel shading, dark wine shadows, warm orange rim light, premium editorial costume design. Match a 128 by 192 logical sprite grid inside a 768 by 1152 export canvas; if exact pixel grid cannot be guaranteed, preserve clean flat clusters for later pixel cleanup. Plain solid near-black background #0B0909; clean separable silhouette. No lettering, no logos, no watermark, no UI, no charts, no frame, no photographic rendering, no smooth gradients, no blur, no gore, no duplicated limbs, no cropped hands or feet. Original adult human, not an existing game character or celebrity.
```

### I04 — Венчурный фонд — Леди Икс

```text
Create one original character for INVESTFY, a fashion-forward 1990s 16-bit arcade fighting game about defending a startup pitch. Full body, three-quarter view, facing screen-left, feet fully visible, ready-to-spar pose, centered with 12 percent clear padding. An adult female venture partner, asymmetrical ivory trouser suit over black silk, narrow amber visor glasses, pointed boots, one lightning-shaped earring, tall athletic silhouette, impatient forward lean, original face. Crisp intentional square pixel clusters, limited 24-color palette, strong readable silhouette, two-step cel shading, dark wine shadows, warm orange rim light, premium editorial costume design. Match a 128 by 192 logical sprite grid inside a 768 by 1152 export canvas; if exact pixel grid cannot be guaranteed, preserve clean flat clusters for later pixel cleanup. Plain solid near-black background #0B0909; clean separable silhouette. No lettering, no logos, no watermark, no UI, no charts, no frame, no photographic rendering, no smooth gradients, no blur, no gore, no duplicated limbs, no cropped hands or feet. Original adult human, not an existing game character or celebrity.
```

### I05 — Свой персонаж — Хайп-Алхимик

```text
Create one original character for INVESTFY, a fashion-forward 1990s 16-bit arcade fighting game about defending a startup pitch. Full body, three-quarter view, facing screen-left, feet fully visible, ready-to-spar pose, centered with 12 percent clear padding. An eccentric adult independent investor, violet mullet with dark roots, oversized tangerine faux-fur coat over a tropical Hawaiian shirt, black-and-cream checkerboard trousers, mismatched sneakers, clear bag of toy arcade tokens, ordinary alert eyes and a razor-sharp skeptical expression, fashion-editorial maximalism, original face. No drug paraphernalia. Crisp intentional square pixel clusters, limited 24-color palette, strong readable silhouette, two-step cel shading, dark wine shadows, warm orange rim light, premium editorial costume design. Match a 128 by 192 logical sprite grid inside a 768 by 1152 export canvas; if exact pixel grid cannot be guaranteed, preserve clean flat clusters for later pixel cleanup. Plain solid near-black background #0B0909; clean separable silhouette. No lettering, no logos, no watermark, no UI, no charts, no frame, no photographic rendering, no smooth gradients, no blur, no gore, no duplicated limbs, no cropped hands or feet. Original adult human, not an existing game character or celebrity.
```

## Студент: мастер

```text
Create one original adult university startup founder, age 22, for the same fashion-forward 1990s 16-bit arcade fighting game INVESTFY. Full body, three-quarter view, facing screen-right, feet visible, compact confident boxing stance. Short dark curly hair, oversized cream varsity jacket with black cuffs and one abstract orange patch without letters, charcoal cargo trousers, orange high-top sneakers, small backpack, a slim laptop tucked into the backpack. Smart alert expression, resourceful equal opponent, never a helpless child. Crisp square pixel clusters, 24-color palette, two-step shading, wine-black shadows, warm orange rim light, clear silhouette, plain near-black #0B0909 background, generous margin, logical sprite target 128x192, export 768x1152. No words, no logos, no UI, no blur, no photography, no gore, no extra limbs.
```

Второй взрослый студенческий образ можно сделать заменой пола/причёски; для демо выбрать один и держать постоянным. Студент не обязан быть мускулистым, чтобы выглядеть достойным соперником.

## 15 кадров для каждого персонажа

Для каждого кадра прикрепить его мастер, использовать полное описание из I01–I05 и добавить соответствующий блок. Готовая формула: **мастер-референс + полный промпт персонажа + блок Axx**. При конфликте позы блок Axx заменяет ready-to-spar из мастер-промпта. Номера, имена и подписи только в имени файла.

Общий префикс для вариаций:
```text
Use the supplied approved character as a strict identity reference. Preserve the exact face, hairstyle, outfit, accessories, colors, pixel-cluster scale and body proportions. Change only the pose and crop described below. Keep the same camera and lighting. One image, one character, no text or UI.
```

| ID | Задача / формат | Английский блок для генерации |
|---|---|---|
| A01 | Портрет выбора, 1:1 | Head-and-shoulders selection portrait, face at three-quarter angle, challenging expression, square crop with clear silhouette. |
| A02 | Стойка целиком, 2:3 | Full-body neutral fighting stance, both feet planted on the shared baseline, shoulders relaxed, facing the opponent. |
| A03 | Слушает питч, 2:3 | Full-body attentive listening pose, one eyebrow raised, head slightly tilted, hands visible. |
| A04 | Не верит, 1:1 | Chest-up skeptical reaction, eyes narrowed, one open palm asking for evidence. |
| A05 | Задаёт вопрос, 2:3 | Full-body challenging gesture, one hand extended toward the opponent, mouth slightly open, no speech bubble. |
| A06 | Замах, 2:3 | Full-body clear anticipation pose for a stylized non-injurious sparring strike, weight shifted back, readable silhouette. |
| A07 | Атака, 2:3 | Full-body forward sparring strike ending before contact with the opponent, simple orange pixel impact arc, no injury. |
| A08 | Восстановление, 2:3 | Full-body recovery after the strike, weight returning to the original baseline, identical outfit and hands. |
| A09 | Блок, 2:3 | Full-body guard with both forearms raised, small amber geometric evidence shield in front, no lettering. |
| A10 | Уклонение, 2:3 | Full-body controlled side lean away from an incoming strike, both feet visible, calm alert expression. |
| A11 | Лёгкая отдача, 2:3 | Full-body mild comic recoil from a blocked attack, surprise rather than pain, no bruises or damage. |
| A12 | Думает, 1:1 | Chest-up thoughtful evaluation, chin lowered slightly, hand near chin, skeptical but fair. |
| A13 | Уважает ответ, 1:1 | Chest-up restrained approving nod, relaxed eyebrows, subtle half-smile, no trophy and no victory text. |
| A14 | Итоговая карточка, 2:3 | Full-body composed debrief stance, signature accessory held still, 30 percent blank space on the left for later UI compositing. |
| A15 | Промо, 2:3 | Full-body high-fashion editorial hero pose, dramatic asymmetric silhouette, same costume, clean cutout-friendly background. |

## Арена

```text
Original 16-bit pixel-art startup pitch fighting arena, side view, wide 16:9 composition, logical scene 640x360 enlarged to 1280x720 without smoothing. An after-hours university demo-day stage transformed into a boxing ring, dark black-wine floor, burnt-orange ropes, red corner lights, abstract investor board silhouettes far in the background, small empty podium off to one side. Clear empty fight area in the middle, one shared horizontal ground baseline, warm orange side light, restrained pixel dithering and crisp hard-edged clusters. Leave the top 18 percent and bottom 15 percent quiet for UI added later. No fighters, no words, no logos, no numerals, no real university insignia, no realistic render, no blood, no mist obscuring silhouettes.
```

## Общая инструкция для image-to-video

```text
Animate the supplied approved pixel-art reference without redesigning it. Locked side-view camera, fixed framing and floor baseline. Preserve exact character identity, outfit, accessories, face, scale and crisp pixel clusters. Simulate a limited 8-frame-per-second sprite animation; if the output container uses 24 fps, repeat frames rather than interpolating into smooth motion. No camera orbit, no zoom, no morphing, no new objects, no text, no audio required, no realistic skin, no injury. Keep the final full pose readable. Character motion only in the action described next.
```

Это художественная инструкция, не гарантия управляемого FPS генератора. Финальную частоту, обрезку и бесшовную петлю проверяют после экспорта. Не просим модель одновременно рисовать 15 лиц и полноценный сложный бой.

## Сцены движения

Каждый блок добавляется к общей инструкции; источник — утверждённый персонаж/пара на утверждённой арене. Контакт приходится в геометрический щит или в воздух, не в лицо.

### M01. Idle инвестора / 2 секунды, петля
```text
The investor on the right gently shifts weight, coat hem moves by one or two pixels, hands stay in guard. One blink, minimal breathing. The opponent on the left remains still. Begin and end in exactly the same neutral pose, matching silhouette, floor position and lighting for a seamless loop. No drifting or extra gestures.
```

### M02. Слушает / 2 секунды, петля
```text
The investor tilts the head a few degrees, raises one eyebrow and returns to the starting pose. The student holds a ready stance. Quiet listening, no attack. First and last frames match exactly.
```

### M03. Критика — атака / 1.5 секунды, одно проигрывание
```text
The investor on the right makes one readable anticipation move, then throws one exaggerated theatrical sparring strike toward the student's amber evidence shield on the left. A single small orange pixel spark appears at the shield. The student holds guard, nobody is injured. End with both characters back at the shared neutral baseline. No repeated attacks.
```

### M04. Аргумент выдержал — блок / 1.5 секунды, одно проигрывание
```text
The student's raised forearms form a clean block behind the amber geometric shield. One investor strike meets the shield, a small warm spark, then the investor recoils one step and nods with respect. Student remains composed and returns to guard. No score graphics, no glowing numbers.
```

### M05. Честное незнание — уклонение / 1.5 секунды
```text
The student smoothly leans aside as the investor's theatrical strike crosses empty air. Both return to neutral. The dodge is measured, not triumphant; no reward particles, no victory gesture. Preserve both complete silhouettes and exact clothing.
```

### M06. Аргумент слабый — отдача / 1.5 секунды
```text
An investor objection creates one pixel ripple across the student's geometric shield. The shield shows a small temporary crack; the student slides back one short step, remains standing, then calmly resets guard. No body damage, no shame, no fallen character. Clear constructive training tone.
```

### M07. Думает / 2 секунды, петля
```text
The investor stands still in a thoughtful pose, lightly taps one finger against the signature accessory, looks toward the student and returns to the exact initial pose. A quiet pause, not a defeat animation. No ellipsis or generated text.
```

### M08. Уважение / 2 секунды
```text
After the round, both adult characters lower their guard and exchange a small respectful nod. The investor takes half a step back, giving the student room. End in a stable composed pose. No handshake if hands become anatomically unstable; a nod is enough.
```

### M09. Три улучшения / 3 секунды
```text
Three empty pixel-art upgrade tokens appear one at a time beside the student: a shield, a coin, a stopwatch. Each floats by only two pixels and settles into a fixed row, with wide empty spaces for labels added later. Characters remain still. Exactly three tokens, no words, no numerals, no additional rewards.
```

### M10. Итог со статами / 3 секунды, петля
```text
The investor on the right gently sways in a calm debrief pose. Five blank outlined horizontal meter slots stay completely still on the left; no filling, no numerical values and no text. Only the figure breathes and blinks. Return to the first pose exactly. Leave all evidence, labels and scores to later UI compositing.
```

Пять слотов — только декоративная обзорная группа. Реальные десять критериев показываются отдельно полностью; генератор их не считает.

### M11. Промо-петля / 6 секунд
```text
Create a clean six-second side-view training sparring loop using the approved student, investor and arena. Seconds 0–1.5: both idle. Seconds 1.5–3: investor makes one theatrical strike into the student's evidence shield. Seconds 3–4.5: student blocks and investor takes a small respectful recoil. Seconds 4.5–6: both reset to precisely the opening idle pose. One small orange impact spark only, no injuries, no winner text, locked camera and stable identity throughout.
```

Если единый клип расползается, генерировать M01, M03, M04 отдельно и собрать последовательность монтажом; это надёжнее, чем тратить попытки на длинный бой.

### M12. Фирменный приём Хайп-Алхимика / 2 секунды
```text
The eccentric investor in the orange faux-fur coat releases three small confetti-like hype bubbles from an open palm toward the student's amber shield. Bubbles pop into tiny orange square particles before reaching the student. The student holds a calm guard; the investor returns to the opening stance. No substances, no intoxication, no text, no change to coat or hairstyle.
```

## Предметы / навыки

```text
Create an original 16-bit pixel-art game icon of [OBJECT], centered, isolated on near-black #0B0909, crisp 32x32 logical grid enlarged to 256x256 with hard square edges. Warm orange, pale cream and dark wine palette, strong readable silhouette, maximum three shades per material. No words, no numbers, no letters, no border, no glow blur, no 3D rendering. One icon only.
```

Вместо OBJECT по одному: evidence shield; business coin; market compass; finance safe; legal seal; first-sale receipt without lettering; risk helmet; planning stopwatch; uniqueness crystal; investment star. Сначала проверить читаемость в 32 px, затем анимировать лёгкое покачивание 2 секунды; численные значения только интерфейсом.

## Выходные файлы

| Носитель | Формат и цель | Проверка |
|---|---|---|
| Портрет | `I05_A01.png`, квадрат 768×768 | Один герой, лицо узнаваемо в 96×96 |
| Полный рост | `I05_A02.png`, 768×1152 | Ноги/кисти целиком, общий масштаб |
| Сайт | PNG/WebP-спрайты или короткий WebM/MP4, сцена 1280×720 | Чёткие пиксели, постер, reduced-motion |
| Telegram | MP4 без звука, 960×540, цель ≤3 MB | Реальная отправка в бот, статичный fallback |
| One-pager | Ключевой PNG + промо MP4/GIF | В статичном PDF понятен основной смысл |

GIF — дополнительный экспорт, не единственный мастер. Исходники хранить без букв и оценок, чтобы одни кадры подходили сайту, боту и презентации. Лицо, волосы, аксессуар и цвет костюма не меняются между кадрами; предметы не телепортируются из руки в руку. Последний кадр петли сравнить с первым. Не обещаем сжатие и бесшовность до реального экспорта.
