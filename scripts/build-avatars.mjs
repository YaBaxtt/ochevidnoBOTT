import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from '../public/brand.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets/avatars');
for (const name of ['bot', 'manager']) {
  const source = path.join(root, `${name}-avatar-source-v${BRAND.avatarVersion}.png`);
  await sharp(source).resize(640, 640).flatten({ background: '#111217' }).jpeg({ quality: 92, mozjpeg: true }).toFile(path.join(root, `${name}-avatar-v${BRAND.avatarVersion}.jpg`));
  await sharp(source).resize(128, 128).webp({ quality: 88 }).toFile(path.join(root, `${name}-avatar-v${BRAND.avatarVersion}-128.webp`));
}
console.log('Аватарки готовы: JPG для Telegram и лёгкие WebP для мини-аппа.');
