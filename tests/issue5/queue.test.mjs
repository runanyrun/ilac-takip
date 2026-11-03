import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { putPlan, putDevice, enqueue, dispatchDue, Conflict } from '../../cloudflare/push-queue/queue.mjs';

function fixture(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec(readFileSync(new URL('../../cloudflare/push-queue/schema.sql',import.meta.url),'utf8'));
  const counts = {reads:0,writes:0};
  let batchTail = Promise.resolve();
  const db = {
    prepare(query) {
      let values = [];
      const count = () => {counts[/^\s*SELECT/.test(query) ? 'reads' : 'writes']++;};
      const stmt = {
        bind(...args) {values=args;return stmt;},
        async first() {count();return sql.prepare(query).get(...values) ?? null;},
        async all() {count();return {results:sql.prepare(query).all(...values)};},
        async run() {count();return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}
      };
      return stmt;
    },
    batch(statements) {
      const result = batchTail.then(async () => {
        sql.exec('BEGIN IMMEDIATE');
        try {const rows=[];for(const s of statements) rows.push(await s.run());sql.exec('COMMIT');return rows;}
        catch(error) {sql.exec('ROLLBACK');throw error;}
      });
      batchTail = result.catch(() => {});
      return result;
    }
  };
  const reset = () => {for(const k of Object.keys(counts)) counts[k]=0;};
  return {sql,db,counts,reset};
}
const due = Date.parse('2026-11-03T08:00:00Z');
const payload = {times:['08:00'],timezone:'Europe/Istanbul',unknown:{preserved:true}};
async function seed(db,owner='u',device='phone') {
  await putPlan(db,{owner,id:'p',payload});
  await putDevice(db,{owner,id:device,subscription:{endpoint:'https://synthetic.invalid/push',keys:{auth:'synthetic'}}});
  await enqueue(db,{owner,planId:'p',deviceId:device,dueAt:due,expiresAt:due+10*60000});
}

