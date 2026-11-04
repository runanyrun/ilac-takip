// Offline patch planner for an already-authorized private export. No network.
// This is NOT a production Worker and does not satisfy the source-import gate.
import { parse } from 'acorn';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPutSource } from './private-put-audit.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
const blocked = () => {throw new Error('P4_PRIVATE_PATCH_BLOCKED');};
function tree(source) {
  try {return parse(source,{ecmaVersion:'latest',sourceType:'module'});} catch {blocked();}
}
function index(ast) {
  const nodes=[],parents=new WeakMap();
  function visit(n,parent) {
    if(!n || typeof n!=='object' || typeof n.type!=='string')return;
    nodes.push(n);parents.set(n,parent);
    for(const value of Object.values(n)) {
      if(Array.isArray(value)) {for(const child of value)visit(child,n);}
      else visit(value,n);
    }
  }
  visit(ast,null);
  const prop=n=>n?.computed?n.property?.value:n?.property?.name;
  const puts=nodes.filter(n=>n.type==='CallExpression' && n.callee.type==='MemberExpression' && prop(n.callee)==='put' &&
    (n.callee.object?.type==='Identifier' && n.callee.object.name==='PUSH_KV' || n.callee.object?.type==='MemberExpression' && prop(n.callee.object)==='PUSH_KV')).sort((a,b)=>a.start-b.start);
  return {nodes,parents,puts};
}
// Deliberately narrow: removing unknown helper calls could remove useful work.
function inertArgument(n) {
  if(!n)return false;
  switch(n.type) {
    case 'Literal': case 'Identifier': return true;
    case 'TemplateLiteral': return n.expressions.every(inertArgument);
    case 'BinaryExpression': return n.operator==='+' && inertArgument(n.left) && inertArgument(n.right);
    case 'ObjectExpression': return n.properties.every(p=>p.type==='Property' && !p.computed && p.kind==='init' && inertArgument(p.value));
    case 'ArrayExpression': return n.elements.every(inertArgument);
    case 'NewExpression': return n.callee.type==='Identifier' && n.callee.name==='Date' && n.arguments.every(inertArgument);
    case 'CallExpression': {
      const c=n.callee;
      if(c.type!=='MemberExpression' || c.computed || n.optional)return false;
      const known=c.object.type==='Identifier' && ((c.object.name==='JSON' && c.property.name==='stringify') || (c.object.name==='Date' && c.property.name==='now'));
      const timestamp=c.property.name==='toISOString' && c.object.type==='NewExpression' && inertArgument(c.object);
      return (known || timestamp) && n.arguments.every(inertArgument);
    }
    default:return false;
  }
}
export function planP4Removal(source,{expectedSha256,diagnosticOnlyReviewed}={}) {
  if(typeof source!=='string' || diagnosticOnlyReviewed!==true || !/^[a-f0-9]{64}$/.test(expectedSha256 || '') || digest(source)!==expectedSha256)blocked();
  // Accept one reviewed JavaScript entry module, not an unreviewed multipart dump.
  if(/^--[^\r\n]+/.test(source))blocked();
  const audit=auditPutSource(source,parse),module=audit.modules?.[0];
  const p4=module?.sites.find(s=>s.site==='M1P4');
  if(audit.status!=='static-only' || audit.modules.length!==1 || module.directPutSites!==7 || !p4 || p4.keyClass!=='scheduler-metadata' || !p4.reachableFrom.scheduled || p4.reachableFrom.fetch || !p4.awaited || !p4.hasExpirationOption || p4.loopDepth!==0 || p4.conditionalAncestorCount!==0 || p4.priorControlExitCount!==0 || p4.errorHandling!=='not-locally-caught')blocked();
  const before=index(tree(source)),put=before.puts[3];
  const prefix=n=>typeof n?.value==='string'?n.value:n?.type==='TemplateLiteral'?n.quasis[0]?.value?.cooked || '':n?.type==='BinaryExpression'?prefix(n.left):'';
  if(before.puts.length!==7 || !/cron|heartbeat|last.?run|last.?tick/i.test(prefix(put?.arguments[0])) || !put.arguments.every(inertArgument))blocked();
  const awaited=before.parents.get(put),statement=before.parents.get(awaited);
  if(awaited?.type!=='AwaitExpression' || statement?.type!=='ExpressionStatement' || statement.expression!==awaited || before.parents.get(statement)?.type!=='BlockStatement')blocked();
  const replacement='/* P4 diagnostic-only KV heartbeat removed; delivery state is unchanged. */\n';
  const candidate=source.slice(0,statement.start)+replacement+source.slice(statement.end);
  const after=index(tree(candidate));
  const oldPuts=before.puts.filter(n=>n!==put).map(n=>source.slice(n.start,n.end));
  const newPuts=after.puts.map(n=>candidate.slice(n.start,n.end));
  if(newPuts.length!==6 || oldPuts.some((value,i)=>value!==newPuts[i]))blocked();
  // Plan contains offsets/hashes and fixed text only, never removed source.
  return Object.freeze({start:statement.start,end:statement.end,replacement,sourceSha256:expectedSha256,candidateSha256:digest(candidate),removedPutSites:1,remainingPutSites:6,readyForDeployment:false});
}
function privateDirectory(path) {
  const dir=realpathSync(path);
  if((lstatSync(dir).mode & 0o077)!==0)blocked();
  // Keep both source and candidate outside Git checkouts, including this repo.
  for(let at=dir;;at=dirname(at)) {
    const marker=join(at,'.git');
    // Some managed filesystems expose an empty reserved .git directory even
    // outside repositories. A worktree file or repository metadata is decisive.
    if(existsSync(marker) && (lstatSync(marker).isFile() || lstatSync(marker).isSymbolicLink() || existsSync(join(marker,'HEAD')) || existsSync(join(marker,'objects'))))blocked();
    if(dirname(at)===at)break;
  }
  return dir;
}
export function preparePrivateP4File({sourcePath,expectedSha256,diagnosticOnlyReviewed,candidatePath}) {
  const requested=resolve(sourcePath),info=lstatSync(requested);
  if(!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)!==0 || info.size>4*1024*1024)blocked();
  const actual=realpathSync(requested),dir=privateDirectory(dirname(actual));
  const raw=readFileSync(actual),source=raw.toString('utf8');
  if(!Buffer.from(source).equals(raw))blocked();
  const plan=planP4Removal(source,{expectedSha256,diagnosticOnlyReviewed});
  if(candidatePath) {
    const target=resolve(candidatePath);
    if(privateDirectory(dirname(target))!==dir || target===actual)blocked();
    // Exclusive create: do not overwrite source, old candidates or symlink targets.
    writeFileSync(target,source.slice(0,plan.start)+plan.replacement+source.slice(plan.end),{flag:'wx',mode:0o600});
  }
  return {status:candidatePath?'private-candidate-created':'check-only',sourceSha256:plan.sourceSha256,candidateSha256:plan.candidateSha256,removedPutSites:1,remainingPutSites:6,readyForDeployment:false};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2),values={};
    for(let i=0;i<args.length;i++) {
      if(args[i]==='--diagnostic-only-reviewed') {if(values.reviewed)blocked();values.reviewed=true;continue;}
      if(!['--source','--expected-sha256','--candidate'].includes(args[i]) || values[args[i]] || !args[i+1])blocked();
      values[args[i]]=args[++i];
    }
    console.log(JSON.stringify(preparePrivateP4File({sourcePath:values['--source'],expectedSha256:values['--expected-sha256'],diagnosticOnlyReviewed:values.reviewed===true,candidatePath:values['--candidate']})));
  } catch {console.error('BLOCKED: private P4 candidate preconditions failed; source and error details withheld.');process.exitCode=1;}
}
