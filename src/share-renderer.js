import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const fonts=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public/assets/fonts');
const fontFiles=['PT_Sans-Web-Regular.ttf','PT_Sans-Web-Bold.ttf','PT_Serif-Web-Regular.ttf','PT_Serif-Web-Italic.ttf','MarckScript-Regular.ttf'].map(name=>path.join(fonts,name));
const cache=new Map(),inflight=new Map(),waiters=[];
let active=0,cacheBytes=0;
async function acquire() {
  if(active<2){active++;return;}
  if(waiters.length>=16)throw new Error('Сейчас готовится много картинок. Попробуйте через несколько секунд.');
  await new Promise(resolve=>waiters.push(resolve));
}
function release(){const next=waiters.shift();if(next)next();else active--;}

export async function renderShareJpeg(svg,{thumbnail=false}={}) {
  const key=crypto.createHash('sha256').update(`${thumbnail?'thumb':'photo'}:${svg}`).digest('hex');
  if(cache.has(key)){const buffer=cache.get(key);cache.delete(key);cache.set(key,buffer);return buffer;}
  if(inflight.has(key))return inflight.get(key);
  const pending=(async()=>{
    await acquire();
    try {
      const [{Resvg},{default:sharp}]=await Promise.all([import('@resvg/resvg-js'),import('sharp')]);
      const png=new Resvg(svg,{fitTo:{mode:'width',value:thumbnail?320:1200},font:{fontFiles,loadSystemFonts:false,defaultFontFamily:'PT Sans'}}).render().asPng();
      const buffer=await sharp(png).flatten({background:'#ffffff'}).jpeg({quality:thumbnail?78:91,mozjpeg:true}).toBuffer();
      cache.set(key,buffer);cacheBytes+=buffer.length;
      while(cache.size>32||cacheBytes>12*1024*1024){const first=cache.keys().next().value;cacheBytes-=cache.get(first).length;cache.delete(first);}
      return buffer;
    }finally{release();}
  })();
  inflight.set(key,pending);
  try{return await pending;}finally{inflight.delete(key);}
}
