import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAppUrlFromEnv, validatePublicAppUrl, appConnection } from '../src/deployment.js';
import { readinessSnapshot } from '../src/readiness.js';
import { botSetupPanel } from '../public/admin.js';
import { DEFAULT_BOT_SETTINGS, LEGACY_BOT_SETTINGS, resolveBotSettings } from '../src/product.js';
import { MemoryAppStore } from '../src/app-store.js';
import { syncBotAvatar } from '../src/bot-avatar.js';

test('deployment URL uses the public Railway domain, never the dashboard or a placeholder', () => {
  assert.equal(publicAppUrlFromEnv({ RAILWAY_PUBLIC_DOMAIN: 'obvious.up.railway.app' }), 'https://obvious.up.railway.app');
  assert.equal(publicAppUrlFromEnv({ PUBLIC_APP_URL: ' https://example.com/ ', RAILWAY_PUBLIC_DOMAIN: 'other.up.railway.app' }), 'https://example.com');
  assert.equal(validatePublicAppUrl('https://obvious.up.railway.app/'), 'https://obvious.up.railway.app');
  for (const url of ['', 'https://railway.com/project/123', 'https://github.com/example/repo', 'https://your-project.up.railway.app', 'http://example.com', 'https://localhost', 'https://app.railway.internal', 'https://example.com/path', 'https://example.com/?tab=home', 'https://example.com/#home', 'https://user:password@example.com']) {
    assert.throws(() => validatePublicAppUrl(url), /PUBLIC_APP_URL/);
    assert.equal(appConnection(url).publicAppUrl, '');
    assert.match(appConnection(url).appSetupIssue, /PUBLIC_APP_URL/);
  }
  assert.equal(appConnection('https://example.com').appSetupIssue, '');
});

test('readiness distinguishes demo, configuration and real payment checks; UI escapes text', () => {
  const demo = readinessSnapshot({ config: { demo: true, publicAppUrl: '' }, settings: {}, telegramConnected: false });
  assert.equal(demo.mode, 'demo');
  assert.equal(demo.checks.find(item => item.key === 'telegram').state, 'info');
  const live = readinessSnapshot({ config: { demo: false, publicAppUrl: 'https://example.com', supportUrl: 'https://t.me/support' }, settings: { avatarHash: 'a'.repeat(64), avatarVersion: 2 }, telegramConnected: true });
  assert.equal(live.checks.find(item => item.key === 'avatar').state, 'ok');
  assert.equal(live.checks.find(item => item.key === 'payment').state, 'info');
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const html = botSetupPanel({ appUrl: null, checks: [{ title: '<script>evil</script>', detail: '"test"', state: 'info' }] }, escape);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('new stock bot copy replaces old stock copy but preserves owner-written text', async () => {
  const upgraded = resolveBotSettings(LEGACY_BOT_SETTINGS);
  assert.equal(upgraded.welcome, DEFAULT_BOT_SETTINGS.welcome);
  assert.equal(upgraded.description, DEFAULT_BOT_SETTINGS.description);
  assert.equal(upgraded.shortDescription, DEFAULT_BOT_SETTINGS.shortDescription);
  assert.ok(upgraded.description.length <= 512);
  assert.ok(upgraded.shortDescription.length <= 120);
  const store = new MemoryAppStore();
  await store.updateBotSettings({ welcome: 'Мой текст, {name}.', description: 'Моё описание', shortDescription: 'Мой профиль' });
  assert.equal((await store.getBotSettings()).welcome, 'Мой текст, {name}.');
  assert.equal((await store.getBotSettings()).shortDescription, 'Мой профиль');
});

test('bot avatar is uploaded as a fresh JPEG once per image version and secrets never enter errors', async () => {
  const store = new MemoryAppStore();
  let uploads = 0;
  const fetchImpl = async (url, options) => {
    uploads++;
    assert.match(url, /\/setMyProfilePhoto$/);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body.get('photo')), { type: 'static', photo: 'attach://avatar' });
    const file = options.body.get('avatar');
    assert.equal(file.type, 'image/jpeg');
    assert.ok(file.size > 1000);
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  };
  assert.deepEqual(await syncBotAvatar({ store, botToken: 'test-secret', fetchImpl }), { updated: true });
  assert.deepEqual(await syncBotAvatar({ store, botToken: 'test-secret', fetchImpl }), { updated: false });
  assert.equal(uploads, 1);
  await store.updateBotSettings({ avatarHash: 'force-retry' });
  await assert.rejects(() => syncBotAvatar({ store, botToken: 'test-secret', fetchImpl: async () => { throw new Error('https://api.telegram.org/bottest-secret'); } }), error => {
    assert.doesNotMatch(error.message, /test-secret|api\.telegram\.org/);
    return /Не удалось обновить/.test(error.message);
  });
  assert.equal((await store.getBotSettings()).avatarHash, 'force-retry');
});
