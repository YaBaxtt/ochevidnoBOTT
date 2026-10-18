import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {once} from 'node:events';
import sharp from 'sharp';
import {Telegram} from 'telegraf';
import {MemoryAppStore} from '../src/app-store.js';
import {createApp} from '../src/server.js';
import {createBot} from '../src/bot.js';
import {makeResult} from '../src/card-engine.js';
import {ownedInlineResults,shareEntry,sharePhoto,shareSelector} from '../src/sharing.js';
import {renderShareJpeg} from '../src/share-renderer.js';
import {certificateSvg,certificateSample} from '../public/certificate-design.js';
import {resultCardSvg,sampleResult,sampleResultCard} from '../public/result-visuals.js';

const config={demo:false,env:'test',botToken:'test-sharing-token',botUsername:'obvious_test_bot',publicAppUrl:'https://example.com',adminIds:new Set(['1'])};
function auth(id){
  const p=new URLSearchParams({user:JSON.stringify({id,first_name:`Имя ${id}`,username:`private_user_${id}`}),auth_date:String(Math.floor(Date.now()/1000))});
  const data=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  p.set('hash',crypto.createHmac('sha256',crypto.createHmac('sha256','WebAppData').update(config.botToken).digest()).update(data).digest('hex'));return p.toString();
}
async function seed(store,userId=2,cardId='hundredth-year',state='paid'){
  await store.upsertUser({id:userId,first_name:`Имя ${userId}`,username:`private_user_${userId}`});
  const answers=cardId==='hundredth-year'?{birthYear:2020}:cardId==='sum-two'?{a:2,b:3}:{name:'Фамилия Имя'};
  const purchase=await store.createPurchase({userId,cardId,amount:20,answers,result:makeResult(cardId,answers)});
  if(state==='paid')await store.settlePurchase({payload:purchase.payload,chargeId:crypto.randomUUID()});
  return store.getPurchase(purchase.id,userId);
}
async function fixture(){
  const store=new MemoryAppStore(),calls=[];
  const telegram={callApi:async(method,data)=>{calls.push({method,data});return {id:'prepared-photo',expiration_date:Math.floor(Date.now()/1000)+300};},sendPhoto:async(...args)=>{calls.push({method:'sendPhoto',args});return true;}};
  const purchase=await seed(store),server=createApp({store,config:{...config},getTelegram:()=>telegram}).listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,{user=2,body={},headers={}}={})=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':auth(user),...headers},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  return {store,calls,telegram,purchase,base,request,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('photo templates render real JPEGs with bundled Cyrillic fonts; premium and bundle designs are distinct',async()=>{
  const regular=certificateSvg(certificateSample()),premium=certificateSvg(certificateSample('premium')),bundle=certificateSvg(certificateSample('bundle'));
  assert.notEqual(regular,premium);assert.notEqual(bundle,premium);assert.notEqual(bundle,regular);
  assert.match(premium,/ЧАСТНАЯ КОЛЛЕКЦИЯ/);assert.match(premium,/#ad853e/);assert.match(regular,/Фамилия Имя/);assert.match(premium,/Marck Script/);
  const svg=resultCardSvg({result:sampleResult,card:sampleResultCard,firstName:'<script>Имя & текст</script>',botUsername:'obvious_test_bot'});
  assert.doesNotMatch(svg,/<script>/);assert.match(svg,/&lt;script&gt;/);
  for(const source of [svg,regular,premium,bundle]){
    const photo=await renderShareJpeg(source),info=await sharp(photo).metadata();assert.equal(info.format,'jpeg');assert.equal(info.width,1200);assert.ok(photo.length<5*1024*1024);
    assert.strictEqual(await renderShareJpeg(source),photo);
  }
  const thumb=await renderShareJpeg(svg,{thumbnail:true});assert.equal((await sharp(thumb).metadata()).width,320);
});

