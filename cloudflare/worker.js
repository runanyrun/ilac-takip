const ALLOWED_ORIGIN = 'https://runanyrun.github.io';
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const respond = (data, status = 200, origin = null) => new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...(origin === ALLOWED_ORIGIN ? { 'access-control-allow-origin': ALLOWED_ORIGIN, 'vary': 'Origin' } : {}) } });
const hash = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(b => b.toString(16).padStart(2, '0')).join('');
const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const validTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);


const base64url = bytes => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
};
const decode64 = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
const PUSH_HOSTS = [
  'fcm.googleapis.com', 'updates.push.services.mozilla.com',
  'web.push.apple.com'
];
const allowedPushEndpoint = url => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && u.port === '' &&
      PUSH_HOSTS.includes(u.hostname);
  } catch { return false; }
};
async function sendEmptyWebPush(subscription, env) {
  if (!allowedPushEndpoint(subscription.endpoint)) throw Error('push_host_not_allowed');
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY || !env.VAPID_CONTACT) throw Error('vapid_not_configured');
  const audience = new URL(subscription.endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = base64url(new TextEncoder().encode(JSON.stringify({ aud: audience, exp: now + 3600, sub: env.VAPID_CONTACT })));
  const signingInput = header + '.' + claims;
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput)));
  const jwt = signingInput + '.' + base64url(signature);
  // Empty payload: the service worker displays a generic reminder. No medical data leaves the server.
  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: { authorization: 'vapid t=' + jwt + ', k=' + env.VAPID_PUBLIC_KEY, ttl: '60', urgency: 'normal', 'content-length': '0' }
  });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const origin = request.headers.get('origin');
    const reply = (data, status = 200) => respond(data, status, origin);
    if (origin && origin !== ALLOWED_ORIGIN) return reply({ error: 'origin_not_allowed' }, 403);
    if (request.method === 'OPTIONS') {
      if (origin !== ALLOWED_ORIGIN) return reply({ error: 'origin_not_allowed' }, 403);
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': ALLOWED_ORIGIN, 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, if-match', 'access-control-max-age': '600', 'vary': 'Origin' } });
    }
    if (request.method === 'GET' && path === '/api/health') {
      try {
        const row = await env.DB.prepare('SELECT 1 AS ok').first();
        return reply({ ok: row?.ok === 1, database: 'connected' });
      } catch { return reply({ ok: false, database: 'unavailable' }, 503); }
    }
    // Single-use invitation. The invitation is provisioned out of band and stored hashed in D1.
    // It is never embedded in the public frontend.
    if (request.method === 'POST' && path === '/api/devices') {
      if (!(request.headers.get('content-type') || '').startsWith('application/json')) return reply({ error: 'json_required' }, 415);
      let invite;
      try {
        const raw = await request.text();
        if (raw.length > 256) return reply({ error: 'too_large' }, 413);
        invite = JSON.parse(raw)?.invite;
      } catch { return reply({ error: 'invalid_json' }, 400); }
      if (typeof invite !== 'string' || !/^[a-f0-9]{64}$/.test(invite)) return reply({ error: 'invalid_invite' }, 400);
      const inviteHash = await hash(invite);
      const id = crypto.randomUUID();
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
      const digest = await hash(token);
      try {
        const results = await env.DB.batch([
          env.DB.prepare('INSERT INTO users (id) SELECT ? WHERE EXISTS (SELECT 1 FROM enrollment_invites WHERE token_hash = ? AND used_at IS NULL)').bind(id, inviteHash),
          env.DB.prepare('UPDATE enrollment_invites SET used_at = CURRENT_TIMESTAMP, user_id = ? WHERE token_hash = ? AND used_at IS NULL').bind(id, inviteHash),
          env.DB.prepare('INSERT INTO device_credentials (user_id, token_hash) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM enrollment_invites WHERE token_hash = ? AND user_id = ?)').bind(id, digest, inviteHash, id)
        ]);
        if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1 || results[2].meta.changes !== 1) {
          return reply({ error: 'invite_unavailable' }, 403);
        }
        return reply({ userId: id, token }, 201);
      } catch { return reply({ error: 'registration_failed' }, 503); }
    }
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer [a-f0-9]{64}$/.test(authorization)) return reply({ error: 'unauthorized' }, 401);
    const digest = await hash(authorization.slice(7));
    const owner = await env.DB.prepare('SELECT user_id FROM device_credentials WHERE token_hash = ?').bind(digest).first();
    if (!owner) return reply({ error: 'unauthorized' }, 401);
    // Store browser Web Push subscriptions for the authenticated test device.
    // Actual delivery requires VAPID signing and a scheduled sender (not enabled here).
    if (path === '/api/push-subscriptions' && request.method === 'POST') {
      if (!(request.headers.get('content-type') || '').startsWith('application/json')) return reply({ error: 'json_required' }, 415);
      let subscription;
      try {
        const raw = await request.text();
        if (new TextEncoder().encode(raw).length > 8192) return reply({ error: 'too_large' }, 413);
        subscription = JSON.parse(raw);
      } catch { return reply({ error: 'invalid_json' }, 400); }
      const endpoint = subscription?.endpoint;
      const p256dh = subscription?.keys?.p256dh;
      const auth = subscription?.keys?.auth;
      let endpointUrl;
      try { endpointUrl = new URL(endpoint); } catch { return reply({ error: 'invalid_subscription' }, 400); }
      if (endpointUrl.protocol !== 'https:' || endpointUrl.username || endpointUrl.password ||
          typeof endpoint !== 'string' || endpoint.length > 2048 ||
          typeof p256dh !== 'string' || !/^[A-Za-z0-9_-]{80,120}$/.test(p256dh) ||
          typeof auth !== 'string' || !/^[A-Za-z0-9_-]{16,40}$/.test(auth)) {
        return reply({ error: 'invalid_subscription' }, 400);
      }
      try {
        const existing = await env.DB.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).first();
        if (existing && existing.user_id !== owner.user_id) return reply({ error: 'subscription_conflict' }, 409);
        if (existing) {
          await env.DB.prepare('UPDATE push_subscriptions SET p256dh = ?, auth = ? WHERE endpoint = ? AND user_id = ?').bind(p256dh, auth, endpoint, owner.user_id).run();
        } else {
          await env.DB.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), owner.user_id, endpoint, p256dh, auth).run();
        }
        return reply({ ok: true, registered: true }, 200);
      } catch { return reply({ error: 'database_error' }, 503); }
    }
    if (request.method === 'GET' && path === '/api/push/config') {
      return reply({ configured: !!(env.VAPID_PRIVATE_JWK && env.VAPID_PUBLIC_KEY && env.VAPID_CONTACT), publicKey: env.VAPID_PUBLIC_KEY || null });
    }
    if (request.method === 'POST' && path === '/api/push/test') {
      if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY || !env.VAPID_CONTACT) return reply({ error: 'vapid_not_configured' }, 503);
      const rows = await env.DB.prepare('SELECT endpoint FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 3').bind(owner.user_id).all();
      if (!rows.results.length) return reply({ error: 'subscription_missing' }, 404);
      const results = [];
      for (const subscription of rows.results) {
        try {
          const sent = await sendEmptyWebPush(subscription, env);
          results.push({ status: sent.status, accepted: sent.status === 201 || sent.status === 202 });
          if (sent.status === 404 || sent.status === 410) {
            await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').bind(owner.user_id, subscription.endpoint).run();
          }
        } catch { results.push({ status: null, accepted: false }); }
      }
      return reply({ results, accepted: results.some(r => r.accepted) }, results.some(r => r.accepted) ? 200 : 502);
    }
    // Lossless opt-in backup storage. The server never modifies the backup's drug fields.
    if (path === '/api/backup' && request.method === 'GET') {
      const row = await env.DB.prepare('SELECT payload, revision, updated_at FROM user_backups WHERE user_id = ?').bind(owner.user_id).first();
      if (!row) return reply({ error: 'backup_not_found' }, 404);
      return reply({ backup: JSON.parse(row.payload), revision: row.revision, updatedAt: row.updated_at });
    }
    if (path === '/api/backup' && request.method === 'PUT') {
      if (!(request.headers.get('content-type') || '').startsWith('application/json')) return reply({ error: 'json_required' }, 415);
      const expected = request.headers.get('if-match');
      if (expected !== '*' && !(typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected))) {
        return reply({ error: 'revision_required' }, 428);
      }
      let payload;
      try {
        const raw = await request.text();
        if (new TextEncoder().encode(raw).length > 262144) return reply({ error: 'too_large' }, 413);
        payload = JSON.parse(raw);
      } catch { return reply({ error: 'invalid_json' }, 400); }
      if (!payload || payload.format !== 'ilac-takip-backup' || payload.version !== 2 ||
          !Array.isArray(payload.drugs) || !Array.isArray(payload.history) ||
          !payload.takenLog || typeof payload.takenLog !== 'object' || Array.isArray(payload.takenLog) ||
          payload.drugs.length > 1000 || payload.history.length > 20000 ||
          payload.drugs.some(d => !d || typeof d !== 'object' || typeof d.name !== 'string' || !d.name.trim())) {
        return reply({ error: 'invalid_backup' }, 400);
      }
      const serialized = JSON.stringify(payload);
      if (new TextEncoder().encode(serialized).length > 262144) return reply({ error: 'too_large' }, 413);
      const revision = await hash(serialized);
      const current = await env.DB.prepare('SELECT revision FROM user_backups WHERE user_id = ?').bind(owner.user_id).first();
      if ((current && expected !== current.revision) || (!current && expected !== '*')) return reply({ error: 'revision_conflict' }, 409);
      if (current && current.revision === revision) return reply({ ok: true, revision, unchanged: true });
      const result = current
        ? await env.DB.prepare('UPDATE user_backups SET payload = ?, revision = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revision = ?').bind(serialized, revision, owner.user_id, expected).run()
        : await env.DB.prepare('INSERT OR IGNORE INTO user_backups (user_id, payload, revision) VALUES (?, ?, ?)').bind(owner.user_id, serialized, revision).run();
      if (result.meta.changes !== 1) return reply({ error: 'revision_conflict' }, 409);
      return reply({ ok: true, revision }, 200);
    }
    if (request.method === 'GET' && path === '/api/medications') {
      const rows = await env.DB.prepare('SELECT m.id, m.name, m.dosage, m.usage_condition, m.active, s.local_time FROM medications m LEFT JOIN schedules s ON s.medication_id = m.id WHERE m.user_id = ? ORDER BY m.created_at, m.id, s.local_time').bind(owner.user_id).all();
      const medications = [];
      for (const row of rows.results) {
        let item = medications[medications.length - 1];
        if (!item || item.id !== row.id.slice(owner.user_id.length + 1)) {
          item = { id: row.id.slice(owner.user_id.length + 1), name: row.name, dosage: row.dosage, usage_condition: row.usage_condition, active: row.active, times: [] };
          medications.push(item);
        }
        if (row.local_time !== null) item.times.push(row.local_time);
      }
      return reply({ medications });
    }
    if (request.method === 'POST' && path === '/api/medications') {
      if (!(request.headers.get('content-type') || '').startsWith('application/json')) return reply({ error: 'json_required' }, 415);
      if (Number(request.headers.get('content-length') || 0) > 16384) return reply({ error: 'too_large' }, 413);
      let body;
      try {
        const raw = await request.text();
        if (raw.length > 16384) return reply({ error: 'too_large' }, 413);
        body = JSON.parse(raw);
      } catch { return reply({ error: 'invalid_json' }, 400); }
      if (!body || !validId(body.id) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 160 ||
          (body.dosage != null && (typeof body.dosage !== 'string' || body.dosage.length > 100)) ||
          (body.usage_condition != null && !['ac', 'tok'].includes(body.usage_condition)) ||
          !Array.isArray(body.times) || body.times.length > 12 || !body.times.every(validTime) || new Set(body.times).size !== body.times.length) {
        return reply({ error: 'invalid_medication' }, 400);
      }
      try {
        const dbId = owner.user_id + ':' + body.id;
        const exists = await env.DB.prepare('SELECT user_id FROM medications WHERE id = ?').bind(dbId).first();
        if (exists && exists.user_id !== owner.user_id) return reply({ error: 'conflict' }, 409);
        if (exists) return reply({ error: 'already_exists' }, 409);
        await env.DB.batch([
          env.DB.prepare('INSERT INTO medications (id,user_id,name,dosage,usage_condition) VALUES (?,?,?,?,?)').bind(dbId, owner.user_id, body.name.trim(), body.dosage || null, body.usage_condition || null),
          ...body.times.map((time, index) => env.DB.prepare('INSERT INTO schedules (id,medication_id,local_time) VALUES (?,?,?)').bind(dbId + '_' + index, dbId, time))
        ]);
        return reply({ ok: true, id: body.id }, 201);
      } catch { return reply({ error: 'database_error' }, 503); }
    }
    return reply({ error: 'not_found' }, 404);
  }
};
