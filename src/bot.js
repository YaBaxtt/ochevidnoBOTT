import { Markup, Telegraf } from 'telegraf';
import { publicPurchase, resolveBotSettings, terms, validPayment } from './product.js';
import { ownedInlineResults } from './sharing.js';

export function botMenu(config, text = 'Открыть «Очевидно»', tab = 'home') {
  if (!config.publicAppUrl) return Markup.inlineKeyboard([
    [{ ...Markup.button.callback(text, 'app_not_configured'), style: 'success' }],
    [Markup.button.callback('О проекте', 'show_about'), Markup.button.callback('Помощь', 'show_help')],
    [Markup.button.callback('Правила', 'show_terms'), Markup.button.callback('Поддержка', 'show_support')]
  ]);
  const appUrl = (view) => { const url = new URL(config.publicAppUrl); url.searchParams.set('tab', view); return url.href; };
  return Markup.inlineKeyboard([
    [{ ...Markup.button.webApp(text, appUrl(tab)), style: 'success' }],
    [Markup.button.webApp('Моя коллекция', appUrl('collection')), Markup.button.webApp('Задания', appUrl('tasks'))],
    [Markup.button.callback('Ввести промокод', 'enter_promo'), Markup.button.webApp('Наборы', appUrl('bundles'))],
    [Markup.button.callback('О проекте', 'show_about'), Markup.button.callback('Помощь', 'show_help')],
    [Markup.button.callback('Правила', 'show_terms'), Markup.button.callback('Поддержка', 'show_support')]
  ]);
}

export const ABOUT_TEXT = '🃏 «Очевидно»\nСерьёзный подход к несерьёзным вопросам.\n\nОчевидные ответы, именные шуточные грамоты, наборы и частная коллекция «Для богатых». Красиво оформить абсурд — тоже искусство.\n\n🎓 Грамоты созданы для развлечения: это не настоящие дипломы, медицинские справки или предсказания. Здесь нет ставок, выигрышей и обещаний заработка.\n\nЦена видна до покупки. Оплата — в Telegram Stars, готовые результаты — в твоей коллекции. Бонусы за задания и промокоды можно потратить на карточки; вывести их нельзя.\n\nПравила: /terms\nВопрос по покупке: /paysupport';

export const HELP_TEXT = '🧭 Как всё работает\n\n1. Открой мини-апп и выбери карточку.\n2. Заполни вопросы и проверь цену.\n3. Подтверди покупку в окне Telegram Stars.\n4. Забери результат в коллекции — он останется там и после закрытия приложения.\n\n🎟 Есть промокод? Нажми «Ввести промокод» или отправь /promo КОД. Задания дают внутренние бонусы, не Stars для вывода.\n\nБыстрый доступ\n/cards — каталог\n/collection — купленные карточки\n/bundles — наборы грамот\n/premium — для богатых\n/tasks — задания и бонусы\n/profile — профиль и Gram-кошелёк\n\nЕсли что-то пошло не так\n/paysupport — помощь с покупкой и возвратом\n/about — о проекте\n/terms — правила\n/cancel — отменить ввод\n/stop — отключить рекламные сообщения\n/share — отправить покупку картинкой\n/start — вернуться в начало и включить сообщения\n\nМини-апп нужно открывать кнопкой в этом боте. Если видишь старый экран, закрой его и отправь /start ещё раз. Не плати повторно, если покупка задержалась: сначала обратись в поддержку.';

