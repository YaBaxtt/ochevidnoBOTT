import { Address } from '@ton/core';
import { PNG } from 'pngjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { configureBot } from './bot.js';
import { validLink } from './product.js';

const text = (value, name, max, optional = false) => {
  const result = String(value ?? '').trim();
  if ((!result && !optional) || result.length > max) throw new Error(`Проверьте поле «${name}» (до ${max} символов).`);
  return result;
};

function campaignInput(body) {
  if (!['entry', 'broadcast'].includes(body.kind)) throw new Error('Выберите формат рекламы.');
  const buttonText = text(body.buttonText, 'кнопка', 48, true);
  const buttonUrl = validLink(body.buttonUrl);
  if (Boolean(buttonText) !== Boolean(buttonUrl)) throw new Error('Для кнопки нужны и текст, и ссылка.');
  const audience = ['all', 'recent', 'limit'].includes(body.audience) ? body.audience : 'all';
  const limitCount = audience === 'limit' ? Number(body.limitCount) : null;
  if (audience === 'limit' && (!Number.isInteger(limitCount) || limitCount < 1 || limitCount > 100000)) throw new Error('Количество получателей: от 1 до 100 000.');
  const interest=['all','documents','math','you','premium','bundles'].includes(body.interest)?body.interest:'all';
  return { kind: body.kind, title: text(body.title, 'заголовок', 80), body: text(body.body, 'сообщение', 2800), buttonText, buttonUrl, audience, limitCount, interest:body.kind==='broadcast'?interest:'all' };
}

