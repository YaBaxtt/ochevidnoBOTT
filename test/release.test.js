import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { MemoryAppStore } from '../src/app-store.js';
import { createApp } from '../src/server.js';
import { DEFAULT_CARDS, makeResult } from '../src/card-engine.js';
import { certificateSvg } from '../public/certificate.js';
import { processOwnerAlert } from '../src/release-api.js';
import { validateTelegramInitData } from '../src/telegram-auth.js';
import { validPayment } from '../src/product.js';

function sign(id,extra={}) {const p=new URLSearchParams({user:JSON.stringify({id,first_name:'Тест'}),auth_date:String(Math.floor(Date.now()/1000)),...extra});const s=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');p.set('hash',crypto.createHmac('sha256',crypto.createHmac('sha256','WebAppData').update('test-token').digest()).update(s).digest('hex'));return p.toString();}
async function fixture(demo=true) {
  const store=new MemoryAppStore(),config={demo,env:'test',botToken:'test-token',botUsername:'obvious_test_bot',publicAppUrl:'https://example.com',adminIds:new Set(['1']),supportUrl:'https://t.me/support'};
  const telegram={createInvoiceLink:async()=> 'https://t.me/$test',callApi:async()=>({amount:123,nanostar_amount:0})};
  const app=createApp({store,config,getTelegram:()=>demo?null:telegram}),server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(url,{user=1,body,method=body?'POST':'GET',auth}={})=>{const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(demo?{'X-Demo-User':String(user)}:{'X-Telegram-Init-Data':auth||sign(user)})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  return {store,request,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('premium prices, bundle payment lock and stop-sales keep owned documents available',async()=>{
  const f=await fixture();try{
    const b=(await f.request('/api/bootstrap')).body;assert.equal(b.cards.length,30);assert.ok(b.cards.some(c=>c.priceStars===1000));
    assert.equal((await f.request('/api/admin/cards/patron-of-obvious',{method:'PATCH',body:{priceStars:1500}})).body.card.priceStars,1500);
    assert.equal((await f.request('/api/cards/patron-of-obvious/checkout',{body:{answers:{name:'Тест'},termsAccepted:true,expectedPriceStars:1000}})).status,409);
    const order=(await f.request('/api/cards/bundle-office/checkout',{body:{answers:{name:'Тест'},termsAccepted:true}})).body.purchase;
    assert.equal(order.result,undefined);
    const pending=(await f.request('/api/cards/sum-two/checkout',{body:{answers:{a:1,b:1},termsAccepted:true}})).body.purchase;
    const paid=(await f.request(`/api/demo/purchases/${order.id}/confirm`,{body:{}})).body.purchase;assert.equal(paid.result.items.length,3);assert.equal((await f.store.getProfile(1)).cardCount,3);
    await f.request('/api/admin/sales',{method:'PATCH',body:{paused:true}});
    assert.equal((await f.request('/api/cards/sum-two/checkout',{body:{answers:{a:1,b:1},termsAccepted:true}})).status,409);
    assert.equal((await f.request(`/api/demo/purchases/${pending.id}/confirm`,{body:{}})).status,409);
    assert.equal((await f.request(`/api/purchases/${order.id}`)).body.purchase.result.items.length,3);
    assert.equal((await f.request('/api/admin/sales',{user:2,method:'PATCH',body:{paused:false}})).status,403);
    await f.request('/api/admin/sales',{method:'PATCH',body:{paused:false}});
    assert.equal((await f.request('/api/admin/reports',{user:2})).status,403);
    const r=(await f.request('/api/admin/reports')).body;assert.equal(r.receivedStars,35);assert.equal(r.bundleCount,3);
  }finally{await f.close();}
});

test('promo limits cannot be raced; card vouchers unlock once and never count as Stars',async()=>{
  const f=await fixture();try{
    await f.request('/api/bootstrap');await f.request('/api/bootstrap',{user:2});
    await f.request('/api/admin/promos',{body:{code:'LASTONE',kind:'bonus',bonus:10,usageLimit:1}});
    const claims=await Promise.all([f.request('/api/promos/redeem',{body:{code:'LASTONE'}}),f.request('/api/promos/redeem',{user:2,body:{code:'LASTONE'}})]);
    assert.equal(claims.filter(c=>c.status===200).length,1);assert.equal((await f.request('/api/promos/redeem',{body:{code:'LASTONE'}})).status,400);
    const p=(await f.request('/api/admin/promos',{body:{code:'CARD',kind:'card',cardId:'rest-license',usageLimit:10}})).body.promo;
    assert.equal((await f.request('/api/promos/redeem',{body:{code:'CARD'}})).body.reward.cardId,'rest-license');
    const paid=(await f.request('/api/cards/rest-license/checkout',{body:{answers:{name:'Тест'},termsAccepted:true,paymentMethod:'voucher'}})).body.purchase;
    assert.equal(paid.paymentMethod,'voucher');assert.equal(paid.state,'paid');assert.equal(paid.result.kind,'certificate');assert.equal((await f.store.releaseReport()).receivedStars,0);
    assert.equal(validPayment(await f.store.getPurchase(paid.id,1),{currency:'XTR',total_amount:20},1),false);
    assert.equal((await f.request('/api/cards/rest-license/checkout',{body:{answers:{name:'Тест'},termsAccepted:true,paymentMethod:'voucher'}})).status,400);
    await f.request(`/api/admin/promos/${p.id}`,{method:'PATCH',body:{active:false}});
    assert.equal((await f.request('/api/promos/redeem',{user:2,body:{code:'CARD'}})).status,400);
  }finally{await f.close();}
});

test('advertising attribution uses signed Telegram payload and retains the first source',async()=>{
  const f=await fixture(false);try{
    const a=(await f.request('/api/admin/placements',{body:{title:'Канал А',cost:1500,currency:'RUB'}})).body.placement;
    const b=(await f.request('/api/admin/placements',{body:{title:'Канал Б',cost:10,currency:'XTR'}})).body.placement;
    await f.request('/api/bootstrap',{user:2,auth:sign(2,{start_param:`ad_${a.token}`})});
    await f.request('/api/bootstrap',{user:2,auth:sign(2,{start_param:`ad_${b.token}`})});
    const p=(await f.request('/api/cards/sum-two/checkout',{user:2,body:{answers:{a:2,b:2},termsAccepted:true}})).body;
    const purchase=await f.store.getPurchase(p.purchaseId,2);await f.store.settlePurchase({payload:purchase.payload,chargeId:'external-test-charge'});
    const reports=(await f.request('/api/admin/placements')).body.placements;
    assert.equal(reports.find(r=>r.id===a.id).users,1);assert.equal(reports.find(r=>r.id===a.id).receivedStars,5);assert.equal(reports.find(r=>r.id===b.id).users,0);
    assert.equal((await f.request('/api/admin/star-balance')).body.amount,123);
    assert.equal((await f.request('/api/admin/placements',{user:2})).status,403);
  }finally{await f.close();}
});

test('complaints persist, owner alerts retry, and own support history is isolated',async()=>{
  const f=await fixture();try{
    await f.request('/api/bootstrap');const r=await f.request('/api/support',{body:{message:'Тест: нужна помощь с покупкой'}});assert.equal(r.status,201);
    assert.equal((await f.request('/api/admin/problems')).body.problems.length,1);
    assert.equal((await f.request('/api/support/mine',{user:2})).body.tickets.length,0);
    const sent=[];await processOwnerAlert({store:f.store,telegram:{sendMessage:async(id,text)=>sent.push({id,text})}});assert.equal(sent[0].id,'1');assert.match(sent[0].text,/нужна помощь/);
    await processOwnerAlert({store:f.store,telegram:{sendMessage:async()=>assert.fail('duplicate alert')}});
    await f.store.recordProblem({title:'Ошибка',body:'Тест',dedupeKey:'same'});await f.store.recordProblem({title:'Ошибка',body:'Тест',dedupeKey:'same'});
    assert.equal((await f.store.listProblems()).length,2);
    await processOwnerAlert({store:f.store,telegram:{sendMessage:async()=>{throw {response:{error_code:429,parameters:{retry_after:7}}};}}});
    assert.equal([...f.store.ownerAlerts.values()].find(a=>a.status==='pending').attempts,1);
    assert.equal((await f.request('/api/admin/problems',{user:2})).status,403);
  }finally{await f.close();}
});

test('interest broadcasts select paid categories only and still respect opt-out',async()=>{
  const s=new MemoryAppStore();for(const id of [1,2,3]){await s.upsertUser({id});await s.setNotifications(id,true,true);}
  const p=await s.createPurchase({userId:1,cardId:'rest-license',amount:20,answers:{name:'Тест'},result:makeResult('rest-license',{name:'Тест'})});await s.settlePurchase({payload:p.payload,chargeId:'doc'});
  const data={kind:'broadcast',title:'Документы',body:'Обновление',buttonText:'',buttonUrl:'',audience:'all',interest:'documents'};assert.equal(await s.campaignAudience(data),1);await s.setNotifications(1,false);assert.equal(await s.campaignAudience(data),0);
});

test('certificates escape user text; Telegram auth rejects duplicate fields and negative IDs',()=>{
  const r=makeResult('rest-license',{name:'<script>alert(1)</script>'});const svg=certificateSvg(r);assert.doesNotMatch(svg,/<script>/i);assert.match(svg,/&lt;Script&gt;/);assert.match(svg,/ШУТОЧНЫЙ ДОКУМЕНТ/);
  assert.throws(()=>validateTelegramInitData(sign(-1),'test-token'));
  assert.throws(()=>validateTelegramInitData(sign(1)+'&user=forged','test-token'),/Повторяющиеся/);
  assert.equal(DEFAULT_CARDS.filter(c=>c.premium&&c.kind==='certificate').length,5);
});
