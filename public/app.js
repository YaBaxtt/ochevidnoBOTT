import { icon, cardIcons } from './icons.js';
import { adminPage, loadAdmin, adminClick, adminSubmit, filterReports } from './admin.js?v=6';
import { certificateSvg, downloadCertificate, certificateSample, recipientPreview } from './certificate.js?v=5';
import { normaliseRecipient } from './visual-utils.js?v=2';
import { resultCardSvg, sampleResult, sampleResultCard } from './result-visuals.js?v=1';
import { artImage, artworkSlug } from './art.js?v=3';
import { BRAND } from './brand.js?v=2';

const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const toastRoot = document.querySelector('#toast-root');
const telegram = window.Telegram?.WebApp;
const requestedTab = new URLSearchParams(location.search).get('tab') || new URLSearchParams(telegram?.initData || '').get('start_param');
const state = { view: ['home','profile','tasks','top','collection','premium','bundles','admin'].includes(requestedTab) ? requestedTab : 'home', data: null, category:'all', search:'', adminTab:'overview', wallet:null, balance:null, walletError:'' };
let displayedDocument;
let displayedAward;
let awardZoom=1;
let modalOpener;
try { document.body.classList.toggle('reduce-motion',localStorage.getItem('obvious.reduce-motion')==='1'); } catch {}
let tonUI;
let toastTimer;
let entryShown = false;
let savedFavorites = [];
try { savedFavorites = JSON.parse(localStorage.getItem('obvious.favorites') || '[]'); } catch {}
const favorites = new Set(Array.isArray(savedFavorites) ? savedFavorites : []);
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
const fmt = (value) => Number(value || 0).toLocaleString('ru-RU');
const isDemo = () => state.data?.mode === 'demo';
const stars = (n) => `<span class="star-amount">${icon('star')}${fmt(n)}</span>`;
const button = (label, action, style='primary') => `<button class="${style}" data-action="${action}">${label}</button>`;
const section = (title, suffix='') => `<div class="section-head"><h2>${title}</h2>${suffix}</div>`;
const ctx = { state, api, esc, icon, button, section, toast, showModal, closeModal, refresh, showEntryAd, render };

