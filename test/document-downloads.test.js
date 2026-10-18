import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { MemoryAppStore } from '../src/app-store.js';
import { createApp } from '../src/server.js';
import { makeResult } from '../src/card-engine.js';
import { downloadCertificate } from '../public/certificate.js';

function sign(id) {
  const params=new URLSearchParams({user:JSON.stringify({id,first_name:'Тест'}),auth_date:String(Math.floor(Date.now()/1000))});
  const message=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  params.set('hash',crypto.createHmac('sha256',crypto.createHmac('sha256','WebAppData').update('test-token').digest()).update(message).digest('hex'));return params.toString();
}
async function fixture() {
  const store=new MemoryAppStore(),sent=[];
  for(const id of [1,2])await store.upsertUser({id});
  await store.grantFreeOpenings({userId:'2',adminId:'1',quantity:3,requestId:crypto.randomUUID()});
  const purchases=[];
  for(const cardId of ['rest-license','bundle-office','sum-two']) {
    const answers=cardId==='sum-two'?{a:1,b:1}:{name:'<Проверка & имя>'};
    purchases.push(await store.createFreePurchase({userId:2,cardId,amount:20,answers,result:makeResult(cardId,answers),requestId:crypto.randomUUID()}));
  }
  const telegram={sendDocument:async(...args)=>sent.push(args)};
  const config={demo:false,env:'test',botToken:'test-token',publicAppUrl:'https://example.com',adminIds:new Set(['1'])};
  const server=createApp({store,config,getTelegram:()=>telegram}).listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,{user=2,body={},headers={}}={})=>{
    const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':sign(user),...headers},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  return {store,sent,telegram,base,request,purchases,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('owned certificate download uses a short-lived server file, escaped SVG and Telegram-compatible headers',async()=>{
  const f=await fixture();try {
    const p=f.purchases[0],issued=await f.request(`/api/purchases/${p.id}/document-link`);
    assert.equal(issued.status,200);assert.match(issued.body.fileName,/^ochevidno-[a-f0-9]{8}\.svg$/);
    assert.ok(issued.body.expiresAt>Date.now());assert.ok(issued.body.expiresAt<=Date.now()+300000);
    const file=await fetch(f.base+issued.body.path),svg=await file.text();
    assert.equal(file.status,200);assert.match(file.headers.get('content-type'),/image\/svg\+xml/);
    assert.equal(file.headers.get('content-disposition'),`attachment; filename="${issued.body.fileName}"`);
    assert.equal(file.headers.get('access-control-allow-origin'),'https://web.telegram.org');assert.match(file.headers.get('cache-control'),/no-store/);
    assert.match(svg,/^<\?xml/);assert.match(svg,/width="800" height="1100"/);assert.match(svg,/&lt;Проверка &amp; Имя&gt;/);assert.doesNotMatch(svg,/<Проверка/);
    assert.match(svg,/@font-face/);assert.match(svg,/data:font\/ttf;base64,/);assert.match(file.headers.get('content-security-policy'),/font-src data:/);
    const head=await fetch(f.base+issued.body.path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
    const replacement=issued.body.path.at(-1)==='A'?'B':'A';
    assert.equal((await fetch(f.base+issued.body.path.slice(0,-1)+replacement)).status,403);
    const key=crypto.createHmac('sha256','test-token').update('ochevidno:certificate-download:v1').digest();
    const expired=Buffer.from(JSON.stringify({purchaseId:p.id,userId:'2',itemIndex:null,expiresAt:Date.now()-1})).toString('base64url');
    const signature=crypto.createHmac('sha256',key).update(expired).digest('base64url');
    assert.equal((await fetch(`${f.base}/api/document-files/${expired}.${signature}`)).status,403);
    f.store.purchases.get(p.id).state='refunded';assert.equal((await fetch(f.base+issued.body.path)).status,404);
  }finally{await f.close();}
});

