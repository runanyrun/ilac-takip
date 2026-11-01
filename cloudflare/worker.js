export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/api/health') {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
      });
    }
    try {
      const result = await env.DB.prepare('SELECT 1 AS ok').first();
      return new Response(JSON.stringify({ ok: result?.ok === 1, database: 'connected' }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
      });
    } catch {
      return new Response(JSON.stringify({ ok: false, database: 'unavailable' }), {
        status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
      });
    }
  }
};
