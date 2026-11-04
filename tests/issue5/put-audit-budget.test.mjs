import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateAuditedPutBudget as budget } from '../../scripts/issue5/put-audit-budget.mjs';

test('audited global metadata alone attempts 1440 PUTs without users',()=>{
  const r=budget({users:0});assert.equal(r.total,1440);assert.equal(r.exceedsFreeWriteQuota,true);
  assert.equal(r.kind,'conditional-static-bound');assert.equal(r.notProductionMeasurement,true);
});
test('1, 2 and 100 one-device users have explicit per-class conditional bounds',()=>{
  for(const [users,maintenance,total] of [[1,1440,2880],[2,2880,4320],[100,144000,145440]]) {
    const r=budget({users});assert.equal(r.writes.scheduledDeviceMaintenance,maintenance);assert.equal(r.total,total);
  }
});
test('delivery iterations, sync, test requests and devices are counted independently',()=>{
  for(const [users,total] of [[1,11520],[2,21600],[100,1009440]])assert.equal(budget({users,deliveryIterationsPerDevicePerTick:3}).total,total);
  const r=budget({users:2,devicesPerUser:2,ticksPerDay:10,deliveryIterationsPerDevicePerTick:3,syncRequestsPerDay:7,testRequestsPerDay:5});
  assert.deepEqual(r.writes,{scheduledMetadata:10,scheduledDeviceMaintenance:40,deliveryAndDedup:240,subscriptionSync:7,manualTests:10,cleanupDirectPutSites:0});
  assert.equal(r.total,307);
});
test('unbounded, invalid and overflowing workloads cannot be labeled as finite bounds',()=>{
  for(const users of [undefined,-1,1.5,Infinity,NaN,Number.MAX_SAFE_INTEGER])assert.throws(()=>budget({users}),TypeError);
});
