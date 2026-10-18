import {escapeSvg,svgText} from './visual-utils.js';

export const sampleCertificate={kind:'certificate',documentTitle:'Лицензия на отдых',recipient:'Фамилия Имя',citation:'Предоставляется полное шуточное право на отдых без объяснения причин. Диван, чай и тишина одобрены комиссией.',serial:'ОБРАЗЕЦ',issuedAt:'2026-10-18',rank:'Личная коллекция'};
export function certificateSample(variant='standard') {
  return {...sampleCertificate,collectionStyle:variant,documentTitle:variant==='premium'?'Меценат очевидности':'Лицензия на отдых',citation:variant==='premium'?'С благодарностью за добровольную поддержку проекта и вклад в сохранение культурного наследия очевидных ответов.':sampleCertificate.citation,rank:variant==='premium'?'Частная коллекция':variant==='bundle'?'Документ из набора':'Личная коллекция'};
}

export function certificateSvg(r,sample=false) {
  const premium=r.collectionStyle==='premium'||r.premium||r.rank==='Частная коллекция';
  const bundle=!premium&&r.collectionStyle==='bundle';
  const p=premium?{paper:'#171713',shade:'#242019',ink:'#ecddbd',muted:'#aaa18b',line:'#a78c51',accent:'#d5b775',soft:'#b4934e'}:bundle?{paper:'#f3f5f1',shade:'#e4eaf0',ink:'#1b344c',muted:'#647684',line:'#92a9b7',accent:'#456c89',soft:'#819bb0'}:{paper:'#faf8f0',shade:'#eee9db',ink:'#22332e',muted:'#7b8175',line:'#b9b7a0',accent:'#526d59',soft:'#90a08a'};
  const edition=premium?'PRIVATE EDITION':bundle?'COLLECTION / SET':'PERSONAL EDITION';
  const issued=new Date(r.issuedAt),date=Number.isFinite(issued.getTime())?issued.toLocaleDateString('ru-RU'):'—';
  const seal=Array.from({length:48},(_,i)=>{const a=i*Math.PI/24,inner=i%2?39:43;return `${654+Math.cos(a)*inner},${928+Math.sin(a)*inner}`;}).join(' ');
  const title=svgText(r.documentTitle,{x:64,y:347,width:650,size:37,minSize:29,maxLines:2,family:'PT Serif,Georgia,serif',fill:p.ink,extra:'font-style="italic"'});
  const name=svgText(r.recipient,{x:64,y:550,width:658,size:53,minSize:35,maxLines:2,family:'PT Serif,Georgia,serif',fill:p.ink});
  const citation=svgText(r.citation,{x:64,y:704,width:625,size:22,minSize:17,maxLines:5,leading:1.47,fill:p.ink});
  return `<svg class="certificate-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1100" role="img" aria-label="Именная шуточная грамота: ${escapeSvg(r.documentTitle)}"><defs><linearGradient id="paper" x2="1" y2="1"><stop stop-color="${p.paper}"/><stop offset="1" stop-color="${p.shade}"/></linearGradient><linearGradient id="foil" x2="1" y2="1"><stop stop-color="${p.line}"/><stop offset=".45" stop-color="${p.accent}"/><stop offset="1" stop-color="${p.line}"/></linearGradient><pattern id="grain" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 7L7 0" stroke="${p.line}" stroke-width=".35" opacity=".11"/></pattern></defs><rect width="800" height="1100" fill="url(#paper)"/><rect width="800" height="1100" fill="url(#grain)"/>
  <rect x="18" y="18" width="764" height="1064" fill="none" stroke="url(#foil)" stroke-width="${premium?2:1}"/><rect x="27" y="27" width="746" height="1046" fill="none" stroke="${p.line}" stroke-width=".5"/>
  ${premium?`<g fill="none" stroke="${p.line}" opacity=".5"><path d="M40 115V40H115 M685 40H760V115 M40 985V1060H115 M685 1060H760V985" stroke-width="3"/><path d="M50 93V50H93 M707 50H750V93 M50 1007V1050H93 M707 1050H750V1007"/></g>`:''}
  <g font-family="PT Sans,Arial,sans-serif"><text x="64" y="87" fill="${p.ink}" font-size="30" font-weight="700" letter-spacing="-1">очевидно<tspan fill="${p.accent}">.</tspan></text><text x="736" y="82" text-anchor="end" fill="${p.muted}" font-size="10" letter-spacing="2">${edition}</text><path d="M64 120H736" stroke="${p.line}" stroke-width=".75"/>
  <text x="64" y="196" fill="${p.accent}" font-size="11" letter-spacing="3.5">${premium?'ЧАСТНАЯ КОЛЛЕКЦИЯ':'КОЛЛЕГИЯ ОЧЕВИДНЫХ ДОСТИЖЕНИЙ'}</text><text x="59" y="285" fill="${p.ink}" font-family="PT Serif,Georgia,serif" font-size="83" letter-spacing="-3">Грамота</text>${title}
  <text x="64" y="490" fill="${p.muted}" font-size="11" letter-spacing="2.8">НАСТОЯЩИМ УДОСТОВЕРЯЕТСЯ</text>${name}<path d="M64 639H736" stroke="${p.line}" stroke-width=".75"/>${citation}
  <path d="M66 912C100 877 83 946 126 904C150 880 121 935 170 913C189 905 164 941 224 918 M64 938H272" fill="none" stroke="${p.accent}" stroke-width="1.7" stroke-linecap="round"/><text x="64" y="963" fill="${p.muted}" font-size="10" letter-spacing="1.4">А. ОЧЕВИДНЫЙ / КОЛЛЕГИЯ</text>
  <polygon points="${seal}" fill="${premium?'#b8944917':'none'}" stroke="${p.accent}" stroke-width="1.1"/><circle cx="654" cy="928" r="32" fill="none" stroke="${p.accent}" stroke-width=".6"/><text x="654" y="939" text-anchor="middle" fill="${p.accent}" font-family="PT Serif,Georgia,serif" font-size="34">О.</text><text x="654" y="987" text-anchor="middle" fill="${p.muted}" font-size="8" letter-spacing="2">ЗАВЕРЕНО ОЧЕВИДНОСТЬЮ</text>
  <path d="M64 1007H736" stroke="${p.line}" stroke-width=".75"/><text x="64" y="1031" fill="${p.muted}" font-size="9">№ ${escapeSvg(r.serial)} · ${escapeSvg(date)}</text><text x="736" y="1031" text-anchor="end" fill="${p.accent}" font-size="10">${escapeSvg(r.botUsername?`@${r.botUsername}`:'Серьёзно оформлено — несерьёзно получено.')}</text><text x="400" y="1054" text-anchor="middle" fill="${p.muted}" font-size="7.5" letter-spacing="1">ШУТОЧНЫЙ ДОКУМЕНТ · НЕ ПРЕДОСТАВЛЯЕТ ПРАВ И ЛЬГОТ</text></g>
  ${sample?`<text x="400" y="605" text-anchor="middle" transform="rotate(-26 400 605)" font-family="PT Sans,Arial,sans-serif" font-size="100" font-weight="700" fill="${p.accent}" opacity=".08">ОБРАЗЕЦ</text>`:''}</svg>`;
}
