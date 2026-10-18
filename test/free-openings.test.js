import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { MemoryAppStore } from '../src/app-store.js';
import { createApp } from '../src/server.js';
import { makeResult } from '../src/card-engine.js';
import { validPayment } from '../src/product.js';
import { adminPage, loadAdmin, adminSubmit } from '../public/admin.js';

function sign(id) {
  const params=new URLSearchParams({user:JSON.stringify({id,first_name:`Игрок ${id}`,username:`tester_${id}`}),auth_date:String(Math.floor(Date.now()/1000))});
  const message=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  params.set('hash',crypto.createHmac('sha256',crypto.createHmac('sha256','WebAppData').update('test-token').digest()).update(message).digest('hex'));
  return params.toString();
}
async function fixture() {
  const store=new MemoryAppStore();let invoices=0;
  const config={demo:false,env:'test',botToken:'test-token',botUsername:'obvious_test_bot',publicAppUrl:'https://example.com',adminIds:new Set(['1']),supportUrl:''};
  const telegram={createInvoiceLink:async()=>{invoices++;return 'https://t.me/$test';}};
  const server=createApp({store,config,getTelegram:()=>telegram}).listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,{user=1,body,method=body?'POST':'GET',headers={}}={})=>{
    const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Telegram-Init-Data':sign(user),...headers},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  };
  await request('/api/bootstrap',{user:2});
  const grant=(quantity=1,overrides={})=>request('/api/admin/free-openings/grants',{body:{userId:'2',quantity,requestId:crypto.randomUUID(),...overrides}});
  const open=(cardId,answers,overrides={})=>request(`/api/cards/${cardId}/checkout`,{user:2,body:{paymentMethod:'free',termsAccepted:true,requestId:crypto.randomUUID(),answers,...overrides}});
  return {store,request,grant,open,invoices:()=>invoices,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('only admins grant to known Telegram IDs; grants are validated, idempotent and recorded',async()=>{
  const f=await fixture();try {
    const found=await f.request('/api/admin/free-openings/user?query=%40TESTER_2');
    assert.equal(found.status,200);assert.equal(found.body.user.id,'2');assert.equal(found.body.remaining,0);
    assert.equal((await f.request('/api/admin/free-openings/user?query=2',{user:2})).status,403);
    assert.equal((await f.request('/api/admin/free-openings/grants',{user:2,body:{userId:'2',quantity:10,requestId:crypto.randomUUID()}})).status,403);
    assert.equal((await f.request('/api/admin/free-openings/grants',{body:{userId:'2',quantity:10,requestId:crypto.randomUUID()},headers:{'X-Telegram-Init-Data':'forged'}})).status,401);
    for (const quantity of [0,-1,1.5,1001,'10',null]) assert.equal((await f.grant(quantity)).status,400);
    assert.equal((await f.grant(2,{userId:'999'})).status,400);
    assert.equal((await f.grant(2,{userId:'@tester_2'})).status,400);
    assert.equal((await f.grant(2,{requestId:'invalid'})).status,400);
    assert.equal((await f.request('/api/admin/free-openings/user?query=999')).status,404);
    const requestId=crypto.randomUUID();
    const results=await Promise.all([f.grant(3,{requestId,note:'Проверка'}),f.grant(3,{requestId,note:'Проверка'})]);
    assert.ok(results.every(r=>r.status===200));assert.equal(await f.store.getFreeOpenings(2),3);
    assert.equal((await f.store.listFreeOpeningGrants(2)).length,1);
    assert.equal((await f.grant(4,{requestId,note:'Проверка'})).status,400);
    const details=(await f.request('/api/admin/free-openings/user?query=2')).body;
    assert.equal(details.remaining,3);assert.equal(details.grants[0].adminId,'1');assert.equal(details.grants[0].note,'Проверка');
    assert.equal((await f.request('/api/bootstrap',{user:2})).body.freeOpenings,3);
    assert.equal((await f.request('/api/bootstrap')).body.freeOpenings,0);
  }finally{await f.close();}
});

test('one free opening buys any card or complete premium/bundle result without an invoice or Stars',async()=>{
  const f=await fixture();try {
    await f.grant(3);
    for (const [cardId,answers,kind] of [['sum-two',{a:2,b:3},'result'],['patron-of-obvious',{name:'Тест'},'certificate'],['bundle-office',{name:'Тест'},'bundle']]) {
      const result=await f.open(cardId,answers);assert.equal(result.status,200);
      const p=result.body.purchase;assert.equal(p.paymentMethod,'free');assert.equal(p.state,'paid');assert.equal(p.result.kind||'result',kind);
      assert.equal((await f.request(`/api/purchases/${p.id}`,{user:2})).status,200);
      assert.equal((await f.request(`/api/purchases/${p.id}`)).status,404);
      assert.equal(validPayment(await f.store.getPurchase(p.id,2),{currency:'XTR',total_amount:p.amount},2),false);
      assert.equal((await f.request(`/api/admin/purchases/${p.id}/refund`,{body:{}})).status,409);
    }
    assert.equal(f.invoices(),0);assert.equal(await f.store.getFreeOpenings(2),0);
    const profile=await f.store.getProfile(2);assert.equal(profile.starsSpent,0);assert.equal(profile.bonusBalance,0);assert.equal(profile.cardCount,5);
    const report=await f.store.releaseReport();assert.equal(report.freeOpenings,3);assert.equal(report.receivedStars,0);assert.equal(report.bonusVolume,0);
    assert.equal(report.products.find(p=>p.id==='bundle-office').freeOpenings,1);
    assert.equal((await f.store.dashboard()).grossStars,0);
    assert.equal((await f.open('sum-two',{a:1,b:1})).status,400);assert.equal(f.store.purchases.size,3);
  }finally{await f.close();}
});

test('repeated checkout consumes once; two concurrent checkouts cannot spend the last opening twice',async()=>{
  const f=await fixture();try {
    await f.grant(1);const requestId=crypto.randomUUID();
    const retries=await Promise.all([f.open('rest-license',{name:'Тест'},{requestId}),f.open('rest-license',{name:'Тест'},{requestId})]);
    assert.ok(retries.every(r=>r.status===200));assert.deepEqual(retries[0].body,retries[1].body);
    assert.equal(f.store.purchases.size,1);assert.equal(await f.store.getFreeOpenings(2),0);
    assert.equal((await f.open('rest-license',{name:'Другое имя'},{requestId})).status,400);
    assert.equal((await f.request('/api/cards/rest-license/checkout',{body:{paymentMethod:'free',termsAccepted:true,requestId,answers:{name:'Тест'}}})).status,400);
    await f.grant(1);
    const raced=await Promise.all([f.open('sum-two',{a:1,b:1}),f.open('sum-two',{a:1,b:2})]);
    assert.equal(raced.filter(r=>r.status===200).length,1);assert.equal(raced.filter(r=>r.status===400).length,1);
    assert.equal(f.store.purchases.size,2);assert.equal(await f.store.getFreeOpenings(2),0);assert.equal((await f.store.getProfile(2)).cardCount,2);
  }finally{await f.close();}
});

test('invalid input, hidden cards and paused sales never consume a free opening; crypto payment is not accepted',async()=>{
  const f=await fixture();try {
    await f.grant(2);
    assert.equal((await f.open('sum-two',{a:1,b:1},{termsAccepted:false})).status,422);
    assert.equal((await f.open('sum-two',{a:'bad',b:1})).status,400);
    assert.equal((await f.open('sum-two',{a:1,b:1},{expectedPriceStars:1})).status,409);
    assert.equal((await f.open('sum-two',{a:1,b:1},{requestId:'no'})).status,400);
    assert.equal((await f.open('sum-two',{a:1,b:1},{paymentMethod:'gram'})).status,422);
    await f.store.updateCard('sum-two',{enabled:false});assert.equal((await f.open('sum-two',{a:1,b:1})).status,404);
    await f.store.updateSalesSettings({paused:true});assert.equal((await f.open('rest-license',{name:'Тест'})).status,409);
    assert.equal(await f.store.getFreeOpenings(2),2);assert.equal(f.store.purchases.size,0);assert.equal(f.invoices(),0);
  }finally{await f.close();}
});

test('username lookup is exact and refuses ambiguous old usernames; a grant stays with the immutable ID',async()=>{
  const store=new MemoryAppStore();await store.upsertUser({id:1,username:'SameName'});await store.upsertUser({id:2,username:'samename'});
  await assert.rejects(()=>store.findFreeOpeningUser('@SAMENAME'),/Telegram ID/);
  await store.grantFreeOpenings({userId:'1',adminId:'1',quantity:2,requestId:crypto.randomUUID()});
  await store.upsertUser({id:1,username:'newname'});
  assert.equal((await store.findFreeOpeningUser('samename')).id,'2');assert.equal(await store.getFreeOpenings(1),2);assert.equal(await store.getFreeOpenings(2),0);
  assert.equal(await store.findFreeOpeningUser('newnam'),null);
  const args={userId:'1',cardId:'sum-two',amount:5,answers:{a:1,b:1},result:makeResult('sum-two',{a:1,b:1}),requestId:crypto.randomUUID()};
  const p=await store.createFreePurchase(args);await store.createFreePurchase(args);assert.equal(await store.getFreeOpenings(1),1);assert.equal((await store.getPurchase(p.id,1)).state,'paid');
});

test('admin UI shows an explicit recipient, escapes names and preserves a grant key after a lost response',async()=>{
  const previous=globalThis.document,el={isConnected:true,innerHTML:''};
  globalThis.document={querySelector:()=>el};
  const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const details={user:{id:'2',firstName:'<script>Имя</script>',username:'tester_2'},remaining:7,grants:[{quantity:10,adminId:'1',note:'<b>Проверка</b>',createdAt:new Date().toISOString()}]};
  const state={view:'admin',adminTab:'free',data:{mode:'live',profile:{id:'1'}},freeOpeningUser:details};
  let fail=true,removed=false;const sent=[];
  const c={state,esc:escape,icon:()=>'',api:async(path,options)=>{
    if(!options)return details;
    sent.push(JSON.parse(options.body));if(fail)throw new Error('Потерян ответ');
    return {grant:{userId:'2',quantity:3},remaining:10};
  },toast:()=>{}};
  try {
    assert.match(adminPage(c),/data-admin-tab="free"/);await loadAdmin(c);
    assert.match(el.innerHTML,/Выбрать мой профиль/);assert.match(el.innerHTML,/data-user-id="2"/);assert.match(el.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(el.innerHTML,/<script>/);assert.match(el.innerHTML,/&lt;b&gt;Проверка/);
    const requestId=crypto.randomUUID(),form={id:'free-grant-form',dataset:{userId:'2',requestId},remove(){removed=true;}};
    await assert.rejects(()=>adminSubmit(form,{quantity:'3',note:'Тест'},c),/Потерян ответ/);assert.equal(form.dataset.requestId,requestId);assert.equal(removed,false);
    fail=false;await adminSubmit(form,{quantity:'3',note:'Тест'},c);assert.equal(removed,true);assert.deepEqual(sent[0],sent[1]);assert.equal(sent[0].quantity,3);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