telegram?.ready(); telegram?.expand();
if (telegram?.isVersionAtLeast?.('6.1')) { telegram.setHeaderColor('#090a10'); telegram.setBackgroundColor('#090a10'); }
async function api(url, options={}) {
  const headers = {'Content-Type':'application/json', ...(telegram?.initData ? {'X-Telegram-Init-Data':telegram.initData} : {'X-Demo-User':'900000001'}), ...options.headers};
  const response = await fetch(url, {...options,headers});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос. Попробуйте ещё раз.');
  return data;
}
function toast(message,error=false) { clearTimeout(toastTimer); toastRoot.innerHTML=`<div class="toast ${error?'error':''}">${esc(message)}</div>`; toastTimer=setTimeout(()=>toastRoot.replaceChildren(),4000); }
async function refresh(renderPage=true) { state.data=await api('/api/bootstrap'); if(state.view==='admin'&&!state.data.isAdmin)state.view='profile'; if(renderPage) render(); }
async function load() {
  try { await refresh(); initWallet(); if(!entryShown && state.data.entryAd) { entryShown=true; showEntryAd(state.data.entryAd); } }
  catch(error) {
    let botUrl;
    if (!telegram?.initData) {
      try { botUrl = (await fetch('/api/app-info').then(response => response.json())).botUrl; } catch {}
    }
    const safeBotUrl = typeof botUrl === 'string' && /^https:\/\/t\.me\/[a-z0-9_]+$/i.test(botUrl) ? botUrl : null;
    app.innerHTML=`<div class="splash"><img class="brand-mark" src="${BRAND.smallAvatar}" alt="Очевидно"><h2>${safeBotUrl?'Продолжим в Telegram':'Открой «Очевидно»'}</h2><p>${esc(safeBotUrl?'Это мини-апп Telegram. Перейди в бота, отправь /start и нажми зелёную кнопку «Открыть».':error.message)}</p>${safeBotUrl?`<a class="primary" href="${esc(safeBotUrl)}" rel="noopener noreferrer">Открыть бота</a>`:''}${button('Повторить','retry','secondary')}</div>`;
  }
}
function avatar(p,large=false) { return p.photoUrl?`<img class="avatar ${large?'large':''}" src="${esc(p.photoUrl)}" alt="Аватар" referrerpolicy="no-referrer">`:`<span class="avatar ${large?'large':''}">${esc(p.firstName[0])}</span>`; }
function topbar() {
  return `<header class="topbar"><button class="wordmark" data-view="home"><img class="mini-mark" src="${BRAND.smallAvatar}" alt="">очевидно</button><div class="header-actions"><button class="balance-pill" data-action="wallet">${icon('ton')}<span>${state.balance?`${esc(state.balance.balance)} Gram`:'Gram'}</span><b>${state.wallet?'·':'+'}</b></button>${state.data.isAdmin?`<button class="icon-button" data-view="admin" aria-label="Админка">${icon('gear')}</button>`:`<button class="profile-button" data-view="profile" aria-label="Профиль">${avatar(state.data.profile)}</button>`}</div></header>${isDemo()?'<div class="demo-label"><span></span>Предпросмотр · реальные Stars не списываются</div>':''}${state.data.sales?.paused?'<div class="sales-notice">Продажи на паузе. Твоя коллекция доступна.</div>':''}`;
}
function nav() { return `<nav class="nav">${[['home','home','Главная'],['tasks','tasks','Задания'],['top','trophy','Топ'],['profile','user','Профиль']].map(([v,g,l])=>`<button data-view="${v}" class="${state.view===v||v==='profile'&&state.view==='collection'?'active':''}">${icon(g)}<span>${l}</span></button>`).join('')}</nav>`; }
function category(card) { return card.kind==='bundle'?'bundles':card.premium?'premium':card.kind==='certificate'&&card.id!=='flashlight'?'documents':['birth-year','age-minus-ten','hundredth-year','sum-two','older-today','mondays','days-alive'].includes(card.id)?'math':'you'; }
function cardMarkup(card,featured=false) {
  const art=artworkSlug(card.id);
  return `<article class="fun-card illustrated ${featured?'featured':''} ${card.premium?'premium-card':''} ${card.kind==='certificate'?'document-card':''}" data-accent="${esc(card.accent)}" data-art="${art}"><button class="card-hit" data-card="${card.id}" aria-label="${esc(card.title)} — ${card.priceStars} Stars"><span class="card-visual">${artImage(art,{className:'card-cover',eager:featured})}</span><div class="card-meta"><span class="badge">${esc(card.category)}</span></div><div class="card-copy"><h3>${esc(card.title)}</h3><p>${esc(card.subtitle)}</p></div><div class="card-bottom"><span class="price">${stars(card.priceStars)}<small>STARS</small></span><span class="card-buy">${card.id==='flashlight'?'Включить':card.kind==='bundle'?`${card.bundleItems.length} шт.`:'Открыть'} ${icon('arrow')}</span></div></button><button class="favorite ${favorites.has(card.id)?'selected':''}" data-favorite="${card.id}" aria-label="В избранное: ${esc(card.title)}">${icon('heart')}</button></article>`;
}
function catalogCards() {
  const cards=state.data.cards.filter((c)=>(state.category==='all'&&!c.premium||category(c)===state.category||state.category==='favorites'&&favorites.has(c.id))&&`${c.title} ${c.subtitle}`.toLowerCase().includes(state.search.toLowerCase()));
  return cards.length?cards.map((c,i)=>cardMarkup(c,i===0&&!state.search&&state.category==='all')).join(''):'<div class="empty full-grid">Ничего не нашли. Попробуй другое слово.</div>';
}
function renderHome() {
  const cards=state.data.cards.filter((c)=>c.id!=='flashlight'&&!c.premium&&c.kind!=='bundle');
  const daily=cards[Math.floor(Date.now()/86400000)%Math.max(1,cards.length)];
  return `<section class="hero illustrated-hero"><img class="hero-art" src="/assets/art-v3/hero-wide.webp" width="1440" height="960" alt="" fetchpriority="high" decoding="async"><div class="hero-top"><span class="eyebrow">СЕРЬЁЗНО О НЕСЕРЬЁЗНОМ</span><span class="edition">VOL. 03</span></div><h1>Ты и так знаешь.<br><span>Но проверь.</span></h1><p>Ответы, которые не удивят.<br>Грамоты, которые хочется сохранить.</p><button class="hero-cta" data-action="surprise">Удиви меня ${icon('arrow')}</button></section>
  <div class="quick-actions"><button data-view="collection">${icon('collection')}<span>Моя коллекция</span><b>${state.data.profile.cardCount}</b></button><button data-action="promo">${icon('gift')}<span>Ввести промокод</span>${icon('chevron')}</button></div>
  <div class="editorial-links"><button class="premium-entry art-entry" data-view="premium">${artImage('premium',{className:'entry-cover'})}<small>ЧАСТНАЯ КОЛЛЕКЦИЯ</small><b>Для богатых.</b><span>Дорогая шутка. От 100 Stars.</span>${icon('arrow')}</button><button class="bundle-entry art-entry" data-view="bundles">${artImage('bundles',{className:'entry-cover'})}<small>В ОДНОЙ ПАПКЕ</small><b>Наборы грамот</b><span>Несколько поводов гордиться.</span>${icon('arrow')}</button></div>
  ${daily?`<button class="daily-pick" data-card="${daily.id}"><span class="daily-icon art-thumb">${artImage(artworkSlug(daily.id),{sizes:'40px'})}</span><span><small>ВЫБОР ДНЯ</small><b>${esc(daily.title)}</b></span>${stars(daily.priceStars)}${icon('chevron')}</button>`:''}
  ${section('Каталог',`<span>${state.data.cards.length} поводов проверить</span>`)}<div class="catalog-tools"><label class="search">${icon('search')}<input id="search" type="search" placeholder="Найти что-нибудь очевидное" value="${esc(state.search)}" aria-label="Поиск карточек"></label><div class="category-tabs">${[['all','Все'],['math','Вычислить'],['you','Про тебя'],['documents','Грамоты'],['bundles','Наборы'],['favorites','Избранное']].map(([k,l])=>`<button data-category="${k}" class="${state.category===k?'active':''}">${l}</button>`).join('')}</div></div><section class="card-grid" id="catalog">${catalogCards()}</section>
  <button class="sample-entry" data-action="sample"><span>${icon('document')}</span><span><b>Бумага всё стерпит.</b><small>Образцы карточек и грамот · бесплатно</small></span>${icon('arrow')}</button><div class="footer-note">${icon('spark')}<p>Покупаешь настроение.<br>И красивое подтверждение своей догадки.</p></div><button class="legal-link" data-action="terms">Правила и условия покупки ${icon('arrow')}</button>`;
}
function renderSpecial(kind) {
  const premium=kind==='premium',cards=state.data.cards.filter(c=>premium?c.premium:c.kind==='bundle');
  return `<button class="back-link" data-view="home">← Главная</button><div class="page-title special-title ${premium?'premium-title':''}">${artImage(premium?'premium':'bundles',{className:'special-title-art',eager:true})}<span class="eyebrow">${premium?'ЧАСТНАЯ КОЛЛЕКЦИЯ':'СОБРАНО В ОДНУ ПАПКУ'}</span><h1>${premium?'Для богатых.':'Всё официально.<br>И сразу.'}</h1><p>${premium?'100, 150, 200, 500 и 1000 Stars. Только красивая именная шутка — без призов, доходности и скрытых преимуществ.':'Несколько именных документов за одну оплату. Каждый останется в коллекции и скачивается отдельно.'}</p></div><button class="sample-section-link" data-sample-kind="${premium?'premium':'bundle'}">${icon('document')} Образец ${premium?'частной коллекции':'грамоты из набора'} ${icon('arrow')}</button><section class="card-grid special-grid">${cards.map(c=>cardMarkup(c,c.kind==='bundle')).join('')}</section><button class="legal-link" data-action="terms">Условия покупки →</button>`;
}
function renderTasks() {
  return `<div class="page-title"><span class="eyebrow">ПРОВЕРИЛИ — НАЧИСЛИЛИ</span><h1>Маленькие дела.<br>Новые карточки.</h1><p>Выполняй задания, забирай бонусы и трать их на карточки. 1 бонус = 1 единица цены.</p></div><div class="bonus-panel">${icon('gift')}<span>Твои бонусы<b>${fmt(state.data.profile.bonusBalance)}</b></span><button class="small-button" data-view="home">Потратить ${icon('arrow')}</button></div>${section('Доступные задания',`<span>${state.data.tasks.length}</span>`)}<div class="task-list">${state.data.tasks.length?state.data.tasks.map((t)=>`<article class="task"><span class="task-icon">${icon('chat')}</span><div><h3>${esc(t.title)}</h3><p>${esc(t.subtitle)}</p></div><b class="reward">+${t.rewardPoints}</b><div class="task-actions"><button class="secondary" data-open-link="${esc(t.targetUrl)}">Выполнить ${icon('arrow')}</button><button class="primary" data-claim-task="${t.id}">Проверить</button></div></article>`).join(''):`<div class="empty">${icon('tasks')}<h3>Пока можно выдохнуть</h3><p>Задания появятся здесь, когда администратор добавит и проверит каналы.</p><button class="secondary" data-view="home">Посмотреть карточки</button></div>`}</div><p class="muted-note">Бонусы используются внутри приложения. Они не конвертируются в Stars или Gram.</p>`;
}
function renderTop() {
  const l=state.data.leaderboard;
  return `<div class="page-title"><span class="eyebrow">ОБЩЕСТВЕННЫЙ ИНТЕРЕС</span><h1>Самое<br>очевидное.</h1><p>Топ карточек по открытиям.</p></div><div class="top-total">${icon('trophy')}<b>${fmt(l.completedCards)}</b><span>карточек открыто</span></div>${section('Выбор пользователей')}<div class="ranking">${l.cards.length?l.cards.map((c,i)=>`<button class="rank-row" data-card="${c.id}"><b class="rank">0${i+1}</b><span>${esc(c.title)}<small>${fmt(c.purchases)} открытий</small></span>${icon('arrow')}</button>`).join(''):`<div class="empty">${icon('trophy')}<h3>Первое место свободно</h3><p>Открой карточку — и положи начало рейтингу.</p><button class="primary" data-view="home">Выбрать карточку</button></div>`}</div>`;
}
function walletCard() {
  const connected=Boolean(state.wallet),address=state.balance?.address||state.wallet?.account.address||'';
  return `<section class="wallet-card"><div class="wallet-heading"><span class="ton-logo">${icon('ton')}</span><span>Gram · кошелёк<small>${connected?esc(`${address.slice(0,6)}…${address.slice(-6)}`):'Подключи свой кошелёк'}</small></span><span class="network-dot ${connected?'connected':''}"></span></div><div class="wallet-amount">${connected&&state.balance?esc(state.balance.balance):'—'} <span>GRAM</span></div><p>${state.walletError?esc(state.walletError):connected?state.wallet.account.chain==='-3'?'Testnet · тестовые монеты Gram':'Баланс Gram в твоём кошельке · сеть TON':'Подключение через TON Connect. Средства остаются в твоём кошельке.'}</p><div class="wallet-actions">${button(connected?'Обновить баланс':'Подключить кошелёк',connected?'refresh-wallet':'connect-wallet')}${connected?button('Отключить','disconnect-wallet','secondary'):''}</div><small>Подключение не начисляет монеты. Здесь только просмотр баланса; карточки оплачиваются Telegram Stars.</small></section>`;
}
function renderProfile() {
  const p=state.data.profile;
  return `<section class="profile-head"><div class="profile-cover"><span>MEMBER OF THE OBVIOUS CLUB</span></div>${avatar(p,true)}<h1>${esc(p.firstName)}</h1><p>${p.username?`@${esc(p.username)}`:'В клубе очевидных открытий'}</p></section><div class="profile-stats"><div><b>${fmt(p.cardCount)}</b><span>В коллекции</span></div><div><b>${fmt(p.starsSpent)} <i>★</i></b><span>Потрачено Stars</span></div><div><b>${fmt(p.bonusBalance)}</b><span>Бонусов</span></div></div>${walletCard()}${section('Твоё пространство')}<div class="settings-list"><button class="setting" data-view="collection">${icon('collection')}<span>Моя коллекция<small>Результаты и история покупок</small></span>${icon('chevron')}</button><button class="setting" data-action="favorites">${icon('heart')}<span>Избранное<small>${favorites.size} карточек на потом</small></span>${icon('chevron')}</button><button class="setting" data-action="notifications">${icon('bell')}<span>Рекламные сообщения<small>${p.notifications?'Включены · нажми, чтобы отключить':'Отключены · нажми, чтобы включить'}</small></span><span class="toggle ${p.notifications?'on':''}"></span></button><button class="setting" data-action="support">${icon('chat')}<span>Помощь по оплате<small>Обращение с номером заявки</small></span>${icon('chevron')}</button><button class="setting" data-action="terms">${icon('document')}<span>Правила и конфиденциальность</span>${icon('chevron')}</button>${state.data.isAdmin?`<button class="setting" data-view="admin">${icon('gear')}<span>Админ-панель<small>Цены, реклама, бот и статистика</small></span>${icon('chevron')}</button>`:''}</div>`;
}
function renderCollection() {
  const purchases=state.data.purchases;
  return `<button class="back-link" data-view="profile">← Профиль</button><div class="page-title"><span class="eyebrow">СОХРАНЯЕМ ОТКРЫТИЯ</span><h1>Моя коллекция.</h1><p>Карточки можно открыть снова. Повторно платить не нужно.</p></div><div class="collection-list">${purchases.length?purchases.map((p)=>`<button class="collection-row" data-purchase="${p.id}"><span class="collection-icon">${icon(cardIcons[p.cardId])}</span><span><b>${esc(p.title||state.data.cards.find((c)=>c.id===p.cardId)?.title||'Карточка')}</b><small>${new Date(p.createdAt).toLocaleDateString('ru-RU')} · ${p.state==='paid'?p.paymentMethod==='free'?'Бесплатное открытие':p.paymentMethod==='voucher'?'По промокоду':p.paymentMethod==='bonus'?'Бонусы':`${p.amount} Stars`:p.state==='pending'?'Ожидает оплаты':'Возвращено'}</small></span>${icon(p.state==='paid'?'chevron':'clock')}</button>`).join(''):`<div class="empty">${icon('collection')}<h3>Место для будущих открытий</h3><p>Первая карточка уже ждёт в каталоге.</p><button class="primary" data-view="home">Открыть каталог</button></div>`}</div>`;
}
function render() {
  if(!state.data) return;
  const views={home:renderHome,tasks:renderTasks,top:renderTop,profile:()=>renderProfile()+extraSettings(),collection:renderCollection,premium:()=>renderSpecial('premium'),bundles:()=>renderSpecial('bundles'),admin:()=>adminPage(ctx)};
  app.innerHTML=`<div class="page">${topbar()}${(views[state.view]||renderHome)()}</div>${nav()}`;
  if(state.view==='admin') loadAdmin(ctx);
}
function navigate(view) { if(view==='admin'&&!state.data.isAdmin) return; state.view=view; closeModal(); render(); window.scrollTo({top:0,behavior:'instant'}); }
function showModal(html) { if(!document.body.classList.contains('modal-open'))modalOpener=document.activeElement;modalRoot.innerHTML=`<div class="modal-backdrop"><section class="sheet" role="dialog" aria-modal="true" tabindex="-1"><div class="drag"></div><button class="close" data-action="close" aria-label="Закрыть">${icon('close')}</button>${html}</section></div>`;document.body.classList.add('modal-open');app.inert=true;modalRoot.querySelector('.sheet').focus({preventScroll:true}); }
function closeModal() { modalRoot.replaceChildren(); document.body.classList.remove('modal-open');app.inert=false;if(modalOpener?.isConnected)modalOpener.focus({preventScroll:true});modalOpener=null; }
function agreement() { return '<label class="agree"><input name="termsAccepted" type="checkbox" required><span>Я прочитал <a href="/api/terms" target="_blank" rel="noreferrer">правила</a> и понимаю, что покупаю развлекательную карточку.</span></label>'; }
function extraSettings(){return `${state.data.freeOpenings?`<section class="free-opening-card spaced">${icon('gift')}<span>Бесплатные открытия<b>${fmt(state.data.freeOpenings)} в запасе</b><small>Любая карточка или набор · без Stars</small></span><button class="secondary" data-view="home">Выбрать</button></section>`:''}<div class="settings-list spaced"><button class="setting" data-action="promo">${icon('gift')}<span>Промокод<small>Бонусы или карточка в подарок</small></span>${icon('chevron')}</button><button class="setting" data-action="sample">${icon('document')}<span>Образцы<small>Карточка, грамоты и частная коллекция</small></span>${icon('chevron')}</button><button class="setting" data-action="inline-collection">${icon('chat')}<span>Отправить из любого чата<small>Как открыть покупки через @${esc(state.data.botUsername||'бота')}</small></span>${icon('chevron')}</button><button class="setting" data-action="my-tickets">${icon('chat')}<span>Мои обращения<small>Проверить статус заявки</small></span>${icon('chevron')}</button><button class="setting" data-action="motion">${icon('spark')}<span>Уменьшить движение<small>Спокойное появление без эффектов</small></span><span class="toggle ${document.body.classList.contains('reduce-motion')?'on':''}"></span></button></div>`;}
function openCard(id,flashlightConfirm=false) {
  const card=state.data.cards.find((c)=>c.id===id); if(!card) return toast('Карточка сейчас недоступна.',true);
  if(id==='flashlight'&&!flashlightConfirm) return openFlashlight(card);
  api(`/api/cards/${id}/view`,{method:'POST',body:'{}'}).catch(()=>{});
  const fields=card.fields.map((f)=>`<label>${esc(f.label)}<input name="${esc(f.key)}" type="${f.type==='number'?'number':'text'}" ${f.key==='name'?'autocomplete="name" autocapitalize="words" spellcheck="false"':''} ${f.type==='number'?'step="any"':''} ${f.min!==undefined?`min="${f.min}"`:''} ${f.max!==undefined?`max="${f.max}"`:''} ${f.maxLength?`maxlength="${f.maxLength}"`:''} placeholder="${esc(f.placeholder||'')}" required></label>`).join('');
  const bonusAvailable=state.data.profile.bonusBalance>=card.priceStars;
  const voucher=state.data.vouchers?.find(v=>v.cardId===id&&v.quantity>0);
  const freeOpenings=state.data.freeOpenings||0;
  const bundle=card.bundleItems?.length?`<div class="bundle-contents"><small>В НАБОРЕ · ${card.bundleItems.length} ДОКУМЕНТА</small>${card.bundleItems.map(i=>`<span>${icon('document')}${esc(state.data.cards.find(c=>c.id===i)?.title||i)}</span>`).join('')}</div>`:'';
  showModal(`<div class="checkout-visual">${artImage(artworkSlug(id),{eager:true,sizes:'180px'})}</div><span class="eyebrow">${esc(card.category)}</span><h2>${esc(card.title)}</h2><p>${esc(card.subtitle)}</p><div class="checkout-price">${stars(card.priceStars)}<small>ОБЫЧНАЯ ЦЕНА · TELEGRAM STARS</small></div>${bundle}<button class="sample-link" data-sample-card="${id}">Посмотреть образец ↗</button><form class="form" id="card-form" data-id="${id}" data-request-id="${crypto.randomUUID()}">${fields}<div class="payment-options">${freeOpenings?`<label class="free-payment-option"><input type="radio" name="paymentMethod" value="free" checked><span>Бесплатное открытие<small>Осталось: ${fmt(freeOpenings)} · потратится 1</small></span><b>Без Stars</b></label>`:''}${voucher?`<label><input type="radio" name="paymentMethod" value="voucher" ${freeOpenings?'':'checked'}><span>По промокоду<small>Доступно: ${voucher.quantity}</small></span><b>Бесплатно</b></label>`:''}<label><input type="radio" name="paymentMethod" value="stars" ${voucher||freeOpenings?'':'checked'}><span>Telegram Stars</span>${stars(card.priceStars)}</label><label class="${bonusAvailable?'':'unavailable'}"><input type="radio" name="paymentMethod" value="bonus" ${bonusAvailable?'':'disabled'}><span>Бонусами<small>На счёте: ${state.data.profile.bonusBalance}</small></span><b>${card.priceStars}</b></label></div>${agreement()}<button class="primary full" type="submit" ${state.data.sales?.paused?'disabled':''}></button></form><div class="payment-note" id="checkout-note"></div>`);
  updateCheckoutMethod();
  if(card.fields.some(field=>field.key==='name')&&['certificate','bundle'].includes(card.kind)) {
    const preview=document.createElement('details');preview.id='recipient-preview';preview.className='recipient-preview';
    preview.innerHTML='<summary>Проверить имя на грамоте <span id="recipient-preview-name"></span></summary><p>Только образец оформления. Персональный результат по-прежнему открывается после покупки.</p><div id="recipient-preview-document" class="certificate-wrap"></div>';
    document.querySelector('#card-form .payment-options').before(preview);
    updateRecipientPreview();
  }
}
function updateRecipientPreview() {
  const details=document.querySelector('#recipient-preview'),form=document.querySelector('#card-form');if(!details||!form)return;
  const input=form.querySelector('[name="name"]'),card=state.data.cards.find(c=>c.id===form.dataset.id);
  const recipient=normaliseRecipient(input?.value)||'Фамилия Имя';
  details.querySelector('#recipient-preview-name').textContent=recipient;
  if(details.open)details.querySelector('#recipient-preview-document').innerHTML=certificateSvg(recipientPreview(card,recipient,state.data.botUsername),true);
}
function updateCheckoutMethod() {
  const form=document.querySelector('#card-form');if(!form)return;
  const method=form.querySelector('[name="paymentMethod"]:checked')?.value;
  form.querySelector('[type="submit"]').textContent=state.data.sales?.paused?'Продажи на паузе':method==='free'||method==='voucher'?'Открыть бесплатно':method==='bonus'?'Открыть за бонусы':'К оплате →';
  document.querySelector('#checkout-note').textContent=method==='free'?'Одна попытка за карточку или набор. Stars не списываются.':method==='voucher'?'Открытие по промокоду. Stars не списываются.':method==='bonus'?'Списываются только внутренние бонусы.':isDemo()?'Предпросмотр: дальше — тестовый счёт.':'Результат откроется после подтверждения оплаты.';
}
async function checkout(card,answers,termsAccepted,paymentMethod,requestId) {
  const submit=modalRoot.querySelector('[type="submit"]'); if(submit) {submit.disabled=true;submit.textContent=paymentMethod==='free'?'Открываем карточку…':'Готовим счёт…';}
  try {
    const r=await api(`/api/cards/${card.id}/checkout`,{method:'POST',body:JSON.stringify({answers,termsAccepted,paymentMethod,requestId,expectedPriceStars:card.priceStars})});
    if(['bonus','voucher','free'].includes(r.mode)) {await refresh();return showResult(r.purchase);}
    if(r.mode==='demo') return showDemoInvoice(r);
    if(!telegram?.initData) throw new Error('Для оплаты открой приложение внутри Telegram.');
    telegram.openInvoice(r.invoiceLink,(status)=>{if(status==='paid'||status==='pending') verifyPayment(r.purchaseId);else {if(submit?.isConnected) {submit.disabled=false;submit.textContent='К оплате →';} toast(status==='cancelled'?'Оплата отменена. Деньги не списаны.':'Оплата не завершилась. Попробуй снова.');}});
  } catch(error) {toast(error.message,true);if(error.message.startsWith('Цена изменилась.')){await refresh(false);return openCard(card.id,card.id==='flashlight');}if(submit?.isConnected){submit.disabled=false;updateCheckoutMethod();}}
}
function showDemoInvoice(r) { showModal(`<div class="invoice-symbol">${icon('star')}</div><span class="eyebrow">ТЕСТОВЫЙ СЧЁТ</span><h2>Подтвердить покупку?</h2><p>${esc(r.title)}</p><div class="invoice-amount">${stars(r.purchase.amount)}</div><div class="demo-explanation">Это предпросмотр. Реальные Stars не списываются. В Telegram здесь откроется платёжное окно.</div><button class="primary full" data-demo-confirm="${r.purchase.id}">Подтвердить тестовую оплату</button><button class="text-button full" data-action="close">Отмена</button>`); }
async function verifyPayment(id,manual=false) {
  try {
    for(let i=0;i<(manual?1:10);i++){const {purchase}=await api(`/api/purchases/${id}`);if(purchase.state==='paid'){await refresh();return showResult(purchase);}if(purchase.state!=='pending')throw new Error('Покупка закрыта. Посмотри статус в коллекции.');if(!manual)await new Promise((r)=>setTimeout(r,1000));}
    showModal(`<div class="sheet-card-icon">${icon('clock')}</div><h2>Ждём Telegram</h2><p>Результат появится после подтверждения платежа. Повторно оплачивать не нужно.</p><button class="primary full" data-check-purchase="${id}">Проверить статус</button><button class="text-button full" data-view="collection">В коллекцию</button>`);
  } catch(error){toast(error.message,true);}
}
function showResult(p,itemIndex=null) {
  if(p.state!=='paid'||!p.result)return verifyPayment(p.id,true);const r=p.result;
  displayedDocument=r.kind==='certificate'?{purchaseId:p.id,itemIndex}:null;
  const presented={...r,botUsername:state.data.botUsername,collectionStyle:r.rank==='Частная коллекция'?'premium':itemIndex!==null?'bundle':'standard'};
  displayedAward=r.kind==='certificate'?presented:null;
  const result=r.kind==='certificate'
    ? `<button class="certificate-wrap certificate-zoom" data-action="zoom-certificate" aria-label="Увеличить грамоту">${certificateSvg(presented)}<span>Увеличить ↗</span></button><button class="secondary full spaced" data-action="download-certificate">Скачать грамоту · SVG ${icon('arrow')}</button>${!isDemo()?`<button class="text-button full" data-send-document="${p.id}" data-item-index="${itemIndex??''}">Получить файлом в боте</button>`:''}<p class="muted-note">SVG — для печати. JPEG — чтобы сохранить на телефон или отправить другу.</p>`
    : r.kind==='bundle'
      ? `<div class="bundle-issued"><span class="eyebrow">КОМПЛЕКТ ВЫДАН</span><h2>${esc(r.headline)}</h2><p>${esc(r.detail)}</p>${r.items.map((item,i)=>`<button class="collection-row" data-bundle-purchase="${p.id}" data-bundle-index="${i}"><span class="collection-icon">${icon('document')}</span><span><b>${esc(item.title)}</b><small>Именной документ · открыть и скачать</small></span>${icon('chevron')}</button>`).join('')}</div>`
      : `<div class="result-image-wrap">${resultCardSvg({result:r,card:state.data.cards.find(card=>card.id===p.cardId),firstName:state.data.profile.firstName,botUsername:state.data.botUsername})}</div>`;
  showModal(`<div class="reveal-shell"><div class="reveal-curtain"><img src="${BRAND.smallAvatar}" alt=""><span>${r.kind==='certificate'?'ДОКУМЕНТ ЗАВЕРЕН':'ОЧЕВИДНО. ГОТОВО.'}</span><i></i></div><div class="reveal-content">${result}<div class="result-actions"><button class="secondary" data-view="collection">В коллекцию</button><button class="primary" data-share="${p.id}" data-share-index="${itemIndex??''}">Отправить фото ${icon('arrow')}</button></div><button class="text-button full" data-download-share="${p.id}" data-share-index="${itemIndex??''}">Сохранить картинкой · JPEG</button>${p.paymentMethod==='free'?'<p class="muted-note">Бесплатное открытие · Stars не списаны</p>':''}<p class="purchase-id">Заказ: ${esc(p.id)}</p></div></div>`);if(telegram?.isVersionAtLeast?.('6.1'))telegram.HapticFeedback?.notificationOccurred?.('success');
}
function zoomCertificate() {
  if(!displayedAward||!displayedDocument)return;
  awardZoom=1;
  showModal(`<div class="award-viewer-heading"><span class="eyebrow">ГРАМОТА · КРУПНЫМ ПЛАНОМ</span><button class="text-button" data-action="back-certificate">← К результату</button></div><div class="award-zoom-tools"><button class="secondary" data-award-zoom="out" aria-label="Уменьшить">−</button><span id="award-zoom-value" aria-live="polite">100%</span><button class="secondary" data-award-zoom="in" aria-label="Увеличить">+</button></div><div class="award-stage"><div id="award-stage-content">${certificateSvg(displayedAward)}</div></div><p class="muted-note">Увеличивай кнопками и прокручивай документ. Это вектор: буквы остаются чёткими.</p>`);
  modalRoot.querySelector('.sheet').classList.add('award-viewer');
}
async function backToCertificate() {
  if(!displayedDocument)return;
  const {purchaseId,itemIndex}=displayedDocument,{purchase}=await api(`/api/purchases/${purchaseId}`);
  if(itemIndex!==null&&purchase.result?.items?.[itemIndex]){
    const item=purchase.result.items[itemIndex];return showResult({...purchase,cardId:item.cardId,result:item.result},itemIndex);
  }
  return showResult(purchase);
}
function changeAwardZoom(direction) {
  const stage=document.querySelector('.award-stage'),content=document.querySelector('#award-stage-content');if(!stage||!content)return;
  const previous=awardZoom;awardZoom=Math.max(1,Math.min(3,awardZoom+(direction==='in'?0.5:-0.5)));
  const ratio=awardZoom/previous,left=(stage.scrollLeft+stage.clientWidth/2)*ratio-stage.clientWidth/2,top=(stage.scrollTop+stage.clientHeight/2)*ratio-stage.clientHeight/2;
  content.style.width=`${awardZoom*100}%`;stage.scrollLeft=left;stage.scrollTop=top;
  document.querySelector('#award-zoom-value').textContent=`${Math.round(awardZoom*100)}%`;
}
async function saveDocument(target) {
  const document={...displayedDocument};if(!document.purchaseId)return;
  target.disabled=true;
  try {
    const file=await api(`/api/purchases/${document.purchaseId}/document-link`,{method:'POST',body:JSON.stringify({itemIndex:document.itemIndex})});
    const url=new URL(file.path,location.origin).href;
    let opened=false;
    try{opened=downloadCertificate({url,fileName:file.fileName,telegram,onStatus:toast});}catch{}
    if(!opened)showModal(`<span class="eyebrow">ГРАМОТА · SVG</span><h2>Сохраним через бота.</h2><p>Эта версия Telegram не поддерживает загрузку из мини-аппа. Получи грамоту обычным файлом в личном чате с ботом.</p><button class="primary full" data-send-document="${document.purchaseId}" data-item-index="${document.itemIndex??''}">Отправить файл в бот</button><button class="secondary full spaced" data-open-link="${esc(url)}">Открыть ссылку в браузере</button><p class="muted-note">Ссылка действует 5 минут. За скачивание повторно платить не нужно.</p>`);
  }finally{if(target.isConnected)target.disabled=false;}
}
async function sendDocument(target) {
  target.disabled=true;
  try {
    await api(`/api/purchases/${target.dataset.sendDocument}/document-send`,{method:'POST',body:JSON.stringify({itemIndex:target.dataset.itemIndex===''?null:Number(target.dataset.itemIndex)})});
    toast('Грамота отправлена в личный чат с ботом. Сохрани файл из сообщения.');
  }finally{if(target.isConnected)target.disabled=false;}
}
function showSample(cardId,kind) {
  const card=state.data.cards.find(c=>c.id===cardId);
  kind=kind||(card?.kind==='bundle'?'bundle':card?.premium?'premium':card?.kind==='certificate'?'standard':'result');
  const labels={result:'Карточка',standard:'Грамота',premium:'Для богатых',bundle:'Из набора'};
  const visual=kind==='result'?resultCardSvg({result:sampleResult,card:sampleResultCard,firstName:'Фамилия Имя',botUsername:state.data.botUsername,sample:true}):certificateSvg({...certificateSample(kind),botUsername:state.data.botUsername},true);
  showModal(`<span class="eyebrow">ОБРАЗЦЫ · БЕЗ ПОКУПКИ</span><h2>${kind==='premium'?'Частная коллекция.':kind==='result'?'Ответ — как открытка.':'Документ с характером.'}</h2><p>Пример оформления. Вместо «Фамилия Имя» будет твоё имя. Цифры и текст здесь демонстрационные, это не твой результат.</p><div class="sample-tabs">${Object.entries(labels).map(([k,label])=>`<button class="${kind===k?'active':''}" data-sample-kind="${k}" data-return-card="${cardId||''}">${label}</button>`).join('')}</div><div class="${kind==='result'?'result-image-wrap':'certificate-wrap'} sample-certificate">${visual}</div><button class="primary full spaced" ${cardId?`data-card="${cardId}"`:'data-action="close"'}>${cardId?'Вернуться к карточке':'Понятно'}</button>`);
}
const shareSpec=target=>({purchaseId:target.dataset.share||target.dataset.sendShare||target.dataset.downloadShare,itemIndex:target.dataset.shareIndex===''?null:Number(target.dataset.shareIndex)});
async function shareImageInfo(spec){return api(`/api/purchases/${spec.purchaseId}/share-image`,{method:'POST',body:JSON.stringify({itemIndex:spec.itemIndex})});}
function showShareOptions(spec,image) {
  showModal(`<span class="eyebrow">ОТПРАВЛЯЕМ КАРТИНКУ</span><h2>Не просто ссылка.</h2><p>Фото с именем, результатом и подписью «Очевидно». Username покупателя не добавляем.</p><img class="share-preview" src="${esc(image.path)}" alt="Предпросмотр своей карточки">${!isDemo()?`<button class="primary full spaced" data-send-share="${spec.purchaseId}" data-share-index="${spec.itemIndex??''}">Получить фото в боте</button>`:''}<button class="secondary full spaced" data-download-share="${spec.purchaseId}" data-share-index="${spec.itemIndex??''}">Скачать JPEG</button>${telegram?.switchInlineQuery?`<button class="text-button full" data-inline-share="${esc(image.selector)}">Выбрать чат через inline-поиск</button>`:''}<p class="muted-note">Из личного чата фото можно переслать кому угодно. Без повторной покупки.</p>`);
}
async function shareResult(target) {
  const spec=shareSpec(target);target.disabled=true;
  try {
    const image=await shareImageInfo(spec);
    if(!isDemo()&&telegram?.initData&&telegram.shareMessage&&telegram.isVersionAtLeast?.('8.0')) {
      try {
        const prepared=await api(`/api/purchases/${spec.purchaseId}/share-prepare`,{method:'POST',body:JSON.stringify({itemIndex:spec.itemIndex})});
        telegram.shareMessage(prepared.messageId,sent=>toast(sent?'Картинка отправлена.':'Отправка отменена. Карточка осталась в коллекции.'));return;
      }catch(error){toast(error.message,true);}
    }
    showShareOptions(spec,image);
  }finally{if(target.isConnected)target.disabled=false;}
}
async function downloadShareImage(target) {
  const spec=shareSpec(target);target.disabled=true;
  try {
    const image=await shareImageInfo(spec),url=new URL(image.path+'?download=1',location.origin).href;
    let opened=false;try{opened=downloadCertificate({url,fileName:image.fileName,telegram,onStatus:toast});}catch{}
    if(!opened){showShareOptions(spec,image);toast('Этот клиент не поддерживает скачивание. Получи фото в личном чате с ботом.');}
  }finally{if(target.isConnected)target.disabled=false;}
}
async function sendShareImage(target) {
  const spec=shareSpec(target);target.disabled=true;
  try{await api(`/api/purchases/${spec.purchaseId}/share-send`,{method:'POST',body:JSON.stringify({itemIndex:spec.itemIndex})});toast('Фото отправлено в личный чат с ботом. Теперь его можно переслать.');}
  finally{if(target.isConnected)target.disabled=false;}
}
function inlineCollection() {
  const name=state.data.botUsername||'obviously_bbot';
  showModal(`<span class="eyebrow">ТВОИ ПОКУПКИ В ЛЮБОМ ЧАТЕ</span><h2>@${esc(name)} + пробел</h2><p>Введи это в поле сообщения другу. Появятся твои выданные карточки и грамоты. Выбери картинку — и отправь. Чтобы найти нужную, допиши название.</p><p>Результаты поиска видишь только ты. Друг получит лишь выбранную тобой картинку с именем, ответом и кнопкой проекта.</p>${telegram?.switchInlineQuery?'<button class="primary full" data-inline-share="">Выбрать карточку и чат</button>':''}<button class="text-button full" data-view="collection">Моя коллекция</button>`);
}
function openPromo(){showModal(`<div class="sheet-card-icon">${icon('gift')}</div><h2>Есть свой код?</h2><p>Активируй бонусы на покупки или конкретную карточку.</p><form id="promo-form" class="form"><label>Промокод<input name="code" maxlength="40" pattern="[A-Za-z0-9_-]{3,40}" autocomplete="off" required placeholder="OCHEVIDNO"></label><button class="primary full">Активировать</button></form><p class="muted-note">Бонусы используются только на карточки. Это не выводимые Stars.</p>`);}
function openFlashlight(card) { modalOpener=document.activeElement;modalRoot.innerHTML=`<section class="flashlight" role="dialog" aria-modal="true" aria-label="Фонарик"><span class="eyebrow">СВЕТ В КОНЦЕ ПРИЛОЖЕНИЯ</span><div class="beam"></div><h2>Ну вот.<br>Теперь светло.</h2><p>Спокойно. Выключение бесплатное.</p><button class="primary full" data-action="close">Выключить фонарик</button><button class="text-button full" data-flash-card="${card.id}">Торжественно погасить · ${card.priceStars} ⭐</button></section>`;document.body.classList.add('modal-open');app.inert=true;modalRoot.querySelector('[data-action="close"]').focus({preventScroll:true}); }
function openLink(url) {if(/^https:\/\/t\.me\//i.test(url)&&telegram?.initData)telegram.openTelegramLink(url);else if(telegram?.initData)telegram.openLink(url);else window.open(url,'_blank','noopener,noreferrer');}
function showEntryAd(ad,preview=false) { showModal(`<span class="ad-label">${preview?'ПРЕДПРОСМОТР · ':''}РЕКЛАМА</span><div class="ad-art">${icon('megaphone')}</div><h2>${esc(ad.title)}</h2><p class="ad-body">${esc(ad.body)}</p>${ad.buttonUrl?`<button class="primary full" data-ad-click="${ad.id}" data-url="${esc(ad.buttonUrl)}" data-preview="${preview}">${esc(ad.buttonText)} ${icon('arrow')}</button>`:''}<button class="text-button full" data-action="close">Продолжить в приложении</button>`);if(!preview)api(`/api/ads/${ad.id}/event`,{method:'POST',body:JSON.stringify({event:'view'})}).catch(()=>{}); }
async function showTerms() {const content=await fetch('/api/terms').then((r)=>r.text());showModal(`<h2>Правила покупки</h2><p class="preline">${esc(content)}</p><a class="legal-link" href="/api/privacy" target="_blank">Конфиденциальность ↗</a>`);}
function openSupport() {showModal(`<div class="sheet-card-icon">${icon('chat')}</div><h2>Разберёмся.</h2><p>Опиши проблему. По оплате — добавь ID покупки из коллекции.</p><form class="form" id="support-form"><label>Сообщение<textarea name="message" rows="4" maxlength="1200" required placeholder="Что произошло?"></textarea></label><button class="primary full">Отправить обращение</button></form>`);}
function initWallet() {
  if(tonUI||!state.data.walletEnabled||!window.TON_CONNECT_UI)return;
  tonUI=new window.TON_CONNECT_UI.TonConnectUI({manifestUrl:`${location.origin}/tonconnect-manifest.json`,language:'ru',uiPreferences:{theme:'DARK'},analytics:{mode:'off'},...(state.data.botUrl?{actionsConfiguration:{twaReturnUrl:state.data.botUrl}}:{})});
  tonUI.onStatusChange(async(wallet)=>{state.wallet=wallet;state.balance=null;state.walletError='';if(wallet)await updateBalance();else render();});
}
async function updateBalance() {if(!state.wallet)return;const wallet=state.wallet;try{const balance=await api(`/api/wallet/balance?address=${encodeURIComponent(wallet.account.address)}&network=${wallet.account.chain}`);if(state.wallet===wallet){state.balance=balance;state.walletError='';}}catch(error){if(state.wallet===wallet)state.walletError=error.message;}render();}
function connectWallet() {if(!state.data.walletEnabled)return showModal(`<div class="sheet-card-icon ton-color">${icon('ton')}</div><h2>Gram · кошелёк</h2><p>Подключение через TON Connect готово. Кошелёк сможет подтвердить соединение после публикации приложения на HTTPS-адресе.</p><p>Локальный адрес 127.0.0.1 недоступен приложению кошелька. После подключения в профиле будут адрес и настоящий баланс Gram в сети TON. Само подключение не начисляет монеты.</p><button class="primary full" data-action="close">Понятно</button>`);initWallet();tonUI?.openModal().catch((error)=>toast(error.message,true));}

document.addEventListener('click',async(event)=>{
  const t=event.target.closest('button,[data-action]');if(!t){if(event.target.classList.contains('modal-backdrop'))closeModal();return;}if(t.disabled)return;
  try {
    if(t.dataset.view)return navigate(t.dataset.view);
    if(t.dataset.card)return openCard(t.dataset.card);
    if(t.dataset.flashCard)return openCard(t.dataset.flashCard,true);
    if(t.dataset.sampleCard)return showSample(t.dataset.sampleCard);
    if(t.dataset.sampleKind)return showSample(t.dataset.returnCard||undefined,t.dataset.sampleKind);
    if(t.dataset.inlineShare!==undefined){if(telegram?.switchInlineQuery&&telegram.isVersionAtLeast?.('6.7'))return telegram.switchInlineQuery(t.dataset.inlineShare,['users','groups','channels']);return toast(`Введи @${state.data.botUsername||'obviously_bbot'} и пробел в любом чате.`);}
    if(t.dataset.sendShare)return await sendShareImage(t);
    if(t.dataset.downloadShare)return await downloadShareImage(t);
    if(t.dataset.awardZoom)return changeAwardZoom(t.dataset.awardZoom);
    if(t.dataset.bundlePurchase){const {purchase}=await api(`/api/purchases/${t.dataset.bundlePurchase}`);const item=purchase.result?.items?.[Number(t.dataset.bundleIndex)];if(item)return showResult({...purchase,cardId:item.cardId,result:item.result},Number(t.dataset.bundleIndex));return;}
    if(t.dataset.sendDocument)return await sendDocument(t);
    if(t.dataset.favorite){const id=t.dataset.favorite;favorites.has(id)?favorites.delete(id):favorites.add(id);localStorage.setItem('obvious.favorites',JSON.stringify([...favorites]));return render();}
    if(t.dataset.category){state.category=t.dataset.category;return render();}
    if(t.dataset.demoConfirm){t.disabled=true;const {purchase}=await api(`/api/demo/purchases/${t.dataset.demoConfirm}/confirm`,{method:'POST',body:'{}'});await refresh();return showResult(purchase);}
    if(t.dataset.purchase||t.dataset.checkPurchase){const id=t.dataset.purchase||t.dataset.checkPurchase;const {purchase}=await api(`/api/purchases/${id}`);return purchase.state==='paid'?showResult(purchase):verifyPayment(id,true);}
    if(t.dataset.share)return await shareResult(t);
    if(t.dataset.openLink)return openLink(t.dataset.openLink);
    if(t.dataset.claimTask){t.disabled=true;const r=await api(`/api/tasks/${t.dataset.claimTask}/claim`,{method:'POST',body:'{}'});await refresh();return toast(r.message);}
    if(t.dataset.adClick){if(t.dataset.preview!=='true')await api(`/api/ads/${t.dataset.adClick}/event`,{method:'POST',body:JSON.stringify({event:'click'})});return openLink(t.dataset.url);}
    if(await adminClick(t,ctx))return;
    const a=t.dataset.action;
    if(a==='close')return closeModal();if(a==='retry')return load();if(a==='terms')return showTerms();if(a==='support')return openSupport();
    if(a==='sample')return showSample();if(a==='promo')return openPromo();if(a==='download-certificate'&&displayedDocument)return await saveDocument(t);
    if(a==='zoom-certificate')return zoomCertificate();if(a==='back-certificate')return await backToCertificate();
    if(a==='inline-collection')return inlineCollection();
    if(a==='motion'){document.body.classList.toggle('reduce-motion');localStorage.setItem('obvious.reduce-motion',document.body.classList.contains('reduce-motion')?'1':'0');return render();}
    if(a==='my-tickets'){const {tickets}=await api('/api/support/mine');return showModal(`<h2>Мои обращения</h2><div class="admin-list">${tickets.length?tickets.map(r=>`<article class="admin-card"><h3>№${esc(r.id.slice(0,8))} · ${r.state==='resolved'?'Решено':'В работе'}</h3><p>${esc(r.message)}</p></article>`).join(''):'<p>Обращений пока нет.</p>'}</div><button class="primary full spaced" data-action="support">Написать в поддержку</button>`);}
    if(a==='wallet')return navigate('profile');if(a==='connect-wallet')return connectWallet();if(a==='refresh-wallet')return updateBalance();if(a==='disconnect-wallet'){await tonUI.disconnect();return;}
    if(a==='notifications'){const r=await api('/api/profile/notifications',{method:'PATCH',body:JSON.stringify({enabled:!state.data.profile.notifications})});state.data.profile=r.profile;render();return toast(r.profile.notifications?'Сообщения включены.':'Рекламные сообщения отключены.');}
    if(a==='favorites'){state.category='favorites';return navigate('home');}
    if(a==='surprise'){const cards=state.data.cards.filter((c)=>c.id!=='flashlight'&&!c.premium);if(cards.length)return openCard(cards[Math.floor(Math.random()*cards.length)].id);}
  }catch(error){if(t.isConnected)t.disabled=false;toast(error.message,true);}
});
document.addEventListener('submit',async(event)=>{
  const form=event.target;if(!['card-form','support-form','task-form','card-edit-form','bot-form','ad-form','promo-form','admin-promo-form','placement-form','free-user-form','free-grant-form'].includes(form.id))return;
  event.preventDefault();const data=Object.fromEntries(new FormData(form));const submit=form.querySelector('[type="submit"],button');
  if(submit?.disabled)return;
  try {
    if(form.id==='card-form'){const card=state.data.cards.find((c)=>c.id===form.dataset.id);const {paymentMethod,termsAccepted,...answers}=data;if(answers.name!==undefined)answers.name=normaliseRecipient(answers.name);return await checkout(card,answers,termsAccepted==='on',paymentMethod,form.dataset.requestId);}
    submit.disabled=true;
    if(form.id==='promo-form'){const {reward}=await api('/api/promos/redeem',{method:'POST',body:JSON.stringify(data)});await refresh();closeModal();toast(reward.kind==='bonus'?`Начислено ${reward.bonus} бонусов на покупки.`:'Промокарточка доступна в каталоге.');if(reward.cardId)openCard(reward.cardId);return;}
    if(form.id==='support-form'){const {ticket}=await api('/api/support',{method:'POST',body:JSON.stringify(data)});closeModal();toast(`Обращение №${ticket.id.slice(0,8)} принято.`);return;}
    await adminSubmit(form,data,ctx);
  }catch(error){toast(error.message,true);}finally{if(submit?.isConnected)submit.disabled=false;}
});
document.addEventListener('input',(event)=>{if(event.target.name==='name'&&event.target.closest('#card-form'))updateRecipientPreview();if(event.target.id==='search'){state.search=event.target.value;document.querySelector('#catalog').innerHTML=catalogCards();}});
document.addEventListener('focusout',event=>{if(event.target.name==='name'&&event.target.closest('#card-form')){event.target.value=normaliseRecipient(event.target.value);updateRecipientPreview();}});
document.addEventListener('toggle',event=>{if(event.target.id==='recipient-preview')updateRecipientPreview();},true);
document.addEventListener('change',(event)=>{if(event.target.name==='paymentMethod'&&event.target.closest('#card-form'))updateCheckoutMethod();if(event.target.id==='report-group')filterReports(event.target.value,ctx);if(event.target.name==='audience'&&document.querySelector('#limit-field'))document.querySelector('#limit-field').hidden=event.target.value!=='limit';if(event.target.name==='kind'&&event.target.closest('#ad-form')){document.querySelector('#audience-fields').hidden=event.target.value==='entry';document.querySelector('#ad-kind-hint').textContent=event.target.value==='entry'?'Можно сразу закрыть. Не чаще одного показа человеку в день.':'Сначала сохраним черновик и покажем предпросмотр.';}});
document.addEventListener('keydown',(event)=>{if(event.key==='Escape')closeModal();if(event.key==='Tab'&&document.body.classList.contains('modal-open')){const items=[...modalRoot.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea,select')].filter(e=>e.getClientRects().length);const first=items[0],last=items.at(-1);if(!first)return;if(event.shiftKey&&(document.activeElement===first||!items.includes(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!items.includes(document.activeElement))){event.preventDefault();first.focus();}}});
load();
