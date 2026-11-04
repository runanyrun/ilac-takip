// Integration component, NOT the imported production Worker. No KV operations.
// Caller must authenticate owners and materialize UTC occurrences using the
// existing app's timezone/DST policy; this module never changes local dose times.
export class Conflict extends Error {}
const canonical = value => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('JSON data required');
  return encoded;
};
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const minute = value => Number.isSafeInteger(value) && value >= 0 && value % 60000 === 0;

async function replace(db, table, field, owner, id, payload, expected) {
  if (!text(owner) || !text(id) || (expected !== null && !text(expected))) throw new TypeError('Invalid identity or revision');
  const encoded = canonical(payload);
  if (new TextEncoder().encode(encoded).length > 262144) throw new TypeError('Payload too large');
  const current = await db.prepare(`SELECT * FROM ${table} WHERE owner_id=? AND id=?`).bind(owner,id).first();
  if ((current?.revision ?? null) !== expected) throw new Conflict('Revision changed');
  if (current?.[field] === encoded && (table !== 'push_devices_v1' || current.active === 1)) return {revision:current.revision,changed:false};
  const revision = crypto.randomUUID();
  const column = table === 'push_plans_v1' ? 'plan_id' : 'device_id';
  const result = await db.batch([
    db.prepare(`INSERT INTO ${table}(owner_id,id,revision,${field}) VALUES(?,?,?,?)
      ON CONFLICT(owner_id,id) DO UPDATE SET revision=excluded.revision,${field}=excluded.${field}${table === 'push_devices_v1' ? ',active=1' : ''}
      WHERE ${table}.revision=?`).bind(owner,id,revision,encoded,expected),
    db.prepare(`DELETE FROM push_jobs_v1 WHERE owner_id=? AND ${column}=? AND state IN ('pending','claimed')
      AND EXISTS(SELECT 1 FROM ${table} WHERE owner_id=? AND id=? AND revision=?)`).bind(owner,id,owner,id,revision)
  ]);
  if (result[0].meta.changes !== 1) throw new Conflict('Concurrent update');
  return {revision,changed:true};
}
export const putPlan = (db, {owner,id,payload}, expected = null) => replace(db,'push_plans_v1','payload',owner,id,payload,expected);
export const putDevice = (db, {owner,id,subscription}, expected = null) => replace(db,'push_devices_v1','subscription',owner,id,subscription,expected);

export async function enqueue(db, {owner,planId,deviceId,dueAt,expiresAt}) {
  if (![owner,planId,deviceId].every(text) || !minute(dueAt) || !minute(expiresAt) || expiresAt <= dueAt) throw new TypeError('Invalid occurrence');
  const id = crypto.randomUUID();
  const result = await db.prepare(`INSERT INTO push_jobs_v1(id,owner_id,plan_id,plan_revision,device_id,device_revision,due_at,expires_at,next_at)
    SELECT ?,p.owner_id,p.id,p.revision,d.id,d.revision,?,?,? FROM push_plans_v1 p
    JOIN push_devices_v1 d ON d.owner_id=p.owner_id
    WHERE p.owner_id=? AND p.id=? AND d.id=? AND d.active=1
    ON CONFLICT(owner_id,plan_id,plan_revision,device_id,device_revision,due_at) DO NOTHING`)
    .bind(id,dueAt,expiresAt,dueAt,owner,planId,deviceId).run();
  return {created:result.meta.changes === 1};
}
const active = `EXISTS(SELECT 1 FROM push_plans_v1 p JOIN push_devices_v1 d ON d.owner_id=p.owner_id
  WHERE p.owner_id=push_jobs_v1.owner_id AND p.id=push_jobs_v1.plan_id AND p.revision=push_jobs_v1.plan_revision
    AND d.id=push_jobs_v1.device_id AND d.revision=push_jobs_v1.device_revision AND d.active=1)`;

export async function dispatchDue(db, {now, send, limit = 500, leaseMs = 60000, maxAttempts = 4}) {
  if (!Number.isSafeInteger(now) || now < 0 || typeof send !== 'function' || !Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new TypeError('Invalid dispatch options');
  // Reads only when no work is due. Bounded queries use separate state/time indexes.
  const rows = await db.prepare(`SELECT * FROM push_jobs_v1 WHERE state='pending' AND next_at<=?
    UNION ALL SELECT * FROM push_jobs_v1 WHERE state='claimed' AND lease_until<=?
    ORDER BY next_at,id LIMIT ?`).bind(now,now,limit).all();
  const summary = {claimed:0,sent:0,retry:0,expired:0,gone:0,failed:0};
  for (const job of rows.results) {
    const lease = crypto.randomUUID();
    const claimed = await db.prepare(`UPDATE push_jobs_v1 SET state='claimed',lease=?,lease_until=?,attempts=attempts+1
      WHERE id=? AND ((state='pending' AND next_at<=?) OR (state='claimed' AND lease_until<=?)) AND ${active}
      RETURNING *`).bind(lease,now+leaseMs,job.id,now,now).first();
    if (!claimed) continue;
    summary.claimed++;
    const finish = async (state,next = now) => db.prepare(`UPDATE push_jobs_v1 SET state=?,next_at=?,lease=NULL,lease_until=NULL WHERE id=? AND state='claimed' AND lease=?`).bind(state,next,job.id,lease).run();
    if (claimed.expires_at <= now) {await finish('expired');summary.expired++;continue;}
    if (claimed.attempts > maxAttempts) {await finish('failed');summary.failed++;continue;}
    // Re-read versions just before external I/O. An edit during I/O remains a
    // documented race; transactions cannot make external Web Push exactly once.
    const device = await db.prepare(`SELECT d.subscription FROM push_devices_v1 d JOIN push_plans_v1 p ON p.owner_id=d.owner_id
      WHERE d.owner_id=? AND d.id=? AND d.revision=? AND d.active=1 AND p.id=? AND p.revision=?`)
      .bind(job.owner_id,job.device_id,job.device_revision,job.plan_id,job.plan_revision).first();
    if (!device) {await finish('failed');summary.failed++;continue;}
    let response;
    try { response = await send(JSON.parse(device.subscription), {occurrenceId:job.id,dueAt:job.due_at}); }
    catch { response = {status:503}; }
    if (response?.status === 201 || response?.status === 202) {await finish('sent');summary.sent++;continue;}
    if (response?.status === 404 || response?.status === 410) {
      await db.batch([
        db.prepare('UPDATE push_devices_v1 SET active=0 WHERE owner_id=? AND id=? AND revision=? AND active=1').bind(job.owner_id,job.device_id,job.device_revision),
        db.prepare("UPDATE push_jobs_v1 SET state='gone',lease=NULL,lease_until=NULL WHERE owner_id=? AND device_id=? AND device_revision=? AND state IN ('pending','claimed')").bind(job.owner_id,job.device_id,job.device_revision)
      ]);
      summary.gone++;continue;
    }
    const transient = response?.status === 429 || response?.status >= 500;
    if (!transient || claimed.attempts >= maxAttempts) {await finish('failed');summary.failed++;continue;}
    const retryHeader = response.headers?.get?.('retry-after');
    const seconds = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader)*1000 : Date.parse(retryHeader)-now;
    const delay = Math.max(60000 * 2 ** (claimed.attempts-1), Number.isFinite(seconds) ? seconds : 0);
    const next = now + delay;
    if (!Number.isSafeInteger(next) || next >= claimed.expires_at) {await finish('expired');summary.expired++;continue;}
    await finish('pending',next);summary.retry++;
  }
  return summary;
}
