import crypto from 'node:crypto';

const safeEqual = (a, b) => {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

/**
 * Validates the signed data that Telegram passes to a Mini App.
 * Never trust initDataUnsafe or any user id supplied by the browser.
 */
export function validateTelegramInitData(initData, botToken, maxAgeSeconds = 3600) {
  if (!initData || !botToken) throw new Error('Не удалось подтвердить сессию Telegram.');
  const params = new URLSearchParams(initData);
  if (new Set(params.keys()).size !== [...params.keys()].length) throw new Error('Повторяющиеся поля Telegram.');
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!hash || !Number.isFinite(authDate)) throw new Error('Неполные данные Telegram.');
  if (Math.abs(Math.floor(Date.now() / 1000) - authDate) > maxAgeSeconds) {
    throw new Error('Сессия Telegram устарела. Откройте Mini App заново.');
  }

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!safeEqual(expected, hash)) throw new Error('Подпись Telegram не совпала.');

  let user;
  try {
    user = JSON.parse(params.get('user') || '');
  } catch {
    throw new Error('Telegram не передал профиль пользователя.');
  }
  if (!Number.isSafeInteger(user.id) || user.id <= 0) throw new Error('Не удалось определить пользователя Telegram.');
  return { user, authDate, queryId: params.get('query_id') || null };
}

export function isTelegramMember(member) {
  if (!member) return false;
  if (member.status === 'creator' || member.status === 'administrator' || member.status === 'member') return true;
  return member.status === 'restricted' && member.is_member === true;
}
