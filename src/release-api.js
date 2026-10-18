import { rateLimit } from 'express-rate-limit';
import { getCardDefinition } from './card-engine.js';

const clean = (value,max) => String(value??'').trim().slice(0,max);
const promoCode = value => clean(value,40).toUpperCase();
export function registerReleaseApi({app,store,config,getTelegram,requireActor,requireAdmin}) {
  const limited = rateLimit({windowMs:60000,limit:12,keyGenerator:req=>String(req.actor.id),standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много попыток. Подождите минуту.'}});
  app.post('/api/cards/:id/view',requireActor,async(req,res)=>{if(!getCardDefinition(req.params.id))return res.sendStatus(404);await store.recordView(req.params.id,req.actor.id);res.json({ok:true});});
  app.post('/api/promos/redeem',requireActor,limited,async(req,res)=>{
    const code=promoCode(req.body.code);if(!/^[A-Z0-9_-]{3,40}$/.test(code))return res.status(422).json({error:'Проверьте промокод: латинские буквы, цифры, дефис.'});
    res.json({reward:await store.redeemPromo(code,req.actor.id)});
  });
  app.get('/api/support/mine',requireActor,async(req,res)=>res.json({tickets:await store.ownTickets(req.actor.id)}));
  app.get('/api/admin/reports',...requireAdmin,async(_req,res)=>res.json(await store.releaseReport()));
  app.get('/api/admin/sales',...requireAdmin,async(_req,res)=>res.json(await store.getSalesSettings()));
  app.patch('/api/admin/sales',...requireAdmin,async(req,res)=>{
    if(typeof req.body.paused!=='boolean')return res.status(422).json({error:'Укажите состояние продаж.'});
    const value=await store.updateSalesSettings({paused:req.body.paused});await store.audit(req.actor.id,'sales.pause','global',value);res.json(value);
  });
  let starBalanceCache;
  app.get('/api/admin/star-balance',...requireAdmin,async(_req,res)=>{
    const telegram=getTelegram();if(!telegram||config.demo)return res.json({available:false,reason:'Подключите реального бота. В демо нет настоящих Stars.'});
    if(starBalanceCache&&starBalanceCache.until>Date.now())return res.json(starBalanceCache.value);
    let timer;
    try { const balance=await Promise.race([telegram.callApi('getMyStarBalance',{}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),6000);})]);const value={available:true,amount:balance.amount,nanostarAmount:balance.nanostar_amount||0,updatedAt:new Date().toISOString()};starBalanceCache={until:Date.now()+30000,value};res.json(value); }
    catch {res.status(503).json({available:false,error:'Telegram не вернул баланс. Это не означает нулевой баланс.'});}finally{clearTimeout(timer);}
  });
  app.get('/api/admin/promos',...requireAdmin,async(_req,res)=>res.json({promos:await store.listPromos()}));
  app.post('/api/admin/promos',...requireAdmin,async(req,res)=>{
    const code=promoCode(req.body.code),kind=req.body.kind,usageLimit=Number(req.body.usageLimit),bonus=kind==='bonus'?Number(req.body.bonus):0,cardId=kind==='card'?clean(req.body.cardId,80):null;
    const expiresAt=req.body.expiresAt?new Date(req.body.expiresAt):null;
    if(!/^[A-Z0-9_-]{3,40}$/.test(code)||!['bonus','card'].includes(kind)||!Number.isInteger(usageLimit)||usageLimit<1||usageLimit>100000||kind==='bonus'&&(!Number.isInteger(bonus)||bonus<1||bonus>10000)||kind==='card'&&!getCardDefinition(cardId)||expiresAt&&(!Number.isFinite(expiresAt.getTime())||expiresAt<=new Date()))return res.status(422).json({error:'Проверьте код, награду, лимит (1–100 000) и будущую дату окончания.'});
    if((await store.listPromos()).some(p=>p.code===code))return res.status(409).json({error:'Такой промокод уже существует.'});
    const promo=await store.createPromo({code,kind,usageLimit,bonus,cardId,expiresAt:expiresAt?.toISOString()||null});await store.audit(req.actor.id,'promo.create',promo.id,{code,kind,usageLimit,bonus,cardId});res.status(201).json({promo});
  });
  app.patch('/api/admin/promos/:id',...requireAdmin,async(req,res)=>{
    if(typeof req.body.active!=='boolean')return res.status(422).json({error:'Укажите состояние промокода.'});
    const promo=await store.togglePromo(req.params.id,req.body.active);if(!promo)return res.sendStatus(404);await store.audit(req.actor.id,'promo.toggle',promo.id,{active:promo.active});res.json({promo});
  });
  app.get('/api/admin/placements',...requireAdmin,async(_req,res)=>res.json({placements:await store.placementReport(),botUsername:config.botUsername||null}));
  app.post('/api/admin/placements',...requireAdmin,async(req,res)=>{
    const title=clean(req.body.title,100),cost=Number(req.body.cost),currency=clean(req.body.currency,8);
    if(!title||!Number.isFinite(cost)||cost<0||cost>100000000||!['RUB','USD','XTR'].includes(currency))return res.status(422).json({error:'Проверьте название, расход и валюту.'});
    const placement=await store.createPlacement({title,cost:Math.round(cost*100)/100,currency});await store.audit(req.actor.id,'ad-placement.create',placement.id,{title,cost,currency});res.status(201).json({placement});
  });
  app.get('/api/admin/problems',...requireAdmin,async(_req,res)=>res.json({problems:await store.listProblems(),notificationsConnected:Boolean(getTelegram()&&config.adminIds.size)}));
  app.patch('/api/admin/problems/:id',...requireAdmin,async(req,res)=>{await store.resolveProblem(req.params.id);await store.audit(req.actor.id,'problem.resolve',req.params.id);res.json({ok:true});});
}

export async function processOwnerAlert({store,telegram}) {
  const a=await store.claimOwnerAlert();if(!a)return false;
  try {await telegram.sendMessage(a.userId,`Очевидно · ${a.title}\n\n${a.body}\n\nПодробности: Mini App → Админка → Проблемы / Поддержка.`);await store.finishOwnerAlert(a.id,'sent');}
  catch(e){await store.finishOwnerAlert(a.id,a.attempts>=5||e.response?.error_code===403?'failed':'pending',e.response?.parameters?.retry_after||60);}
  return true;
}

export function startOwnerAlertWorker({store,telegram}) {
  let stopped=false,timer;const tick=async()=>{try{await processOwnerAlert({store,telegram});}catch{console.error('owner alert worker: storage unavailable');}if(!stopped){timer=setTimeout(tick,1500);timer.unref();}};tick();return()=>{stopped=true;clearTimeout(timer);};
}
