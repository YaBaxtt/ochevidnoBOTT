import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const isPg = store => typeof store.query === 'function';
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validId = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const grantColumns = `id::text,telegram_id::text AS "userId",admin_telegram_id::text AS "adminId",quantity,note,created_at AS "createdAt"`;

export async function initFreeOpeningSchema(store) {
  await store.query(`
    CREATE TABLE IF NOT EXISTS free_opening_balances (
      telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id),
      quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity BETWEEN 0 AND 1000000)
    );
    CREATE TABLE IF NOT EXISTS free_opening_grants (
      id UUID PRIMARY KEY,telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      admin_telegram_id BIGINT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
      note TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS free_grants_user_idx ON free_opening_grants(telegram_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS users_username_lower_idx ON users(LOWER(username));
  `);
}

function checkGrantRetry(previous, next) {
  if (['userId','adminId','quantity','note'].some(key => previous[key] !== next[key])) {
    throw new Error('Этот запрос уже использован. Обновите форму перед новой выдачей.');
  }
}

function checkPurchaseRetry(previous, next) {
  if (previous.userId !== next.userId || previous.cardId !== next.cardId || previous.paymentMethod !== 'free' ||
      previous.state !== 'paid' || !isDeepStrictEqual(previous.answers, next.answers)) {
    throw new Error('Этот запрос уже использован. Откройте карточку заново.');
  }
}

