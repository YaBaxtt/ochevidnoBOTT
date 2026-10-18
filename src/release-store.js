import crypto from 'node:crypto';
import { getCardDefinition } from './card-engine.js';

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const isPg = (s) => typeof s.query === 'function';
const productGroup = (id) => { const c = getCardDefinition(id); return c?.premium ? 'premium' : c?.kind === 'bundle' ? 'bundles' : c?.kind === 'certificate' ? 'documents' : ['sum-two','birth-year','age-minus-ten','hundredth-year','days-alive','mondays','older-today'].includes(id) ? 'math' : 'you'; };
const promoColumns = `id::text,code,kind,card_id AS "cardId",bonus,usage_limit AS "usageLimit",used,active,expires_at AS "expiresAt",created_at AS "createdAt"`;

export async function initReleaseSchema(s) {
  await s.query(`
    CREATE TABLE IF NOT EXISTS service_settings(key TEXT PRIMARY KEY,value JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS product_views(card_id TEXT REFERENCES cards(id),telegram_id BIGINT REFERENCES users(telegram_id),day DATE NOT NULL DEFAULT CURRENT_DATE,PRIMARY KEY(card_id,telegram_id,day));
    CREATE TABLE IF NOT EXISTS bot_starts(id UUID PRIMARY KEY,telegram_id BIGINT REFERENCES users(telegram_id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS promos(id UUID PRIMARY KEY,code TEXT UNIQUE NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('bonus','card')),card_id TEXT REFERENCES cards(id),bonus INTEGER NOT NULL DEFAULT 0,usage_limit INTEGER NOT NULL CHECK(usage_limit>0),used INTEGER NOT NULL DEFAULT 0,active BOOLEAN NOT NULL DEFAULT TRUE,expires_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS promo_redemptions(promo_id UUID REFERENCES promos(id),telegram_id BIGINT REFERENCES users(telegram_id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(promo_id,telegram_id));
    CREATE TABLE IF NOT EXISTS card_vouchers(telegram_id BIGINT REFERENCES users(telegram_id),card_id TEXT REFERENCES cards(id),quantity INTEGER NOT NULL CHECK(quantity>=0),PRIMARY KEY(telegram_id,card_id));
    CREATE TABLE IF NOT EXISTS ad_placements(id UUID PRIMARY KEY,token TEXT NOT NULL UNIQUE,title TEXT NOT NULL,cost NUMERIC(14,2) NOT NULL DEFAULT 0,currency TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS user_sources(telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id),placement_id UUID REFERENCES ad_placements(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS problems(id UUID PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,dedupe_key TEXT UNIQUE,state TEXT NOT NULL DEFAULT 'open',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS owner_alerts(id UUID PRIMARY KEY,problem_id UUID REFERENCES problems(id),telegram_id BIGINT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),lock_until TIMESTAMPTZ,UNIQUE(problem_id,telegram_id));
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS interest TEXT NOT NULL DEFAULT 'all';
    CREATE INDEX IF NOT EXISTS views_day_idx ON product_views(day);
    CREATE INDEX IF NOT EXISTS alert_pending_idx ON owner_alerts(status,next_at);
  `);
}

