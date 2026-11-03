import { test } from 'node:test';
import assert from 'node:assert/strict';
import { functions, source } from './helpers.mjs';

test('MVP: mevcut localStorage anahtarları korunur', () => {
  for (const key of ['ilac_drugs_v2', 'ilac_log_v2', 'ilac_history_v2',
    'ilac_fcm_token_v1', 'ilac_focus_photo_size_v1', 'ilac_test_device_token_v1'])
    assert.ok(source('src/main.js').includes(`'${key}'`), key);
});

test('MVP: ilaç, alım ve geçmiş depolama turu', () => {
  const data = new Map();
  const c = functions('function loadDrugs()', 'function normalizeUsageCondition', {
    LS_DRUGS: 'drugs', LS_LOG: 'log', LS_HISTORY: 'history',
    localStorage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }
  });
  // Tamamen sentetik kayıtlar; kişisel veri veya abonelik kullanılmaz.
  c.saveDrugs([{ id: 1, name: 'Synthetic', stock: 30 }]);
  c.saveLog({ synthetic: 'skipped' }); c.saveHistory([{ action: 'synthetic' }]);
  assert.equal(c.loadDrugs()[0].stock, 30);
  assert.equal(c.loadLog().synthetic, 'skipped');
  assert.equal(c.loadHistory()[0].action, 'synthetic');
});

test('MVP: yedek ilaç/alım/geçmiş içerir, token içermez', () => {
  const c = functions('function currentBackup()', 'function exportData()', {
    loadDrugs: () => [{ name: 'Synthetic' }], loadLog: () => ({}), loadHistory: () => []
  });
  assert.deepEqual(Object.keys(c.currentBackup()).sort(),
    ['drugs', 'exportedAt', 'format', 'history', 'takenLog', 'version']);
  assert.equal(c.currentBackup().version, 2);
});

test.todo('MVP kusuru: bozuk JSON açılışta üzerine yazılmadan korunmalı', () => {
  let value = '{invalid';
  const c = functions('function loadDrugs()', 'function normalizeUsageCondition', {
    LS_DRUGS: 'drugs', localStorage: { getItem: () => value, setItem: (_, v) => { value = v; } }
  });
  c.saveDrugs(c.loadDrugs());
  assert.equal(value, '{invalid');
});
