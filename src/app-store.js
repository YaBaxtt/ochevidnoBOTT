import crypto from 'node:crypto';
import { MemoryStore, PostgresStore } from './store.js';
import { DEFAULT_BOT_SETTINGS, resolveBotSettings } from './product.js';
import { initReleaseSchema, installReleaseMethods, productGroup } from './release-store.js';
import { initFreeOpeningSchema, installFreeOpeningMethods } from './free-openings.js';

const uuid = () => crypto.randomUUID();
const isoNow = () => new Date().toISOString();
const profile = (user) => {
  if (!user) return null;
  const { lumens, ...rest } = user;
  return { ...rest, bonusBalance: lumens ?? 0, notifications: user.notifications ?? true };
};

export class MemoryAppStore extends MemoryStore {
  constructor() {
    super();
    this.settings = { ...DEFAULT_BOT_SETTINGS };
    this.campaigns = new Map();
    this.deliveries = new Map();
    this.impressions = new Map();
  }
  async upsertUser(user) { return profile(await super.upsertUser(user)); }
  async getProfile(userId) { return profile(await super.getProfile(userId)); }
  async setNotifications(userId, enabled, started = false) {
    const user = this.users.get(String(userId));
    if (user) { user.notifications = enabled; if (started) user.botStarted = true; }
    return this.getProfile(userId);
  }
  async claimTask(args) { const result = await super.claimTask(args); return result ? { ...result, profile: profile(result.profile) } : null; }
  async createPurchase(args) { const purchase = await super.createPurchase(args); this.purchases.get(purchase.id).paymentMethod = 'stars'; return { ...purchase, paymentMethod: 'stars' }; }
  async payWithBonuses(purchaseId, userId) {
    const purchase = this.purchases.get(purchaseId);
    if (!purchase || purchase.userId !== String(userId)) return null;
    if (purchase.state === 'paid' && purchase.paymentMethod === 'bonus') return { ...purchase };
    if (purchase.state !== 'pending') throw new Error('Этот заказ уже закрыт.');
    const user = this.users.get(String(userId));
    if (!user || user.lumens < purchase.amount) throw new Error('Недостаточно бонусов для этой карточки.');
    user.lumens -= purchase.amount;
    user.cardCount += purchase.result.items?.length || 1;
    Object.assign(purchase, { paymentMethod: 'bonus', state: 'paid' });
    return { ...purchase };
  }
  async incrementShare(purchaseId, userId) { const purchase = this.purchases.get(purchaseId); if (!purchase || purchase.userId !== String(userId) || purchase.state !== 'paid') return null; return ++purchase.shareCount; }
  async recentPurchases(userId) { return [...this.purchases.values()].filter((item) => item.userId === String(userId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,30).map((item)=>({...item,title:this.cards.get(item.cardId)?.title||item.cardId})); }
  async getBotSettings() { return resolveBotSettings(this.settings); }
  async updateBotSettings(patch) { Object.assign(this.settings, patch); return this.getBotSettings(); }
  eligibleUsers(campaign) {
    const users = [...this.users.values()].filter((user) => user.botStarted && user.notifications !== false && (campaign.audience !== 'recent' || Date.now() - new Date(user.lastSeenAt).getTime() < 7 * 86_400_000) && (!campaign.interest || campaign.interest === 'all' || [...this.purchases.values()].some(p=>p.userId===user.id&&p.state==='paid'&&productGroup(p.cardId)===campaign.interest))).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    return campaign.audience === 'limit' ? users.slice(0, campaign.limitCount) : users;
  }
  async campaignAudience(campaign) { return this.eligibleUsers(campaign).length; }
  async createCampaign(data) {
    const campaign = { ...data, id: uuid(), status: 'draft', active: false, createdAt: isoNow() };
    this.campaigns.set(campaign.id, campaign);
    return { ...campaign };
  }
  async getCampaign(id) { const row = this.campaigns.get(id); return row ? { ...row } : null; }
  async listCampaigns() {
    return [...this.campaigns.values()].reverse().map((campaign) => {
      const deliveries = [...this.deliveries.values()].filter((item) => item.campaignId === campaign.id);
      const impressions = [...this.impressions.values()].filter((item) => item.campaignId === campaign.id);
      return { ...campaign, total: deliveries.length, sent: deliveries.filter((item) => item.status === 'sent').length, failed: deliveries.filter((item) => item.status === 'failed').length, views: impressions.length, clicks: impressions.filter((item) => item.clicked).length };
    });
  }
  async updateEntryCampaign(id, active) { const row = this.campaigns.get(id); if (!row || row.kind !== 'entry') return null; row.active = active; return { ...row }; }
  async getEntryCampaign(userId) {
    return [...this.campaigns.values()].reverse().find((campaign) => campaign.kind === 'entry' && campaign.active && !this.impressions.has(`${campaign.id}:${userId}:${isoNow().slice(0, 10)}`)) ?? null;
  }
  async recordAdEvent(campaignId, userId, clicked = false) {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign || campaign.kind !== 'entry' || !campaign.active) return false;
    const key = `${campaignId}:${userId}:${isoNow().slice(0, 10)}`;
    const impression = this.impressions.get(key) ?? { campaignId, userId, clicked: false };
    if (clicked) impression.clicked = true;
    this.impressions.set(key, impression);
    return true;
  }
  async queueCampaign(id) {
    const campaign = this.campaigns.get(id);
    if (!campaign || campaign.kind !== 'broadcast' || campaign.status !== 'draft') throw new Error('Эта рассылка уже запускалась.');
    const recipients = this.eligibleUsers(campaign);
    if (!recipients.length) throw new Error('Нет пользователей, разрешивших сообщения от бота.');
    for (const user of recipients) { const delivery = { id: uuid(), campaignId: id, userId: user.id, status: 'pending', attempts: 0, nextAt: 0 }; this.deliveries.set(delivery.id, delivery); }
    campaign.status = 'queued'; return { ...campaign, total: recipients.length };
  }
  async cancelCampaign(id) { const row = this.campaigns.get(id); if (!row || !['queued', 'sending'].includes(row.status)) return null; row.status = 'cancelled'; return { ...row }; }
  async claimDelivery() {
    const delivery = [...this.deliveries.values()].find((item) => (item.status === 'pending' || item.status === 'sending' && item.lockUntil < Date.now()) && item.nextAt <= Date.now() && ['queued', 'sending'].includes(this.campaigns.get(item.campaignId)?.status));
    if (!delivery) return null;
    const user = this.users.get(delivery.userId);
    if (!user?.notifications) { delivery.status = 'failed'; await this.completeCampaigns(); return null; }
    delivery.status = 'sending'; delivery.attempts++; delivery.lockUntil = Date.now() + 60_000;
    const campaign = this.campaigns.get(delivery.campaignId); campaign.status = 'sending';
    return { ...delivery, campaign: { ...campaign } };
  }
  async finishDelivery(id, status, retrySeconds = 0) { const delivery = this.deliveries.get(id); Object.assign(delivery, { status, nextAt: Date.now() + retrySeconds * 1000 }); await this.completeCampaigns(); }
  async completeCampaigns() { for (const campaign of this.campaigns.values()) { if (['queued', 'sending'].includes(campaign.status) && ![...this.deliveries.values()].some((item) => item.campaignId === campaign.id && ['pending', 'sending'].includes(item.status))) campaign.status = 'completed'; } }
  async dashboard() { const result = await super.dashboard(); result.grossStars = [...this.purchases.values()].filter((p) => p.state === 'paid' && p.paymentMethod === 'stars').reduce((sum, p) => sum + p.amount, 0); return { ...result, reachableUsers: await this.campaignAudience({ audience: 'all' }) }; }
}

