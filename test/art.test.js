import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DEFAULT_CARDS } from '../src/card-engine.js';
import { ART_SLUGS, CARD_ART, artworkSlug, artImage } from '../public/art.js';

test('every catalog product has an existing optimized illustration; main five and premium five are distinct',async()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public/assets/art-v3');
  assert.equal(ART_SLUGS.length,20);assert.equal(new Set(ART_SLUGS).size,20);
  for(const c of DEFAULT_CARDS){assert.ok(CARD_ART[c.id],`Missing art for ${c.id}`);assert.ok(ART_SLUGS.includes(artworkSlug(c.id)));}
  const main=['birth-year','age-minus-ten','hundredth-year','sum-two','older-today'];assert.equal(new Set(main.map(artworkSlug)).size,5);
  const premium=DEFAULT_CARDS.filter(c=>c.premium&&c.kind==='certificate');assert.equal(new Set(premium.map(c=>artworkSlug(c.id))).size,5);
  let mobileBytes=0;
  for(const slug of ART_SLUGS){
    const original=await sharp(path.join(root,`${slug}.png`)).metadata();assert.ok(original.width>=1000);assert.ok(original.height>=1000);
    for(const width of [360,720]){const file=path.join(root,`${slug}-${width}.webp`);const info=await sharp(file).metadata();assert.equal(info.format,'webp');assert.equal(info.width,width);if(slug!=='hero')assert.equal(info.height,width);if(width===360)mobileBytes+=(await fs.stat(file)).size;}
  }
  assert.ok(mobileBytes<1024*1024,'Mobile cover set must remain under 1 MB');
  assert.equal((await sharp(path.join(root,'hero-wide.webp')).metadata()).width,1440);
  assert.match(artImage('birth-year'),/loading="lazy"/);assert.match(artImage('birth-year',{eager:true}),/fetchpriority="high"/);
  assert.doesNotMatch(artImage('../../.env'),/\.env/);
});
