import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync,writeFileSync,readFileSync,statSync,existsSync,rmSync,mkdirSync,symlinkSync,chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { planP4Removal,preparePrivateP4File } from '../../scripts/issue5/p4-private-patch.mjs';

// Synthetic shape only; never substituted for the production source-import gate.
const source=`const sentinel = 'synthetic-private-content';
export default {
 async fetch(request,env) {
  if(request.kind === 'test') {
   await env.PUSH_KV.put('test-a','one',{expirationTtl:120});
   await env.PUSH_KV.put('test-b','two',{expirationTtl:120});
  } else {await env.PUSH_KV.put('sub:synthetic','three',{expirationTtl:120});}
 },
 async scheduled(event,env,ctx) {ctx.waitUntil((async()=>{
  await env.PUSH_KV.put('cron:metadata',new Date().toISOString(),{expirationTtl:120});
  for(const device of env.devices) {
   for(const group of device.groups) {
    for(const due of group.doses) {
     await env.PUSH_KV.put('status:synthetic',JSON.stringify({status:201}),{expirationTtl:120});
     if(due)await env.PUSH_KV.put('sent:synthetic','six',{expirationTtl:120});
    }
    await env.PUSH_KV.put('record:synthetic','seven',{expirationTtl:120});
   }
  }
 })());}
};`;
const sha = s=>createHash('sha256').update(s).digest('hex');
const options=s=>({expectedSha256:sha(s),diagnosticOnlyReviewed:true});
const candidate=(s,p)=>s.slice(0,p.start)+p.replacement+s.slice(p.end);
async function tick(s,devices,failHeartbeat=false) {
  const calls=[],promises=[];
  const sandbox={Date,JSON};
  vm.runInNewContext(s.replace('export default','globalThis.worker ='),sandbox);
  await sandbox.worker.scheduled({scheduledTime:0},{devices,PUSH_KV:{async put(key,value,opt){
    if(failHeartbeat && key==='cron:metadata')throw Error('Synthetic KV 429');
    calls.push({key,value,opt:JSON.parse(JSON.stringify(opt))});
  }}},{waitUntil(p){promises.push(p);}});
  await Promise.all(promises);
  return calls;
}
test('P4 candidate removes one standalone expression and preserves every other source byte',()=>{
  const p=planP4Removal(source,options(source)),next=candidate(source,p);
  assert.equal(p.removedPutSites,1);assert.equal(p.remainingPutSites,6);
  assert.equal(p.readyForDeployment,false);
  assert.equal(next.slice(0,p.start),source.slice(0,p.start));
  assert.equal(next.slice(p.start+p.replacement.length),source.slice(p.end));
  assert.equal(sha(next),p.candidateSha256);
  for(const forbidden of ['synthetic-private-content','cron:metadata','put('])assert.equal(JSON.stringify(p).includes(forbidden),false);
});
test('unverified hashes, missing review, double patch and shape changes fail closed',()=>{
  assert.throws(()=>planP4Removal(source,{...options(source),expectedSha256:'0'.repeat(64)}));
  assert.throws(()=>planP4Removal(source,{expectedSha256:sha(source)}));
  const next=candidate(source,planP4Removal(source,options(source)));
  assert.throws(()=>planP4Removal(next,options(next)));
  for(const altered of [source.replace("'cron:metadata'","'delivery:critical'"),source.replace("await env.PUSH_KV.put('cron:metadata'","if(event.enabled)await env.PUSH_KV.put('cron:metadata'"),source.replace("await env.PUSH_KV.put('test-a'","await env.PUSH_KV.get('test-a'")])assert.throws(()=>planP4Removal(altered,options(altered)));
});
test('unknown side effects and compound statements cannot be deleted as a heartbeat',()=>{
  for(const altered of [source.replace('new Date().toISOString()','unknownMutation()'),source.replace("await env.PUSH_KV.put('cron:metadata'","recordMutation(), await env.PUSH_KV.put('cron:metadata'")])assert.throws(()=>planP4Removal(altered,options(altered)));
});
test('1440 empty synthetic ticks attempt zero PUT after patch; old heartbeat 429 no longer blocks tick',async()=>{
  const next=candidate(source,planP4Removal(source,options(source)));
  await assert.rejects(tick(source,[],true),/429/);
  let beforeWrites=0,afterWrites=0;
  for(let minute=0;minute<1440;minute++) {
    beforeWrites+=(await tick(source,[])).length;
    afterWrites+=(await tick(next,[],true)).length;
  }
  assert.equal(beforeWrites,1440);assert.equal(afterWrites,0);
});
test('1, 2 and 100 synthetic devices retain P5/P6/P7 writes, payloads and TTL exactly',async()=>{
  const next=candidate(source,planP4Removal(source,options(source)));
  for(const count of [1,2,100]) {
    const devices=Array.from({length:count},()=>({groups:[{doses:[true]}]}));
    const baseline=await tick(source,devices),patched=await tick(next,devices,true);
    assert.deepEqual(patched,baseline.filter(c=>c.key!=='cron:metadata'));
    assert.equal(baseline.length-patched.length,1);
  }
});
function folder(t) {const dir=mkdtempSync(join(tmpdir(),'ilac-p4-private-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
test('private file check is read-only; explicit candidate is exclusive, private and leaves source intact',t=>{
  const dir=folder(t),input=join(dir,'worker.mjs'),output=join(dir,'candidate.mjs');
  writeFileSync(input,source,{mode:0o600});
  const args={sourcePath:input,...options(source)};
  assert.equal(preparePrivateP4File(args).status,'check-only');assert.equal(existsSync(output),false);
  const report=preparePrivateP4File({...args,candidatePath:output});
  assert.equal(report.status,'private-candidate-created');assert.equal(readFileSync(input,'utf8'),source);
  assert.equal(statSync(output).mode & 0o777,0o600);
  assert.throws(()=>preparePrivateP4File({...args,candidatePath:output}));
  assert.throws(()=>preparePrivateP4File({...args,candidatePath:input}));
  assert.equal(JSON.stringify(report).includes('synthetic-private-content'),false);
});
test('Git worktrees, public permissions, symlink input and different candidate directory are rejected',t=>{
  const dir=folder(t),input=join(dir,'worker.mjs');writeFileSync(input,source,{mode:0o600});
  const args={sourcePath:input,...options(source)};
  chmodSync(input,0o644);assert.throws(()=>preparePrivateP4File(args));chmodSync(input,0o600);
  const link=join(dir,'link.mjs');symlinkSync(input,link);assert.throws(()=>preparePrivateP4File({...args,sourcePath:link}));
  const other=folder(t);assert.throws(()=>preparePrivateP4File({...args,candidatePath:join(other,'candidate.mjs')}));
  mkdirSync(join(dir,'.git'));writeFileSync(join(dir,'.git/HEAD'),'ref: refs/heads/synthetic\n');assert.throws(()=>preparePrivateP4File(args));
});
