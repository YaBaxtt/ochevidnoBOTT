import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { getCardDefinition, makeResult } from './card-engine.js';
import { createAppStore } from './app-store.js';
import { createBot, configureBot } from './bot.js';
import { syncBotAvatar } from './bot-avatar.js';
import { publicAppUrlFromEnv, appConnection } from './deployment.js';
import { BRAND } from '../public/brand.js';
import { registerEngagementApi } from './engagement-api.js';
import { registerReleaseApi, startOwnerAlertWorker } from './release-api.js';
import { publicPurchase, terms } from './product.js';
import { startBroadcastWorker } from './broadcast.js';
import { isTelegramMember, validateTelegramInitData } from './telegram-auth.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(dirname, '..', 'public');

const defaultConfig = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  botToken: process.env.BOT_TOKEN || '',
  publicAppUrl: publicAppUrlFromEnv(),
  databaseUrl: process.env.DATABASE_URL || '',
  supportUrl: process.env.SUPPORT_URL || '',
  toncenterApiKey: process.env.TONCENTER_API_KEY || '',
  adminIds: new Set((process.env.ADMIN_TELEGRAM_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)),
  demo: process.env.ALLOW_DEMO === '1' && process.env.NODE_ENV !== 'production'
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const asText = (value, label, max = 120) => {
  const result = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!result || result.length > max) throw new Error(`Поле «${label}» заполнено неверно.`);
  return result;
};
const asInteger = (value, label, min, max) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`Поле «${label}» заполнено неверно.`);
  return number;
};

function cardForClient(row) {
  const definition = getCardDefinition(row.id);
  if (!definition) return null;
  const questionLabels = isObject(row.copy?.questionLabels) ? row.copy.questionLabels : {};
  return {
    ...row,
    category: definition.category,
    kind: definition.kind || 'result', premium: Boolean(definition.premium), bundleItems: definition.bundleItems || [],
    fields: definition.fields.map((field) => ({ ...field, label: questionLabels[field.key] || field.label })),
    copy: row.copy || {}
  };
}

