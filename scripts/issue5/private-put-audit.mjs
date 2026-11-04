// Run this analysis next to the private source. Never return source/AST/literals.
// Parser is injected so the same tested function can run inside the private tool.
export function auditPutSource(source, parse) {
  const modules = [];
  if (/^--[^\r\n]+/.test(source)) {
    const boundary=source.match(/^--[^\r\n]+/)[0];
    for(const part of source.split(boundary)) {
      const match=/\r?\n\r?\n/.exec(part);
      const body=match?part.slice(match.index+match[0].length).replace(/\r?\n$/,''):'';
      if(match && (/(?:javascript|ecmascript)/i.test(part.slice(0,match.index)) || /\bexport\s+default\b|\baddEventListener\s*\(/.test(body))) modules.push(body);
    }
  } else modules.push(source);
  if(!modules.length) return {status:'blocked',reason:'no-javascript-modules',sourceWithheld:true};
  const reports=[];
  for(let moduleIndex=0;moduleIndex<modules.length;moduleIndex++) {
    let ast;
    try {ast=parse(modules[moduleIndex],{ecmaVersion:'latest',sourceType:'module',locations:true});}
    catch {return {status:'blocked',reason:'parse-failed',sourceWithheld:true};}
    const parents=new WeakMap(),owners=new WeakMap(),functions=[],nodes=[];
    const isFunction=n=>/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n?.type);
    const prop=n=>n?.computed?n.property?.value:n?.property?.name;
    const member=(n,name)=>n?.type==='MemberExpression' && prop(n)===name;
    const kv=n=>n?.type==='Identifier' && n.name==='PUSH_KV' || member(n,'PUSH_KV');
    const operation=n=>n?.type==='CallExpression' && n.callee?.type==='MemberExpression' && kv(n.callee.object)?prop(n.callee):null;
    function walk(n,parent,owner) {
      if(!n || typeof n!=='object' || typeof n.type!=='string')return;
      parents.set(n,parent);
      if(isFunction(n)) {
        const name=n.id?.name || (parent?.type==='Property' ? parent.key?.name || parent.key?.value : parent?.type==='VariableDeclarator' ? parent.id?.name : null);
        const f={id:`M${moduleIndex+1}F${functions.length+1}`,name,node:n,parentOwner:owner,entrypoint:parent?.type==='Property' && ['fetch','scheduled'].includes(name)?name:null,calls:new Set(),puts:[],reads:0};
        functions.push(f);owner=f;
      }
      owners.set(n,owner);nodes.push(n);
      for(const [key,value] of Object.entries(n)) {
        if(['loc','start','end'].includes(key))continue;
        if(Array.isArray(value))for(const child of value)walk(child,n,owner);
        else walk(value,n,owner);
      }
    }
    walk(ast,null,null);
    const byName=new Map();
    for(const f of functions) if(f.name && (f.node.type==='FunctionDeclaration' || parents.get(f.node)?.type==='VariableDeclarator')) {const list=byName.get(f.name)||[];list.push(f);byName.set(f.name,list);}
    for(const n of nodes) {
      const f=owners.get(n);if(!f)continue;
      if(operation(n)==='get'||operation(n)==='getWithMetadata')f.reads++;
      if(operation(n)==='put')f.puts.push(n);
      if(n.type==='CallExpression' && n.callee.type==='Identifier') {
        const matches=byName.get(n.callee.name);if(matches?.length===1)f.calls.add(matches[0]);
      }
      if(isFunction(n) && f.parentOwner && n.type!=='FunctionDeclaration')f.parentOwner.calls.add(f); // conservative callback reachability
    }
    const roots=functions.filter(f=>f.entrypoint);
    const reaches=(a,b,seen=new Set())=>a===b || (!seen.has(a) && (seen.add(a),[...a.calls].some(c=>reaches(c,b,seen))));
    const contains=(root,type)=>nodes.some(n=>n.type===type && n.start>=root.start && n.end<=root.end);
    const labelName=name=>['fetch','scheduled'].includes(name)?name:'redacted-helper';
    const literalPrefix=(n,site,seen=new Set())=>{
      if(!n || seen.has(n))return '';seen.add(n);
      if(typeof n.value==='string')return n.value;
      if(n.type==='TemplateLiteral')return n.quasis[0]?.value?.cooked || '';
      if(n.type==='BinaryExpression')return literalPrefix(n.left,site,seen);
      if(n.type==='Identifier') {
        const choices=nodes.filter(v=>v.type==='VariableDeclarator' && v.id?.name===n.name && v.start<site.start && owners.get(v)===owners.get(site));
        const candidate=choices.sort((a,b)=>b.start-a.start)[0];
        if(candidate)return literalPrefix(candidate.init,site,seen);
      }
      return '';
    };
    const classifyKey=(n,site)=>{const p=literalPrefix(n,site);return /cron|heartbeat|last.?run|last.?tick/i.test(p)?'scheduler-metadata':/sent|dedup|deliver/i.test(p)?'delivery-state':/sub/i.test(p)?'subscription-state':/plan|schedule|alarm/i.test(p)?'schedule-state':'unclassified';};
    const sites=[];
    for(const f of functions)for(const put of f.puts) {
      const ancestors=[];for(let n=parents.get(put);n && n!==f.node;n=parents.get(n))ancestors.push(n);
      const catcher=ancestors.find(n=>n.type==='TryStatement' && n.handler && put.start>=n.block.start && put.end<=n.block.end)?.handler;
      const inlineCatch=ancestors.find(n=>n.type==='CallExpression' && member(n.callee,'catch'));
      const catchBody=catcher?.body || inlineCatch?.arguments?.find(isFunction)?.body;
      const scheduled=roots.some(r=>r.entrypoint==='scheduled' && reaches(r,f));
      const fetch=roots.some(r=>r.entrypoint==='fetch' && reaches(r,f));
      const options=put.arguments[2];
      sites.push({site:`M${moduleIndex+1}P${sites.length+1}`,functionId:f.id,functionName:labelName(f.name),line:put.loc.start.line,
        reachableFrom:{scheduled,fetch},keyClass:classifyKey(put.arguments[0],put),
        routeClasses:[...new Set(ancestors.filter(n=>n.type==='IfStatement').flatMap(n=>nodes.filter(v=>v.type==='Literal' && typeof v.value==='string' && v.start>=n.test.start && v.end<=n.test.end && v.value.startsWith('/')).map(v=>/test/i.test(v.value)?'test':/status|health/i.test(v.value)?'status':/subscr|subscribe|register/i.test(v.value)?'subscription-sync':/schedule|plan/i.test(v.value)?'schedule-sync':/sync/i.test(v.value)?'state-sync':/clean/i.test(v.value)?'cleanup':'other-api')))],
        guardedHttpStatuses:[...new Set(ancestors.filter(n=>n.type==='IfStatement').flatMap(n=>nodes.filter(v=>v.type==='Literal' && Number.isInteger(v.value) && v.value>=200 && v.value<=599 && v.start>=n.test.start && v.end<=n.test.end).map(v=>v.value)))],
        catchReturnStatuses:catchBody?[...new Set(nodes.filter(n=>n.type==='ReturnStatement' && n.start>=catchBody.start && n.end<=catchBody.end).flatMap(n=>nodes.filter(v=>v.type==='Literal' && Number.isInteger(v.value) && v.value>=200 && v.value<=599 && v.start>=n.start && v.end<=n.end).map(v=>v.value)))]:[],
        catchReturnsExplicitSuccess:!!catchBody && nodes.some(n=>n.type==='Property' && ['ok','success'].includes(n.key?.name||n.key?.value) && n.value?.value===true && n.start>=catchBody.start && n.end<=catchBody.end),
        functionMutatesStateFields:[...new Set(nodes.filter(n=>n.type==='AssignmentExpression' && n.left.type==='MemberExpression' && owners.get(n)===f).map(n=>prop(n.left)).filter(name=>['lastRun','lastTick','lastCron','lastSent','lastSentAt','updatedAt','createdAt','lastAttempt','lastChecked','lastCheck','sent','sentAt','status','error','lastError','alarms','schedule','subscription'].includes(name)))],
        valueRoles:[...new Set(nodes.filter(n=>n.start>=put.arguments[1]?.start && n.end<=put.arguments[1]?.end).flatMap(n=>{
          const name=n.type==='Property'?(n.key?.name||n.key?.value):n.type==='MemberExpression'?prop(n):'';
          if(typeof name!=='string')return [];
          return /last.*(?:run|tick|check)|checkedAt|lastCron|heartbeat/i.test(name)?['scheduler-metadata']:/sent|deliver/i.test(name)?['delivery-state']:/retry|attempt/i.test(name)?['retry-state']:/endpoint|subscription|keys/i.test(name)?['subscription-state']:/alarms|schedule|plans/i.test(name)?['schedule-state']:/status|result/i.test(name)?['status-state']:[];
        }))],
        priorControlExitCount:nodes.filter(n=>['ReturnStatement','ContinueStatement','ThrowStatement'].includes(n.type) && n.end<put.start && owners.get(n)===f).length,
        loopDepth:ancestors.filter(n=>['ForStatement','ForOfStatement','ForInStatement','WhileStatement','DoWhileStatement'].includes(n.type)).length,
        conditionalAncestorCount:ancestors.filter(n=>['IfStatement','ConditionalExpression','SwitchCase'].includes(n.type)).length,
        awaited:ancestors.some(n=>n.type==='AwaitExpression'),
        storedReadsInFunction:f.reads,hasExpirationOption:options?.type==='ObjectExpression' && options.properties.some(p=>['expiration','expirationTtl'].includes(p.key?.name||p.key?.value)),
        errorHandling:!catchBody?'not-locally-caught':contains(catchBody,'ThrowStatement')?'catch-rethrows':contains(catchBody,'ReturnStatement')?'catch-returns-review-status':'catch-continues',
        sameDataWriteGuard:'not-proven-by-this-analysis'});
    }
    const deleteSites=nodes.filter(n=>operation(n)==='delete').map(n=>{
      const f=owners.get(n),ancestors=[];for(let a=parents.get(n);a && a!==f?.node;a=parents.get(a))ancestors.push(a);
      return {functionId:f?.id || 'top-level',reachableFrom:{scheduled:roots.some(r=>r.entrypoint==='scheduled' && reaches(r,f)),fetch:roots.some(r=>r.entrypoint==='fetch' && reaches(r,f))},guardedHttpStatuses:[...new Set(ancestors.filter(a=>a.type==='IfStatement').flatMap(a=>nodes.filter(v=>v.type==='Literal' && Number.isInteger(v.value) && v.value>=200 && v.value<=599 && v.start>=a.test.start && v.end<=a.test.end).map(v=>v.value)))]};
    });
    reports.push({deleteSites,module:`M${moduleIndex+1}`,directPutSites:sites.length,sites,
      entrypoints:roots.map(r=>({name:r.entrypoint,directPutSites:r.puts.length,reachablePutSites:sites.filter(s=>s.reachableFrom[r.entrypoint]).length})),
      retryAfterReferenced:nodes.some(n=>n.type==='Literal' && typeof n.value==='string' && n.value.toLowerCase()==='retry-after'),
      unresolvedCallGraph:true});
  }
  // Do not add unbounded names, source fragments, ASTs, key values or parser errors.
  return {status:'static-only',sourceWithheld:true,modules:reports};
}
