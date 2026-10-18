import crypto from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { certificateSvg } from '../public/certificate.js';

const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const lifetimeMs=5*60*1000;

function ownedDocument(purchase,itemIndex=null) {
  if(!purchase||purchase.state!=='paid')throw new Error('Документ недоступен. Откройте выданную грамоту в своей коллекции.');
  let result=purchase.result;
  if(result.kind==='bundle') {
    if(!Number.isInteger(itemIndex)||itemIndex<0||itemIndex>=result.items.length)throw new Error('Выберите грамоту из набора.');
    result=result.items[itemIndex].result;
  } else if(itemIndex!==null)throw new Error('В этой карточке нет выбранного документа.');
  if(result.kind!=='certificate')throw new Error('Эта карточка не является грамотой.');
  const fileName=`ochevidno-${purchase.id.slice(0,8)}${itemIndex===null?'':`-${itemIndex+1}`}.svg`;
  const svg=`<?xml version="1.0" encoding="UTF-8"?>\n${certificateSvg(result).replace('<svg ','<svg width="800" height="1100" ')}`;
  return {fileName,svg,title:result.documentTitle};
}

export function registerDocumentDownloads({app,store,config,getTelegram,requireActor}) {
  const key=crypto.createHmac('sha256',config.botToken||crypto.randomBytes(32)).update('ochevidno:certificate-download:v1').digest();
  const sign=value=>crypto.createHmac('sha256',key).update(value).digest('base64url');
  const limited=rateLimit({windowMs:60000,limit:20,keyGenerator:req=>String(req.actor.id),standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Подождите минуту перед следующим скачиванием.'}});
  const sendLimited=rateLimit({windowMs:60000,limit:5,keyGenerator:req=>String(req.actor.id),standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Файлы уже отправлены. Подождите минуту перед следующей отправкой.'}});
  app.post('/api/purchases/:purchaseId/document-link',requireActor,limited,async(req,res)=>{
    const purchase=await store.getPurchase(req.params.purchaseId,req.actor.id);
    if(!purchase)return res.status(404).json({error:'Покупка не найдена.'});
    const itemIndex=req.body?.itemIndex??null;
    const {fileName}=ownedDocument(purchase,itemIndex);
    const expiresAt=Date.now()+lifetimeMs;
    const value=Buffer.from(JSON.stringify({purchaseId:purchase.id,userId:req.actor.id,itemIndex,expiresAt})).toString('base64url');
    res.set('Cache-Control','no-store').json({path:`/api/document-files/${value}.${sign(value)}`,fileName,expiresAt});
  });
  // A short-lived capability is necessary because Telegram's downloader cannot send initData headers.
  app.get('/api/document-files/:token',async(req,res)=>{
    res.set('Cache-Control','private, no-store').set('Referrer-Policy','no-referrer');
    const token=req.params.token;
    if(token.length>1024||!/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(token))return res.status(403).json({error:'Недействительная ссылка на файл.'});
    const [value,signature]=token.split('.'),expected=Buffer.from(sign(value)),actual=Buffer.from(signature);
    if(expected.length!==actual.length||!crypto.timingSafeEqual(expected,actual))return res.status(403).json({error:'Недействительная ссылка на файл.'});
    let data;
    try{data=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{return res.status(403).json({error:'Недействительная ссылка на файл.'});}
    if(!uuidPattern.test(data.purchaseId)||!Number.isSafeInteger(data.expiresAt)||data.expiresAt<=Date.now())return res.status(403).json({error:'Ссылка истекла. Нажмите «Скачать SVG» в коллекции ещё раз.'});
    const purchase=await store.getPurchase(data.purchaseId,data.userId);
    if(!purchase||purchase.state!=='paid')return res.status(404).json({error:'Документ недоступен.'});
    const {fileName,svg}=ownedDocument(purchase,data.itemIndex);
    res.type('image/svg+xml').set('Content-Disposition',`attachment; filename="${fileName}"`)
      .set('Access-Control-Allow-Origin','https://web.telegram.org')
      .set('Cross-Origin-Resource-Policy','cross-origin')
      .set('Content-Security-Policy',"default-src 'none'; sandbox")
      .send(svg);
  });
  app.post('/api/purchases/:purchaseId/document-send',requireActor,sendLimited,async(req,res)=>{
    const purchase=await store.getPurchase(req.params.purchaseId,req.actor.id);
    if(!purchase)return res.status(404).json({error:'Покупка не найдена.'});
    const {fileName,svg,title}=ownedDocument(purchase,req.body?.itemIndex??null),telegram=getTelegram();
    if(config.demo||!telegram)return res.status(409).json({error:'В демо отправка в Telegram недоступна. Используйте скачивание в браузере.'});
    try {
      await telegram.sendDocument(req.actor.id,{source:Buffer.from(svg,'utf8'),filename:fileName},{caption:`Очевидно · ${title}\n\nТвоя грамота в SVG: сохрани файл из этого сообщения. Шуточный документ.`});
      res.json({sent:true});
    }catch(error){
      if([400,403].includes(error.response?.error_code))return res.status(409).json({error:'Откройте личный чат с ботом, нажмите /start и разрешите сообщения, затем повторите отправку.'});
      throw error;
    }
  });
}
