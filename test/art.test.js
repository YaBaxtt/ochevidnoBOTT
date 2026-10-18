import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DEFAULT_CARDS } from '../src/card-engine.js';
import { ART_SLUGS, CARD_ART, artworkSlug, artImage } from '../public/art.js';
import { BRAND } from '../public/brand.js';

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

test('both identity avatars fit Telegram and lightweight UI use, with originals and exact prompts retained', async () => {
  const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  for (const role of ['bot', 'manager']) {
    const avatar = path.join(publicRoot, role === 'bot' ? BRAND.botAvatar : BRAND.managerAvatar);
    const small = path.join(publicRoot, role === 'bot' ? BRAND.smallAvatar : BRAND.smallManagerAvatar);
    const image = await sharp(avatar).metadata();
    assert.equal(image.format, 'jpeg'); assert.equal(image.width, 640); assert.equal(image.height, 640);
    assert.ok((await fs.stat(avatar)).size < 40000);
    const icon = await sharp(small).metadata();
    assert.equal(icon.width, 128); assert.equal(icon.height, 128); assert.equal(icon.format, 'webp');
    assert.ok((await fs.stat(small)).size < 4000);
    const source = await sharp(path.join(publicRoot, `assets/avatars/${role}-avatar-source-v${BRAND.avatarVersion}.png`)).metadata();
    assert.ok(source.width >= 1000); assert.equal(source.width, source.height);
  }
  const prompts = await fs.readFile(path.join(publicRoot, 'assets/avatars/prompts-v2.md'), 'utf8');
  assert.match(prompts, /imagegen/); assert.match(prompts, /ПОДДЕРЖКА/);
});
