import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BRAND } from '../public/brand.js';

export async function syncBotAvatar({ store, botToken, fetchImpl = fetch, avatarPath = new URL(`../public${BRAND.botAvatar}`, import.meta.url) }) {
  const image = await readFile(avatarPath);
  const avatarHash = createHash('sha256').update(image).digest('hex');
  if ((await store.getBotSettings()).avatarHash === avatarHash) return { updated: false };
  const form = new FormData();
  form.set('photo', JSON.stringify({ type: 'static', photo: 'attach://avatar' }));
  form.set('avatar', new Blob([image], { type: 'image/jpeg' }), 'obvious-bot.jpg');
  // Keep the token out of logs and never surface the raw transport error, which can contain the URL.
  let result;
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/setMyProfilePhoto`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Telegram API');
    result = await response.json();
  } catch { throw new Error('Не удалось обновить аватарку бота в Telegram. Повторим при следующем запуске.'); }
  if (!result?.ok || result.result !== true) throw new Error('Telegram не подтвердил обновление аватарки бота.');
  await store.updateBotSettings({ avatarHash, avatarVersion: BRAND.avatarVersion });
  return { updated: true };
}