test('share prepare is owner-only and produces a photo message with a real bot button, never text-only content',async()=>{
  const f=await fixture();try{
    const path=`/api/purchases/${f.purchase.id}`;
    assert.equal((await f.request(path+'/share-prepare',{user:1})).status,400);
    assert.equal((await f.request(path+'/share-prepare',{headers:{'X-Telegram-Init-Data':'forged'}})).status,401);
    const prepared=await f.request(path+'/share-prepare',{body:{userId:1,result:{headline:'forged'}}});assert.equal(prepared.status,200);assert.equal(prepared.body.messageId,'prepared-photo');
    const call=f.calls.find(c=>c.method==='savePreparedInlineMessage');assert.equal(call.data.user_id,2);assert.equal(call.data.result.type,'photo');assert.equal(call.data.result.input_message_content,undefined);
    assert.match(call.data.result.photo_url,/^https:\/\/example.com\/api\/shared-media\//);assert.match(call.data.result.caption,/2120 год/);assert.doesNotMatch(call.data.result.caption,/private_user|forged/);
    assert.equal(call.data.result.reply_markup.inline_keyboard[0][0].url,'https://t.me/obvious_test_bot?start=shared');
    assert.equal(call.data.allow_user_chats,true);assert.equal(call.data.allow_group_chats,true);assert.equal(call.data.allow_channel_chats,true);
    const pending=await seed(f.store,2,'sum-two','pending');assert.equal((await f.request(`/api/purchases/${pending.id}/share-prepare`)).status,400);
  }finally{await f.close();}
});

test('photo capabilities reject tampering and refunds; downloads and thumbnails return JPEG without exposing a collection',async()=>{
  const f=await fixture();try{
    const minted=(await f.request(`/api/purchases/${f.purchase.id}/share-image`)).body;
    const payload=JSON.parse(Buffer.from(minted.path.split('/').at(-1).split('.')[0],'base64url').toString('utf8'));assert.equal(payload.visualVersion,2);
    const file=await fetch(f.base+minted.path),buffer=Buffer.from(await file.arrayBuffer());assert.equal(file.status,200);assert.match(file.headers.get('content-type'),/image\/jpeg/);assert.equal((await sharp(buffer).metadata()).width,1200);
    const thumb=await fetch(f.base+minted.path+'?size=thumb');assert.equal((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width,320);
    const downloaded=await fetch(f.base+minted.path+'?download=1');assert.equal(downloaded.headers.get('content-disposition'),`attachment; filename="${minted.fileName}"`);
    const tampered=minted.path.slice(0,-1)+(minted.path.at(-1)==='A'?'B':'A');assert.equal((await fetch(f.base+tampered)).status,403);
    const expiredValue=Buffer.from(JSON.stringify({purchaseId:f.purchase.id,userId:'2',itemIndex:null,expiresAt:Date.now()-1})).toString('base64url');
    const key=crypto.createHmac('sha256',config.botToken).update('ochevidno:share-photo:v1').digest(),sig=crypto.createHmac('sha256',key).update(expiredValue).digest('base64url');
    assert.equal((await fetch(`${f.base}/api/shared-media/${expiredValue}.${sig}`)).status,403);
    f.store.purchases.get(f.purchase.id).state='refunded';assert.equal((await fetch(f.base+minted.path)).status,404);
  }finally{await f.close();}
});

test('send-photo fallback sends the selected real document to its owner; public samples contain no user data',async()=>{
  const f=await fixture();try{
    const bundle=await seed(f.store,2,'bundle-important');
    const sent=await f.request(`/api/purchases/${bundle.id}/share-send`,{body:{itemIndex:0,userId:1}});assert.equal(sent.status,200);
    const call=f.calls.find(c=>c.method==='sendPhoto');assert.equal(call.args[0],'2');assert.ok(Buffer.isBuffer(call.args[1].source));assert.match(call.args[2].caption,/Очень важная персона/);
    assert.equal((await f.request(`/api/purchases/${bundle.id}/share-send`,{body:{itemIndex:99}})).status,400);
    for(const kind of ['result','standard','premium','bundle']){const sample=await fetch(`${f.base}/api/samples/${kind}`);assert.equal(sample.status,200);assert.match(sample.headers.get('content-type'),/image\/jpeg/);}
    assert.equal((await fetch(f.base+'/api/samples/secret')).status,404);
    f.telegram.sendPhoto=async()=>{throw {response:{error_code:403}};};const denied=await f.request(`/api/purchases/${bundle.id}/share-send`,{body:{itemIndex:1}});assert.equal(denied.status,409);assert.match(denied.body.error,/\/start/);
  }finally{await f.close();}
});

test('inline results are scoped to the requester, paginate the whole collection, and include bundle documents',async()=>{
  const store=new MemoryAppStore(),bundle=await seed(store,2,'bundle-office');
  await seed(store,1,'patron-of-obvious');await seed(store,2,'patron-of-obvious','pending');
  for(let i=0;i<10;i++)await seed(store,2,'sum-two');
  const ids=[];let offset='';
  do{const page=await ownedInlineResults({store,config,userId:2,offset});ids.push(...page.results.map(r=>r.id));offset=page.nextOffset;}while(offset);
  assert.equal(ids.length,14);assert.equal(new Set(ids).size,14);
  const certificates=await ownedInlineResults({store,config,userId:2,query:'Офисный'});assert.equal(certificates.results.length,4);
  const exact=await ownedInlineResults({store,config,userId:2,query:shareSelector(bundle.id,1)});assert.equal(exact.results.length,1);assert.match(exact.results[0].title,/созвоне/);
  const foreign=await ownedInlineResults({store,config,userId:1,query:shareSelector(bundle.id)});assert.equal(foreign.results.length,0);
  const invalid=await ownedInlineResults({store,config,userId:2,query:shareSelector(bundle.id,99)});assert.equal(invalid.results.length,0);
  const profile=await store.getProfile(2);assert.doesNotMatch(shareEntry(bundle,profile,{itemIndex:0}).svg,/private_user_2/);
  assert.ok(sharePhoto(config,bundle,profile).path.startsWith('/api/shared-media/'));
});

test('actual inline bot updates answer with personal zero-cache photos, not another user’s purchases',async()=>{
  const store=new MemoryAppStore(),calls=[];await seed(store,1,'rest-license');const owned=await seed(store,2,'hundredth-year');
  const original=Telegram.prototype.callApi;Telegram.prototype.callApi=async function(method,data){calls.push({method,data});return true;};
  try{
    const bot=createBot({store,config});bot.botInfo={id:999,is_bot:true,username:config.botUsername,first_name:'Очевидно'};
    await bot.handleUpdate({update_id:1,inline_query:{id:'inline-query',from:{id:2,is_bot:false,first_name:'Имя 2',username:'private_user_2'},query:'',offset:''}});
    const answer=calls.find(c=>c.method==='answerInlineQuery').data;assert.equal(answer.is_personal,true);assert.equal(answer.cache_time,0);assert.equal(answer.results.length,1);assert.equal(answer.results[0].id,shareSelector(owned.id));assert.equal(answer.results[0].type,'photo');
    assert.equal(answer.button.start_parameter,'collection');assert.equal((await store.getProfile(2)).botStarted,undefined);
  }finally{Telegram.prototype.callApi=original;}
});

test('inline configuration check is owner-only and reports the actual Telegram setting',async()=>{
  const f=await fixture();try{
    assert.equal((await fetch(f.base+'/api/admin/sharing-status',{headers:{'X-Telegram-Init-Data':auth(2)}})).status,403);
    f.telegram.callApi=async method=>{assert.equal(method,'getMe');return {username:config.botUsername,supports_inline_queries:true};};
    const response=await fetch(f.base+'/api/admin/sharing-status',{headers:{'X-Telegram-Init-Data':auth(1)}}),data=await response.json();
    assert.equal(data.checked,true);assert.equal(data.inlineEnabled,true);assert.equal(data.botUsername,config.botUsername);assert.doesNotMatch(JSON.stringify(data),/token/);
  }finally{await f.close();}
});
