import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ART_SLUGS } from '../public/art.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets/art-v3');
let originals = 0, mobile = 0;
for (const slug of ART_SLUGS) {
  const input = path.join(root, `${slug}.png`);
  const stat = await fs.stat(input); originals += stat.size;
  for (const width of [360,720]) {
    const output = path.join(root, `${slug}-${width}.webp`);
    await sharp(input).resize({ width, withoutEnlargement: true }).webp({ quality: 84, effort: 6 }).toFile(output);
    if(width === 360) mobile += (await fs.stat(output)).size;
  }
}
await sharp(path.join(root,'hero.png')).resize({width:1440,withoutEnlargement:true}).webp({quality:86,effort:6}).toFile(path.join(root,'hero-wide.webp'));
console.log(`${ART_SLUGS.length} illustrations: PNG originals ${(originals/1024/1024).toFixed(1)} MB; all mobile WebP covers ${(mobile/1024).toFixed(0)} KB.`);