export function createApp({ store, getTelegram, config = defaultConfig }) {
  store.ownerIds = config.adminIds;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.demo ? false : 1);
  app.use((req, res, next) => {
    res.locals.requestId = crypto.randomUUID();
    res.setHeader('X-Request-ID', res.locals.requestId);
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://telegram.org'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        // Wallet bridges are discovered from the TON Connect registry; their HTTPS origins vary by wallet.
        connectSrc: ["'self'", 'https:'],
        frameAncestors: ["'self'", 'https://web.telegram.org', 'https://*.web.telegram.org'],
        upgradeInsecureRequests: config.env === 'production' ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false
  }));
  app.use(express.json({ limit: '64kb', type: 'application/json' }));
  app.param(['purchaseId','taskId','ticketId'],(req,res,next,value)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)?next():res.status(404).json({error:'Объект не найден.'}));
  // Use the package's IP normalizer so equivalent IPv6 addresses share one limit.
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));

  const requireActor = async (req, res, next) => {
    try {
      let telegramUser;
      if (config.demo && req.get('x-demo-user')) {
        telegramUser = { id: Number(req.get('x-demo-user')), first_name: 'Локальный игрок', username: 'local_demo' };
        if (!Number.isSafeInteger(telegramUser.id) || telegramUser.id <= 0) throw new Error('Некорректный тестовый профиль.');
      } else {
        const verified = validateTelegramInitData(req.get('x-telegram-init-data'), config.botToken);
        telegramUser = verified.user;
      }
      req.telegramUser = telegramUser;
    } catch (error) {
      return res.status(401).json({ error: 'Не удалось войти через Telegram. Откройте приложение заново.' });
    }
    try { req.actor = await store.upsertUser(req.telegramUser); const startParam = new URLSearchParams(req.get('x-telegram-init-data') || '').get('start_param'); if(startParam?.startsWith('ad_'))await store.attributeUser(req.actor.id,startParam.slice(3)); next(); } catch(error) {next(error);}
  };

  const isAdmin = (id) => config.adminIds.has(String(id)) || config.demo && String(id) === '900000001';
  const checkoutLimit=rateLimit({windowMs:60000,limit:20,keyGenerator:req=>String(req.actor.id),standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много счетов. Подождите минуту.'}});
  const supportLimit=rateLimit({windowMs:60000,limit:5,keyGenerator:req=>String(req.actor.id),standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Сообщения приняты. Подождите минуту перед следующим обращением.'}});
  const requireAdmin = [requireActor, async (req, res, next) => {
    if (!isAdmin(req.actor.id)) return res.status(403).json({ error: 'Нужны права администратора.' });
    next();
  }];

  app.get('/health', (_req, res) => res.json({ ok: true, mode: config.demo ? 'demo' : 'telegram' }));
  app.get('/api/app-info', (_req, res) => res.json({
    name: 'Очевидно',
    botUrl: config.botUsername ? `https://t.me/${config.botUsername}` : null,
    avatarUrl: BRAND.botAvatar
  }));

  app.get('/api/bootstrap', requireActor, async (req, res, next) => {
    try {
      const [profile, cards, tasks, leaderboard, purchases, entryAd, sales, vouchers] = await Promise.all([store.getProfile(req.actor.id), store.getCards(), store.getTasks(), store.publicLeaderboard(), store.recentPurchases(req.actor.id), store.getEntryCampaign(req.actor.id),store.getSalesSettings(),store.getVouchers(req.actor.id)]);
      res.json({ mode: config.demo ? 'demo' : 'live', profile, cards: cards.map(cardForClient).filter(Boolean), tasks, leaderboard, purchases: purchases.map(publicPurchase), entryAd, sales, vouchers, walletEnabled: Boolean(config.publicAppUrl.startsWith('https://')), botUrl: config.botUsername ? `https://t.me/${config.botUsername}?startapp=profile` : null, shareUrl: config.botUsername ? `https://t.me/${config.botUsername}?startapp=home` : config.publicAppUrl || null, supportUrl: config.supportUrl, isAdmin: isAdmin(req.actor.id), termsUrl: '/api/terms' });
    } catch (error) { next(error); }
  });

  app.get('/api/terms', (_req, res) => res.type('text/plain; charset=utf-8').send(terms(config.supportUrl || 'команду /paysupport')));

  app.post('/api/cards/:cardId/checkout', requireActor, checkoutLimit, async (req, res, next) => {
    if (config.appSetupIssue) return res.status(503).json({ error: 'Мини-апп ещё настраивается. Новые покупки временно недоступны; поддержка и уже купленные карточки остаются доступны.' });
    try {
      const sales=await store.getSalesSettings();if(sales.paused)return res.status(409).json({error:sales.message});
      const card = await store.getCard(req.params.cardId);
      if (!card || !card.enabled) return res.status(404).json({ error: 'Эта карточка сейчас недоступна.' });
      if(req.body?.expectedPriceStars!==undefined&&req.body.expectedPriceStars!==card.priceStars)return res.status(409).json({error:'Цена изменилась. Обновите карточку и проверьте новую сумму.'});
      if (req.body?.termsAccepted !== true) return res.status(422).json({ error: 'Перед оплатой нужно подтвердить прочтение правил.' });
      const definition = getCardDefinition(card.id);
      if (!definition) return res.status(404).json({ error: 'У карточки нет сценария.' });
      const result = makeResult(card.id, isObject(req.body?.answers) ? req.body.answers : {});
      const applyCopy=(r,c)=>{if(c.copy?.answerText)r.detail=String(c.copy.answerText).replaceAll('{name}',r.recipient||'').slice(0,600);if(c.copy?.detailSuffix)r.detail+=` ${String(c.copy.detailSuffix).slice(0,180)}`;if(r.kind==='certificate'){r.documentTitle=c.title.replace(/^Сертификат: /,'').replace(/^Справка: /,'');r.citation=r.detail;}return r;};
      applyCopy(result,card);
      if(result.kind==='bundle')for(const item of result.items){const child=await store.getCard(item.cardId);if(child){item.title=child.title;applyCopy(item.result,child);}}
      const purchase = await store.createPurchase({ userId: req.actor.id, cardId: card.id, amount: card.priceStars, answers: req.body?.answers || {}, result });

      if(req.body?.paymentMethod==='voucher')return res.json({mode:'voucher',purchase:publicPurchase(await store.payWithVoucher(purchase.id,req.actor.id))});

      if (req.body?.paymentMethod === 'bonus') {
        const paid = await store.payWithBonuses(purchase.id, req.actor.id);
        return res.json({ mode: 'bonus', purchase: publicPurchase(paid) });
      }
      if (config.demo) {
        return res.json({ mode: 'demo', purchase: publicPurchase(purchase), title: card.title });
      }

      const telegram = getTelegram();
      if (!telegram) throw new Error('Платёжный бот ещё не запущен.');
      const invoiceLink = await telegram.createInvoiceLink({
        title: card.title.slice(0, 32),
        description: `Развлекательная карточка «${card.title}».`.slice(0, 255),
        payload: purchase.payload,
        currency: 'XTR',
        prices: [{ label: card.title.slice(0, 32), amount: card.priceStars }]
      });
      res.json({ mode: 'invoice', invoiceLink, purchaseId: purchase.id });
    } catch (error) { next(error); }
  });

  app.get('/api/purchases/:purchaseId', requireActor, async (req, res, next) => {
    try {
      const purchase = await store.getPurchase(req.params.purchaseId, req.actor.id);
      if (!purchase) return res.status(404).json({ error: 'Покупка не найдена.' });
      res.json({ purchase: publicPurchase(purchase) });
    } catch (error) { next(error); }
  });

  app.post('/api/demo/purchases/:purchaseId/confirm', requireActor, async (req, res, next) => {
    try {
      if (!config.demo) return res.status(404).json({ error: 'Не найдено.' });
      const purchase = await store.getPurchase(req.params.purchaseId, req.actor.id);
      if (!purchase) return res.status(404).json({ error: 'Покупка не найдена.' });
      if (purchase.state !== 'pending' && purchase.state !== 'paid') return res.status(409).json({ error: 'Заказ уже закрыт.' });
      if(purchase.state==='pending'&&(await store.getSalesSettings()).paused)return res.status(409).json({error:'Продажи на паузе.'});
      const settled = await store.settlePurchase({ payload: purchase.payload, chargeId: `demo_${purchase.id}` });
      res.json({ purchase: publicPurchase(settled) });
    } catch (error) { next(error); }
  });

  app.post('/api/purchases/:purchaseId/share', requireActor, async (req, res, next) => {
    try {
      const shares = await store.incrementShare(req.params.purchaseId, req.actor.id);
      if (shares === null) return res.status(409).json({ error: 'Поделиться можно только выданной карточкой.' });
      res.json({ ok: true, shares });
    } catch (error) { next(error); }
  });

  app.post('/api/tasks/:taskId/claim', requireActor, async (req, res, next) => {
    try {
      const task = (await store.getTasks()).find((item) => item.id === req.params.taskId);
      if (!task) return res.status(404).json({ error: 'Задание не найдено или выключено.' });
      if (task.taskType !== 'channel_membership') return res.status(422).json({ error: 'Этот тип задания пока не поддерживается.' });
      const telegram = getTelegram();
      if (!telegram && !config.demo) throw new Error('Бот проверки заданий не запущен.');
      if (!config.demo) {
        const member = await telegram.getChatMember(task.chatId, req.actor.id);
        if (!isTelegramMember(member)) return res.status(422).json({ error: 'Подписка ещё не найдена. Открой канал, подпишись и нажми «Проверить» снова.' });
      }
      const claimed = await store.claimTask({ taskId: task.id, userId: req.actor.id });
      if (!claimed) return res.status(409).json({ error: 'Награда за это задание уже получена.' });
      res.json({ ok: true, profile: claimed.profile, message: `Начислено ${claimed.task.rewardPoints} бонусов на карточки.` });
    } catch (error) { next(error); }
  });

  app.post('/api/support', requireActor, supportLimit, async (req, res, next) => {
    try {
      const message = asText(req.body?.message, 'сообщение', 1200);
      const ticket = await store.createTicket({ userId: req.actor.id, message });
      res.status(201).json({ ticket });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/dashboard', ...requireAdmin, async (req, res, next) => {
    try { res.json(await store.dashboard()); } catch (error) { next(error); }
  });
  app.get('/api/admin/purchases', ...requireAdmin, async (_req, res, next) => { try { res.json({ purchases: await store.listAdminPurchases() }); } catch (error) { next(error); } });
  app.get('/api/admin/tickets', ...requireAdmin, async (_req, res, next) => { try { res.json({ tickets: await store.listTickets() }); } catch (error) { next(error); } });
  app.patch('/api/admin/tickets/:ticketId', ...requireAdmin, async (req, res, next) => {
    try {
      if (!['open', 'resolved'].includes(req.body?.state)) throw new Error('Некорректный статус тикета.');
      const ticket = await store.updateTicket(req.params.ticketId, { state: req.body.state });
      if (!ticket) return res.status(404).json({ error: 'Тикет не найден.' });
      await store.audit(req.actor.id, 'ticket.update', ticket.id, { state: ticket.state });
      res.json({ ticket });
    } catch (error) { next(error); }
  });
  app.get('/api/admin/cards', ...requireAdmin, async (_req, res, next) => {
    try { res.json({ cards: (await store.getCards({ includeDisabled: true })).map(cardForClient).filter(Boolean) }); } catch (error) { next(error); }
  });
  app.patch('/api/admin/cards/:cardId', ...requireAdmin, async (req, res, next) => {
    try {
      const patch = {};
      if (req.body.title !== undefined) patch.title = asText(req.body.title, 'название', 80);
      if (req.body.subtitle !== undefined) patch.subtitle = asText(req.body.subtitle, 'описание', 255);
      if (req.body.priceStars !== undefined) patch.priceStars = asInteger(req.body.priceStars, 'цена', 1, 100000);
      if (req.body.enabled !== undefined) { if (typeof req.body.enabled !== 'boolean') throw new Error('Поле «включено» заполнено неверно.'); patch.enabled = req.body.enabled; }
      if (req.body.copy !== undefined) { if (!isObject(req.body.copy)) throw new Error('Тексты карточки заполнены неверно.'); const labels={};for(const field of getCardDefinition(req.params.cardId)?.fields||[])if(req.body.copy.questionLabels?.[field.key])labels[field.key]=asText(req.body.copy.questionLabels[field.key],'вопрос',160); patch.copy={answerText:String(req.body.copy.answerText||'').trim().slice(0,600),detailSuffix:String(req.body.copy.detailSuffix||'').slice(0,180),questionLabels:labels}; }
      const card = await store.updateCard(req.params.cardId, patch);
      if (!card) return res.status(404).json({ error: 'Карточка не найдена.' });
      await store.audit(req.actor.id, 'card.update', card.id, patch);
      res.json({ card: cardForClient(card) });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/tasks', ...requireAdmin, async (_req, res, next) => { try { res.json({ tasks: await store.getAllTasks() }); } catch (error) { next(error); } });
  app.post('/api/admin/tasks', ...requireAdmin, async (req, res, next) => {
    try {
      const task = { title: asText(req.body.title, 'название', 48), subtitle: asText(req.body.subtitle, 'описание', 180), chatId: asText(req.body.chatId, 'ID канала', 80), targetUrl: asText(req.body.targetUrl, 'ссылка', 240), rewardPoints: asInteger(req.body.rewardPoints, 'награда', 1, 100) };
      if (!/^https:\/\/t\.me\//i.test(task.targetUrl)) throw new Error('Нужна ссылка формата https://t.me/…');
      const created = await store.createTask(task);
      await store.audit(req.actor.id, 'task.create', created.id, task);
      res.status(201).json({ task: created, note: 'Задание создано выключенным. Перед включением бот должен стать админом канала.' });
    } catch (error) { next(error); }
  });
  app.patch('/api/admin/tasks/:taskId', ...requireAdmin, async (req, res, next) => {
    try {
      const patch = {};
      if (req.body.title !== undefined) patch.title = asText(req.body.title, 'название', 48);
      if (req.body.subtitle !== undefined) patch.subtitle = asText(req.body.subtitle, 'описание', 180);
      if (req.body.chatId !== undefined) patch.chatId = asText(req.body.chatId, 'ID канала', 80);
      if (req.body.targetUrl !== undefined) { patch.targetUrl = asText(req.body.targetUrl, 'ссылка', 240); if (!/^https:\/\/t\.me\//i.test(patch.targetUrl)) throw new Error('Нужна ссылка формата https://t.me/…'); }
      if (req.body.rewardPoints !== undefined) patch.rewardPoints = asInteger(req.body.rewardPoints, 'награда', 1, 100);
      if (req.body.active !== undefined) { if (typeof req.body.active !== 'boolean') throw new Error('Поле «включено» заполнено неверно.'); patch.active = req.body.active; }
      const existing = (await store.getAllTasks()).find((task) => task.id === req.params.taskId);
      if (!existing) return res.status(404).json({ error: 'Задание не найдено.' });
      if (patch.active || existing.active && patch.active !== false && patch.chatId && patch.chatId !== existing.chatId) {
        const telegram = getTelegram();
        if (!telegram) return res.status(409).json({ error: 'Нельзя включить задание: бот не запущен.' });
        const me = await telegram.getMe();
        const botMember = await telegram.getChatMember(patch.chatId || existing.chatId, me.id);
        if (!['administrator', 'creator'].includes(botMember.status)) return res.status(422).json({ error: 'Сначала добавьте бота администратором выбранного канала.' });
      }
      const task = await store.updateTask(req.params.taskId, patch);
      await store.audit(req.actor.id, 'task.update', task.id, patch);
      res.json({ task });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/purchases/:purchaseId/refund', ...requireAdmin, async (req, res, next) => {
    try {
      if (config.demo) return res.status(422).json({ error: 'В демо возвраты отключены.' });
      const purchase = await store.getPurchaseAdmin(req.params.purchaseId);
      if (!purchase) return res.status(404).json({ error: 'Покупка не найдена.' });
      if (purchase.state !== 'paid' || !purchase.chargeId || purchase.paymentMethod !== 'stars') return res.status(409).json({ error: 'Эта покупка не может быть возвращена.' });
      const telegram = getTelegram();
      await telegram.callApi('refundStarPayment', { user_id: Number(purchase.userId), telegram_payment_charge_id: purchase.chargeId });
      const refunded = await store.markRefunded(purchase.id);
      await store.audit(req.actor.id, 'purchase.refund', purchase.id, { userId: purchase.userId, amount: purchase.amount });
      res.json({ purchase: refunded });
    } catch (error) { next(error); }
  });

  registerEngagementApi({ app, store, config, getTelegram, requireActor, requireAdmin });
  registerReleaseApi({ app, store, config, getTelegram, requireActor, requireAdmin });

  app.use(express.static(publicDir, {
    index: 'index.html', maxAge: config.env === 'production' ? '1h' : 0, etag: true,
    setHeaders: (res, filePath) => {
      if (path.extname(filePath) === '.html') res.setHeader('Cache-Control', 'no-cache');
      const assetPath = filePath.replace(/\\/g, '/');
      const versionedAvatar = assetPath.includes('/assets/avatars/') && /-v\d+(?:-\d+)?\.(?:jpg|webp)$/.test(assetPath);
      const versionedCover = assetPath.includes('/assets/art-v3/') && assetPath.endsWith('.webp');
      if (config.env === 'production' && (versionedAvatar || versionedCover)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }));
  app.use((req, res) => res.status(404).json({ error: `Не найдено: ${req.method} ${req.path}` }));
  app.use((error, _req, res, _next) => {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка.';
    const expected = !error.code && /^[А-ЯЁ]/.test(message) && !(error instanceof TypeError);
    if(!expected){console.error(`[${res.locals.requestId}] ${error.name || 'Error'} ${error.code || ''}`);store.recordProblem({title:'Ошибка сервера',body:`Запрос ${res.locals.requestId}. Маршрут: ${_req.route?.path || 'unknown'}. Код: ${error.code || error.name || 'error'}.`,dedupeKey:`server:${error.code||error.name}:${Math.floor(Date.now()/300000)}`}).catch(()=>{});}
    res.status(expected?400:500).json({ error: expected ? message : 'Не удалось выполнить запрос. Повторите позже или обратитесь в поддержку.', requestId: res.locals.requestId });
  });
  return app;
}

export async function start(config = defaultConfig) {
  if([...config.adminIds].some(id=>!/^\d+$/.test(id)||!Number.isSafeInteger(Number(id))||Number(id)<=0))throw new Error('ADMIN_TELEGRAM_IDS должен содержать положительные числовые Telegram ID через запятую.');
  if (!config.demo) Object.assign(config, appConnection(config.publicAppUrl));
  if (!config.demo && (!config.botToken || !config.databaseUrl || !config.adminIds.size)) {
    throw new Error('Для запуска нужны BOT_TOKEN, DATABASE_URL и ADMIN_TELEGRAM_IDS. Для мини-аппа также настройте HTTPS PUBLIC_APP_URL. Для локального просмотра: ALLOW_DEMO=1.');
  }
  const store = createAppStore({ databaseUrl: config.databaseUrl, demo: config.demo });
  await store.init();
  const bot = createBot({ store, config });
  if (config.appSetupIssue) {
    console.warn('Мини-апп не подключён. Настройте PUBLIC_APP_URL или публичный домен Railway. Бот и поддержка продолжают работать.');
    await store.recordProblem({ title: 'Не подключён адрес мини-аппа', body: config.appSetupIssue, dedupeKey: 'public-app-url' }).catch(() => {});
  }
  const app = createApp({ store, getTelegram: () => bot?.telegram ?? null, config });
  const server = app.listen(config.port, config.demo?'127.0.0.1':'0.0.0.0', () => console.log(`Очевидно: http://127.0.0.1:${config.port} (${config.demo ? 'demo — без реальных списаний' : 'Telegram'})`));
  let stopWorker = () => {};
  let stopAlerts = () => {};
  if (bot) {
    bot.botInfo = await bot.telegram.getMe();
    config.botUsername = bot.botInfo.username;
    await configureBot(bot, config, await store.getBotSettings());
    try { await syncBotAvatar({ store, botToken: config.botToken }); } catch {
      console.warn('Аватарка бота не обновлена. При необходимости установите её через BotFather → /setuserpic.');
      await store.recordProblem({ title: 'Не удалось обновить аватарку бота', body: `Бот продолжает работать. Проверьте доступ к Telegram API или установите public${BRAND.botAvatar} через BotFather → /setuserpic.`, dedupeKey: `bot-avatar-v${BRAND.avatarVersion}` }).catch(() => {});
    }
    stopWorker = startBroadcastWorker({ store, telegram: bot.telegram });
    stopAlerts = startOwnerAlertWorker({store,telegram:bot.telegram});
    // Telegraf launch runs until polling stops; register all settings before starting it.
    bot.launch().catch((error) => { console.error('Не удалось запустить Telegram polling:', error.message); process.exitCode = 1; server.close(); });
  }
  const shutdown = async (signal) => { stopWorker(); stopAlerts(); server.close(); if (bot) { try { bot.stop(signal); } catch {} } await store.close(); };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return { app, server, store };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await start();
