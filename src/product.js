export const LEGACY_BOT_SETTINGS = {
  welcome: 'Привет, {name}! Это «Очевидно» — магазин ответов, которые ты и так почти знаешь.\n\nУзнай свой год рождения, рассуди спор за пиццу или получи официальную справку об усталости. Выбирай карточку, смотри цену, оплачивай в Stars — и забирай результат в коллекцию.\n\nЕсть задания с бонусами и фонарик, который лучше не включать ночью.',
  buttonText: 'Открыть «Очевидно»',
  description: 'Серьёзные ответы на несерьёзные вопросы. Карточки, сертификаты и немного абсурда.',
};

export const DEFAULT_BOT_SETTINGS = {
  welcome: '👋 Привет, {name}!\n\nЭто «Очевидно» — очевидные ответы с серьёзным оформлением.\n\n🃏 Узнай год рождения, сложи два числа или закажи ответ, который ты почти знал.\n🎓 Получи именную шуточную грамоту — с печатью, подписью и поводом переслать друзьям.\n\nВыбери карточку → посмотри цену → оплати в Telegram Stars. Результат останется в коллекции.\n\nЗадания и промокоды дают бонусы на покупки. Начнём с очевидного?',
  buttonText: 'Открыть «Очевидно»',
  description: '🃏 Очевидные ответы. 🎓 Именные шуточные грамоты.\n\nКарточки, наборы и частная коллекция — в одном мини-аппе. Цена видна до оплаты в Telegram Stars, покупки сохраняются в коллекции.\n\nЕсть задания, промокоды и фонарик. Да, просто фонарик.\n\nПомощь: /help · Правила: /terms · По оплате: /paysupport',
  shortDescription: '🃏 Очевидные ответы и именные шуточные грамоты. Покупки в Stars, результаты — в коллекции.'
};

// Upgrade only untouched stock copy. Text written by the owner must survive a deploy.
export function resolveBotSettings(stored = {}) {
  const settings = { ...DEFAULT_BOT_SETTINGS, ...stored };
  for (const key of ['welcome', 'description']) {
    if (settings[key] === LEGACY_BOT_SETTINGS[key]) settings[key] = DEFAULT_BOT_SETTINGS[key];
  }
  return settings;
}

export const TERMS_VERSION = '2026-10-18';

export function terms(supportUrl) {
  return `Правила «Очевидно» · версия ${TERMS_VERSION}\n\n1. Карточки — развлекательный цифровой контент. Шуточные оценки не являются диагностикой или предсказанием.\n2. До покупки показаны цена и описание. Реальная оплата выполняется в Telegram Stars. Результат открывается после подтверждения платежа Telegram.\n3. За проверенные задания начисляются бонусы. Бонусами можно полностью оплатить карточку: 1 бонус соответствует 1 единице её цены. Бонусы не являются Stars, Gram или деньгами; они не выводятся и не передаются.\n4. Если карточка не выдана, произошла повторная оплата или другая ошибка, обратитесь в /paysupport или ${supportUrl}. Мы проверим покупку и восстановим доступ либо оформим возврат. Само по себе несогласие с шуточным результатом не означает техническую ошибку. Это условие не отменяет применимые права покупателя.\n5. Фонарик можно выключить бесплатно. Платна только отдельная добровольная карточка.\n6. Кошелёк Gram подключается через TON Connect. Приложение показывает адрес и открытый баланс в сети TON. Подключение не начисляет монеты и не используется для оплаты карточек. Средства остаются в кошельке; приложение не хранит приватные ключи.\n7. Рекламные сообщения бота можно отключить в профиле или командой /stop. Объявления внутри приложения можно закрыть.\n8. Администратор может выдать бесплатные открытия. Одно открытие даёт одну доступную карточку или набор без списания Stars и бонусов. Повторный просмотр в коллекции бесплатен. Открытия не являются деньгами, не передаются и не выводятся.\n9. При отправке фото или выборе inline-результата вы делитесь картинкой с именем и ответом. Автоматически username покупателя не добавляется. Отправленные и сохранённые получателями копии невозможно отозвать. Образцы отмечены отдельно и не являются вашим персональным результатом.`;
}

export function publicPurchase(purchase) {
  if (!purchase) return null;
  const { id, cardId, amount, state, createdAt, paymentMethod = 'stars', title } = purchase;
  return { id, cardId, amount, state, createdAt, paymentMethod, title, ...(state === 'paid' ? { result: purchase.result } : {}) };
}

export function validPayment(purchase, payment, userId) {
  return Boolean(purchase && (!purchase.paymentMethod || purchase.paymentMethod === 'stars') && purchase.state === 'pending' &&
    purchase.userId === String(userId) && purchase.amount === payment.total_amount && payment.currency === 'XTR');
}

export function validLink(value) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new Error('Укажите полную ссылку https://…'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Для кнопки нужна безопасная HTTPS-ссылка.');
  return url.href;
}
