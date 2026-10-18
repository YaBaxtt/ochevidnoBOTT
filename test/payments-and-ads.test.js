import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { MemoryAppStore } from '../src/app-store.js';
import { createApp } from '../src/server.js';
import { publicPurchase, validPayment } from '../src/product.js';
import { processDelivery } from '../src/broadcast.js';
import { BRAND } from '../public/brand.js';

const signed = (id, token='test-token') => {
  const params = new URLSearchParams({ user: JSON.stringify({id,first_name:'Тест'}), auth_date: String(Math.floor(Date.now()/1000)) });
  const message = [...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256','WebAppData').update(token).digest();
  params.set('hash',crypto.createHmac('sha256',secret).update(message).digest('hex'));
  return params.toString();
};

async function fixture(demo, env = 'test', overrides = {}) {
  const store = new MemoryAppStore();
  const config = { demo, env, botToken:'test-token', publicAppUrl:'https://example.com', botUsername:'obvious_test_bot',adminIds:new Set(['1']),supportUrl:'https://t.me/test_support', ...overrides };
  const telegram = {createInvoiceLink:async()=> 'https://t.me/$test_invoice'};
  const app = createApp({store,config,getTelegram:()=>demo?null:telegram});
  const server = app.listen(0,'127.0.0.1');await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async(url,{user=1,body,method=body?'POST':'GET',headers={}}={})=>{
    const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(demo?{'X-Demo-User':String(user)}:{'X-Telegram-Init-Data':signed(user)}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  };
  return {store,request,base,close:()=>new Promise((resolve)=>server.close(resolve))};
}

test('public app info helps browser visitors open Telegram without disclosing runtime configuration', async () => {
  const f = await fixture(false);
  try {
    const result = await f.request('/api/app-info', { headers: { 'X-Telegram-Init-Data': '' } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { name: 'Очевидно', botUrl: 'https://t.me/obvious_test_bot', avatarUrl: BRAND.botAvatar });
    assert.doesNotMatch(JSON.stringify(result.body), /test-token|DATABASE|adminIds/);
    const html = await fetch(f.base + '/');
    assert.equal(html.headers.get('cache-control'), 'no-cache');
    assert.match(await html.text(), /app\.js\?v=7/);
    const avatar = await fetch(f.base + result.body.avatarUrl);
    assert.equal(avatar.status, 200);
    assert.match(avatar.headers.get('content-type'), /image\/jpeg/);
  } finally { await f.close(); }
});

test('versioned art is cached long-term while entry HTML revalidates and readiness stays owner-only', async () => {
  const f = await fixture(false, 'production');
  try {
    const avatar = await fetch(f.base + BRAND.botAvatar);
    assert.match(avatar.headers.get('cache-control'), /max-age=31536000, immutable/);
    const again = await fetch(f.base + BRAND.botAvatar, { cache: 'force-cache', headers: { 'If-None-Match': avatar.headers.get('etag') } });
    assert.equal(again.status, 304);
    const cover = await fetch(f.base + '/assets/art-v3/birth-year-360.webp');
    assert.match(cover.headers.get('cache-control'), /immutable/);
    const html = await fetch(f.base + '/');
    assert.equal(html.headers.get('cache-control'), 'no-cache');
    assert.equal((await f.request('/api/admin/readiness', { user: 2 })).status, 403);
    const result = await f.request('/api/admin/readiness');
    assert.equal(result.status, 200);
    assert.equal(result.body.appUrl, 'https://example.com');
    assert.equal(result.body.checks.find(item => item.key === 'payment').state, 'info');
    assert.doesNotMatch(JSON.stringify(result.body), /test-token|DATABASE_URL|adminIds/);
  } finally { await f.close(); }
});

test('demo purchase stays locked until explicit confirmation; cancel cannot reveal the answer',async()=>{
  const f=await fixture(true);
  try {
    const r=await f.request('/api/cards/sum-two/checkout',{body:{answers:{a:19,b:23},termsAccepted:true}});
    assert.equal(r.body.mode,'demo');assert.equal(r.body.purchase.state,'pending');assert.equal(r.body.purchase.result,undefined);
    const id=r.body.purchase.id;
    const pending=await f.request(`/api/purchases/${id}`);assert.equal(pending.body.purchase.result,undefined);
    assert.equal((await f.request(`/api/demo/purchases/${id}/confirm`,{user:2,body:{}})).status,404);
    const paid=await f.request(`/api/demo/purchases/${id}/confirm`,{body:{}});
    assert.equal(paid.body.purchase.result.headline,'42');
    await f.request(`/api/demo/purchases/${id}/confirm`,{body:{}});
    const profile=await f.store.getProfile(1);assert.equal(profile.cardCount,1);assert.equal(profile.starsSpent,5);
  }finally{await f.close();}
});

test('setup mode blocks new charges without hiding already paid purchases or support', async () => {
  const f = await fixture(false, 'test', { publicAppUrl: '', appSetupIssue: 'PUBLIC_APP_URL' });
  try {
    assert.equal((await f.request('/api/bootstrap')).status, 200);
    const purchase = await f.store.createPurchase({ userId: 1, cardId: 'sum-two', amount: 5, answers: {a:1,b:1}, result: { headline:'2', detail:'1 + 1' } });
    await f.store.settlePurchase({ payload:purchase.payload, chargeId:'already-paid' });
    const checkout = await f.request('/api/cards/sum-two/checkout', { body: { answers:{a:1,b:1}, termsAccepted:true } });
    assert.equal(checkout.status, 503);
    assert.equal((await f.request(`/api/purchases/${purchase.id}`)).body.purchase.result.headline, '2');
    assert.equal((await f.request('/api/support', { body: { message:'Не открывается мини-апп' } })).status, 201);
  } finally { await f.close(); }
});

test('live invoice ignores forged prices and browser cannot mark it paid',async()=>{
  const f=await fixture(false);
  try {
    const r=await f.request('/api/cards/sum-two/checkout',{body:{answers:{a:20,b:22},priceStars:0,result:'forged',termsAccepted:true}});
    assert.equal(r.body.mode,'invoice');assert.equal(r.body.result,undefined);
    const purchase=await f.store.getPurchase(r.body.purchaseId,1);assert.equal(purchase.amount,5);
    assert.equal((await f.request(`/api/purchases/${purchase.id}`)).body.purchase.result,undefined);
    assert.equal((await f.request(`/api/demo/purchases/${purchase.id}/confirm`,{body:{}})).status,404);
    assert.equal((await f.request('/api/admin/campaigns',{user:2})).status,403);
    const forged=signed(1).replace('first_name','last_name');
    assert.equal((await f.request('/api/bootstrap',{headers:{'X-Telegram-Init-Data':forged}})).status,401);
    assert.equal(validPayment(purchase,{total_amount:5,currency:'XTR'},2),false);
    assert.equal(validPayment(purchase,{total_amount:0,currency:'XTR'},1),false);
    assert.equal(validPayment(purchase,{total_amount:5,currency:'TON'},1),false);
    assert.equal(validPayment(purchase,{total_amount:5,currency:'XTR'},1),true);
  }finally{await f.close();}
});

test('bonus purchase is atomic, idempotent and not counted as Stars revenue',async()=>{
  const store=new MemoryAppStore();await store.upsertUser({id:1,first_name:'Тест'});
  store.users.get('1').lumens=5;
  const args={userId:1,cardId:'sum-two',amount:5,answers:{a:1,b:1},result:{headline:'2'}};
  const purchase=await store.createPurchase(args);
  await Promise.all([store.payWithBonuses(purchase.id,1),store.payWithBonuses(purchase.id,1)]);
  assert.equal((await store.getProfile(1)).bonusBalance,0);assert.equal((await store.getProfile(1)).cardCount,1);
  assert.equal((await store.dashboard()).grossStars,0);
  const other=await store.createPurchase(args);await assert.rejects(()=>store.payWithBonuses(other.id,1),/Недостаточно/);
  assert.equal(publicPurchase(await store.getPurchase(other.id,1)).result,undefined);
});

test('ad audience excludes users who never started the bot or opted out; duplicate launch rejected',async()=>{
  const store=new MemoryAppStore();
  for(const id of [1,2,3,4])await store.upsertUser({id,first_name:`User ${id}`});
  await store.setNotifications(1,true,true);await store.setNotifications(2,false,true);await store.setNotifications(3,true,true);
  const campaign=await store.createCampaign({kind:'broadcast',title:'Тест',body:'Объявление',buttonText:'',buttonUrl:'',audience:'limit',limitCount:1});
  assert.equal(await store.campaignAudience(campaign),1);
  assert.equal((await store.queueCampaign(campaign.id)).total,1);
  await assert.rejects(()=>store.queueCampaign(campaign.id),/уже запускалась/);
  const sent=[];await processDelivery({store,telegram:{sendMessage:async(id,text)=>sent.push({id,text})}});
  assert.equal(sent.length,1);assert.ok(['1','3'].includes(sent[0].id));
  assert.equal((await store.getCampaign(campaign.id)).status,'completed');
});

test('Telegram rate limits are retried without falsely counting delivery',async()=>{
  const store=new MemoryAppStore();await store.upsertUser({id:1,first_name:'Тест'});await store.setNotifications(1,true,true);
  const ad=await store.createCampaign({kind:'broadcast',title:'Тест',body:'Тест',buttonText:'',buttonUrl:'',audience:'all'});await store.queueCampaign(ad.id);
  const result=await processDelivery({store,telegram:{sendMessage:async()=>{throw {response:{error_code:429,parameters:{retry_after:7}}};}}});
  assert.equal(result.retryAfter,7);assert.equal((await store.listCampaigns())[0].sent,0);
  assert.equal([...store.deliveries.values()][0].status,'pending');
});

test('entry ad impressions are once per user per day and preview is not a delivery',async()=>{
  const store=new MemoryAppStore();await store.upsertUser({id:1,first_name:'Тест'});
  const ad=await store.createCampaign({kind:'entry',title:'Вход',body:'Тест',buttonText:'',buttonUrl:'',audience:'all'});
  assert.equal(await store.getEntryCampaign(1),null);await store.updateEntryCampaign(ad.id,true);
  assert.equal((await store.getEntryCampaign(1)).id,ad.id);
  await store.recordAdEvent(ad.id,1);await store.recordAdEvent(ad.id,1);await store.recordAdEvent(ad.id,1,true);
  assert.equal(await store.getEntryCampaign(1),null);const stats=(await store.listCampaigns())[0];assert.equal(stats.views,1);assert.equal(stats.clicks,1);
});