function iconPng() {
  const image = new PNG({ width: 180, height: 180 });
  const source=PNG.sync.read(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public/assets/obvious-logo-v2.png')));
  for (let y = 0; y < 180; y++) for (let x = 0; x < 180; x++) {
    const index = (y * 180 + x) * 4;
    const sx=Math.floor(x*source.width/180),sy=Math.floor(y*source.height/180),from=(sy*source.width+sx)*4;
    source.data.copy(image.data,index,from,from+4);
  }
  return PNG.sync.write(image);
}

export function registerEngagementApi({ app, store, config, getTelegram, requireActor, requireAdmin }) {
  const png = iconPng();
  const walletCache = new Map();
  app.get('/icon-180.png', (_req, res) => res.set('Access-Control-Allow-Origin', '*').set('Cross-Origin-Resource-Policy', 'cross-origin').type('png').send(png));
  app.get('/vendor/tonconnect-ui.js', (_req, res) => res.sendFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/@tonconnect/ui/dist/tonconnect-ui.min.js')));
  app.get('/tonconnect-manifest.json', (_req, res) => {
    if (!config.publicAppUrl.startsWith('https://')) return res.status(503).json({ error: 'Для TON Connect настройте публичный HTTPS-адрес приложения.' });
    res.set('Access-Control-Allow-Origin', '*').set('Cross-Origin-Resource-Policy', 'cross-origin').json({ url: config.publicAppUrl, name: 'Очевидно', iconUrl: `${config.publicAppUrl}/icon-180.png`, termsOfUseUrl: `${config.publicAppUrl}/api/terms`, privacyPolicyUrl: `${config.publicAppUrl}/api/privacy` });
  });
  app.get('/api/privacy', (_req, res) => res.type('text/plain; charset=utf-8').send('Очевидно: конфиденциальность\n\nМы сохраняем Telegram ID, имя, покупки, результаты, обращения и выполненные задания. Администратор видит эти данные для работы сервиса и поддержки. Публичные рейтинги показывают только карточки.\n\nАдрес подключённого TON-кошелька используется для чтения публичного баланса через TON Center и локально сохраняется TON Connect на устройстве. Приложение не получает приватные ключи.\n\nРекламные сообщения отключаются командой /stop или в профиле. По вопросам данных обращайтесь в /paysupport.'));
  app.get('/api/wallet/balance', requireActor, async (req, res) => {
    let address;
    try { address = Address.parse(String(req.query.address ?? '')).toString({ bounceable: false }); } catch { return res.status(422).json({ error: 'Некорректный TON-адрес.' }); }
    const network = req.query.network === '-3' ? '-3' : '-239';
    const key = `${network}:${address}`;
    if (walletCache.has(key) && walletCache.get(key).expires > Date.now()) return res.json(walletCache.get(key).data);
    try {
      const endpoint = network === '-3' ? 'https://testnet.toncenter.com' : 'https://toncenter.com';
      const response = await fetch(`${endpoint}/api/v2/getAddressBalance?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(6000), headers: config.toncenterApiKey ? { 'X-API-Key': config.toncenterApiKey } : {} });
      const body = await response.json();
      if (!response.ok || !body.ok || !/^\d+$/.test(String(body.result))) throw new Error('network');
      const nano = BigInt(body.result);
      const data = { address, network, balance: `${nano / 1_000_000_000n}.${String(nano % 1_000_000_000n).padStart(9, '0').slice(0, 4)}`, updatedAt: new Date().toISOString() };
      if (walletCache.size > 2000) walletCache.clear();
      walletCache.set(key, { expires: Date.now() + 30000, data });
      res.json(data);
    } catch { res.status(503).json({ error: 'Баланс сети сейчас недоступен. Кошелёк остаётся подключённым; попробуйте обновить позже.' }); }
  });
  app.patch('/api/profile/notifications', requireActor, async (req, res) => {
    if (typeof req.body.enabled !== 'boolean') return res.status(422).json({ error: 'Проверьте настройку сообщений.' });
    res.json({ profile: await store.setNotifications(req.actor.id, req.body.enabled) });
  });
  app.post('/api/ads/:id/event', requireActor, async (req, res) => {
    if (!['view', 'click'].includes(req.body.event)) return res.status(422).json({ error: 'Некорректное событие.' });
    res.json({ ok: await store.recordAdEvent(req.params.id, req.actor.id, req.body.event === 'click') });
  });
  app.get('/api/admin/bot', ...requireAdmin, async (_req, res) => res.json({ settings: await store.getBotSettings(), connected: Boolean(getTelegram()), reachableUsers: await store.campaignAudience({ audience: 'all' }) }));
  app.patch('/api/admin/bot', ...requireAdmin, async (req, res) => {
    const patch = { welcome: text(req.body.welcome, 'приветствие', 3000), buttonText: text(req.body.buttonText, 'кнопка', 40), description: text(req.body.description, 'описание бота', 512) };
    const settings = await store.updateBotSettings(patch);
    // Persisted greeting is used immediately; Telegram metadata is retried on next boot if the API is temporarily down.
    let synced = false;
    if (getTelegram()) { try { await configureBot({ telegram: getTelegram() }, config, settings); synced = true; } catch (error) { console.error('bot metadata:', error.message); } }
    await store.audit(req.actor.id, 'bot.update', 'settings', patch);
    res.json({ settings, synced });
  });
  app.get('/api/admin/campaigns', ...requireAdmin, async (_req, res) => res.json({ campaigns: await store.listCampaigns(), reachableUsers: await store.campaignAudience({ audience: 'all' }), connected: Boolean(getTelegram()) }));
  app.post('/api/admin/campaigns', ...requireAdmin, async (req, res) => {
    const data = campaignInput(req.body);
    const campaign = await store.createCampaign(data);
    await store.audit(req.actor.id, 'campaign.create', campaign.id, data);
    res.status(201).json({ campaign, eligibleCount: await store.campaignAudience(data) });
  });
  app.post('/api/admin/campaigns/:id/preview', ...requireAdmin, async (req, res) => {
    const campaign = await store.getCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Объявление не найдено.' });
    res.json({ campaign, eligibleCount: await store.campaignAudience(campaign) });
  });
  app.post('/api/admin/campaigns/:id/start', ...requireAdmin, async (req, res) => {
    if (config.demo || !getTelegram()) return res.status(409).json({ error: 'Для реальной рассылки подключите Telegram-бота. В предпросмотре можно создать черновик и проверить объявление при входе.' });
    const campaign = await store.queueCampaign(req.params.id);
    await store.audit(req.actor.id, 'campaign.start', campaign.id, { total: campaign.total });
    res.json({ campaign });
  });
  app.patch('/api/admin/campaigns/:id', ...requireAdmin, async (req, res) => {
    let campaign;
    if (req.body.cancel === true) campaign = await store.cancelCampaign(req.params.id);
    else if (typeof req.body.active === 'boolean') campaign = await store.updateEntryCampaign(req.params.id, req.body.active);
    else return res.status(422).json({ error: 'Выберите действие с объявлением.' });
    if (!campaign) return res.status(409).json({ error: 'Это действие сейчас недоступно.' });
    await store.audit(req.actor.id, 'campaign.update', campaign.id, req.body);
    res.json({ campaign });
  });
}