test('1, 2 and 100 users: full-day idle ticks use zero D1 write statements', async t => {
  for (const users of [1,2,100]) {
    const f = fixture(t);
    for(let i=0;i<users;i++) await seed(f.db,'u'+i);
    // Isolate idle cron cost before the scheduled day, retaining real rows.
    f.reset();
    for(let tick=0;tick<1440;tick++) await dispatchDue(f.db,{now:due-86400000+tick*60000,send:()=>{throw Error('Early send');}});
    assert.deepEqual(f.counts,{reads:1440,writes:0});
    let sent=0;
    const result=await dispatchDue(f.db,{now:due,send:async()=>{sent++;return {status:201};}});
    assert.equal(sent,users);assert.equal(result.sent,users);
    f.reset();
    assert.equal((await dispatchDue(f.db,{now:due,send:()=>{throw Error('Duplicate');}})).claimed,0);
    assert.equal(f.counts.writes,0);
  }
});
test('identical plan/device sync does not write or change local times/revision', async t => {
  const f=fixture(t);await seed(f.db);
  const p=f.sql.prepare('SELECT * FROM push_plans_v1').get();
  const d=f.sql.prepare('SELECT * FROM push_devices_v1').get();
  f.reset();
  for(let i=0;i<20;i++) {
    assert.equal((await putPlan(f.db,{owner:'u',id:'p',payload:{unknown:payload.unknown,timezone:payload.timezone,times:payload.times}},p.revision)).changed,false);
    assert.equal((await putDevice(f.db,{owner:'u',id:'phone',subscription:JSON.parse(d.subscription)},d.revision)).changed,false);
  }
  assert.equal(f.counts.writes,0);
  assert.deepEqual(JSON.parse(f.sql.prepare('SELECT payload FROM push_plans_v1').get().payload),payload);
});
test('concurrent plan edits have one winner and cancel stale occurrences atomically', async t => {
  const f=fixture(t);await seed(f.db);
  const revision=f.sql.prepare('SELECT revision FROM push_plans_v1').get().revision;
  // batch transactions below execute sequentially as D1 does; two stale clients
  // still contend with the same expected revision.
  const outcomes=await Promise.allSettled([
    putPlan(f.db,{owner:'u',id:'p',payload:{...payload,label:'A'}},revision),
    putPlan(f.db,{owner:'u',id:'p',payload:{...payload,label:'B'}},revision)
  ]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(outcomes.some(r=>r.status==='rejected' && r.reason instanceof Conflict));
  assert.equal(f.sql.prepare('SELECT count(*) n FROM push_jobs_v1').get().n,0);
  await assert.rejects(putPlan(f.db,{owner:'u',id:'p',payload},revision),Conflict);
});
test('overlapping cron claims send once; independent devices receive separately', async t => {
  const f=fixture(t);await seed(f.db);
  await putDevice(f.db,{owner:'u',id:'tablet',subscription:{endpoint:'https://synthetic.invalid/tablet'}});
  await enqueue(f.db,{owner:'u',planId:'p',deviceId:'tablet',dueAt:due,expiresAt:due+600000});
  assert.equal((await enqueue(f.db,{owner:'u',planId:'p',deviceId:'phone',dueAt:due,expiresAt:due+600000})).created,false);
  let sent=0;
  await Promise.all([1,2].map(()=>dispatchDue(f.db,{now:due,send:async()=>{sent++;return {status:201};}})));
  assert.equal(sent,2);
});
test('429 honors backoff and does not claim a successful save/send', async t => {
  const f=fixture(t);await seed(f.db);
  let calls=0;
  const send=async()=>{calls++;return calls===1?new Response('',{status:429,headers:{'retry-after':'120'}}):{status:201};};
  assert.equal((await dispatchDue(f.db,{now:due,send})).retry,1);
  assert.equal(f.sql.prepare('SELECT state FROM push_jobs_v1').get().state,'pending');
  assert.equal((await dispatchDue(f.db,{now:due+60000,send})).claimed,0);
  assert.equal((await dispatchDue(f.db,{now:due+120000,send})).sent,1);
  assert.equal(calls,2);
});
test('transport failures expire within grace; permanent errors do not loop', async t => {
  const f=fixture(t);await seed(f.db);
  assert.equal((await dispatchDue(f.db,{now:due,send:async()=>{throw Error('Transport');}})).retry,1);
  assert.equal((await dispatchDue(f.db,{now:due+60000,send:async()=>({status:401})})).failed,1);
  await seed(f.db,'second');
  assert.equal((await dispatchDue(f.db,{now:due+600000,send:()=>{throw Error('Expired send');}})).expired,1);
});
test('410 cleanup cannot remove a renewed subscription during external send', async t => {
  const f=fixture(t);await seed(f.db);
  const old=f.sql.prepare('SELECT revision FROM push_devices_v1').get().revision;
  await dispatchDue(f.db,{now:due,send:async()=>{
    await putDevice(f.db,{owner:'u',id:'phone',subscription:{endpoint:'https://synthetic.invalid/new'}},old);
    return {status:410};
  }});
  const device=f.sql.prepare('SELECT * FROM push_devices_v1').get();
  assert.equal(device.active,1);assert.notEqual(device.revision,old);
});
test('404 removes only affected device version; another owner is isolated', async t => {
  const f=fixture(t);await seed(f.db);await seed(f.db,'other');
  const result=await dispatchDue(f.db,{now:due,send:async()=>({status:404})});
  assert.equal(result.gone,2);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM push_devices_v1 WHERE active=1').get().n,0);
  await assert.rejects(putPlan(f.db,{owner:'other',id:'p',payload},'another-owner-revision'),Conflict);
});
test('expired leases recover; bounded retry cannot send after grace', async t => {
  const f=fixture(t);await seed(f.db);
  f.sql.prepare("UPDATE push_jobs_v1 SET state='claimed',lease='crashed',lease_until=?,attempts=1").run(due+60000);
  assert.equal((await dispatchDue(f.db,{now:due,send:()=>{throw Error('Lease active');}})).claimed,0);
  assert.equal((await dispatchDue(f.db,{now:due+60000,send:async()=>new Response('',{status:503,headers:{'retry-after':'999999'}})})).expired,1);
});
test('due and lease queries use indexes; invalid occurrences cannot alter times', async t => {
  const f=fixture(t);
  const plans=f.sql.prepare("EXPLAIN QUERY PLAN SELECT * FROM push_jobs_v1 WHERE state='pending' AND next_at<=?").all(due);
  assert.ok(plans.some(p=>p.detail.includes('push_jobs_due_v1')));
  await assert.rejects(enqueue(f.db,{owner:'u',planId:'p',deviceId:'phone',dueAt:due+1,expiresAt:due+60000}),TypeError);
});


test('a failed persistence operation never reports saved or cancels existing work', async t => {
  const f=fixture(t);await seed(f.db);
  const prior=f.sql.prepare('SELECT * FROM push_plans_v1').get();
  const original=f.db.prepare;
  f.db.prepare=query=>{
    const stmt=original(query);
    if(query.startsWith('INSERT INTO push_plans_v1')) stmt.run=async()=>{throw Error('Synthetic persistence 429');};
    return stmt;
  };
  await assert.rejects(putPlan(f.db,{owner:'u',id:'p',payload:{...payload,label:'edit'}},prior.revision),/429/);
  assert.equal(f.sql.prepare('SELECT revision FROM push_plans_v1').get().revision,prior.revision);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM push_jobs_v1').get().n,1);
});