test('unpaid, foreign and non-certificate results cannot be exported; bundle selection stays exact',async()=>{
  const f=await fixture();try {
    const [certificate,bundle,answer]=f.purchases;
    assert.equal((await f.request(`/api/purchases/${certificate.id}/document-link`,{user:1})).status,404);
    assert.equal((await f.request(`/api/purchases/${certificate.id}/document-link`,{headers:{'X-Telegram-Init-Data':'invalid'}})).status,401);
    assert.equal((await f.request(`/api/purchases/${answer.id}/document-link`)).status,400);
    assert.equal((await f.request(`/api/purchases/${bundle.id}/document-link`)).status,400);
    assert.equal((await f.request(`/api/purchases/${bundle.id}/document-link`,{body:{itemIndex:-1}})).status,400);
    assert.equal((await f.request(`/api/purchases/${bundle.id}/document-link`,{body:{itemIndex:'0'}})).status,400);
    const issued=await f.request(`/api/purchases/${bundle.id}/document-link`,{body:{itemIndex:1}});
    assert.equal(issued.status,200);assert.match(issued.body.fileName,/-2\.svg$/);
    const svg=await (await fetch(f.base+issued.body.path)).text();assert.ok(svg.includes(bundle.result.items[1].result.serial));
    const pending=await f.store.createPurchase({userId:2,cardId:'rest-license',amount:20,answers:{name:'Тест'},result:makeResult('rest-license',{name:'Тест'})});
    assert.equal((await f.request(`/api/purchases/${pending.id}/document-link`)).status,400);
    assert.equal((await f.request(`/api/purchases/${pending.id}/document-send`)).status,400);
  }finally{await f.close();}
});

test('Telegram fallback sends a real SVG document to its owner, not to a client-supplied recipient',async()=>{
  const f=await fixture();try {
    const bundle=f.purchases[1];
    const response=await f.request(`/api/purchases/${bundle.id}/document-send`,{body:{itemIndex:2,userId:1,svg:'<script>bad</script>'}});
    assert.equal(response.status,200);assert.equal(response.body.sent,true);assert.equal(f.sent.length,1);
    const [recipient,document,options]=f.sent[0];assert.equal(recipient,'2');assert.ok(Buffer.isBuffer(document.source));assert.match(document.filename,/-3\.svg$/);
    assert.ok(document.source.toString('utf8').includes(bundle.result.items[2].result.serial));assert.doesNotMatch(document.source.toString('utf8'),/<script>/);assert.match(options.caption,/SVG/);
    assert.equal((await f.request(`/api/purchases/${bundle.id}/document-send`,{user:1,body:{itemIndex:2}})).status,404);
    f.telegram.sendDocument=async()=>{throw {response:{error_code:403}};};
    const blocked=await f.request(`/api/purchases/${bundle.id}/document-send`,{body:{itemIndex:0}});assert.equal(blocked.status,409);assert.match(blocked.body.error,/\/start/);
  }finally{await f.close();}
});

test('download helper uses Telegram native download, declines unsupported clients and attaches browser anchors',()=>{
  const calls=[],statuses=[];
  assert.equal(downloadCertificate({url:'https://example.com/file',fileName:'doc.svg',telegram:{initData:'signed',isVersionAtLeast:v=>v==='8.0',downloadFile:(params,cb)=>{calls.push(params);cb(true);}},onStatus:text=>statuses.push(text)}),true);
  assert.deepEqual(calls,[{url:'https://example.com/file',file_name:'doc.svg'}]);assert.match(statuses[0],/Запрос на скачивание/);
  assert.equal(downloadCertificate({url:'https://example.com/file',fileName:'doc.svg',telegram:{initData:'signed',isVersionAtLeast:()=>false}}),false);
  const previous=globalThis.document,steps=[];
  globalThis.document={createElement:()=>({click(){steps.push('click');},remove(){steps.push('remove');}}),body:{append(){steps.push('append');}}};
  try{assert.equal(downloadCertificate({url:'http://localhost/file',fileName:'doc.svg'}),true);assert.deepEqual(steps,['append','click','remove']);}
  finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