export function installFreeOpeningMethods(Memory, Postgres) {
  const methods = {
    async findFreeOpeningUser(value) {
      const query = String(value ?? '').trim();
      const byId = validId(query), username = query.replace(/^@/, '').toLowerCase();
      if (!byId && !/^[a-z0-9_]{1,32}$/.test(username)) throw new Error('Введите числовой Telegram ID или @username.');
      const rows = isPg(this)
        ? (await this.query(`SELECT telegram_id::text AS id,username,first_name AS "firstName" FROM users WHERE ${byId ? 'telegram_id=$1' : 'LOWER(username)=$1'} LIMIT 2`, [byId ? query : username])).rows
        : [...this.users.values()].filter(user => byId ? user.id === query : user.username?.toLowerCase() === username);
      if (rows.length > 1) throw new Error('Этот username найден у нескольких старых профилей. Используйте Telegram ID.');
      const user = rows[0];
      return user ? { id: user.id, username: user.username, firstName: user.firstName } : null;
    },
    async getFreeOpenings(userId) {
      if (!isPg(this)) return this.freeOpeningBalances?.get(String(userId)) ?? 0;
      return (await this.query('SELECT quantity FROM free_opening_balances WHERE telegram_id=$1', [String(userId)])).rows[0]?.quantity ?? 0;
    },
    async listFreeOpeningGrants(userId) {
      if (!isPg(this)) return [...(this.freeOpeningGrants?.values() ?? [])].filter(row => row.userId === String(userId)).reverse().slice(0,20).map(row => ({ ...row }));
      return (await this.query(`SELECT ${grantColumns} FROM free_opening_grants WHERE telegram_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20`, [String(userId)])).rows;
    },
    async grantFreeOpenings({ userId, adminId, quantity, note = '', requestId }) {
      userId = String(userId); adminId = String(adminId);
      if (!validId(userId) || !validId(adminId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000 ||
          typeof note !== 'string' || note.length > 180 || !uuidPattern.test(requestId ?? '')) throw new Error('Проверьте получателя, количество (1–1000) и комментарий.');
      const grant = { id: requestId.toLowerCase(), userId, adminId, quantity, note, createdAt: new Date().toISOString() };
      if (!isPg(this)) {
        if (!this.users.has(userId)) throw new Error('Пользователь не найден. Сначала ему нужно открыть бота.');
        const grants = this.freeOpeningGrants ??= new Map(), balances = this.freeOpeningBalances ??= new Map();
        const previous = grants.get(grant.id);
        if (previous) checkGrantRetry(previous, grant);
        else {
          const remaining = (balances.get(userId) ?? 0) + quantity;
          if (remaining > 1000000) throw new Error('Превышен лимит бесплатных открытий пользователя.');
          balances.set(userId, remaining); grants.set(grant.id, grant);
        }
        return { grant: { ...(previous ?? grant) }, remaining: balances.get(userId) ?? 0 };
      }
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const user = await client.query('SELECT telegram_id FROM users WHERE telegram_id=$1', [userId]);
        if (!user.rowCount) throw new Error('Пользователь не найден. Сначала ему нужно открыть бота.');
        const inserted = await client.query(`INSERT INTO free_opening_grants(id,telegram_id,admin_telegram_id,quantity,note) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING ${grantColumns}`, [grant.id,userId,adminId,quantity,note]);
        let saved = inserted.rows[0];
        if (saved) {
          const credited = await client.query(`INSERT INTO free_opening_balances(telegram_id,quantity) VALUES($1,$2) ON CONFLICT(telegram_id) DO UPDATE SET quantity=free_opening_balances.quantity+EXCLUDED.quantity WHERE free_opening_balances.quantity<=1000000-$2 RETURNING quantity`, [userId,quantity]);
          if (!credited.rowCount) throw new Error('Превышен лимит бесплатных открытий пользователя.');
          await client.query(`INSERT INTO admin_audit(id,admin_telegram_id,action,target,payload) VALUES($1,$2,'free-openings.grant',$3,$4)`, [crypto.randomUUID(),adminId,userId,JSON.stringify({ grantId:grant.id,quantity,note })]);
        } else {
          saved = (await client.query(`SELECT ${grantColumns} FROM free_opening_grants WHERE id=$1`, [grant.id])).rows[0];
          checkGrantRetry(saved, grant);
        }
        const balance = await client.query('SELECT quantity FROM free_opening_balances WHERE telegram_id=$1', [userId]);
        await client.query('COMMIT');
        return { grant: saved, remaining: balance.rows[0]?.quantity ?? 0 };
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
    // Debit and issue together. Retrying the same request cannot consume a second opening.
    async createFreePurchase({ userId, cardId, amount, answers, result, requestId }) {
      userId = String(userId);
      if (!uuidPattern.test(requestId ?? '')) throw new Error('Не удалось распознать запрос. Откройте карточку заново.');
      const purchaseId = requestId.toLowerCase();
      if (!isPg(this)) {
        const previous = this.purchases.get(purchaseId);
        if (previous) { checkPurchaseRetry(previous,{userId,cardId,answers}); return { ...previous }; }
        const balances = this.freeOpeningBalances ??= new Map(), remaining = balances.get(userId) ?? 0;
        if (remaining < 1) throw new Error('Бесплатные открытия закончились. Обновите карточку или выберите другой способ оплаты.');
        const user = this.users.get(userId);
        if (!user) throw new Error('Пользователь не найден.');
        const createdAt = new Date().toISOString();
        const purchase = { id:purchaseId,userId,cardId,amount,answers,result,state:'paid',paymentMethod:'free',payload:`p_${crypto.randomUUID()}`,createdAt,termsAcceptedAt:createdAt,chargeId:null,shareCount:0 };
        balances.set(userId,remaining-1); this.purchases.set(purchaseId,purchase); user.cardCount += result.items?.length || 1;
        return { ...purchase };
      }
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query(`INSERT INTO purchases(id,telegram_id,card_id,amount,answers,result,payload,state,payment_method,paid_at) VALUES($1,$2,$3,$4,$5,$6,$7,'paid','free',NOW()) ON CONFLICT(id) DO NOTHING RETURNING id`, [purchaseId,userId,cardId,amount,JSON.stringify(answers),JSON.stringify(result),`p_${crypto.randomUUID()}`]);
        if (!inserted.rowCount) {
          const previous = (await client.query(`SELECT telegram_id::text AS "userId",card_id AS "cardId",answers,state,payment_method AS "paymentMethod" FROM purchases WHERE id=$1`, [purchaseId])).rows[0];
          checkPurchaseRetry(previous,{userId,cardId,answers});
        } else {
          const debited = await client.query(`UPDATE free_opening_balances SET quantity=quantity-1 WHERE telegram_id=$1 AND quantity>0 RETURNING quantity`, [userId]);
          if (!debited.rowCount) throw new Error('Бесплатные открытия закончились. Обновите карточку или выберите другой способ оплаты.');
          await client.query('UPDATE users SET card_count=card_count+$2 WHERE telegram_id=$1', [userId,result.items?.length || 1]);
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      return this.getPurchase(purchaseId,userId);
    }
  };
  Object.assign(Memory.prototype,methods);
  Object.assign(Postgres.prototype,methods);
}

export function registerFreeOpeningApi({ app, store, requireAdmin }) {
  app.get('/api/admin/free-openings/user', ...requireAdmin, async (req,res) => {
    const user = await store.findFreeOpeningUser(req.query.query);
    if (!user) return res.status(404).json({ error:'Пользователь не найден. Пусть сначала нажмёт /start в боте или откроет мини-апп, затем повторите поиск.' });
    const [remaining,grants] = await Promise.all([store.getFreeOpenings(user.id),store.listFreeOpeningGrants(user.id)]);
    res.json({ user,remaining,grants });
  });
  app.post('/api/admin/free-openings/grants', ...requireAdmin, async (req,res) => {
    const { userId, quantity, note = '', requestId } = req.body ?? {};
    const result = await store.grantFreeOpenings({ userId,adminId:req.actor.id,quantity,note,requestId });
    res.json(result);
  });
}
