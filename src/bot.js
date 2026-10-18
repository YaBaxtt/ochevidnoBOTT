import { Markup, Telegraf } from 'telegraf';
import { publicPurchase, terms, validPayment } from './product.js';

export function createBot({ store, config }) {
  if (!config.botToken || config.demo) return null;
  const bot = new Telegraf(config.botToken);
  store.ownerIds = config.adminIds || new Set();
  const promoWaiting = new Map();
  const menu = (text = 'Открыть «Очевидно»', tab = 'home') => Markup.inlineKeyboard([
    [Markup.button.webApp(text, `${config.publicAppUrl}/?tab=${tab}`)],
    [Markup.button.webApp('Моя коллекция', `${config.publicAppUrl}/?tab=collection`), Markup.button.webApp('Задания', `${config.publicAppUrl}/?tab=tasks`)],
    [Markup.button.callback('Ввести промокод', 'enter_promo'), Markup.button.webApp('Наборы', `${config.publicAppUrl}/?tab=bundles`)],
    [Markup.button.callback('О проекте', 'show_about'), Markup.button.callback('Помощь', 'show_help')]
  ]);
  const help = 'Выбирай карточку в Mini App → заполни вопросы → проверь сумму → подтверди оплату в Telegram. Результат сохранится в коллекции.\n\nЗадания дают бонусы на карточки. TON-кошелёк подключается в профиле.\n\n/collection — мои карточки\n/paysupport описание проблемы — помощь по оплате\n/stop — отключить рекламные сообщения\n/start — снова включить сообщения';
  bot.use(async (ctx, next) => {
    if(ctx.chat && ctx.chat.type !== 'private') return;
    if (ctx.from && ctx.chat?.type === 'private') await store.upsertUser(ctx.from);
    return next();
  });
  bot.start(async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    await store.setNotifications(ctx.from.id, true, true);
    await store.recordStart(ctx.from.id);
    const payload=ctx.startPayload||'';if(payload.startsWith('ad_'))await store.attributeUser(ctx.from.id,payload.slice(3));
    const settings = await store.getBotSettings();
    const greeting = settings.welcome.replaceAll('{name}', ctx.from.first_name || 'друг');
    await ctx.reply(greeting, menu(settings.buttonText));
  });
  bot.command(['menu', 'cards'], (ctx) => ctx.reply('Выбери свою следующую великую находку.', menu()));
  const about='«Очевидно» — серьёзно оформленный абсурд. Здесь можно купить очевидный ответ или именную шуточную грамоту. Никаких выигрышей, инвестиций и тайных предсказаний.\n\nЦены видны до оплаты. Купленные результаты сохраняются в коллекции. Правила: /terms. Поддержка: /paysupport.';
  bot.command('about',ctx=>ctx.reply(about,menu()));
  bot.action('show_about',async ctx=>{await ctx.answerCbQuery();await ctx.reply(about,menu());});
  bot.command('bundles',ctx=>ctx.reply('Несколько грамот одной покупкой. Состав и цена видны заранее.',menu('Посмотреть наборы','bundles')));
  bot.command('premium',ctx=>ctx.reply('Для богатых: дорогая шутка, красивая грамота. Никаких дополнительных преимуществ или призов.',menu('Частная коллекция','premium')));
  const redeem=async(ctx,code)=>{try{const r=await store.redeemPromo(code.trim().toUpperCase(),ctx.from.id);promoWaiting.delete(String(ctx.from.id));await ctx.reply(r.kind==='bonus'?`Начислено ${r.bonus} бонусов на покупки. Это внутренние бонусы, не Stars для вывода.`:'Промокарточка добавлена! Открой её в каталоге и выбери «По промокоду».',menu());}catch(e){await ctx.reply(e.message);}};
  bot.command('promo',async ctx=>{const code=ctx.message.text.replace(/^\/promo(?:@\w+)?\s*/,'').trim();if(code)return redeem(ctx,code);promoWaiting.set(String(ctx.from.id),Date.now()+300000);await ctx.reply('Пришли промокод следующим сообщением или напиши /promo КОД. Отмена: /cancel.');});
  bot.action('enter_promo',async ctx=>{await ctx.answerCbQuery();promoWaiting.set(String(ctx.from.id),Date.now()+300000);await ctx.reply('Пришли промокод одним сообщением. Отмена: /cancel.');});
  bot.command('cancel',ctx=>{promoWaiting.delete(String(ctx.from.id));return ctx.reply('Ввод отменён.',menu());});
  bot.command('tasks', (ctx) => ctx.reply('Бонусы за задания можно потратить на карточки.', menu('Открыть задания', 'tasks')));
  bot.command('profile', (ctx) => ctx.reply('Коллекция, TON-кошелёк и настройки.', menu('Мой профиль', 'profile')));
  bot.command('collection', async (ctx) => {
    const items = (await store.recentPurchases(ctx.from.id)).filter((p) => p.state === 'paid').slice(0, 5).map(publicPurchase);
    const text = items.length ? `Последние карточки:\n\n${items.map((p) => `• ${p.title || p.cardId}: ${p.result.headline}`).join('\n')}` : 'Твоя коллекция ждёт первую карточку.';
    await ctx.reply(text, menu('Открыть коллекцию', 'collection'));
  });
  bot.command('terms', (ctx) => ctx.reply(terms(config.supportUrl)));
  const fullHelp=help+'\n\n/promo КОД — активировать промокод\n/bundles — наборы грамот\n/premium — частная коллекция\n/about — о проекте\n/terms — правила\n/cancel — отменить ввод промокода';
  bot.command('help', (ctx) => ctx.reply(fullHelp, menu()));
  bot.action('show_terms', async (ctx) => { await ctx.answerCbQuery(); await ctx.reply(terms(config.supportUrl)); });
  bot.action('show_help', async (ctx) => { await ctx.answerCbQuery(); await ctx.reply(fullHelp); });
  bot.command(['paysupport', 'support'], async (ctx) => {
    const message = ctx.message.text.replace(/^\/\w+(?:@\w+)?\s*/, '').trim();
    if (message) {
      const ticket = await store.createTicket({ userId: ctx.from.id, message: message.slice(0, 1200) });
      return ctx.reply(`Обращение №${ticket.id.slice(0, 8)} принято. Сохрани этот номер.`, menu('Открыть профиль', 'profile'));
    }
    await ctx.reply(`Опиши проблему после команды, например:\n/paysupport Оплатил карточку, но она не появилась. ID покупки: …\n\nКонтакт поддержки: ${config.supportUrl}\nИсторию покупок найдёшь в профиле.`, menu('Мои покупки', 'collection'));
  });
  bot.command('stop', async (ctx) => { await store.setNotifications(ctx.from.id, false); await ctx.reply('Рекламные сообщения отключены. Карточки и поддержка доступны как обычно. Включить сообщения снова: /start.'); });
  bot.on('my_chat_member', async (ctx) => {
    if (ctx.myChatMember.chat.type === 'private' && ctx.myChatMember.new_chat_member.status === 'kicked') await store.setNotifications(ctx.myChatMember.from.id, false);
  });
  bot.on('pre_checkout_query', async (ctx) => {
    const query = ctx.preCheckoutQuery;
    try {
      const purchase = await store.getPurchaseByPayload(query.invoice_payload);
      const sales=await store.getSalesSettings();
      const valid = !sales.paused && validPayment(purchase, query, query.from.id) && (!purchase.createdAt || Date.now()-new Date(purchase.createdAt).getTime()<30*60*1000);
      await ctx.answerPreCheckoutQuery(valid, valid ? undefined : 'Счёт недействителен. Откройте карточку заново.');
    } catch { await ctx.answerPreCheckoutQuery(false, 'Не удалось проверить счёт. Попробуйте ещё раз.'); }
  });
  bot.on('message', async (ctx, next) => {
    const payment = ctx.message?.successful_payment;
    if (!payment) return next();
    const existing = await store.getPurchaseByPayload(payment.invoice_payload);
    if (existing?.state === 'paid' && existing.chargeId === payment.telegram_payment_charge_id) return;
    if (!validPayment(existing, payment, ctx.from.id)) {await store.recordProblem({kind:'payment',title:'Платёж требует проверки',body:`Пользователь ${ctx.from.id}. Заказ ${existing?.id || 'не найден'}. Сумма ${payment.total_amount} ${payment.currency}.`,dedupeKey:`payment:${payment.telegram_payment_charge_id}`});return ctx.reply('Платёж требует ручной проверки. Напишите /paysupport и укажите ID покупки.');}
    const purchase = await store.settlePurchase({ payload: payment.invoice_payload, chargeId: payment.telegram_payment_charge_id });
    await ctx.reply(`Карточка готова ✦\n\n${purchase.result.headline}\n${purchase.result.detail}\n\nПокупка: ${purchase.id}`, menu('Забрать карточку', 'collection'));
  });
  bot.on('text', async ctx=>{if(promoWaiting.get(String(ctx.from.id))>Date.now()){const code=ctx.message.text.trim();if(!/^[a-z0-9_-]{3,40}$/i.test(code))return ctx.reply('Промокод: от 3 до 40 латинских букв, цифр или дефисов. Отмена: /cancel.');return redeem(ctx,code);}return ctx.reply('Я уже всё посчитал. Осталось выбрать, что именно.\n\nПромокод: /promo. Помощь: /help. По оплате: /paysupport.', menu());});
  bot.catch(async (error) => {console.error('bot:',error.name);await store.recordProblem({title:'Ошибка обработки команды бота',body:'Проверьте журнал сервера. Пользователь может повторить команду.',dedupeKey:`bot:${Math.floor(Date.now()/300000)}`}).catch(()=>{});});
  return bot;
}

export async function configureBot(bot, config, settings) {
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Открыть «Очевидно»' }, { command: 'cards', description: 'Каталог карточек' },
    { command: 'collection', description: 'Моя коллекция' }, { command: 'tasks', description: 'Задания и бонусы' },
    { command: 'profile', description: 'Профиль и TON-кошелёк' }, { command: 'help', description: 'Как всё работает' },
    { command: 'promo', description: 'Активировать промокод' }, { command: 'bundles', description: 'Наборы грамот' },
    { command: 'premium', description: 'Частная коллекция · для богатых' }, { command: 'about', description: 'О проекте' },
    { command: 'terms', description: 'Правила' }, { command: 'paysupport', description: 'Помощь по платежам' },
    { command: 'stop', description: 'Отключить рекламу' }
  ]);
  await bot.telegram.callApi('setMyDescription', { description: settings.description });
  await bot.telegram.callApi('setMyShortDescription', { short_description: 'Ответы, сертификаты и красивый абсурд. От 5 Stars.' });
  await bot.telegram.callApi('setChatMenuButton', { menu_button: { type: 'web_app', text: settings.buttonText.slice(0, 64), web_app: { url: config.publicAppUrl } } });
}