export function installReleaseMethods(Memory, Postgres) {
  const methods = {
    async getSalesSettings() {
      if (!isPg(this)) return { paused: false, message: 'Продажи временно приостановлены. Купленные карточки доступны в коллекции.', ...this.salesSettings };
      const r = await this.query(`SELECT value FROM service_settings WHERE key='sales'`);
      return { paused: false, message: 'Продажи временно приостановлены. Купленные карточки доступны в коллекции.', ...r.rows[0]?.value };
    },
    async updateSalesSettings(patch) {
      const value = { ...await this.getSalesSettings(), ...patch };
      if (!isPg(this)) this.salesSettings = value;
      else await this.query(`INSERT INTO service_settings(key,value) VALUES('sales',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(value)]);
      return value;
    },
    async recordStart(userId) {
      if (!isPg(this)) { (this.starts ??= []).push({ userId: String(userId), createdAt: now() }); return; }
      await this.query(`INSERT INTO bot_starts(id,telegram_id) VALUES($1,$2)`, [uuid(), String(userId)]);
    },
    async recordView(cardId, userId) {
      if (!isPg(this)) { (this.productViews ??= new Map()).set(`${cardId}:${userId}:${now().slice(0,10)}`, { cardId, userId: String(userId) }); return; }
      await this.query(`INSERT INTO product_views(card_id,telegram_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [cardId, String(userId)]);
    },
    async getVouchers(userId) {
      if (!isPg(this)) return [...(this.vouchers ??= new Map()).values()].filter(v => v.userId === String(userId) && v.quantity > 0).map(v => ({ ...v }));
      return (await this.query(`SELECT card_id AS "cardId",quantity FROM card_vouchers WHERE telegram_id=$1 AND quantity>0`, [String(userId)])).rows;
    },
    async listPromos() {
      if (!isPg(this)) return [...(this.promos ??= new Map()).values()].reverse().map(p => ({ ...p }));
      return (await this.query(`SELECT ${promoColumns} FROM promos ORDER BY created_at DESC LIMIT 100`)).rows;
    },
    async createPromo(data) {
      const p = { ...data, id: uuid(), active: true, used: 0, createdAt: now() };
      if (!isPg(this)) { const map = this.promos ??= new Map(); if ([...map.values()].some(v => v.code === p.code)) throw new Error('Такой промокод уже существует.'); map.set(p.id,p); return p; }
      return (await this.query(`INSERT INTO promos(id,code,kind,card_id,bonus,usage_limit,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${promoColumns}`, [p.id,p.code,p.kind,p.cardId,p.bonus,p.usageLimit,p.expiresAt])).rows[0];
    },
    async togglePromo(id, active) {
      if (!isPg(this)) { const p = this.promos?.get(id); if (!p) return null; p.active = active; return { ...p }; }
      return (await this.query(`UPDATE promos SET active=$2 WHERE id=$1 RETURNING ${promoColumns}`, [id,active])).rows[0] ?? null;
    },
    async redeemPromo(code, userId) {
      userId = String(userId);
      const invalid = () => new Error('Промокод недоступен, закончился или уже использован вами.');
      if (!isPg(this)) {
        const p = [...(this.promos ??= new Map()).values()].find(p => p.code === code);
        const used = this.redemptions ??= new Set();
        if (!p || !p.active || p.used >= p.usageLimit || p.expiresAt && Date.parse(p.expiresAt) <= Date.now() || used.has(`${p.id}:${userId}`)) throw invalid();
        const u = this.users.get(userId); if (!u) throw invalid();
        used.add(`${p.id}:${userId}`); p.used++;
        if (p.kind === 'bonus') u.lumens += p.bonus;
        else { const key = `${userId}:${p.cardId}`; const map = this.vouchers ??= new Map(); const v = map.get(key) ?? { userId, cardId: p.cardId, quantity: 0 }; v.quantity++; map.set(key,v); }
        return { kind: p.kind, bonus: p.bonus, cardId: p.cardId };
      }
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const p = (await client.query(`SELECT * FROM promos WHERE code=$1 FOR UPDATE`, [code])).rows[0];
        if (!p || !p.active || p.used >= p.usage_limit || p.expires_at && new Date(p.expires_at).getTime() <= Date.now()) throw invalid();
        const claim = await client.query(`INSERT INTO promo_redemptions(promo_id,telegram_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING promo_id`, [p.id,userId]);
        if (!claim.rowCount) throw invalid();
        if (p.kind === 'bonus') await client.query(`UPDATE users SET lumens=lumens+$2 WHERE telegram_id=$1`, [userId,p.bonus]);
        else await client.query(`INSERT INTO card_vouchers(telegram_id,card_id,quantity) VALUES($1,$2,1) ON CONFLICT(telegram_id,card_id) DO UPDATE SET quantity=card_vouchers.quantity+1`, [userId,p.card_id]);
        await client.query(`UPDATE promos SET used=used+1 WHERE id=$1`, [p.id]);
        await client.query('COMMIT'); return { kind: p.kind, bonus: p.bonus, cardId: p.card_id };
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    },
    async payWithVoucher(purchaseId, userId) {
      userId = String(userId);
      if (!isPg(this)) {
        const p = this.purchases.get(purchaseId); if (!p || p.userId !== userId) return null;
        if (p.state === 'paid' && p.paymentMethod === 'voucher') return { ...p };
        const v = this.vouchers?.get(`${userId}:${p.cardId}`);
        if (p.state !== 'pending' || !v?.quantity) throw new Error('Нет промокарточки для этого заказа.');
        v.quantity--; p.state = 'paid'; p.paymentMethod = 'voucher'; this.users.get(userId).cardCount+=p.result.items?.length||1; return { ...p };
      }
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const p = (await client.query(`SELECT * FROM purchases WHERE id=$1 AND telegram_id=$2 FOR UPDATE`, [purchaseId,userId])).rows[0];
        if (!p) { await client.query('ROLLBACK'); return null; }
        if (p.state === 'paid' && p.payment_method === 'voucher') { await client.query('COMMIT'); return this.getPurchase(purchaseId,userId); }
        if (p.state !== 'pending') throw new Error('Этот заказ уже закрыт.');
        const v = await client.query(`UPDATE card_vouchers SET quantity=quantity-1 WHERE telegram_id=$1 AND card_id=$2 AND quantity>0 RETURNING card_id`, [userId,p.card_id]);
        if (!v.rowCount) throw new Error('Нет промокарточки для этого заказа.');
        await client.query(`UPDATE purchases SET state='paid',payment_method='voucher',paid_at=NOW() WHERE id=$1`, [purchaseId]);
        await client.query(`UPDATE users SET card_count=card_count+$2 WHERE telegram_id=$1`, [userId,p.result.items?.length||1]);
        await client.query('COMMIT'); return this.getPurchase(purchaseId,userId);
      } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    },
    async releaseReport() {
      const cards = await this.getCards({ includeDisabled: true });
      let report, totals;
      if (!isPg(this)) {
        const purchases = [...this.purchases.values()];
        report = cards.map(c => {
          const orders = purchases.filter(p => p.cardId === c.id), paid = orders.filter(p => ['paid','refunded'].includes(p.state));
          const stars = paid.filter(p => p.paymentMethod === 'stars'), refunds = stars.filter(p => p.state === 'refunded');
          return { id: c.id, title: c.title, group: productGroup(c.id), priceStars: c.priceStars, enabled: c.enabled, views: [...(this.productViews?.values() ?? [])].filter(v => v.cardId === c.id).length, orders: orders.length, purchases: paid.length, receivedStars: stars.reduce((s,p) => s+p.amount,0), refundedStars: refunds.reduce((s,p)=>s+p.amount,0), bonusVolume: paid.filter(p => p.paymentMethod === 'bonus').reduce((s,p)=>s+p.amount,0), shares: paid.reduce((s,p)=>s+p.shareCount,0) };
        });
        totals = { totalUsers: this.users.size, starts: this.starts?.length ?? 0, uniqueStarts: new Set(this.starts?.map(s => s.userId) ?? []).size };
      } else {
        report = (await this.query(`SELECT c.id,c.title,c.price_stars AS "priceStars",c.enabled,(SELECT COUNT(*)::int FROM product_views v WHERE v.card_id=c.id) AS views,COUNT(p.id)::int AS orders,COUNT(p.id) FILTER(WHERE p.state IN ('paid','refunded'))::int AS purchases,COALESCE(SUM(p.amount) FILTER(WHERE p.state IN ('paid','refunded') AND p.payment_method='stars'),0)::bigint::text AS "receivedStars",COALESCE(SUM(p.amount) FILTER(WHERE p.state='refunded' AND p.payment_method='stars'),0)::bigint::text AS "refundedStars",COALESCE(SUM(p.amount) FILTER(WHERE p.state='paid' AND p.payment_method='bonus'),0)::bigint::text AS "bonusVolume",COALESCE(SUM(p.share_count) FILTER(WHERE p.state IN ('paid','refunded')),0)::int AS shares FROM cards c LEFT JOIN purchases p ON p.card_id=c.id GROUP BY c.id ORDER BY c.sort_order`)).rows.map(r => ({ ...r, group: productGroup(r.id), receivedStars: Number(r.receivedStars), refundedStars: Number(r.refundedStars), bonusVolume: Number(r.bonusVolume) }));
        totals = (await this.query(`SELECT (SELECT COUNT(*)::int FROM users) AS "totalUsers",(SELECT COUNT(*)::int FROM bot_starts) AS starts,(SELECT COUNT(DISTINCT telegram_id)::int FROM bot_starts) AS "uniqueStarts"`)).rows[0];
      }
      const sum = key => report.reduce((s,r)=>s+Number(r[key]),0);
      return { ...totals, catalogCount: cards.length, bundleCount: report.filter(r=>r.group==='bundles'||getCardDefinition(r.id)?.kind==='bundle').length, purchases: sum('purchases'), receivedStars: sum('receivedStars'), refundedStars: sum('refundedStars'), netStars: sum('receivedStars')-sum('refundedStars'), bonusVolume: sum('bonusVolume'), products: report.map(r=>({ ...r, netStars:r.receivedStars-r.refundedStars, conversion: r.views ? Math.round(r.purchases/r.views*1000)/10 : null })) };
    },
    async createPlacement(data) {
      const p = { ...data, id: uuid(), token: crypto.randomBytes(8).toString('hex'), createdAt: now() };
      if (!isPg(this)) { (this.placements ??= new Map()).set(p.id,p); return p; }
      return (await this.query(`INSERT INTO ad_placements(id,token,title,cost,currency) VALUES($1,$2,$3,$4,$5) RETURNING id::text,token,title,cost::text,currency,created_at AS "createdAt"`, [p.id,p.token,p.title,p.cost,p.currency])).rows[0];
    },
    async attributeUser(userId, token) {
      if (!/^[a-f0-9]{16}$/.test(token)) return;
      if (!isPg(this)) { const p = [...(this.placements?.values() ?? [])].find(p=>p.token===token); if (p) { const sources=this.sources??=new Map(); if (!sources.has(String(userId))) sources.set(String(userId),{placementId:p.id,createdAt:now()}); } return; }
      await this.query(`INSERT INTO user_sources(telegram_id,placement_id) SELECT $1,id FROM ad_placements WHERE token=$2 ON CONFLICT DO NOTHING`, [String(userId),token]);
    },
    async placementReport() {
      if (!isPg(this)) return [...(this.placements?.values() ?? [])].reverse().map(p=>{ const users=[...(this.sources?.entries()??[])].filter(([,source])=>source.placementId===p.id).map(([id])=>id); const payments=[...this.purchases.values()].filter(o=>users.includes(o.userId)&&o.createdAt>=this.sources.get(o.userId).createdAt&&o.paymentMethod==='stars'&&['paid','refunded'].includes(o.state)); return {...p,users:users.length,buyers:new Set(payments.map(o=>o.userId)).size,receivedStars:payments.reduce((s,o)=>s+o.amount,0),refundedStars:payments.filter(o=>o.state==='refunded').reduce((s,o)=>s+o.amount,0)}; });
      return (await this.query(`SELECT a.id::text,a.token,a.title,a.cost::text,a.currency,COUNT(DISTINCT s.telegram_id)::int AS users,COUNT(DISTINCT p.telegram_id)::int AS buyers,COALESCE(SUM(p.amount),0)::bigint::text AS "receivedStars",COALESCE(SUM(p.amount) FILTER(WHERE p.state='refunded'),0)::bigint::text AS "refundedStars" FROM ad_placements a LEFT JOIN user_sources s ON s.placement_id=a.id LEFT JOIN purchases p ON p.telegram_id=s.telegram_id AND p.created_at>=s.created_at AND p.state IN ('paid','refunded') AND p.payment_method='stars' GROUP BY a.id ORDER BY a.created_at DESC`)).rows;
    },
    async recordProblem({ kind='system',title,body='',dedupeKey=null }) {
      const p = { id: uuid(), kind, title:String(title).slice(0,100), body:String(body).slice(0,1800), state:'open',createdAt:now() };
      if (!isPg(this)) {
        const map=this.problems??=new Map(); if (dedupeKey && [...map.values()].some(v=>v.dedupeKey===dedupeKey)) return null;
        map.set(p.id,{...p,dedupeKey}); for (const userId of this.ownerIds??[]) { const a={id:uuid(),problemId:p.id,userId:String(userId),title:p.title,body:p.body,status:'pending',attempts:0,nextAt:0}; (this.ownerAlerts??=new Map()).set(a.id,a); } return p;
      }
      const inserted=await this.query(`INSERT INTO problems(id,kind,title,body,dedupe_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`, [p.id,p.kind,p.title,p.body,dedupeKey]); if (!inserted.rowCount) return null;
      for (const id of this.ownerIds??[]) await this.query(`INSERT INTO owner_alerts(id,problem_id,telegram_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [uuid(),p.id,String(id)]);
      return p;
    },
    async listProblems() { if(!isPg(this)) return [...(this.problems?.values()??[])].reverse().slice(0,100); return (await this.query(`SELECT id::text,kind,title,body,state,created_at AS "createdAt" FROM problems ORDER BY created_at DESC LIMIT 100`)).rows; },
    async resolveProblem(id) { if(!isPg(this)) {const p=this.problems?.get(id);if(p)p.state='resolved';return Boolean(p);} return Boolean((await this.query(`UPDATE problems SET state='resolved' WHERE id=$1 RETURNING id`, [id])).rowCount); },
    async claimOwnerAlert() {
      if(!isPg(this)) { const a=[...(this.ownerAlerts?.values()??[])].find(a=>(a.status==='pending'||a.status==='sending'&&a.lockUntil<Date.now())&&a.nextAt<=Date.now());if(!a)return null;a.status='sending';a.attempts++;a.lockUntil=Date.now()+60000;return {...a}; }
      const r=await this.query(`UPDATE owner_alerts SET status='sending',attempts=attempts+1,lock_until=NOW()+INTERVAL '60 seconds' WHERE id=(SELECT id FROM owner_alerts WHERE (status='pending' AND next_at<=NOW()) OR (status='sending' AND lock_until<NOW()) ORDER BY next_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id::text,telegram_id::text AS "userId",problem_id AS "problemId",attempts`);const a=r.rows[0];if(!a)return null;const p=(await this.query(`SELECT title,body FROM problems WHERE id=$1`, [a.problemId])).rows[0];return {...a,...p};
    },
    async finishOwnerAlert(id,status,retry=60) { if(!isPg(this)) {const a=this.ownerAlerts.get(id);Object.assign(a,{status,nextAt:Date.now()+retry*1000});return;} await this.query(`UPDATE owner_alerts SET status=$2,next_at=NOW()+$3*INTERVAL '1 second',lock_until=NULL WHERE id=$1`, [id,status,retry]); },
    async ownTickets(userId) { if(!isPg(this))return this.tickets.filter(t=>t.userId===String(userId)).slice(-20).reverse();return (await this.query(`SELECT id::text,message,state,created_at AS "createdAt" FROM support_tickets WHERE telegram_id=$1 ORDER BY created_at DESC LIMIT 20`, [String(userId)])).rows; }
  };
  for(const Base of [Memory,Postgres]) {
    Object.assign(Base.prototype,methods);
    const originalTicket=Base.prototype.createTicket ?? Object.getPrototypeOf(Base.prototype).createTicket;
    Base.prototype.createTicket=async function(data) {const ticket=await originalTicket.call(this,data);await this.recordProblem({kind:'support',title:`Обращение №${ticket.id.slice(0,8)}`,body:`Пользователь ${data.userId}\n${data.message}`,dedupeKey:`ticket:${ticket.id}`});return ticket;};
    const originalUpdateTicket=Base.prototype.updateTicket ?? Object.getPrototypeOf(Base.prototype).updateTicket;
    Base.prototype.updateTicket=async function(id,patch){const ticket=await originalUpdateTicket.call(this,id,patch);if(ticket){if(isPg(this))await this.query(`UPDATE problems SET state=$2 WHERE dedupe_key=$1`,[`ticket:${id}`,ticket.state]);else for(const p of this.problems?.values()??[])if(p.dedupeKey===`ticket:${id}`)p.state=ticket.state;}return ticket;};
  }
}

export { productGroup };
