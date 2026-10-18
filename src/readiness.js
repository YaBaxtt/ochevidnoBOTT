import { validatePublicAppUrl } from './deployment.js';
import { validLink } from './product.js';
import { BRAND } from '../public/brand.js';

export function readinessSnapshot({ config, settings, telegramConnected }) {
  let addressOk = false;
  try { validatePublicAppUrl(config.publicAppUrl); addressOk = true; } catch {}
  let supportOk = false;
  try { supportOk = Boolean(validLink(config.supportUrl)); } catch {}
  const demo = Boolean(config.demo);
  const avatarReady = settings.avatarVersion === BRAND.avatarVersion && /^[a-f0-9]{64}$/.test(settings.avatarHash || '');
  return {
    mode: demo ? 'demo' : 'live',
    checkedAt: new Date().toISOString(),
    appUrl: addressOk ? config.publicAppUrl : null,
    botUrl: config.botUsername ? `https://t.me/${config.botUsername}` : null,
    branding: BRAND,
    checks: [
      { key: 'telegram', title: 'Подключение Telegram', state: demo ? 'info' : telegramConnected ? 'ok' : 'warning', detail: demo ? 'Демо не подключает настоящего бота.' : telegramConnected ? 'Клиент бота создан; работоспособность команд проверь в Telegram.' : 'Проверь BOT_TOKEN и журнал запуска.' },
      { key: 'storage', title: 'Хранилище настроек', state: 'ok', detail: demo ? 'Локальная память. Данные сбросятся после перезапуска.' : 'Настройки прочитаны из базы данных.' },
      { key: 'address', title: 'Адрес мини-аппа', state: addressOk ? 'ok' : demo ? 'info' : 'warning', detail: addressOk ? 'Формат HTTPS-адреса верный. Доступность сайта этим списком не проверяется.' : 'Создай публичный домен в Railway и задай PUBLIC_APP_URL.' },
      { key: 'avatar', title: 'Последняя загрузка аватарки', state: demo ? 'info' : avatarReady ? 'ok' : 'warning', detail: demo ? 'В демо аватарка не отправляется в Telegram.' : avatarReady ? `Telegram подтвердил версию ${BRAND.avatarVersion} при последней синхронизации.` : 'Загрузится при следующем запуске бота. Временная ошибка не остановит продажи.' },
      { key: 'support', title: 'Контакт менеджера', state: supportOk ? 'ok' : 'info', detail: supportOk ? 'HTTPS-контакт поддержки задан.' : 'Добавь SUPPORT_URL с логином менеджера. /paysupport работает и без него.' },
      { key: 'payment', title: 'Проверка покупки и возврата', state: 'info', detail: 'Проверь вручную одну реальную покупку и возврат Stars. Автоматические тесты не подтверждают внешний платёж.' }
    ]
  };
}
