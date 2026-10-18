import {escapeSvg,normaliseRecipient,svgText} from './visual-utils.js?v=2';

export function renderAward(r,sample=false) {
  const premium=r.collectionStyle==='premium'||r.premium||r.rank==='Частная коллекция';
  const bundle=!premium&&r.collectionStyle==='bundle';
  const ink='#202124',muted='#77736a',gold=premium?'#ad853e':'#ad965f',lightGold=premium?'#ddc58c':'#d7caa5';
  const sealInk=bundle?'#526477':'#8b774c';
  const recipient=normaliseRecipient(r.recipient)||'Фамилия Имя';
  const issued=new Date(r.issuedAt),date=Number.isFinite(issued.getTime())?issued.toLocaleDateString('ru-RU'):'—';
  const title=svgText(r.documentTitle,{x:400,y:353,width:620,size:26,minSize:21,maxLines:2,anchor:'middle',family:'PT Serif,Georgia,serif',fill:ink});
  const name=svgText(recipient,{x:400,y:526,width:648,size:70,minSize:42,maxLines:2,maxHeight:138,leading:1.12,anchor:'middle',family:'Marck Script,cursive',fill:'#232a35'});
  const citation=svgText(r.citation,{x:400,y:710,width:590,size:26,minSize:14,maxLines:9,maxHeight:166,leading:1.36,anchor:'middle',family:'PT Serif,Georgia,serif',fill:ink});
  const corners=[[39,39,0],[761,39,90],[761,1061,180],[39,1061,270]].map(([x,y,a])=>`<g transform="translate(${x} ${y}) rotate(${a})"><path d="M0 86V0H86 M8 65V8H65 M18 45V18H45"/><path d="M29 3C38 12 44 15 53 15 M3 29C12 38 15 44 15 53" stroke-width=".8"/></g>`).join('');
  const wreath=`<path d="M382 172C353 159 351 130 367 113 M418 172C447 159 449 130 433 113"/><path d="M363 144C350 139 351 130 352 127C362 129 368 134 363 144 M367 158C351 156 349 149 349 145C361 144 369 149 367 158 M437 144C450 139 449 130 448 127C438 129 432 134 437 144 M433 158C449 156 451 149 451 145C439 144 431 149 433 158"/>`;
  const beading=Array.from({length:48},(_,i)=>{const a=i*Math.PI/24;return `<circle cx="${400+Math.cos(a)*48}" cy="${934+Math.sin(a)*48}" r=".7"/>`;}).join('');
  return `<svg class="certificate-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1100" role="img" aria-label="Именная шуточная грамота: ${escapeSvg(r.documentTitle)}"><defs><linearGradient id="award-paper" x2="1" y2="1"><stop stop-color="#fffefa"/><stop offset="1" stop-color="#f8f5ed"/></linearGradient><linearGradient id="award-foil" x2="1" y2=".25"><stop stop-color="${gold}"/><stop offset=".46" stop-color="${lightGold}"/><stop offset="1" stop-color="${gold}"/></linearGradient></defs>
  <rect width="800" height="1100" fill="url(#award-paper)"/><rect x="20" y="20" width="760" height="1060" fill="none" stroke="url(#award-foil)" stroke-width="${premium?3:2}"/><rect x="29" y="29" width="742" height="1042" fill="none" stroke="${gold}" stroke-width=".7"/><rect x="44" y="44" width="712" height="1012" fill="none" stroke="${lightGold}" stroke-width=".45"/>
  <g fill="none" stroke="url(#award-foil)" stroke-width="1.6">${corners}</g>
  <g font-family="PT Sans,Arial,sans-serif" text-anchor="middle"><text x="400" y="86" fill="${ink}" font-size="14" letter-spacing="6">ОЧЕВИДНО</text><path d="M130 81H273 M527 81H670" stroke="${lightGold}" stroke-width=".65"/>
  <g fill="none" stroke="${gold}" stroke-width="1.1">${wreath}<circle cx="400" cy="141" r="24" stroke-width=".65"/></g><text x="400" y="154" fill="${gold}" font-family="PT Serif,Georgia,serif" font-size="34">О.</text>
  <text x="400" y="207" fill="${muted}" font-size="9.5" letter-spacing="2.5">КОЛЛЕГИЯ ОЧЕВИДНЫХ ДОСТИЖЕНИЙ</text><text x="400" y="300" fill="${ink}" font-family="PT Serif,Georgia,serif" font-size="69" letter-spacing="7">ГРАМОТА</text>${title}
  <path d="M302 404H378 M422 404H498" stroke="${gold}" stroke-width=".7"/><path d="M400 400L404 404L400 408L396 404Z" fill="${gold}"/>
  <text x="400" y="452" fill="${muted}" font-size="12" letter-spacing="4">НАГРАЖДАЕТСЯ</text>${name}
  <path d="M140 625H660" stroke="${lightGold}" stroke-width=".65"/><text x="400" y="664" fill="${muted}" font-size="9" letter-spacing="2.5">ПО РЕШЕНИЮ КОЛЛЕГИИ</text>${citation}
  <g fill="none" stroke="${sealInk}" stroke-width=".8"><circle cx="400" cy="934" r="53"/><circle cx="400" cy="934" r="42"/><circle cx="400" cy="934" r="36"/></g><g fill="${sealInk}">${beading}</g><text x="400" y="916" fill="${sealInk}" font-size="7" letter-spacing="1.1">ОЧЕВИДНО</text><text x="400" y="944" fill="${sealInk}" font-family="PT Serif,Georgia,serif" font-size="29">О.</text><text x="400" y="962" fill="${sealInk}" font-size="6.5" letter-spacing="1.1">ЗАВЕРЕНО</text>
  <text x="197" y="933" fill="${ink}" font-family="PT Serif,Georgia,serif" font-size="18">${escapeSvg(date)}</text><path d="M111 950H283 M514 950H700" stroke="${lightGold}" stroke-width=".65"/><text x="197" y="971" fill="${muted}" font-size="8" letter-spacing="1.6">ДАТА НАГРАЖДЕНИЯ</text>
  <text x="607" y="930" fill="#293142" font-family="Marck Script,cursive" font-size="35">А. Очевидный</text><path d="M535 940C569 935 617 944 675 936" fill="none" stroke="#293142" stroke-width=".9"/><text x="607" y="971" fill="${muted}" font-size="8" letter-spacing="1.2">ПРЕДСЕДАТЕЛЬ КОЛЛЕГИИ</text>
  <text x="400" y="1013" fill="${muted}" font-size="8.5" letter-spacing="1">№ ${escapeSvg(r.serial)}${premium?' · ЧАСТНАЯ КОЛЛЕКЦИЯ':bundle?' · ДОКУМЕНТ ИЗ НАБОРА':''}</text><text x="400" y="1035" fill="${gold}" font-size="9">${escapeSvg(r.botUsername?`@${r.botUsername}`:'Серьёзно оформлено — несерьёзно получено.')}</text><text x="400" y="1053" fill="${muted}" font-size="6.8" letter-spacing=".65">ШУТОЧНЫЙ ДОКУМЕНТ · НЕ ПРЕДОСТАВЛЯЕТ ПРАВ И ЛЬГОТ</text></g>
  ${sample?`<text x="400" y="602" text-anchor="middle" transform="rotate(-20 400 602)" font-family="PT Sans,Arial,sans-serif" font-size="75" font-weight="700" letter-spacing="8" fill="${gold}" opacity=".085">ОБРАЗЕЦ</text>`:''}</svg>`;
}
