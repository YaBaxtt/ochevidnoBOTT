import test from 'node:test';
import assert from 'node:assert/strict';
import { Telegram } from 'telegraf';
import { createBot, configureBot } from '../src/bot.js';
import { MemoryAppStore } from '../src/app-store.js';

test('bot greets by name, configures menu, respects /stop and collects payment support',async()=>{
  const store=new MemoryAppStore();
  const config={botToken:'dummy-for-unit-test',publicAppUrl:'https://example.com',supportUrl:'https://t.me/test_support',demo:false};
  const calls=[];
  const original=Telegram.prototype.callApi;
  Telegram.prototype.callApi=async function(method,data){calls.push({method,data});return true;};
  try {
    const bot=createBot({store,config});
    bot.botInfo={id:999,is_bot:true,username:'obvious_test_bot',first_name:'Очевидно'};
    let updateId=1;
    const send=async(text)=>bot.handleUpdate({update_id:updateId++,message:{message_id:updateId,date:Math.floor(Date.now()/1000),chat:{id:1,type:'private'},from:{id:1,is_bot:false,first_name:'Никита'},text,entities:[{type:'bot_command',offset:0,length:text.split(' ')[0].length}]}});
    await configureBot(bot,config,await store.getBotSettings());
    assert.ok(calls.some((c)=>c.method==='setMyCommands'&&c.data.commands.some((command)=>command.command==='stop')));
    await send('/start');
    const greeting=calls.find((c)=>c.method==='sendMessage');
    assert.match(greeting.data.text,/Никита/);
    assert.equal(greeting.data.reply_markup.inline_keyboard[0][0].web_app.url,'https://example.com/?tab=home');
    assert.equal(await store.campaignAudience({audience:'all'}),1);
    await send('/stop');assert.equal(await store.campaignAudience({audience:'all'}),0);
    await send('/paysupport Оплаченная карточка не появилась');
    assert.equal((await store.listTickets())[0].message,'Оплаченная карточка не появилась');
    await send('/start');assert.equal(await store.campaignAudience({audience:'all'}),1);
    assert.equal((await store.releaseReport()).starts,2);
    assert.ok(calls.find(c=>c.method==='setMyCommands').data.commands.some(c=>c.command==='promo'));
    await store.createPromo({code:'BOT10',kind:'bonus',bonus:10,cardId:null,usageLimit:1,expiresAt:null});await send('/promo BOT10');assert.equal((await store.getProfile(1)).bonusBalance,10);
    const p=await store.createPurchase({userId:1,cardId:'sum-two',amount:5,answers:{a:1,b:1},result:{headline:'2',detail:'1 + 1'}});
    await store.updateSalesSettings({paused:true});
    await bot.handleUpdate({update_id:updateId++,pre_checkout_query:{id:'query',from:{id:1,is_bot:false,first_name:'Никита'},currency:'XTR',total_amount:5,invoice_payload:p.payload}});
    assert.equal(calls.filter(c=>c.method==='answerPreCheckoutQuery').at(-1).data.ok,false);
    // A payment that was already accepted by Telegram must still be fulfilled during a sales pause.
    const paymentUpdate={update_id:updateId++,message:{message_id:updateId,date:Math.floor(Date.now()/1000),chat:{id:1,type:'private'},from:{id:1,is_bot:false,first_name:'Никита'},successful_payment:{currency:'XTR',total_amount:5,invoice_payload:p.payload,telegram_payment_charge_id:'bot-test-charge',provider_payment_charge_id:''}}};
    await bot.handleUpdate(paymentUpdate);await bot.handleUpdate({...paymentUpdate,update_id:updateId++});assert.equal((await store.getProfile(1)).starsSpent,5);assert.equal((await store.getPurchase(p.id,1)).state,'paid');
  }finally{Telegram.prototype.callApi=original;}
});