export function createBot({ store, config }) {
  if (!config.botToken || config.demo) return null;
  const bot = new Telegraf(config.botToken);
  store.ownerIds = config.adminIds || new Set();
  const promoWaiting = new Map();
  const supportWaiting = new Map();
  const menu = (text, tab) => botMenu(config, text, tab);
  const owner = (ctx) => config.adminIds?.has(String(ctx.from.id));
  const waitFor = (map, id) => { promoWaiting.delete(String(id)); supportWaiting.delete(String(id)); map.set(String(id), Date.now() + 300000); };
  const submitSupport = async (ctx, message) => {
    const ticket = await store.createTicket({ userId: ctx.from.id, message: message.slice(0, 1200) });
    supportWaiting.delete(String(ctx.from.id));
    promoWaiting.delete(String(ctx.from.id));
    return ctx.reply(`✅ Обращение №${ticket.id.slice(0, 8)} принято.\n\nСохрани этот номер. Проверим покупку и ответим; платить повторно не нужно.`, menu('Мои покупки', 'collection'));
  };
  const openSupport = async (ctx) => {
    waitFor(supportWaiting, ctx.from.id);
    return ctx.reply(`💬 Поможем разобраться.\n\nПришли следующим сообщением, что произошло. Если вопрос по оплате, добавь ID покупки из коллекции.\n\nНе отправляй пароли, токены и seed-фразу кошелька.\n\nКонтакт поддержки: ${config.supportUrl || 'команда /paysupport'}\nОтмена: /cancel. Ввод доступен 5 минут.`);
  };
  bot.use(async (ctx, next) => {
    if(ctx.chat && ctx.chat.type !== 'private') return;
    for (const map of [promoWaiting, supportWaiting]) for (const [id, expires] of map) if (expires <= Date.now()) map.delete(id);
    if (ctx.from && (ctx.chat?.type === 'private' || ctx.update.inline_query)) await store.upsertUser(ctx.from);
    return next();
  });
  bot.start(async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    await store.setNotifications(ctx.from.id, true, true);
    await store.recordStart(ctx.from.id);
    const payload=ctx.startPayload||'';if(payload.startsWith('ad_'))await store.attributeUser(ctx.from.id,payload.slice(3));
    promoWaiting.delete(String(ctx.from.id)); supportWaiting.delete(String(ctx.from.id));
    const settings = await store.getBotSettings();
    const greeting = settings.welcome.replaceAll('{name}', ctx.from.first_name || 'друг');
    await ctx.reply(greeting, menu(settings.buttonText,payload==='collection'?'collection':'home'));
  });
  bot.on('inline_query',async ctx=>{
    const options={is_personal:true,cache_time:0,button:{text:'Моя коллекция · открыть бота',start_parameter:'collection'}};
    try {
      const page=await ownedInlineResults({store,config:{...config,botUsername:bot.botInfo?.username||config.botUsername},userId:ctx.from.id,query:ctx.inlineQuery.query,offset:ctx.inlineQuery.offset});
      await ctx.answerInlineQuery(page.results,{...options,next_offset:page.nextOffset});
    }catch{
      await ctx.answerInlineQuery([],{...options,next_offset:''});
    }
  });
  bot.command('share',ctx=>ctx.reply(`🖼 Твоя коллекция — прямо в переписке.\n\nВ любом чате напиши @${bot.botInfo?.username||config.botUsername||'obviously_bbot'} и пробел. Появятся только твои выданные карточки и грамоты. Выбери картинку и отправь. Можно дописать название для поиска.\n\nИли открой результат в мини-аппе и нажми «Отправить фото». На картинке будет имя и ответ; @username покупателя не добавляется.`,menu('Моя коллекция','collection')));
  bot.command(['menu', 'cards'], (ctx) => ctx.reply('🃏 Каталог «Очевидно»\n\nОтветы, грамоты и другие убедительные поводы ничего не усложнять. Цена каждой карточки видна до покупки.', menu()));
  const about=ABOUT_TEXT;
  bot.command('about',ctx=>ctx.reply(about,menu()));
  bot.action('show_about',async ctx=>{await ctx.answerCbQuery();await ctx.reply(about,menu());});
  bot.command('bundles',ctx=>ctx.reply('🎓 Наборы грамот\n\nНесколько поводов гордиться собой — одной покупкой. Состав и общая цена видны перед оплатой.',menu('Посмотреть наборы','bundles')));
  bot.command('premium',ctx=>ctx.reply('🥂 Для богатых\n\nДорогая шутка. Красивая грамота. Исключительно серьёзный вид.\n\nБез призов, привилегий и обещаний заработать — только частная коллекция абсурда.',menu('Частная коллекция','premium')));
  const redeem=async(ctx,code)=>{try{const r=await store.redeemPromo(code.trim().toUpperCase(),ctx.from.id);promoWaiting.delete(String(ctx.from.id));supportWaiting.delete(String(ctx.from.id));await ctx.reply(r.kind==='bonus'?`🎟 Начислено ${r.bonus} бонусов на покупки.\n\nЭто внутренние бонусы, не Stars для вывода.`:'🎟 Промокарточка добавлена!\n\nОткрой её в каталоге и выбери «По промокоду».',menu());}catch(e){await ctx.reply(e.message);}};
  bot.command('promo',async ctx=>{const code=ctx.message.text.replace(/^\/promo(?:@\w+)?\s*/,'').trim();if(code)return redeem(ctx,code);waitFor(promoWaiting,ctx.from.id);await ctx.reply('🎟 Есть промокод?\n\nПришли его следующим сообщением или напиши /promo КОД.\nОтмена: /cancel. Ввод доступен 5 минут.');});
  bot.action('enter_promo',async ctx=>{await ctx.answerCbQuery();waitFor(promoWaiting,ctx.from.id);await ctx.reply('🎟 Пришли промокод одним сообщением.\n\nОтмена: /cancel. Ввод доступен 5 минут.');});
  bot.command('cancel',ctx=>{promoWaiting.delete(String(ctx.from.id));supportWaiting.delete(String(ctx.from.id));return ctx.reply('Ввод отменён. Возвращаемся к очевидному.',menu());});
  bot.command('tasks', (ctx) => ctx.reply('🎯 Задания и бонусы\n\nВыполни задание, нажми «Проверить» и получи бонусы на карточки. Бонусы не являются Stars или Gram и не выводятся.', menu('Открыть задания', 'tasks')));
  bot.command('profile', (ctx) => ctx.reply('👤 Всё твоё — здесь.\n\nПокупки, бонусы, Gram-кошелёк и настройки сообщений. Кошелёк остаётся под твоим контролем: seed-фразу мы не спрашиваем.', menu('Мой профиль', 'profile')));
  bot.command('collection', async (ctx) => {
    const items = (await store.recentPurchases(ctx.from.id)).filter((p) => p.state === 'paid').slice(0, 5).map(publicPurchase);
    const text = items.length ? `🗂 Твоя коллекция\n\n${items.map((p) => `• ${p.title || p.cardId}: ${p.result.headline}`).join('\n')}\n\nВсе покупки и скачивание грамот — в мини-аппе.` : '🗂 Пока чистый лист.\n\nКупленные карточки и грамоты появятся здесь. Начни с той, которая слишком очевидна, чтобы пройти мимо.';
    await ctx.reply(text, menu('Открыть коллекцию', 'collection'));
  });
  bot.command('terms', (ctx) => ctx.reply(terms(config.supportUrl)));
  const fullHelp=HELP_TEXT;
  bot.command('help', (ctx) => ctx.reply(fullHelp, menu()));
  bot.action('show_terms', async (ctx) => { await ctx.answerCbQuery(); await ctx.reply(terms(config.supportUrl)); });
  bot.action('show_help', async (ctx) => { await ctx.answerCbQuery(); await ctx.reply(fullHelp, menu()); });
  bot.action('show_support', async (ctx) => { await ctx.answerCbQuery(); await openSupport(ctx); });
  bot.action('app_not_configured', async (ctx) => {
    await ctx.answerCbQuery(owner(ctx) ? 'Настрой PUBLIC_APP_URL в Railway: нужен публичный HTTPS-домен. Подробности: /status.' : 'Мини-апп ещё настраивается. Попробуй позже; поддержка доступна в этом боте.', { show_alert: true });
  });
  bot.command(['paysupport', 'support'], async (ctx) => {
    const message = ctx.message.text.replace(/^\/\w+(?:@\w+)?\s*/, '').trim();
    if (message) return submitSupport(ctx, message);
    await openSupport(ctx);
  });
  bot.command('admin', async (ctx) => {
    if (!owner(ctx)) return ctx.reply('Этот раздел доступен только владельцу проекта.');
    return ctx.reply('⚙️ Пульт управления\n\nЦены, карточки, промокоды, реклама, обращения и отчёты — в твоей админ-панели.\n\nПроверка подключения мини-аппа: /status.', menu('Открыть админ-панель', 'admin'));
  });
  bot.command('status', async (ctx) => {
    if (!owner(ctx)) return ctx.reply('Этот раздел доступен только владельцу проекта.');
    await store.getBotSettings();
    let menuUrl;
    try { menuUrl = (await ctx.telegram.callApi('getChatMenuButton', { chat_id: ctx.chat.id }))?.web_app?.url; } catch {}
    const keyboard = menu('Проверить мини-апп');
    if (config.publicAppUrl) keyboard.reply_markup.inline_keyboard.push([Markup.button.callback('Восстановить кнопку меню', 'repair_menu')]);
    return ctx.reply(`🔎 Подключение «Очевидно»\n\nБот отвечает. Хранилище доступно.\nАдрес мини-аппа: ${config.publicAppUrl || 'ещё не подключён'}\nКнопка меню: ${menuUrl || 'не настроена или Telegram не ответил'}\n\n${config.appSetupIssue || 'Если адреса различаются, нажми «Восстановить кнопку меню» ниже.'}\nНастройка адреса: Railway → Settings → Networking → Generate Domain, затем PUBLIC_APP_URL в Variables. Для кнопки в профиле настрой Main Mini App у @BotFather на тот же адрес.\n\n${config.publicAppUrl ? `Проверка сайта: ${config.publicAppUrl}/health\n` : ''}Внешнюю доступность сайта эта команда не проверяет.`, keyboard);
  });
  bot.action('repair_menu', async (ctx) => {
    if (!owner(ctx)) return ctx.answerCbQuery('Этот раздел доступен только владельцу проекта.', { show_alert: true });
    if (!config.publicAppUrl) return ctx.answerCbQuery('Сначала настрой публичный HTTPS-адрес мини-аппа в Railway.', { show_alert: true });
    const settings = await store.getBotSettings();
    try {
      await ctx.telegram.callApi('setChatMenuButton', { chat_id: ctx.chat.id, menu_button: { type: 'web_app', text: settings.buttonText.slice(0, 64), web_app: { url: config.publicAppUrl } } });
    } catch { return ctx.answerCbQuery('Telegram не ответил. Попробуй восстановить кнопку ещё раз.', { show_alert: true }); }
    await ctx.answerCbQuery('Кнопка меню восстановлена.');
    return ctx.reply('✅ Кнопка возле поля ввода обновлена для этого чата.\n\nОна открывает адрес из PUBLIC_APP_URL. Настройка Main Mini App в профиле остаётся у @BotFather.', menu());
  });
  bot.command('stop', async (ctx) => { promoWaiting.delete(String(ctx.from.id));supportWaiting.delete(String(ctx.from.id));await store.setNotifications(ctx.from.id, false); await ctx.reply('🔕 Рекламные сообщения отключены.\n\nКарточки, покупки и поддержка доступны как обычно. Включить сообщения снова: /start.', menu()); });
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
    await ctx.reply(`✅ Покупка готова\n\n${purchase.result.headline}\n${purchase.result.detail}\n\nКарточка сохранена в коллекции.\nID покупки: ${purchase.id}`, menu('Забрать карточку', 'collection'));
  });
  bot.on('text', async ctx=>{
    if (ctx.message.text.startsWith('/')) return ctx.reply('Такой команды пока нет.\n\nКаталог: /cards · Помощь: /help · Отмена ввода: /cancel.', menu());
    if (supportWaiting.get(String(ctx.from.id)) > Date.now()) return submitSupport(ctx, ctx.message.text.trim());
    if(promoWaiting.get(String(ctx.from.id))>Date.now()){const code=ctx.message.text.trim();if(!/^[a-z0-9_-]{3,40}$/i.test(code))return ctx.reply('Промокод: от 3 до 40 латинских букв, цифр или дефисов. Отмена: /cancel.');return redeem(ctx,code);}
    return ctx.reply('🃏 Я уже всё посчитал. Осталось выбрать, что именно.\n\nОткрой каталог кнопкой ниже.\nЕсть промокод? /promo\nНужна помощь? /help\nВопрос по покупке? /paysupport', menu());
  });
  bot.catch(async (error) => {console.error('bot:',error.name);await store.recordProblem({title:'Ошибка обработки команды бота',body:'Проверьте журнал сервера. Пользователь может повторить команду.',dedupeKey:`bot:${Math.floor(Date.now()/300000)}`}).catch(()=>{});});
  return bot;
}

