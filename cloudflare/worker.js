const ALLOWED_ORIGIN = 'https://runanyrun.github.io';
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const respond = (data, status = 200, origin = null) => new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...(origin === ALLOWED_ORIGIN ? { 'access-control-allow-origin': ALLOWED_ORIGIN, 'vary': 'Origin' } : {}) } });
const hash = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(b => b.toString(16).padStart(2, '0')).join('');
const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const validTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

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
    // Fail closed until a server-side registration secret and abuse controls are configured.
    if (request.method === 'POST' && path === '/api/devices') {
      if (!env.REGISTRATION_SECRET) return reply({ error: 'registration_not_configured' }, 503);
      if (request.headers.get('x-registration-secret') !== env.REGISTRATION_SECRET) return reply({ error: 'forbidden' }, 403);
      const id = crypto.randomUUID();
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
      const digest = await hash(token);
      await env.DB.batch([
        env.DB.prepare('INSERT INTO users (id) VALUES (?)').bind(id),
        env.DB.prepare('INSERT INTO device_credentials (user_id, token_hash) VALUES (?, ?)').bind(id, digest)
      ]);
      return reply({ userId: id, token }, 201);
    }
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer [a-f0-9]{64}$/.test(authorization)) return reply({ error: 'unauthorized' }, 401);
    const digest = await hash(authorization.slice(7));
    const owner = await env.DB.prepare('SELECT user_id FROM device_credentials WHERE token_hash = ?').bind(digest).first();
    if (!owner) return reply({ error: 'unauthorized' }, 401);
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