const campaignColumns = `id::text,kind,title,body,button_text AS "buttonText",button_url AS "buttonUrl",audience,limit_count AS "limitCount",interest,active,status,created_at AS "createdAt"`;
const purchaseColumns = `p.id::text,p.telegram_id::text AS "userId",p.card_id AS "cardId",p.amount,p.answers,p.result,p.payload,p.state,p.charge_id AS "chargeId",p.payment_method AS "paymentMethod",p.share_count AS "shareCount",p.created_at AS "createdAt",c.title`;

export class PostgresAppStore extends PostgresStore {
  async init() {
    await super.init();
    await this.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_started BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'stars';
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY,value JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS campaigns (
        id UUID PRIMARY KEY,kind TEXT NOT NULL CHECK (kind IN ('broadcast','entry')),title TEXT NOT NULL,body TEXT NOT NULL,
        button_text TEXT NOT NULL DEFAULT '',button_url TEXT NOT NULL DEFAULT '',audience TEXT NOT NULL DEFAULT 'all',limit_count INTEGER,
        active BOOLEAN NOT NULL DEFAULT FALSE,status TEXT NOT NULL DEFAULT 'draft',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS campaign_deliveries (
        id UUID PRIMARY KEY,campaign_id UUID NOT NULL REFERENCES campaigns(id),telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
        status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        lock_until TIMESTAMPTZ,sent_at TIMESTAMPTZ,UNIQUE(campaign_id,telegram_id)
      );
      CREATE TABLE IF NOT EXISTS ad_impressions (
        campaign_id UUID NOT NULL REFERENCES campaigns(id),telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
        day DATE NOT NULL DEFAULT CURRENT_DATE,clicked BOOLEAN NOT NULL DEFAULT FALSE,PRIMARY KEY(campaign_id,telegram_id,day)
      );
      CREATE INDEX IF NOT EXISTS delivery_pending_idx ON campaign_deliveries(status,next_at);
    `);
    await initReleaseSchema(this);
    await initFreeOpeningSchema(this);
    await this.query(`CREATE INDEX IF NOT EXISTS purchases_owned_collection_idx ON purchases(telegram_id,created_at DESC,id DESC) WHERE state='paid'`);
  }
  async upsertUser(user) { return profile(await super.upsertUser(user)); }
  async getProfile(userId) {
    const result = await this.query(`SELECT telegram_id::text AS id,username,first_name AS "firstName",photo_url AS "photoUrl",lumens AS "bonusBalance",stars_spent AS "starsSpent",card_count AS "cardCount",notifications,bot_started AS "botStarted",created_at AS "createdAt",last_seen_at AS "lastSeenAt" FROM users WHERE telegram_id=$1`, [String(userId)]);
    return result.rows[0] ?? null;
  }
  async setNotifications(userId, enabled, started = false) { await this.query(`UPDATE users SET notifications=$2,bot_started=bot_started OR $3 WHERE telegram_id=$1`, [String(userId), enabled, started]); return this.getProfile(userId); }
  async claimTask(args) { const result = await super.claimTask(args); return result ? { ...result, profile: await this.getProfile(args.userId) } : null; }
  async getPurchase(purchaseId, userId) { const result = await this.query(`SELECT ${purchaseColumns} FROM purchases p JOIN cards c ON c.id=p.card_id WHERE p.id=$1 AND p.telegram_id=$2`, [purchaseId, String(userId)]); return result.rows[0] ?? null; }
  async getPurchaseByPayload(payload) { const result = await this.query(`SELECT ${purchaseColumns} FROM purchases p JOIN cards c ON c.id=p.card_id WHERE p.payload=$1`, [payload]); return result.rows[0] ?? null; }
  async getPurchaseAdmin(purchaseId) { const result = await this.query(`SELECT ${purchaseColumns},u.first_name AS "firstName",u.username FROM purchases p JOIN cards c ON c.id=p.card_id JOIN users u ON u.telegram_id=p.telegram_id WHERE p.id=$1`, [purchaseId]); return result.rows[0] ?? null; }
  async recentPurchases(userId) { const result = await this.query(`SELECT ${purchaseColumns} FROM purchases p JOIN cards c ON c.id=p.card_id WHERE p.telegram_id=$1 ORDER BY p.created_at DESC LIMIT 30`, [String(userId)]); return result.rows; }
  async listAdminPurchases() { const result = await this.query(`SELECT ${purchaseColumns},u.first_name AS "firstName",u.username FROM purchases p JOIN cards c ON c.id=p.card_id JOIN users u ON u.telegram_id=p.telegram_id ORDER BY p.created_at DESC LIMIT 50`); return result.rows; }
  async payWithBonuses(purchaseId, userId) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(`SELECT * FROM purchases WHERE id=$1 AND telegram_id=$2 FOR UPDATE`, [purchaseId, String(userId)]);
      const purchase = found.rows[0];
      if (!purchase) { await client.query('ROLLBACK'); return null; }
      if (purchase.state === 'paid' && purchase.payment_method === 'bonus') { await client.query('COMMIT'); return this.getPurchase(purchaseId, userId); }
      if (purchase.state !== 'pending') throw new Error('Этот заказ уже закрыт.');
      const debit = await client.query(`UPDATE users SET lumens=lumens-$2,card_count=card_count+$3 WHERE telegram_id=$1 AND lumens >= $2 RETURNING telegram_id`, [String(userId), purchase.amount, purchase.result.items?.length || 1]);
      if (!debit.rowCount) throw new Error('Недостаточно бонусов для этой карточки.');
      await client.query(`UPDATE purchases SET state='paid',payment_method='bonus',paid_at=NOW() WHERE id=$1`, [purchaseId]);
      await client.query('COMMIT');
      return this.getPurchase(purchaseId, userId);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async getBotSettings() { const result = await this.query(`SELECT value FROM app_settings WHERE key='bot'`); return resolveBotSettings(result.rows[0]?.value); }
  async updateBotSettings(patch) { const settings = { ...await this.getBotSettings(), ...patch }; await this.query(`INSERT INTO app_settings (key,value) VALUES ('bot',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(settings)]); return settings; }
  async campaignAudience(campaign) {
    const ids = (await this.getCards({includeDisabled:true})).filter(c=>productGroup(c.id)===campaign.interest).map(c=>c.id);
    const result = await this.query(`SELECT COUNT(*)::int AS count FROM users u WHERE bot_started=TRUE AND notifications=TRUE AND ($1 <> 'recent' OR last_seen_at > NOW()-INTERVAL '7 days') AND ($2='all' OR EXISTS(SELECT 1 FROM purchases p WHERE p.telegram_id=u.telegram_id AND p.state='paid' AND p.card_id=ANY($3::text[])))`, [campaign.audience,campaign.interest||'all',ids]);
    return campaign.audience === 'limit' ? Math.min(result.rows[0].count, campaign.limitCount) : result.rows[0].count;
  }
  async createCampaign(data) { const result = await this.query(`INSERT INTO campaigns(id,kind,title,body,button_text,button_url,audience,limit_count,interest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${campaignColumns}`, [uuid(), data.kind, data.title, data.body, data.buttonText, data.buttonUrl, data.audience, data.limitCount,data.interest||'all']); return result.rows[0]; }
  async getCampaign(id) { const result = await this.query(`SELECT ${campaignColumns} FROM campaigns WHERE id=$1`, [id]); return result.rows[0] ?? null; }
  async listCampaigns() {
    const result = await this.query(`SELECT c.id::text,c.kind,c.title,c.body,c.button_text AS "buttonText",c.button_url AS "buttonUrl",c.audience,c.limit_count AS "limitCount",c.active,c.status,c.created_at AS "createdAt",
      (SELECT COUNT(*)::int FROM campaign_deliveries d WHERE d.campaign_id=c.id) AS total,
      (SELECT COUNT(*)::int FROM campaign_deliveries d WHERE d.campaign_id=c.id AND d.status='sent') AS sent,
      (SELECT COUNT(*)::int FROM campaign_deliveries d WHERE d.campaign_id=c.id AND d.status='failed') AS failed,
      (SELECT COUNT(*)::int FROM ad_impressions i WHERE i.campaign_id=c.id) AS views,
      (SELECT COUNT(*)::int FROM ad_impressions i WHERE i.campaign_id=c.id AND i.clicked) AS clicks
      FROM campaigns c ORDER BY c.created_at DESC LIMIT 100`);
    const interests = await this.query(`SELECT id::text,interest FROM campaigns`);
    return result.rows.map(r=>({...r,interest:interests.rows.find(c=>c.id===r.id)?.interest||'all'}));
  }
  async updateEntryCampaign(id, active) { const result = await this.query(`UPDATE campaigns SET active=$2 WHERE id=$1 AND kind='entry' RETURNING ${campaignColumns}`, [id, active]); return result.rows[0] ?? null; }
  async getEntryCampaign(userId) { const result = await this.query(`SELECT ${campaignColumns} FROM campaigns c WHERE kind='entry' AND active=TRUE AND NOT EXISTS(SELECT 1 FROM ad_impressions i WHERE i.campaign_id=c.id AND i.telegram_id=$1 AND i.day=CURRENT_DATE) ORDER BY created_at DESC LIMIT 1`, [String(userId)]); return result.rows[0] ?? null; }
  async recordAdEvent(campaignId, userId, clicked = false) { const result = await this.query(`INSERT INTO ad_impressions(campaign_id,telegram_id,clicked) SELECT id,$2,$3 FROM campaigns WHERE id=$1 AND kind='entry' AND active=TRUE ON CONFLICT(campaign_id,telegram_id,day) DO UPDATE SET clicked=ad_impressions.clicked OR EXCLUDED.clicked RETURNING campaign_id`, [campaignId, String(userId), clicked]); return Boolean(result.rowCount); }
  async queueCampaign(id) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(`SELECT * FROM campaigns WHERE id=$1 FOR UPDATE`, [id]);
      const campaign = found.rows[0];
      if (!campaign || campaign.kind !== 'broadcast' || campaign.status !== 'draft') throw new Error('Эта рассылка уже запускалась.');
      const ids=(await this.getCards({includeDisabled:true})).filter(c=>productGroup(c.id)===campaign.interest).map(c=>c.id);
      const targets = await client.query(`SELECT telegram_id FROM users u WHERE bot_started=TRUE AND notifications=TRUE AND ($1 <> 'recent' OR last_seen_at > NOW()-INTERVAL '7 days') AND ($3='all' OR EXISTS(SELECT 1 FROM purchases p WHERE p.telegram_id=u.telegram_id AND p.state='paid' AND p.card_id=ANY($4::text[]))) ORDER BY last_seen_at DESC,telegram_id LIMIT $2`, [campaign.audience, campaign.audience === 'limit' ? campaign.limit_count : null,campaign.interest||'all',ids]);
      if (!targets.rowCount) throw new Error('Нет пользователей, разрешивших сообщения от бота.');
      await client.query(`INSERT INTO campaign_deliveries(id,campaign_id,telegram_id) SELECT gen_random_uuid(),$1,recipient FROM unnest($2::bigint[]) AS recipient ON CONFLICT DO NOTHING`, [id, targets.rows.map((user) => user.telegram_id)]);
      await client.query(`UPDATE campaigns SET status='queued' WHERE id=$1`, [id]);
      await client.query('COMMIT');
      return { id, status: 'queued', total: targets.rowCount };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async cancelCampaign(id) { const result = await this.query(`UPDATE campaigns SET status='cancelled' WHERE id=$1 AND status IN ('queued','sending') RETURNING ${campaignColumns}`, [id]); return result.rows[0] ?? null; }
  async claimDelivery() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`SELECT d.id::text,d.campaign_id::text AS "campaignId",d.telegram_id::text AS "userId",d.attempts,u.notifications FROM campaign_deliveries d JOIN campaigns c ON c.id=d.campaign_id JOIN users u ON u.telegram_id=d.telegram_id WHERE c.status IN ('queued','sending') AND ((d.status='pending' AND d.next_at<=NOW()) OR (d.status='sending' AND d.lock_until<NOW())) ORDER BY d.next_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`);
      const delivery = result.rows[0];
      if (!delivery) { await client.query('COMMIT'); return null; }
      if (!delivery.notifications) { await client.query(`UPDATE campaign_deliveries SET status='failed' WHERE id=$1`, [delivery.id]); await client.query('COMMIT'); await this.completeCampaigns(); return null; }
      await client.query(`UPDATE campaign_deliveries SET status='sending',attempts=attempts+1,lock_until=NOW()+INTERVAL '60 seconds' WHERE id=$1`, [delivery.id]);
      await client.query(`UPDATE campaigns SET status='sending' WHERE id=$1`, [delivery.campaignId]);
      await client.query('COMMIT'); return { ...delivery, attempts: delivery.attempts + 1, campaign: await this.getCampaign(delivery.campaignId) };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async finishDelivery(id, status, retrySeconds = 0) { await this.query(`UPDATE campaign_deliveries SET status=$2,next_at=NOW()+$3*INTERVAL '1 second',lock_until=NULL,sent_at=CASE WHEN $2='sent' THEN NOW() ELSE sent_at END WHERE id=$1`, [id, status, retrySeconds]); await this.completeCampaigns(); }
  async completeCampaigns() { await this.query(`UPDATE campaigns c SET status='completed' WHERE status IN ('queued','sending') AND NOT EXISTS(SELECT 1 FROM campaign_deliveries d WHERE d.campaign_id=c.id AND d.status IN ('pending','sending'))`); }
  async dashboard() { const result = await super.dashboard(); const actual = await this.query(`SELECT COALESCE(SUM(amount),0)::int AS gross FROM purchases WHERE state='paid' AND payment_method='stars'`); return { ...result, grossStars: actual.rows[0].gross, reachableUsers: await this.campaignAudience({ audience: 'all' }) }; }
}

installReleaseMethods(MemoryAppStore, PostgresAppStore);
installFreeOpeningMethods(MemoryAppStore, PostgresAppStore);

export function createAppStore({ databaseUrl, demo }) {
  if (!databaseUrl && !demo) throw new Error('DATABASE_URL обязателен вне демо-режима.');
  if (databaseUrl && demo) throw new Error('Демо нельзя запускать с production-базой. Уберите DATABASE_URL.');
  return databaseUrl ? new PostgresAppStore(databaseUrl) : new MemoryAppStore();
}
