import crypto from 'node:crypto';
import pg from 'pg';
import { DEFAULT_CARDS } from './card-engine.js';

const { Pool } = pg;
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

const defaultTasks = [];

const publicCard = (row) => ({
  id: row.id,
  title: row.title,
  subtitle: row.subtitle,
  priceStars: Number(row.price_stars ?? row.priceStars),
  enabled: row.enabled,
  accent: row.accent,
  sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
  copy: row.copy ?? row.copy_json ?? {}
});

export class MemoryStore {
  constructor() {
    this.cards = new Map(DEFAULT_CARDS.map((card, index) => [card.id, { ...card, priceStars: card.priceStars, enabled: true, sortOrder: index, copy: {} }]));
    this.users = new Map();
    this.purchases = new Map();
    this.tasks = new Map(defaultTasks.map((task) => [task.id, task]));
    this.claims = new Set();
    this.tickets = [];
  }
  async init() {}
  async upsertUser(user) {
    const existing = this.users.get(String(user.id));
    const next = { ...existing, id: String(user.id), username: user.username ?? null, firstName: user.first_name ?? 'Игрок', photoUrl: user.photo_url ?? null, lumens: existing?.lumens ?? 0, starsSpent: existing?.starsSpent ?? 0, cardCount: existing?.cardCount ?? 0, createdAt: existing?.createdAt ?? now(), lastSeenAt: now() };
    this.users.set(next.id, next);
    return next;
  }
  async getCards({ includeDisabled = false } = {}) { return [...this.cards.values()].filter((card) => includeDisabled || card.enabled).sort((a, b) => a.sortOrder - b.sortOrder).map(publicCard); }
  async getCard(cardId) { const card = this.cards.get(cardId); return card ? publicCard(card) : null; }
  async getProfile(userId) { const user = this.users.get(String(userId)); return user && { ...user }; }
  async getTasks() { return [...this.tasks.values()].filter((task) => task.active).map((task) => ({ ...task })); }
  async createPurchase({ userId, cardId, amount, answers, result }) {
    const purchase = { id: id(), userId: String(userId), cardId, amount, answers, result, state: 'pending', payload: `p_${crypto.randomUUID()}`, createdAt: now(), termsAcceptedAt: now(), chargeId: null, shareCount: 0 };
    this.purchases.set(purchase.id, purchase); return { ...purchase };
  }
  async getPurchase(purchaseId, userId) { const item = this.purchases.get(purchaseId); return item && item.userId === String(userId) ? { ...item } : null; }
  async getPurchaseAdmin(purchaseId) { const item = this.purchases.get(purchaseId); return item ? { ...item, firstName: this.users.get(item.userId)?.firstName ?? 'Игрок', username: this.users.get(item.userId)?.username ?? null, title: this.cards.get(item.cardId)?.title ?? item.cardId } : null; }
  async getPurchaseByPayload(payload) { return [...this.purchases.values()].find((item) => item.payload === payload) ?? null; }
  async settlePurchase({ payload, chargeId }) {
    const item = await this.getPurchaseByPayload(payload); if (!item || item.state === 'paid') return item;
    if (item.state !== 'pending') return null;
    if ([...this.purchases.values()].some((p) => p.chargeId === chargeId)) throw new Error('Платёж уже учтён.');
    item.state = 'paid'; item.chargeId = chargeId;
    const user = this.users.get(item.userId); if (user) { user.starsSpent += item.amount; user.cardCount += item.result.items?.length || 1; }
    return { ...item };
  }
  async incrementShare(purchaseId, userId) { const item = await this.getPurchase(purchaseId, userId); if (!item || item.state !== 'paid') return null; item.shareCount += 1; return item.shareCount; }
  async claimTask({ taskId, userId }) {
    const task = this.tasks.get(taskId); const key = `${userId}:${taskId}`;
    if (!task || !task.active || this.claims.has(key)) return null;
    this.claims.add(key); const user = this.users.get(String(userId)); if (user) user.lumens += task.rewardPoints;
    return { task, profile: { ...user } };
  }
  async createTicket({ userId, message }) { const ticket = { id: id(), userId: String(userId), message, state: 'open', createdAt: now() }; this.tickets.push(ticket); return ticket; }
  async listAdminPurchases() { return [...this.purchases.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map((item) => ({ ...item, firstName: this.users.get(item.userId)?.firstName ?? 'Игрок', username: this.users.get(item.userId)?.username ?? null, title: this.cards.get(item.cardId)?.title ?? item.cardId })); }
  async listTickets() { return [...this.tickets].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map((ticket) => ({ ...ticket, firstName: this.users.get(ticket.userId)?.firstName ?? 'Игрок', username: this.users.get(ticket.userId)?.username ?? null })); }
  async updateTicket(ticketId, patch) { const ticket = this.tickets.find((item) => item.id === ticketId); if (!ticket) return null; if (patch.state) ticket.state = patch.state; return { ...ticket }; }
  async dashboard() {
    const paid = [...this.purchases.values()].filter((purchase) => purchase.state === 'paid');
    const today = new Date().toISOString().slice(0, 10);
    return { todayUsers: [...this.users.values()].filter((user) => user.lastSeenAt.startsWith(today)).length, monthUsers: [...this.users.values()].filter(u=>u.lastSeenAt.slice(0,7)===today.slice(0,7)).length, paidPurchases: paid.length, grossStars: paid.reduce((sum, purchase) => sum + purchase.amount, 0), refunds: [...this.purchases.values()].filter(p=>p.state==='refunded').length, openTickets: this.tickets.filter((ticket) => ticket.state === 'open').length, popularCards: [...this.cards.values()].map((card) => ({ id: card.id, title: card.title, shares: paid.filter((purchase) => purchase.cardId === card.id).reduce((sum, purchase) => sum + purchase.shareCount, 0) })).sort((a, b) => b.shares - a.shares).slice(0, 8) };
  }
  async publicLeaderboard() {
    const paid = [...this.purchases.values()].filter((purchase) => purchase.state === 'paid');
    const cards = [...this.cards.values()].map((card) => ({ id: card.id, title: card.title, purchases: paid.filter((purchase) => purchase.cardId === card.id).length })).filter((card) => card.purchases > 0).sort((a, b) => b.purchases - a.purchases).slice(0, 3);
    return { completedCards: paid.length, cards };
  }
  async updateCard(cardId, patch) { const card = this.cards.get(cardId); if (!card) return null; Object.assign(card, patch); return publicCard(card); }
  async getAllTasks() { return [...this.tasks.values()].map((task) => ({ ...task })); }
  async createTask(task) { const row = { id: id(), active: false, taskType: 'channel_membership', rewardPoints: 5, ...task, createdAt: now() }; this.tasks.set(row.id, row); return row; }
  async updateTask(taskId, patch) { const task = this.tasks.get(taskId); if (!task) return null; Object.assign(task, patch); return { ...task }; }
  async audit() {}
  async refund() { throw new Error('В демо возвраты недоступны.'); }
  async close() {}
}

export class PostgresStore {
  constructor(connectionString) { this.pool = new Pool({ connectionString }); }
  async query(text, values = []) { return this.pool.query(text, values); }
  async init() {
    await this.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id BIGINT PRIMARY KEY, username TEXT, first_name TEXT NOT NULL, photo_url TEXT,
        lumens INTEGER NOT NULL DEFAULT 0 CHECK (lumens >= 0), stars_spent INTEGER NOT NULL DEFAULT 0 CHECK (stars_spent >= 0),
        card_count INTEGER NOT NULL DEFAULT 0 CHECK (card_count >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT NOT NULL, price_stars INTEGER NOT NULL CHECK (price_stars BETWEEN 1 AND 100000),
        enabled BOOLEAN NOT NULL DEFAULT TRUE, accent TEXT NOT NULL, sort_order INTEGER NOT NULL, copy_json JSONB NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE IF NOT EXISTS purchases (
        id UUID PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id), card_id TEXT NOT NULL REFERENCES cards(id),
        amount INTEGER NOT NULL CHECK (amount > 0), answers JSONB NOT NULL, result JSONB NOT NULL, payload TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL CHECK (state IN ('pending','paid','refunded','expired')) DEFAULT 'pending', charge_id TEXT UNIQUE,
        share_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), terms_accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), paid_at TIMESTAMPTZ, refunded_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT NOT NULL, task_type TEXT NOT NULL CHECK (task_type IN ('channel_membership')),
        chat_id TEXT NOT NULL, target_url TEXT NOT NULL, reward_points INTEGER NOT NULL CHECK (reward_points BETWEEN 1 AND 100),
        active BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS task_claims (
        task_id UUID NOT NULL REFERENCES tasks(id), telegram_id BIGINT NOT NULL REFERENCES users(telegram_id), reward_points INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(task_id, telegram_id)
      );
      CREATE TABLE IF NOT EXISTS support_tickets (
        id UUID PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id), message TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS admin_audit (
        id UUID PRIMARY KEY, admin_telegram_id BIGINT NOT NULL, action TEXT NOT NULL, target TEXT, payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS users_last_seen_idx ON users(last_seen_at);
      CREATE INDEX IF NOT EXISTS purchases_state_created_idx ON purchases(state, created_at DESC);
    `);
    await this.query(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await this.query(`ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_price_stars_check; ALTER TABLE cards ADD CONSTRAINT cards_price_stars_check CHECK (price_stars BETWEEN 1 AND 100000)`);
    for (const [index, card] of DEFAULT_CARDS.entries()) {
      await this.query(`INSERT INTO cards (id,title,subtitle,price_stars,enabled,accent,sort_order) VALUES ($1,$2,$3,$4,true,$5,$6) ON CONFLICT (id) DO NOTHING`, [card.id, card.title, card.subtitle, card.priceStars, card.accent, index]);
    }
  }
  async upsertUser(user) {
    const result = await this.query(`INSERT INTO users (telegram_id,username,first_name,photo_url) VALUES ($1,$2,$3,$4)
      ON CONFLICT (telegram_id) DO UPDATE SET username=EXCLUDED.username, first_name=EXCLUDED.first_name, photo_url=EXCLUDED.photo_url, last_seen_at=NOW()
      RETURNING telegram_id::text AS id, username, first_name AS "firstName", photo_url AS "photoUrl", lumens, stars_spent AS "starsSpent", card_count AS "cardCount", created_at AS "createdAt", last_seen_at AS "lastSeenAt"`, [String(user.id), user.username ?? null, user.first_name ?? 'Игрок', user.photo_url ?? null]);
    return result.rows[0];
  }
  async getCards({ includeDisabled = false } = {}) {
    const result = await this.query(`SELECT id,title,subtitle,price_stars,enabled,accent,sort_order,copy_json FROM cards ${includeDisabled ? '' : 'WHERE enabled=true'} ORDER BY sort_order`);
    return result.rows.map(publicCard);
  }
  async getCard(cardId) { const result = await this.query(`SELECT id,title,subtitle,price_stars,enabled,accent,sort_order,copy_json FROM cards WHERE id=$1`, [cardId]); return result.rows[0] ? publicCard(result.rows[0]) : null; }
  async getProfile(userId) { const result = await this.query(`SELECT telegram_id::text AS id,username,first_name AS "firstName",photo_url AS "photoUrl",lumens,stars_spent AS "starsSpent",card_count AS "cardCount",created_at AS "createdAt",last_seen_at AS "lastSeenAt" FROM users WHERE telegram_id=$1`, [String(userId)]); return result.rows[0] ?? null; }
  async getTasks() { const result = await this.query(`SELECT id,title,subtitle,task_type AS "taskType",chat_id AS "chatId",target_url AS "targetUrl",reward_points AS "rewardPoints",active FROM tasks WHERE active=true ORDER BY created_at DESC`); return result.rows; }
  async createPurchase({ userId, cardId, amount, answers, result }) {
    const row = { id: id(), payload: `p_${crypto.randomUUID()}` };
    const inserted = await this.query(`INSERT INTO purchases (id,telegram_id,card_id,amount,answers,result,payload) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id::text,telegram_id::text AS "userId",card_id AS "cardId",amount,answers,result,payload,state,charge_id AS "chargeId",share_count AS "shareCount",created_at AS "createdAt"`, [row.id, String(userId), cardId, amount, JSON.stringify(answers), JSON.stringify(result), row.payload]);
    return inserted.rows[0];
  }
  async getPurchase(purchaseId, userId) { const result = await this.query(`SELECT id::text,telegram_id::text AS "userId",card_id AS "cardId",amount,answers,result,payload,state,charge_id AS "chargeId",share_count AS "shareCount",created_at AS "createdAt" FROM purchases WHERE id=$1 AND telegram_id=$2`, [purchaseId, String(userId)]); return result.rows[0] ?? null; }
  async getPurchaseAdmin(purchaseId) {
    const result = await this.query(`SELECT p.id::text,p.telegram_id::text AS "userId",p.card_id AS "cardId",p.amount,p.answers,p.result,p.payload,p.state,p.charge_id AS "chargeId",p.share_count AS "shareCount",p.created_at AS "createdAt",u.first_name AS "firstName",u.username,c.title FROM purchases p JOIN users u ON u.telegram_id=p.telegram_id JOIN cards c ON c.id=p.card_id WHERE p.id=$1`, [purchaseId]);
    return result.rows[0] ?? null;
  }
  async getPurchaseByPayload(payload) { const result = await this.query(`SELECT id::text,telegram_id::text AS "userId",card_id AS "cardId",amount,answers,result,payload,state,charge_id AS "chargeId",share_count AS "shareCount",created_at AS "createdAt" FROM purchases WHERE payload=$1`, [payload]); return result.rows[0] ?? null; }
  async settlePurchase({ payload, chargeId }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(`SELECT id::text,telegram_id::text AS "userId",card_id AS "cardId",amount,answers,result,payload,state,charge_id AS "chargeId",share_count AS "shareCount" FROM purchases WHERE payload=$1 FOR UPDATE`, [payload]);
      const purchase = found.rows[0]; if (!purchase) { await client.query('ROLLBACK'); return null; }
      if (purchase.state === 'paid') { await client.query('COMMIT'); return purchase; }
      if (purchase.state !== 'pending') { await client.query('ROLLBACK'); return null; }
      await client.query(`UPDATE purchases SET state='paid', charge_id=$2, paid_at=NOW() WHERE id=$1`, [purchase.id, chargeId]);
      await client.query(`UPDATE users SET stars_spent=stars_spent+$2, card_count=card_count+$3 WHERE telegram_id=$1`, [purchase.userId, purchase.amount, purchase.result.items?.length || 1]);
      await client.query('COMMIT'); return { ...purchase, state: 'paid', chargeId };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async incrementShare(purchaseId, userId) { const result = await this.query(`UPDATE purchases SET share_count=share_count+1 WHERE id=$1 AND telegram_id=$2 AND state='paid' RETURNING share_count`, [purchaseId, String(userId)]); return result.rows[0]?.share_count ?? null; }
  async claimTask({ taskId, userId }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const taskResult = await client.query(`SELECT id,title,subtitle,task_type AS "taskType",chat_id AS "chatId",target_url AS "targetUrl",reward_points AS "rewardPoints",active FROM tasks WHERE id=$1 FOR UPDATE`, [taskId]);
      const task = taskResult.rows[0]; if (!task?.active) { await client.query('ROLLBACK'); return null; }
      const claim = await client.query(`INSERT INTO task_claims (task_id,telegram_id,reward_points) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING task_id`, [taskId, String(userId), task.rewardPoints]);
      if (!claim.rowCount) { await client.query('ROLLBACK'); return null; }
      await client.query(`UPDATE users SET lumens=lumens+$2 WHERE telegram_id=$1`, [String(userId), task.rewardPoints]);
      const profile = await client.query(`SELECT telegram_id::text AS id,username,first_name AS "firstName",photo_url AS "photoUrl",lumens,stars_spent AS "starsSpent",card_count AS "cardCount" FROM users WHERE telegram_id=$1`, [String(userId)]);
      await client.query('COMMIT'); return { task, profile: profile.rows[0] };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async createTicket({ userId, message }) { const ticket = await this.query(`INSERT INTO support_tickets (id,telegram_id,message) VALUES ($1,$2,$3) RETURNING id::text,state,created_at AS "createdAt"`, [id(), String(userId), message]); return ticket.rows[0]; }
  async listAdminPurchases() {
    const result = await this.query(`SELECT p.id::text,p.telegram_id::text AS "userId",p.card_id AS "cardId",p.amount,p.state,p.charge_id AS "chargeId",p.share_count AS "shareCount",p.created_at AS "createdAt",u.first_name AS "firstName",u.username,c.title FROM purchases p JOIN users u ON u.telegram_id=p.telegram_id JOIN cards c ON c.id=p.card_id ORDER BY p.created_at DESC LIMIT 50`);
    return result.rows;
  }
  async listTickets() {
    const result = await this.query(`SELECT s.id::text,s.telegram_id::text AS "userId",s.message,s.state,s.created_at AS "createdAt",u.first_name AS "firstName",u.username FROM support_tickets s JOIN users u ON u.telegram_id=s.telegram_id ORDER BY s.created_at DESC LIMIT 50`);
    return result.rows;
  }
  async updateTicket(ticketId, patch) {
    const result = await this.query(`UPDATE support_tickets SET state=$2,resolved_at=CASE WHEN $2='resolved' THEN NOW() ELSE NULL END WHERE id=$1 RETURNING id::text,telegram_id::text AS "userId",message,state,created_at AS "createdAt"`, [ticketId, patch.state]);
    return result.rows[0] ?? null;
  }
  async dashboard() {
    const result = await this.query(`SELECT
      (SELECT COUNT(*)::int FROM users WHERE last_seen_at >= date_trunc('day', NOW())) AS "todayUsers",
      (SELECT COUNT(*)::int FROM users WHERE last_seen_at >= date_trunc('month', NOW())) AS "monthUsers",
      (SELECT COUNT(*)::int FROM purchases WHERE state='paid') AS "paidPurchases",
      (SELECT COALESCE(SUM(amount),0)::int FROM purchases WHERE state='paid') AS "grossStars",
      (SELECT COUNT(*)::int FROM purchases WHERE state='refunded') AS refunds,
      (SELECT COUNT(*)::int FROM support_tickets WHERE state='open') AS "openTickets"`);
    const popular = await this.query(`SELECT c.id,c.title,COALESCE(SUM(p.share_count),0)::int AS shares FROM cards c LEFT JOIN purchases p ON p.card_id=c.id AND p.state='paid' GROUP BY c.id,c.title ORDER BY shares DESC,c.title LIMIT 8`);
    return { ...result.rows[0], popularCards: popular.rows };
  }
  async publicLeaderboard() {
    const [total, cards] = await Promise.all([
      this.query(`SELECT COUNT(*)::int AS "completedCards" FROM purchases WHERE state='paid'`),
      this.query(`SELECT c.id,c.title,COUNT(p.id)::int AS purchases FROM cards c JOIN purchases p ON p.card_id=c.id AND p.state='paid' GROUP BY c.id,c.title ORDER BY purchases DESC,c.title LIMIT 3`)
    ]);
    return { ...total.rows[0], cards: cards.rows };
  }
  async updateCard(cardId, patch) {
    const result = await this.query(`UPDATE cards SET title=COALESCE($2,title), subtitle=COALESCE($3,subtitle), price_stars=COALESCE($4,price_stars), enabled=COALESCE($5,enabled), copy_json=COALESCE($6,copy_json) WHERE id=$1 RETURNING id,title,subtitle,price_stars,enabled,accent,sort_order,copy_json`, [cardId, patch.title ?? null, patch.subtitle ?? null, patch.priceStars ?? null, patch.enabled ?? null, patch.copy ? JSON.stringify(patch.copy) : null]);
    return result.rows[0] ? publicCard(result.rows[0]) : null;
  }
  async getAllTasks() { const result = await this.query(`SELECT id::text,title,subtitle,task_type AS "taskType",chat_id AS "chatId",target_url AS "targetUrl",reward_points AS "rewardPoints",active,created_at AS "createdAt" FROM tasks ORDER BY created_at DESC`); return result.rows; }
  async createTask(task) { const result = await this.query(`INSERT INTO tasks (id,title,subtitle,task_type,chat_id,target_url,reward_points,active) VALUES ($1,$2,$3,'channel_membership',$4,$5,$6,false) RETURNING id::text,title,subtitle,task_type AS "taskType",chat_id AS "chatId",target_url AS "targetUrl",reward_points AS "rewardPoints",active`, [id(), task.title, task.subtitle, task.chatId, task.targetUrl, task.rewardPoints]); return result.rows[0]; }
  async updateTask(taskId, patch) { const result = await this.query(`UPDATE tasks SET title=COALESCE($2,title),subtitle=COALESCE($3,subtitle),chat_id=COALESCE($4,chat_id),target_url=COALESCE($5,target_url),reward_points=COALESCE($6,reward_points),active=COALESCE($7,active),updated_at=NOW() WHERE id=$1 RETURNING id::text,title,subtitle,task_type AS "taskType",chat_id AS "chatId",target_url AS "targetUrl",reward_points AS "rewardPoints",active`, [taskId, patch.title ?? null, patch.subtitle ?? null, patch.chatId ?? null, patch.targetUrl ?? null, patch.rewardPoints ?? null, patch.active ?? null]); return result.rows[0] ?? null; }
  async audit(adminId, action, target, payload = {}) { await this.query(`INSERT INTO admin_audit (id,admin_telegram_id,action,target,payload) VALUES ($1,$2,$3,$4,$5)`, [id(), String(adminId), action, target, JSON.stringify(payload)]); }
  async markRefunded(purchaseId) { const result = await this.query(`UPDATE purchases SET state='refunded',refunded_at=NOW() WHERE id=$1 AND state='paid' RETURNING id::text,telegram_id::text AS "userId",charge_id AS "chargeId",amount`, [purchaseId]); return result.rows[0] ?? null; }
  async close() { await this.pool.end(); }
}

export function createStore({ databaseUrl, demo }) {
  if (!databaseUrl) {
    if (!demo) throw new Error('DATABASE_URL обязателен вне демо-режима.');
    return new MemoryStore();
  }
  return new PostgresStore(databaseUrl);
}
