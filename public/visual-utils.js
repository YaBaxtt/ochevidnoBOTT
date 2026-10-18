export const escapeSvg=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const weight=char=>/\s/.test(char)?.3:/[ilI1.,:;!'|]/.test(char)?.3:/[MWШЩЖЮФ@%]/.test(char)?.86:/\p{Extended_Pictographic}/u.test(char)?1.15:.57;
const widthOf=(text,size)=>Array.from(text).reduce((sum,c)=>sum+weight(c)*size,0);
function wrapAt(text,width,size) {
  const lines=[];let line='';
  for(const word of String(text??'').trim().split(/\s+/)) {
    if(widthOf([line,word].filter(Boolean).join(' '),size)>width&&line){lines.push(line);line='';}
    for(const char of word){if(widthOf(line+char,size)>width&&line){lines.push(line);line='';}line+=char;}
    line+=' ';
  }
  if(line.trim())lines.push(line.trim());return lines.map(s=>s.trim());
}
export function svgText(value,{x,y,width=672,size=30,minSize=size,maxLines=3,leading=1.3,anchor='start',fill='currentColor',family='PT Sans,Arial,sans-serif',extra=''}={}) {
  let lines=wrapAt(value,width,size);
  while(lines.length>maxLines&&size>minSize){size=Math.max(minSize,size-2);lines=wrapAt(value,width,size);}
  if(lines.length>maxLines){lines=lines.slice(0,maxLines);lines[maxLines-1]=lines[maxLines-1].replace(/[.,;:!?\s]+$/,'')+'…';}
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="${family}" font-size="${size}" text-anchor="${anchor}" ${extra}>${lines.map((line,i)=>`<tspan x="${x}" dy="${i?Math.round(size*leading):0}">${escapeSvg(line)}</tspan>`).join('')}</text>`;
}
