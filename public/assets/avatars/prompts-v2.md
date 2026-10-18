# «Очевидно» · типографическая фирменная пара v2

Две новые самостоятельные генерации встроенным imagegen. Это растровые оригиналы, не имитация существующего чужого логотипа. Скрипт build-avatars.mjs только уменьшает и сжимает их, не рисуя новую графику.

## Бот

Use case: logo-brand. Asset type: finished professional square Telegram avatar, brand Очевидно, a Russian shop of obvious answers and deadpan-humor certificates. Primary request: replace the generic glossy 3D avatar with a genuinely art-directed flat typographic identity. Create a confident custom lowercase Cyrillic ligature 'оч.' as one tightly kerned heavy geometric wordmark: the letters are Cyrillic о and ч, followed by a square period. Exact visible text: 'оч.' only; spell о-ч-точка. This must read as two joined designed letters, not a solitary letter O, ring, checkmark or speech bubble. Composition: oversized warm-white typographic emblem centered on a full-bleed near-black graphite square, one small electric-cobalt square period as the sole color accent, beautiful optical spacing, emblem contained in central 66% for a circular Telegram crop. Style: independent contemporary graphic design studio, restrained editorial Swiss/Russian typographic poster, precise vector-like edges, robust silhouette legible at 40 pixels, almost imperceptible printed-paper texture. No 3D, no chrome, no glossy plastic, no bevel, no glowing effects, no gradients, no robot, no mascot, no headset, no emoji, no stars, no borders, no mockup or contact sheet, no watermark. One standalone polished avatar image.

## Поддержка / менеджер

Use case: logo-brand. Asset type: finished professional square Telegram manager/support avatar for Russian brand Очевидно; companion to a graphite typographic bot avatar. Primary request: a coherent flat editorial identity, not a generic 3D icon or personal portrait. Use the exact custom lowercase Cyrillic wordmark 'оч.' (Cyrillic о-ч followed by a square period), tight heavy rounded geometric grotesk with custom joined letterforms and precise optical spacing. Place this large graphite wordmark centrally on a warm ivory full-bleed square; the square period is electric cobalt blue. Add the exact understated small uppercase Cyrillic label 'ПОДДЕРЖКА' in a clean spaced geometric sans-serif just below the large emblem, entirely within the central 68% circular crop safe area. This is the inverse-palette companion of the bot identity: same visual language, clearly distinct warm-light background identifies the human manager. Style: refined independent graphic-design studio, modern editorial typographic identity, sharp flat vector-like silhouette, nearly imperceptible paper grain, no ornamental clutter. Text verbatim: 'оч.' and 'ПОДДЕРЖКА', nothing else. No 3D, no chrome, no sheen, no shadows, no gradients, no portraits, no headset, no robot, no badge or check mark, no standalone O or surrounding ring, no frame, no watermark. One standalone square finished avatar, not a presentation board.

## Файлы

- bot-avatar-v2.jpg и manager-avatar-v2.jpg: 640 × 640 для Telegram.
- *-avatar-v2-128.webp: лёгкие версии для интерфейса.
- *-avatar-source-v2.png: исходники генерации.

Графитовый фон бота и светлый фон поддержки различают роли. Лигатура «оч.» и синяя точка сохраняют общий характер. Нет личных портретов, хрома, объёмных стикеров и случайных декоративных значков. Главный знак и подпись укладываются в круглый кроп Telegram.

Прошлая пара сохранена локально в artifacts/brand-v1 и не включена в production-деплой. Версии JPG/WebP имеют собственные имена и в production отдаются с долгим кэшем; HTML перепроверяется при открытии. Повторный деплой не повторяет загрузку аватарки в Telegram, если хеш файла уже сохранён после успешной установки.
