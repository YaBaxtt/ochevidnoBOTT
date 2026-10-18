import {escapeSvg,svgText} from './visual-utils.js';

export const sampleResult={headline:'2120 год',detail:'Пожалуйста, сохрани это для будущей очень длинной речи.',badge:'КАЛЕНДАРЬ ОТКРЫТ'};
export const sampleResultCard={id:'hundredth-year',title:'Год твоего 100-летия',accent:'amber'};
export function resultCardSvg({result:r,card={},firstName='Фамилия Имя',botUsername='',sample=false}) {
  const accent=({amber:'#e2bd78',blue:'#90b5ef',cyan:'#84c9c0',violet:'#baa5e9',pink:'#dda9ba',indigo:'#a4b5e9'})[card.premium?'amber':card.accent]||'#a4b5e9';
  const numeric=/^[≈\d\s.,+-]+(?:год|лет|дней|мин\.)?$/.test(r.headline||'');
  const title=svgText(card.title||'Твоё очевидное открытие',{x:72,y:207,width:725,size:37,minSize:28,maxLines:2,fill:'#e9e9e5'});
  const name=svgText(firstName,{x:480,y:430,width:790,size:34,minSize:26,maxLines:2,anchor:'middle',fill:'#c1c8d2'});
  const answer=svgText(r.headline,{x:480,y:600,width:810,size:numeric?143:76,minSize:numeric?72:46,maxLines:3,leading:1.09,anchor:'middle',fill:accent,extra:'font-weight="700" letter-spacing="-2"'});
  const detail=svgText(r.detail,{x:480,y:865,width:760,size:27,minSize:23,maxLines:4,leading:1.4,anchor:'middle',fill:'#a8b2c2'});
  const isCalendar=['birth-year','hundredth-year','age-minus-ten','mondays','days-alive'].includes(card.id);
  return `<svg class="result-image" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 1200" role="img" aria-label="${escapeSvg(card.title)}: ${escapeSvg(r.headline)}"><defs><radialGradient id="ambient" cx=".8" cy=".2" r="1"><stop stop-color="${accent}" stop-opacity=".12"/><stop offset="1" stop-color="#0d121b" stop-opacity="0"/></radialGradient><pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#c6d6f3" stroke-opacity=".035"/></pattern></defs><rect width="960" height="1200" rx="36" fill="#101620"/><rect width="960" height="1200" rx="36" fill="url(#ambient)"/><rect x="24" y="24" width="912" height="1152" rx="20" fill="none" stroke="${accent}" stroke-opacity=".23"/><path d="M72 130H888 M72 1040H888" stroke="#f3f6ff" stroke-opacity=".14"/>
  <g font-family="PT Sans,Arial,sans-serif"><text x="72" y="94" fill="#f1f1eb" font-size="43" font-weight="700" letter-spacing="-1.5">очевидно<tspan fill="${accent}">.</tspan></text><text x="888" y="90" text-anchor="end" fill="${accent}" font-size="12" letter-spacing="2.3">ЛИЧНОЕ ОТКРЫТИЕ</text>${title}
  <g transform="translate(777 273)" stroke="${accent}" stroke-width="2" fill="none" opacity=".55">${isCalendar?'<rect width="90" height="81" rx="14"/><path d="M0 25H90 M25 -8V10 M65 -8V10 M23 47H38 M52 47H68 M23 62H38 M52 62H68"/>':'<circle cx="45" cy="40" r="39"/><path d="M22 41L38 57L68 24"/>'}</g>
  <rect x="72" y="296" width="610" height="1" fill="${accent}" opacity=".2"/><text x="72" y="335" fill="${accent}" font-size="13" letter-spacing="2">${escapeSvg(r.badge||'ОЧЕВИДНО ПОДТВЕРЖДЕНО')}</text>${name}<rect x="86" y="480" width="788" height="283" rx="22" fill="url(#grid)"/>${answer}${detail}
  <text x="72" y="1085" fill="#e1e4e9" font-size="17">Серьёзно оформлено — несерьёзно получено.</text><text x="72" y="1123" fill="#737f93" font-size="14">Сохрани на случай, если снова захочется всё проверить.</text><text x="888" y="1123" text-anchor="end" fill="${accent}" font-size="16">${escapeSvg(botUsername?`@${botUsername}`:'очевидно.')}</text>${sample?'<text x="480" y="795" text-anchor="middle" fill="#f1f3fa" opacity=".09" font-size="84" font-weight="700" letter-spacing="12">ОБРАЗЕЦ</text>':''}</g></svg>`;
}
