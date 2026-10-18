import test from 'node:test';
import assert from 'node:assert/strict';
import { getCardDefinition, makeResult } from '../src/card-engine.js';

test('card registry contains all selected cards and the flashlight', () => {
  assert.equal(getCardDefinition('birth-year').priceStars, 10);
  assert.equal(getCardDefinition('flashlight').priceStars, 5);
  assert.equal(getCardDefinition('unknown'), null);
});

test('birth year handles a birthday later in the year', () => {
  const result = makeResult('birth-year', { age: 20, month: 12 }, new Date('2026-10-15T12:00:00Z'));
  assert.match(result.headline, /2005/);
  assert.doesNotMatch(result.detail, /2004/);
  assert.match(makeResult('birth-year',{age:20,month:10},new Date('2026-10-15T12:00:00Z')).headline,/2006 или 2005/);
});

test('sum is computed server-side', () => {
  const result = makeResult('sum-two', { a: 42, b: 8 }, new Date('2026-10-15T12:00:00Z'));
  assert.equal(result.headline, '50');
});

test('invalid card inputs are rejected', () => {
  assert.throws(() => makeResult('days-alive', { birthDate: '32.01.2020' }), /даты не бывает/);
  assert.throws(() => makeResult('sum-two', {a:'',b:1}), /Заполните/);
});

test('certificate and bundle snapshots contain formal document data, not a generic answer',()=>{
  const r=makeResult('patron-of-obvious',{name:'Александр'});
  assert.equal(r.kind,'certificate');assert.equal(r.recipient,'Александр');assert.match(r.serial,/^[A-F0-9]{12}$/);
  const b=makeResult('bundle-office',{name:'Александр'});assert.equal(b.kind,'bundle');assert.equal(b.items.length,3);assert.ok(b.items.every(i=>i.result.kind==='certificate'));
});
