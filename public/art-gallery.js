import { ART_SLUGS, ART_BASE, artImage } from './art.js?v=3';
const names={
  'birth-year':'Год рождения','age-minus-ten':'Десять лет назад','hundredth-year':'Твой юбилей','sum-two':'Сложи два числа','older-today':'Старше с утра',
  hero:'Главная',premium:'Золотое фолио',bundles:'Наборы грамот','certificate-classic':'Классическая грамота','certificate-rest':'Лицензия на отдых',
  'certificate-award':'Личная награда','certificate-tired':'Справка об усталости',messages:'Индекс сообщений',aura:'Аура и распределение',food:'Пицца и холодильник',flashlight:'Фонарик',
  'premium-nothing':'Ничего. Премиум.','premium-vip':'Важная персона','premium-director':'Директор решений','premium-pause':'Пауза класса люкс'
};
document.querySelector('#art-gallery').innerHTML=ART_SLUGS.map((slug,i)=>`<a class="art-tile" href="${ART_BASE}${slug}.png" target="_blank" rel="noreferrer">${artImage(slug,{eager:i<4,sizes:'(min-width:1000px) 280px, (min-width:600px) 30vw, 50vw'})}<div><small>${String(i+1).padStart(2,'0')}</small><h2>${names[slug]}</h2><span>PNG ↗</span></div></a>`).join('');
