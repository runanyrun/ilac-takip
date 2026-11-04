// Run: node --test cloudflare/worker.test.mjs (Node 20+). No real medication data or Cloudflare credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const source = await readFile(new URL('./worker.js', import.meta.url), 'utf8');
const { default: worker, sendEmptyWebPush } = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { sendEmptyWebPush };').toString('base64'));
const sha = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');

function environment() {
  const backups = new Map();
  const token = 'a'.repeat(64);
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('FROM device_credentials')) return args[0] === await sha(token) ? { user_id: 'test-user' } : null;
                if (sql.includes('FROM user_backups')) {
                  const row = backups.get(args[0]);
                  if (!row) return null;
                  return sql.includes('payload, revision') ? { ...row, updated_at: '2026-11-01' } : { revision: row.revision };
                }
                return null;
              },
              async run() {
                if (sql.startsWith('INSERT OR IGNORE INTO user_backups')) {
                  if (backups.has(args[0])) return { meta: { changes: 0 } };
                  backups.set(args[0], { payload: args[1], revision: args[2] });
                  return { meta: { changes: 1 } };
                }
                if (sql.startsWith('UPDATE user_backups')) {
                  const row = backups.get(args[2]);
                  if (!row || row.revision !== args[3]) return { meta: { changes: 0 } };
                  backups.set(args[2], { payload: args[0], revision: args[1] });
                  return { meta: { changes: 1 } };
                }
                throw Error('Unexpected SQL: ' + sql);
              }
            };
          },
          async first() { return { ok: 1 }; }
        };
      }
    }
  };
  return { env, token };
}

function call(env, token, method, path, body, extra = {}) {
  const headers = { origin: 'https://runanyrun.github.io', ...(token ? { authorization: 'Bearer ' + token } : {}), ...extra };
  return worker.fetch(new Request('https://example.workers.dev' + path, {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  }), env);
}

test('health works while signup is disabled; unauthorized backup is blocked', async () => {
  const { env } = environment();
  assert.equal((await call(env, null, 'GET', '/api/health')).status, 200);
  assert.equal((await call(env, null, 'GET', '/api/backup')).status, 401);
  assert.equal((await call(env, null, 'POST', '/api/devices')).status, 415);
});

test('backup preserves arbitrary drug fields and history; requires matching revision', async () => {
  const { env, token } = environment();
  const backup = { format: 'ilac-takip-backup', version: 2, drugs: [{ id: 123, name: 'Örnek', stock: 9, doctor: 'Örnek doktor', times: ['09:00'] }], takenLog: { '2026-11-01': { '123': true } }, history: [{ event: 'ALDIM' }] };
  const headers = { 'content-type': 'application/json', 'if-match': '*' };
  const created = await call(env, token, 'PUT', '/api/backup', backup, headers);
  assert.equal(created.status, 200);
  const revision = (await created.json()).revision;
  const fetched = await call(env, token, 'GET', '/api/backup');
  assert.deepEqual((await fetched.json()).backup, backup);
  assert.equal((await call(env, token, 'PUT', '/api/backup', { ...backup, history: [] }, headers)).status, 409);
  assert.equal((await call(env, token, 'PUT', '/api/backup', backup, headers)).status, 409);
  assert.equal((await call(env, token, 'PUT', '/api/backup', backup, { ...headers, 'if-match': revision })).status, 200);
  assert.equal((await call(env, token, 'PUT', '/api/backup', { ...backup, history: [] }, { ...headers, 'if-match': revision })).status, 200);
});

test('preflight allows If-Match only for the production origin', async () => {
  const { env } = environment();
  const allowed = await call(env, null, 'OPTIONS', '/api/backup');
  assert.equal(allowed.status, 204);
  assert.match(allowed.headers.get('access-control-allow-headers'), /if-match/);
  const rejected = await worker.fetch(new Request('https://example.workers.dev/api/backup', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), env);
  assert.equal(rejected.status, 403);
});

test('backup validation rejects malformed payloads and missing preconditions', async () => {
  const { env, token } = environment();
  const headers = { 'content-type': 'application/json' };
  const valid = { format: 'ilac-takip-backup', version: 2, drugs: [{ name: 'Deneme' }], takenLog: {}, history: [] };
  assert.equal((await call(env, token, 'PUT', '/api/backup', valid, headers)).status, 428);
  assert.equal((await call(env, token, 'PUT', '/api/backup', { ...valid, history: {} }, { ...headers, 'if-match': '*' })).status, 400);
  assert.equal((await call(env, token, 'PUT', '/api/backup', { ...valid, history: [], extra: 'x'.repeat(270000) }, { ...headers, 'if-match': '*' })).status, 413);
  assert.equal((await call(env, 'b'.repeat(64), 'GET', '/api/backup')).status, 401);
});

test('registration refuses malformed invitation without touching database', async () => {
  const { env } = environment();
  assert.equal((await call(env, null, 'POST', '/api/devices', { invite: 'wrong' }, { 'content-type': 'application/json' })).status, 400);
});

test('push subscription rejects unauthenticated and invalid requests', async () => {
  const { env, token } = environment();
  const valid = { endpoint: 'https://push.example.test/send/abc', keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } };
  assert.equal((await call(env, null, 'POST', '/api/push-subscriptions', valid, { 'content-type': 'application/json' })).status, 401);
  assert.equal((await call(env, token, 'POST', '/api/push-subscriptions', { ...valid, endpoint: 'http://push.example.test/send' }, { 'content-type': 'application/json' })).status, 400);
  assert.equal((await call(env, token, 'POST', '/api/push-subscriptions', { ...valid, keys: { p256dh: 'bad', auth: 'bad' } }, { 'content-type': 'application/json' })).status, 400);
});

test('VAPID test endpoint fails closed until signing secrets are configured', async () => {
  const { env, token } = environment();
  const response = await call(env, token, 'POST', '/api/push/test');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'vapid_not_configured');
  assert.equal((await call(env, null, 'POST', '/api/push/test')).status, 401);
});


test('Web Push VAPID signature is valid base64url and sends no medical payload', async t => {
  const pair = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const privateKey = await crypto.subtle.exportKey('jwk',pair.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
  const env={VAPID_PRIVATE_JWK:JSON.stringify(privateKey),VAPID_PUBLIC_KEY:Buffer.from(pub).toString('base64url'),VAPID_CONTACT:'mailto:synthetic@example.invalid'};
  const original=globalThis.fetch;
  let sent;
  globalThis.fetch=async(url,options)=>{sent={url,options};return new Response('',{status:201});};
  t.after(()=>{globalThis.fetch=original;});
  await sendEmptyWebPush({endpoint:'https://web.push.apple.com/synthetic'},env);
  const jwt=sent.options.headers.authorization.match(/^vapid t=([^,]+)/)[1];
  assert.match(jwt,/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const [header,payload,signature]=jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(payload,'base64url')).aud,'https://web.push.apple.com');
  assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pair.publicKey,Buffer.from(signature,'base64url'),new TextEncoder().encode(header+'.'+payload)),true);
  assert.equal(sent.options.body,undefined);
});
