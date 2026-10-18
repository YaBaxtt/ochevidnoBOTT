import {renderAward} from './award-template.js?v=1';
import {normaliseRecipient} from './visual-utils.js?v=2';

export const sampleCertificate={kind:'certificate',documentTitle:'Лицензия на отдых',recipient:'Фамилия Имя',citation:'Предоставляется полное шуточное право на отдых без объяснения причин. Диван, чай и тишина одобрены комиссией.',serial:'ОБРАЗЕЦ',issuedAt:'2026-10-18',rank:'Личная коллекция'};
export function certificateSample(variant='standard') {
  return {...sampleCertificate,collectionStyle:variant,documentTitle:variant==='premium'?'Меценат очевидности':'Лицензия на отдых',citation:variant==='premium'?'С благодарностью за добровольную поддержку проекта и вклад в сохранение культурного наследия очевидных ответов.':sampleCertificate.citation,rank:variant==='premium'?'Частная коллекция':variant==='bundle'?'Документ из набора':'Личная коллекция'};
}

export function certificateSvg(result,sample=false) { return renderAward(result,sample); }

export function recipientPreview(card,value,botUsername='') {
  const variant=card.premium?'premium':card.kind==='bundle'?'bundle':'standard';
  return {...certificateSample(variant),recipient:normaliseRecipient(value)||'Фамилия Имя',botUsername,
    documentTitle:card.kind==='bundle'?'Документ из набора':String(card.title||'Именная грамота').replace(/^Сертификат: /,'').replace(/^Справка: /,''),
    citation:'Пример оформления. Здесь будет основание награждения после открытия карточки. Имя, дата и номер — персональные.'};
}
