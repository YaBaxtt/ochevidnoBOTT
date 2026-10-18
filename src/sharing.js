import crypto from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {getCardDefinition} from './card-engine.js';
import {certificateSvg,certificateSample} from '../public/certificate-design.js';
import {resultCardSvg,sampleResult,sampleResultCard} from '../public/result-visuals.js';
import {renderShareJpeg} from './share-renderer.js';

const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const selectorPattern=new RegExp(`^p_(${uuid})_(all|[0-9]{1,2})$`,'i');
const configKeys=new WeakMap();
function keyFor(config){if(!configKeys.has(config))configKeys.set(config,crypto.createHmac('sha256',config.botToken||crypto.randomBytes(32)).update('ochevidno:share-photo:v1').digest());return configKeys.get(config);}
const botName=config=>/^[a-z0-9_]{5,32}$/i.test(config.botUsername||'')?config.botUsername:'';
export const shareSelector=(purchaseId,itemIndex=null)=>`p_${purchaseId}_${itemIndex===null?'all':itemIndex}`;
export function shareEntry(purchase,profile,{itemIndex=null,botUsername=''}={}) {
  if(!purchase||purchase.state!=='paid')throw new Error('Поделиться можно только выданной карточкой.');
  const item=itemIndex===null?null:purchase.result.items?.[itemIndex];
  if(itemIndex!==null&&(!Number.isInteger(itemIndex)||itemIndex<0||purchase.result.kind!=='bundle'||!item))throw new Error('Выберите документ из своего набора.');
  const cardId=item?.cardId||purchase.cardId,definition=getCardDefinition(cardId)||{},result=item?.result||purchase.result;
  const title=result.documentTitle||item?.title||purchase.title||definition.title||'Очевидное открытие';
  const firstName=result.recipient||result.items?.[0]?.result?.recipient||String(profile?.firstName||'Владелец карточки').slice(0,80);
  const presented={...result,botUsername,collectionStyle:definition.premium||result.rank==='Частная коллекция'?'premium':item?'bundle':'standard'};
  const posterResult=result.kind==='bundle'?{headline:`${result.items.length} документа`,detail:result.items.map(i=>i.title).join(' · '),badge:'КОЛЛЕКЦИЯ В СБОРЕ'}:result;
  const svg=result.kind==='certificate'?certificateSvg(presented):resultCardSvg({result:posterResult,card:{...definition,title},firstName,botUsername});
  return {svg,result,title,firstName,cardId,itemIndex,purchaseId:purchase.id,selector:shareSelector(purchase.id,itemIndex)};
}
function mediaToken(config,purchase,userId,itemIndex){
  // Stable within six hours for efficient Telegram caching; no sequential/public collection URLs.
  const expiresAt=(Math.floor(Date.now()/21600000)+9)*21600000;
  const value=Buffer.from(JSON.stringify({purchaseId:purchase.id,userId:String(userId),itemIndex,expiresAt})).toString('base64url');
  return `${value}.${crypto.createHmac('sha256',keyFor(config)).update(value).digest('base64url')}`;
}
export function sharePhoto(config,purchase,profile,itemIndex=null){
  const entry=shareEntry(purchase,profile,{itemIndex,botUsername:botName(config)});
  const path=`/api/shared-media/${mediaToken(config,purchase,purchase.userId||profile.id,itemIndex)}`;
  return {...entry,path,fileName:`ochevidno-${purchase.id.slice(0,8)}${itemIndex===null?'':`-${itemIndex+1}`}.jpg`};
}
function photoResult(config,purchase,profile,itemIndex=null){
  if(!config.publicAppUrl?.startsWith('https://'))throw new Error('Для отправки картинок нужен публичный HTTPS-адрес мини-аппа.');
  const entry=sharePhoto(config,purchase,profile,itemIndex),url=config.publicAppUrl+entry.path;
  const botUrl=botName(config)?`https://t.me/${botName(config)}?start=shared`:config.publicAppUrl;
  const caption=Array.from(`${entry.title}\n${entry.result.headline}\n${entry.result.detail||''}\n\nСерьёзно оформлено — несерьёзно получено.\n${botUrl}`).slice(0,1000).join('');
  return {type:'photo',id:entry.selector,photo_url:url,thumbnail_url:`${url}?size=thumb`,title:entry.title,description:entry.result.headline,caption,reply_markup:{inline_keyboard:[[{text:'Создать свою карточку',url:botUrl}]]}};
}

