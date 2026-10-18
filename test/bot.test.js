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
    assert.match(greeting.data.text,/👋/);
    assert.match(greeting.data.text,/🎓/);
    assert.equal(greeting.data.reply_markup.inline_keyboard[0][0].web_app.url,'https://example.com/?tab=home');
    assert.equal(greeting.data.reply_markup.inline_keyboard[0][0].style,'success');
    assert.ok(greeting.data.reply_markup.inline_keyboard.slice(1).flat().every(button=>button.style===undefined));
    assert.ok(greeting.data.reply_markup.inline_keyboard.flat().some(button=>button.callback_data==='show_support'));
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

test('bot has coherent help, private owner diagnostics and support by the next message', async () => {
  const store = new MemoryAppStore();
  const config = { botToken: 'dummy-for-unit-test', publicAppUrl: 'https://example.com', supportUrl: 'https://t.me/test_support', demo: false, adminIds: new Set(['1']) };
  const calls = [];
  const original = Telegram.prototype.callApi;
  Telegram.prototype.callApi = async function(method, data) {
    calls.push({method, data});
    return method === 'getChatMenuButton' ? { type: 'web_app', web_app: { url: config.publicAppUrl } } : true;
  };
  try {
    const bot = createBot({ store, config });
    bot.botInfo = { id: 999, is_bot: true, username: 'obvious_test_bot', first_name: 'Очевидно' };
    let updateId = 20;
    const send = async (text, id = 1) => bot.handleUpdate({ update_id: updateId++, message: { message_id: updateId, date: Math.floor(Date.now()/1000), chat: { id, type: 'private' }, from: { id, is_bot: false, first_name: 'Тест' }, text, ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}) } });
    const action = async (data, id = 1) => bot.handleUpdate({ update_id: updateId++, callback_query: { id: `callback-${updateId}`, data, from: { id, is_bot: false, first_name: 'Тест' }, chat_instance: 'test-chat', message: { message_id: updateId, date: Math.floor(Date.now()/1000), chat: { id, type: 'private' }, text: 'Меню' } } });
    const lastText = () => calls.filter(call=>call.method==='sendMessage').at(-1).data.text;
    await configureBot(bot, config, await store.getBotSettings());
    const commandCalls = calls.filter(call=>call.method==='setMyCommands');
    assert.ok(!commandCalls[0].data.commands.some(command=>command.command==='status'));
    assert.ok(commandCalls.some(call=>call.data.scope?.chat_id===1 && call.data.commands.some(command=>command.command==='status')));
    assert.match(calls.find(call=>call.method==='setMyShortDescription').data.short_description, /🃏/);
    await send('/help'); assert.match(lastText(), /🧭/); assert.match(lastText(), /Не плати повторно/);
    await send('/about'); assert.match(lastText(), /шуточные грамоты/);
    await send('/status', 2); assert.doesNotMatch(lastText(), /https:\/\/example\.com/);
    await send('/status'); assert.match(lastText(), /Хранилище доступно/); assert.match(lastText(), /example\.com/);
    const menuCalls = () => calls.filter(call=>call.method==='setChatMenuButton');
    const beforeRepair = menuCalls().length;
    await action('repair_menu', 2); assert.equal(menuCalls().length, beforeRepair);
    await action('repair_menu'); assert.equal(menuCalls().length, beforeRepair + 1);
    assert.equal(menuCalls().at(-1).data.chat_id, 1);
    assert.equal(menuCalls().at(-1).data.menu_button.web_app.url, 'https://example.com');
    await send('/admin');
    assert.equal(calls.filter(call=>call.method==='sendMessage').at(-1).data.reply_markup.inline_keyboard[0][0].web_app.url,'https://example.com/?tab=admin');
    await send('/paysupport'); assert.match(lastText(), /следующим сообщением/);
    await send('Купил карточку, а результат не открылся');
    assert.equal((await store.listTickets()).length, 1);
    assert.match(lastText(), /Обращение №/);
    await send('/paysupport'); await send('/cancel'); await send('Это не обращение');
    assert.equal((await store.listTickets()).length, 1);
    await send('/paysupport'); await send('/unknown_command');
    assert.equal((await store.listTickets()).length, 1);
    assert.match(lastText(), /Такой команды/);
    await send('/start'); await send('Просто привет');
    assert.equal((await store.listTickets()).length, 1);
  } finally { Telegram.prototype.callApi = original; }
});

test('a missing Mini App domain never sends an invalid web_app button or disables bot support', async () => {
  const store = new MemoryAppStore();
  const config = { botToken: 'dummy-for-unit-test', publicAppUrl: '', demo: false, adminIds: new Set(['1']) };
  const calls = [];
  const original = Telegram.prototype.callApi;
  Telegram.prototype.callApi = async function(method, data) { calls.push({method, data}); return true; };
  try {
    const bot = createBot({store, config});
    bot.botInfo = { id: 999, is_bot: true, username: 'obvious_test_bot', first_name: 'Очевидно' };
    let id = 400;
    const send = async text => bot.handleUpdate({ update_id: id++, message: { message_id: id, date: Math.floor(Date.now()/1000), chat: { id: 1, type: 'private' }, from: { id: 1, is_bot: false, first_name: 'Тест' }, text, ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}) } });
    await configureBot(bot, config, await store.getBotSettings());
    assert.deepEqual(calls.find(call=>call.method==='setChatMenuButton').data.menu_button, { type: 'commands' });
    await send('/start');
    const greeting = calls.filter(call=>call.method==='sendMessage').at(-1);
    assert.equal(greeting.data.reply_markup.inline_keyboard[0][0].callback_data, 'app_not_configured');
    assert.ok(greeting.data.reply_markup.inline_keyboard.flat().every(button=>!button.web_app));
    await send('/paysupport'); await send('Не открывается мини-апп');
    assert.equal((await store.listTickets()).length, 1);
    await send('/status');
    assert.match(calls.filter(call=>call.method==='sendMessage').at(-1).data.text, /ещё не подключён/);
  } finally { Telegram.prototype.callApi = original; }
});
