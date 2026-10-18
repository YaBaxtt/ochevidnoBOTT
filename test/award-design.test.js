import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {normaliseRecipient} from '../public/visual-utils.js';
import {certificateSvg,recipientPreview} from '../public/certificate-design.js';
import {getCardDefinition,makeResult} from '../src/card-engine.js';
import {renderShareJpeg} from '../src/share-renderer.js';

test('certificate names use initial capitals, including Cyrillic, hyphens and apostrophes',()=>{
  assert.equal(normaliseRecipient('  бахт  '),'Бахт');
  assert.equal(normaliseRecipient('АННА-мАРИЯ  о’НИЛ'),'Анна-Мария О’Нил');
  assert.equal(normaliseRecipient("jOHN o'NEIL"),"John O'Neil");
  assert.equal(normaliseRecipient('ёлка   петрова'),'Ёлка Петрова');
  const answers={name:'бахт'},result=makeResult('decision-director',answers);
  assert.equal(result.recipient,'Бахт');assert.match(result.headline,/Бахт/);assert.equal(answers.name,'бахт');
  const bundle=makeResult('bundle-important',{name:'иван петров'});assert.ok(bundle.items.every(item=>item.result.recipient==='Иван Петров'));
});

test('award layout centers the recipient and reason on light paper with a gold frame and handwriting',async()=>{
  const legacy={...makeResult('decision-director',{name:'бахт'}),recipient:'бахт'},svg=certificateSvg(legacy);
  assert.equal(legacy.recipient,'бахт');assert.match(svg,/ГРАМОТА/);assert.match(svg,/>Бахт<\/tspan>/);
  assert.match(svg,/<text x="400" y="526"[^>]*text-anchor="middle"/);
  assert.match(svg,/<text x="400" y="710"[^>]*text-anchor="middle"/);
  assert.match(svg,/Marck Script,cursive/);assert.match(svg,/#fffefa/);assert.match(svg,/award-foil/);assert.match(svg,/ШУТОЧНЫЙ ДОКУМЕНТ/);
  const long=makeResult('patron-of-obvious',{name:'александр константинович иванов-петров'});
  const longSvg=certificateSvg(long);assert.doesNotMatch(longSvg,/Иванов-Петров…/);
  const image=await renderShareJpeg(longSvg),info=await sharp(image).metadata();assert.deepEqual([info.width,info.height],[1200,1650]);assert.ok(image.length<5*1024*1024);
});

test('personalized previews stay explicit samples, never reveal the purchased answer or create a real serial',()=>{
  const card=getCardDefinition('decision-director'),preview=recipientPreview(card,'бахт','obviously_bbot');
  assert.equal(preview.recipient,'Бахт');assert.equal(preview.serial,'ОБРАЗЕЦ');assert.equal(preview.collectionStyle,'premium');
  assert.notEqual(preview.citation,makeResult(card.id,{name:'бахт'}).citation);assert.match(preview.citation,/Пример оформления/);
  const svg=certificateSvg(preview,true);assert.match(svg,/ОБРАЗЕЦ/);assert.match(svg,/obviously_bbot/);
  const escaped=certificateSvg(recipientPreview(card,'<script>иван</script>'),true);assert.doesNotMatch(escaped,/<script>/i);assert.match(escaped,/&lt;Script&gt;/);
});