export async function ownedInlineResults({store,config,userId,query='',offset=''}) {
  query=String(query).trim().slice(0,120);
  const selected=query.match(selectorPattern),profile=await store.getProfile(userId);
  if(selected){
    const purchase=await store.getPurchase(selected[1],userId);
    if(!purchase||purchase.state!=='paid')return {results:[],nextOffset:''};
    const itemIndex=selected[2]==='all'?null:Number(selected[2]);
    try{return {results:[photoResult(config,purchase,profile,itemIndex)],nextOffset:''};}catch{return {results:[],nextOffset:''};}
  }
  const start=/^(0|[1-9]\d{0,6})$/.test(offset)?Number(offset):0,limit=8;
  let rows;
  if(typeof store.query==='function'){
    const pattern=`%${query.replace(/[\\%_]/g,'\\$&')}%`;
    rows=(await store.query(`SELECT p.id::text,p.telegram_id::text AS "userId",p.card_id AS "cardId",p.result,p.state,p.created_at AS "createdAt",c.title FROM purchases p JOIN cards c ON c.id=p.card_id WHERE p.telegram_id=$1 AND p.state='paid' AND ($2='' OR c.title ILIKE $3 OR p.result::text ILIKE $3) ORDER BY p.created_at DESC,p.id DESC LIMIT $4 OFFSET $5`,[String(userId),query,pattern,limit+1,start])).rows;
  }else{
    rows=[...store.purchases.values()].filter(p=>p.userId===String(userId)&&p.state==='paid').map(p=>({...p,title:store.cards.get(p.cardId)?.title||p.cardId})).filter(p=>`${p.title} ${JSON.stringify(p.result)}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(start,start+limit+1);
  }
  const results=rows.slice(0,limit).flatMap(p=>[photoResult(config,p,profile),...(p.result.kind==='bundle'?p.result.items.map((_,index)=>photoResult(config,p,profile,index)):[])]);
  return {results:results.slice(0,50),nextOffset:rows.length>limit?String(start+limit):''};
}

export function registerSharingApi({app,store,config,getTelegram,requireActor,requireAdmin}) {
  const mediaLimit=rateLimit({windowMs:60000,limit:1200,standardHeaders:'draft-8',legacyHeaders:false,message:'Подождите перед повторной загрузкой картинки.'});
  const limited=rateLimit({windowMs:60000,limit:12,keyGenerator:req=>String(req.actor.id),standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Подождите минуту перед следующей отправкой.'}});
  const find=async req=>{
    const purchase=await store.getPurchase(req.params.purchaseId,req.actor.id);
    if(!purchase)throw new Error('Покупка не найдена.');
    return {purchase,entry:sharePhoto(config,purchase,req.actor,req.body?.itemIndex??null)};
  };
  app.post('/api/purchases/:purchaseId/share-image',requireActor,async(req,res)=>{
    const {entry}=await find(req);res.set('Cache-Control','no-store').json({path:entry.path,fileName:entry.fileName,selector:entry.selector});
  });
  app.post('/api/purchases/:purchaseId/share-prepare',requireActor,limited,async(req,res)=>{
    const {purchase,entry}=await find(req),telegram=getTelegram();
    if(config.demo)return res.json({mode:'demo',path:entry.path,fileName:entry.fileName});
    if(!telegram)throw new Error('Бот ещё не подключён. Попробуйте позже.');
    let message;
    try{message=await telegram.callApi('savePreparedInlineMessage',{user_id:Number(req.actor.id),result:photoResult(config,purchase,req.actor,entry.itemIndex),allow_user_chats:true,allow_group_chats:true,allow_channel_chats:true,allow_bot_chats:false});}
    catch{return res.status(503).json({error:'Telegram не подготовил отправку. Можно получить картинку в личном чате с ботом и переслать её оттуда.'});}
    if(!message?.id)return res.status(503).json({error:'Telegram не вернул готовую картинку. Попробуйте отправить её себе в бота.'});
    await store.incrementShare(purchase.id,req.actor.id);
    res.json({mode:'telegram',messageId:message.id,expiresAt:message.expiration_date,selector:entry.selector});
  });
  app.post('/api/purchases/:purchaseId/share-send',requireActor,limited,async(req,res)=>{
    const {purchase,entry}=await find(req),telegram=getTelegram();
    if(config.demo||!telegram)return res.status(409).json({error:'В демо отправка отключена. Скачайте картинку в браузере.'});
    const result=photoResult(config,purchase,req.actor,entry.itemIndex);
    try{await telegram.sendPhoto(req.actor.id,{source:await renderShareJpeg(entry.svg),filename:entry.fileName},{caption:result.caption,reply_markup:result.reply_markup});}
    catch(error){if([400,403].includes(error.response?.error_code))return res.status(409).json({error:'Сначала откройте личный чат с ботом, нажмите /start и разблокируйте сообщения.'});throw error;}
    await store.incrementShare(purchase.id,req.actor.id);res.json({sent:true});
  });
  app.get('/api/shared-media/:token',mediaLimit,async(req,res)=>{
    res.set('Cache-Control','private, no-store').set('Referrer-Policy','no-referrer');
    const token=req.params.token;
    if(token.length>1024||!/^[-a-z0-9_]+\.[-a-z0-9_]+$/i.test(token))return res.sendStatus(403);
    const [value,signature]=token.split('.'),expected=Buffer.from(crypto.createHmac('sha256',keyFor(config)).update(value).digest('base64url')),actual=Buffer.from(signature);
    if(expected.length!==actual.length||!crypto.timingSafeEqual(expected,actual))return res.sendStatus(403);
    let data;try{data=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{return res.sendStatus(403);}
    if(!Number.isSafeInteger(data.expiresAt)||data.expiresAt<=Date.now())return res.sendStatus(403);
    const purchase=await store.getPurchase(data.purchaseId,data.userId);
    if(!purchase||purchase.state!=='paid')return res.sendStatus(404);
    const profile=await store.getProfile(data.userId),entry=shareEntry(purchase,profile,{itemIndex:data.itemIndex,botUsername:botName(config)});
    const buffer=await renderShareJpeg(entry.svg,{thumbnail:req.query.size==='thumb'});
    const fileName=`ochevidno-${purchase.id.slice(0,8)}${data.itemIndex===null?'':`-${data.itemIndex+1}`}.jpg`;
    res.type('jpeg').set('Content-Disposition',`${req.query.download==='1'?'attachment':'inline'}; filename="${fileName}"`).set('Access-Control-Allow-Origin','https://web.telegram.org').set('Cross-Origin-Resource-Policy','cross-origin').send(buffer);
  });
  app.get('/api/samples/:kind',mediaLimit,async(req,res)=>{
    if(!['result','standard','premium','bundle'].includes(req.params.kind))return res.sendStatus(404);
    const svg=req.params.kind==='result'?resultCardSvg({result:sampleResult,card:sampleResultCard,firstName:'Фамилия Имя',botUsername:botName(config),sample:true}):certificateSvg({...certificateSample(req.params.kind),botUsername:botName(config)},true);
    res.type('jpeg').set('Cache-Control','public, max-age=3600').send(await renderShareJpeg(svg,{thumbnail:req.query.size==='thumb'}));
  });
  app.get('/api/admin/sharing-status',...requireAdmin,async(_req,res)=>{
    if(config.demo||!getTelegram())return res.json({checked:false,demo:Boolean(config.demo),botUsername:botName(config),inlineEnabled:null});
    try {
      const me=await getTelegram().callApi('getMe',{});
      res.json({checked:Boolean(me?.username),botUsername:me?.username||botName(config),inlineEnabled:typeof me?.supports_inline_queries==='boolean'?me.supports_inline_queries:false});
    }catch{res.json({checked:false,botUsername:botName(config),inlineEnabled:null});}
  });
}
