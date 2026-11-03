import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { estimateDaily } from '../../scripts/issue5/kv-cost.mjs';
import { auditPwa, identity } from '../../scripts/issue5/pwa-audit.mjs';
import { verifyImport } from '../../scripts/issue5/source-gate.mjs';
import { sensitive } from '../../scripts/issue5/secret-scan.mjs';

test('one list per minute exceeds the list quota independently of user count', () => {
  for (const users of [0, 1, 10, 100]) {
    const model = estimateDaily({ users, devicesPerUser: 2, remindersPerUser: 3 });
    assert.equal(model.operations.list, 1440);
    assert.ok(model.exceeds.includes('list'));
    assert.equal(model.kind, 'hypothetical');
  }
});
test('multiple devices, retries and edits have separate per-operation budgets', () => {
  const result = estimateDaily({ users: 100, devicesPerUser: 2, remindersPerUser: 3, listPagesPerTick: 2, writesPerDelivery: 2, expiredDevices: 4, scheduleUpdates: 10 });
  assert.deepEqual(result.operations, {read: 288000, write: 1210, delete: 4, list: 2880});
  assert.deepEqual(result.exceeds, ['read', 'write', 'list']);
  assert.equal(estimateDaily({users:1, devicesPerUser:1, remindersPerUser:1, listPagesPerTick:0, readsPerDevicePerTick:0, writesPerDelivery:0}).operations.list, 0);
});
test('model rejects missing, negative, fractional and overflowing workloads', () => {
  for (const users of [undefined, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => estimateDaily({users, devicesPerUser:2, remindersPerUser:3}));
});
const manifest = {id:'/ilac-takip',start_url:'./index.html',scope:'./'};
test('same origin/manifest identity is retained and does not authorize removal', () => {
  const report = auditPwa(manifest,'https://example.test/ilac-takip/manifest.json',manifest,'https://example.test/ilac-takip/manifest.json');
  assert.equal(report.sameIdentity,true);
  assert.equal(report.sameOrigin,true);
  assert.equal(report.removalAllowed,false);
  assert.equal(report.next.startUrl,'https://example.test/ilac-takip/index.html');
});
test('cross-origin installs require explicit export/import, even with identical paths', () => {
  const report = auditPwa(manifest,'https://old.example.test/manifest.json',manifest,'https://new.example.test/manifest.json');
  assert.equal(report.sameOrigin,false);
  assert.equal(report.sameIdentity,false);
  assert.equal(report.automaticLocalStorageTransfer,false);
  assert.equal(report.requiresUserVerifiedBackup,true);
});
test('identity resolves relative ids against start_url, rejects cross-origin scopes', () => {
  assert.equal(identity({id:'./',start_url:'/app/index.html',scope:'/app/'},'https://example.test/manifest.json').id,'https://example.test/');
  assert.throws(() => identity({...manifest,scope:'https://other.test/'},'https://example.test/manifest.json'));
});
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(),'issue5-'));
  mkdirSync(join(root,'src'));
  const code = 'export default { async scheduled() {} };\n';
  writeFileSync(join(root,'src/index.js'),code);
  const data = {worker:'ilac-takip-mono-preview',deploymentId:'synthetic-test-only',exportedAt:'2026-11-03T00:00:00Z',compatibilityDate:'2026-10-01',cron:'* * * * *',files:[{path:'src/index.js',sha256:createHash('sha256').update(code).digest('hex')}]};
  const save = () => writeFileSync(join(root,'import-manifest.json'),JSON.stringify(data));
  save();
  try { fn(root,data,save); } finally { rmSync(root,{recursive:true,force:true}); }
}
test('gate validates inventory but never certifies production readiness', () => fixture(root => assert.deepEqual(verifyImport(root),{status:'hash-verified',productionReady:false})));
test('gate fails closed with missing provenance, hash mismatch or altered cron', () => {
  fixture((root,data,save) => {data.cron='*/5 * * * *';save();assert.throws(()=>verifyImport(root));});
  fixture(root => {writeFileSync(join(root,'src/index.js'),'changed');assert.throws(()=>verifyImport(root));});
  fixture(root => {rmSync(join(root,'import-manifest.json'));assert.throws(()=>verifyImport(root));});
});
test('gate rejects traversal, duplicate paths, unlisted files and symlinks', () => {
  fixture((root,data,save) => {data.files[0].path='src/../../outside.js';save();assert.throws(()=>verifyImport(root));});
  fixture((root,data,save) => {data.files.push({...data.files[0]});save();assert.throws(()=>verifyImport(root));});
  fixture(root => {writeFileSync(join(root,'src/extra.js'),'unlisted');assert.throws(()=>verifyImport(root));});
  fixture(root => {symlinkSync('/etc/hostname',join(root,'src/link'));assert.throws(()=>verifyImport(root));});
});
test('scan detects synthetic private material without printing values', () => {
  assert.equal(sensitive('VAPID_PRIVATE_KEY = "'+'x'.repeat(40)+'"'),true);
  assert.equal(sensitive('"d": "'+'x'.repeat(43)+'"'),true);
  assert.equal(sensitive('ghp_'+'a'.repeat(30)),true);
  assert.equal(sensitive('VAPID_PRIVATE_KEY = env.VAPID_PRIVATE_KEY'),false);
  assert.equal(sensitive('https://web.push.apple.com/'+ 'a'.repeat(30)),true);
});
