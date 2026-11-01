const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const hash = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(b => b.toString(16).padStart(2, '0')).join('');
const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const validTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/api/health') {
      try {
        const row = await env.DB.prepare('SELECT 1 AS ok').first();
        return respond({ ok: row?.ok === 1, database: 'connected' });
      } catch { return respond({ ok: false, database: 'unavailable' }, 503); }
    }
    // Fail closed until a server-side registration secret and abuse controls are configured.
    if (!env.REGISTRATION_SECRET) return respond({ error: 'registration_not_configured' }, 503);
    if (request.method === 'POST' && path === '/api/devices') {
      if (request.headers.get('x-registration-secret') !== env.REGISTRATION_SECRET) return respond({ error: 'forbidden' }, 403);
      const id = crypto.randomUUID();
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
      const digest = await hash(token);
      await env.DB.batch([
        env.DB.prepare('INSERT INTO users (id) VALUES (?)').bind(id),
        env.DB.prepare('INSERT INTO device_credentials (user_id, token_hash) VALUES (?, ?)').bind(id, digest)
      ]);
      return respond({ userId: id, token }, 201);
    }
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer [a-f0-9]{64}$/.test(authorization)) return respond({ error: 'unauthorized' }, 401);
    const digest = await hash(authorization.slice(7));
    const owner = await env.DB.prepare('SELECT user_id FROM device_credentials WHERE token_hash = ?').bind(digest).first();
    if (!owner) return respond({ error: 'unauthorized' }, 401);
    if (request.method === 'GET' && path === '/api/medications') {
      const rows = await env.DB.prepare('SELECT id, name, dosage, usage_condition, active FROM medications WHERE user_id = ? ORDER BY created_at').bind(owner.user_id).all();
      return respond({ medications: rows.results });
    }
    if (request.method === 'POST' && path === '/api/medications') {
      if (!(request.headers.get('content-type') || '').startsWith('application/json')) return respond({ error: 'json_required' }, 415);
      if (Number(request.headers.get('content-length') || 0) > 16384) return respond({ error: 'too_large' }, 413);
      let body;
      try { body = await request.json(); } catch { return respond({ error: 'invalid_json' }, 400); }
      if (!body || !validId(body.id) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 160 ||
          (body.dosage != null && (typeof body.dosage !== 'string' || body.dosage.length > 100)) ||
          (body.usage_condition != null && !['ac', 'tok'].includes(body.usage_condition)) ||
          !Array.isArray(body.times) || body.times.length > 12 || !body.times.every(validTime)) {
        return respond({ error: 'invalid_medication' }, 400);
      }
      try {
        const exists = await env.DB.prepare('SELECT user_id FROM medications WHERE id = ?').bind(body.id).first();
        if (exists && exists.user_id !== owner.user_id) return respond({ error: 'conflict' }, 409);
        if (exists) return respond({ error: 'already_exists' }, 409);
        await env.DB.batch([
          env.DB.prepare('INSERT INTO medications (id,user_id,name,dosage,usage_condition) VALUES (?,?,?,?,?)').bind(body.id, owner.user_id, body.name.trim(), body.dosage || null, body.usage_condition || null),
          ...body.times.map((time, index) => env.DB.prepare('INSERT INTO schedules (id,medication_id,local_time) VALUES (?,?,?)').bind(body.id + '_' + index, body.id, time))
        ]);
        return respond({ ok: true, id: body.id }, 201);
      } catch { return respond({ error: 'database_error' }, 503); }
    }
    return respond({ error: 'not_found' }, 404);
  }
};
