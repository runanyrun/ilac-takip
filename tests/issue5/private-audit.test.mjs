import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { auditPutSource } from '../../scripts/issue5/private-put-audit.mjs';

test('private audit returns only bounded metadata; literals, keys and endpoint values never leave',()=>{
  const marker='synthetic-sensitive-'+ 'x'.repeat(45);
  const source=`const privateValue=${JSON.stringify(marker)}; async function writeState(env){await env.PUSH_KV.put('sub:'+privateValue,privateValue,{expirationTtl:86400});} export default {async scheduled(event,env){for(const user of [])await writeState(env);},async fetch(request,env){await env.PUSH_KV.put('cron:private',privateValue);return new Response(privateValue);}};`;
  const report=auditPutSource(source,parse);
  assert.equal(report.status,'static-only');assert.equal(report.sourceWithheld,true);
  assert.equal(report.modules[0].directPutSites,2);
  assert.equal(report.modules[0].sites[0].reachableFrom.scheduled,true);
  assert.equal(report.modules[0].sites[0].reachableFrom.fetch,false);
  assert.equal(report.modules[0].sites[1].reachableFrom.fetch,true);
  assert.equal(report.modules[0].sites[0].keyClass,'subscription-state');
  assert.equal(report.modules[0].sites[0].hasExpirationOption,true);
  const serialized=JSON.stringify(report);
  for(const value of [marker,'sub:','cron:private','86400','new Response','privateValue','writeState'])assert.equal(serialized.includes(value),false,value);
});
test('audit ignores comments, template HTML and regex; does not run source',()=>{
  const report=auditPutSource('const html=`env.PUSH_KV.put("private",1)`; /* PUSH_KV.put() */ const x=/put\\(\\)/; throw new Error("never execute"); export default {async scheduled(e,env){await env.PUSH_KV.put("a","b");}}',parse);
  assert.equal(report.modules[0].directPutSites,1);
  assert.equal(report.modules[0].sites[0].functionName,'scheduled');
});
test('audit flags swallowed errors and reports a local catch without claiming API success',()=>{
  const report=auditPutSource('export default {async fetch(r,env){try{await env.PUSH_KV.put("sub:a","b");}catch{}return new Response("ok");}}',parse);
  assert.equal(report.modules[0].sites[0].errorHandling,'catch-continues');
  assert.equal(report.modules[0].sites[0].sameDataWriteGuard,'not-proven-by-this-analysis');
});
test('audit understands multipart source, withheld parser failures and dynamic-key uncertainty',()=>{
  const code='export default {async scheduled(e,env){await env.PUSH_KV.put(dynamicKey,value);}}';
  const report=auditPutSource('--BOUNDARY\r\nContent-Type: application/javascript\r\n\r\n'+code+'\r\n--BOUNDARY--',parse);
  assert.equal(report.modules[0].directPutSites,1);
  assert.equal(report.modules[0].sites[0].keyClass,'unclassified');
  assert.equal(auditPutSource('--B\r\nContent-Disposition: form-data; name="script"\r\n\r\n'+code+'\r\n--B--',parse).modules[0].directPutSites,1);
  assert.deepEqual(auditPutSource('const bad = "private secret',parse),{status:'blocked',reason:'parse-failed',sourceWithheld:true});
});


test('global fetch is not confused with the Worker fetch method in call graphs',()=>{
  const source='export default {async scheduled(e,env){await fetch("https://synthetic.invalid");await env.PUSH_KV.put("cron:x","v");},async fetch(r,env){if(r.url==="/api/push/subscribe"){await env.PUSH_KV.put("sub:x","v");}}}';
  const r=auditPutSource(source,parse).modules[0];
  assert.equal(r.entrypoints.find(e=>e.name==='scheduled').reachablePutSites,1);
  assert.equal(r.sites[1].reachableFrom.scheduled,false);
  assert.deepEqual(r.sites[1].routeClasses,['subscription-sync']);
});
