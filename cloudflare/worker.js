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
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': ALLOWED_ORIGIN, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600', 'vary': 'Origin' } });
    }
    if (request.method === 'GET' && path === '/api/health') {
      try {
        const row = await env.DB.prepare('SELECT 1 AS ok').first();
        return reply({ ok: row?.ok === 1, database: 'connected' });
      } catch { return reply({ ok: false, database: 'unavailable' }, 503); }
    }
    // Fail closed until a server-side registration secret and abuse controls are configured.
    if (!env.REGISTRATION_SECRET) return reply({ error: 'registration_not_configured' }, 503);
    if (request.method === 'POST' && path === '/api/devices') {
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
    if (request.method === 'GET' && path === '/api/medications') {
      const rows = await env.DB.prepare('SELECT id, name, dosage, usage_condition, active FROM medications WHERE user_id = ? ORDER BY created_at').bind(owner.user_id).all();
      return reply({ medications: rows.results });
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
        const exists = await env.DB.prepare('SELECT user_id FROM medications WHERE id = ?').bind(body.id).first();
        if (exists && exists.user_id !== owner.user_id) return reply({ error: 'conflict' }, 409);
        if (exists) return reply({ error: 'already_exists' }, 409);
        await env.DB.batch([
          env.DB.prepare('INSERT INTO medications (id,user_id,name,dosage,usage_condition) VALUES (?,?,?,?,?)').bind(body.id, owner.user_id, body.name.trim(), body.dosage || null, body.usage_condition || null),
          ...body.times.map((time, index) => env.DB.prepare('INSERT INTO schedules (id,medication_id,local_time) VALUES (?,?,?)').bind(body.id + '_' + index, body.id, time))
        ]);
        return reply({ ok: true, id: body.id }, 201);
      } catch { return reply({ error: 'database_error' }, 503); }
    }
    return reply({ error: 'not_found' }, 404);
  }
};