export async function configureBot(bot, config, settings) {
  settings = resolveBotSettings(settings);
  const commands = [
    { command: 'start', description: 'Открыть «Очевидно»' }, { command: 'cards', description: 'Каталог карточек' },
    { command: 'collection', description: 'Моя коллекция' }, { command: 'tasks', description: 'Задания и бонусы' },
    { command: 'profile', description: 'Профиль и Gram-кошелёк' }, { command: 'help', description: 'Как всё работает' },
    { command: 'promo', description: 'Активировать промокод' }, { command: 'bundles', description: 'Наборы грамот' },
    { command: 'premium', description: 'Частная коллекция · для богатых' }, { command: 'about', description: 'О проекте' },
    { command: 'share', description: 'Отправить карточку картинкой' },
    { command: 'terms', description: 'Правила' }, { command: 'paysupport', description: 'Помощь по платежам' },
    { command: 'stop', description: 'Отключить рекламу' }, { command: 'cancel', description: 'Отменить ввод' }
  ];
  await bot.telegram.setMyCommands(commands);
  for (const id of config.adminIds || []) {
    // Telegram cannot configure a chat-scoped command list before its owner first starts the bot.
    try { await bot.telegram.setMyCommands([...commands, { command: 'admin', description: 'Пульт владельца' }, { command: 'status', description: 'Проверить подключение мини-аппа' }], { scope: { type: 'chat', chat_id: Number(id) } }); } catch { console.warn('Меню владельца пока недоступно. Команды /admin и /status работают после /start.'); }
  }
  await bot.telegram.callApi('setMyDescription', { description: settings.description });
  await bot.telegram.callApi('setMyShortDescription', { short_description: settings.shortDescription });
  await bot.telegram.callApi('setChatMenuButton', { menu_button: config.publicAppUrl ? { type: 'web_app', text: settings.buttonText.slice(0, 64), web_app: { url: config.publicAppUrl } } : { type: 'commands' } });
}
