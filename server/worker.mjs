import assets from './assets.js';
const json = (value, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'private, no-store'}});
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) {
      if (url.pathname.startsWith('/api/')) return json({error: 'Sign in to continue.'}, 401);
      return Response.redirect(new URL('/signin-with-chatgpt?return_to=%2F', url), 302);
    }
    if (url.pathname === '/api/workspace') {
      try {
        if (request.method === 'GET') {
          const row = await env.DB.prepare('SELECT state, revision FROM workspaces WHERE owner = ?').bind(owner).first();
          return json(row ? {state: JSON.parse(row.state), revision: row.revision} : {state: null, revision: 0});
        }
        if (request.method !== 'PUT') return json({error: 'Method not allowed'}, 405);
        if (request.headers.get('origin') !== url.origin || !request.headers.get('content-type')?.startsWith('application/json')) return json({error: 'Invalid request origin'}, 403);
        const text = await request.text();
        if (text.length > 2000000) return json({error: 'Workspace exceeds 2 MB. Export a backup and reduce old records.'}, 413);
        const body = JSON.parse(text);
        if (!Number.isSafeInteger(body.revision) || body.revision < 0 || !body.state || !Array.isArray(body.state.recipes) || !body.state.recipes.length || !Array.isArray(body.state.lots) || !Array.isArray(body.state.orders)) return json({error: 'Invalid workspace'}, 400);
        const data = JSON.stringify(body.state);
        const now = new Date().toISOString();
        const result = body.revision === 0
          ? await env.DB.prepare('INSERT INTO workspaces (owner, state, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(owner) DO NOTHING').bind(owner, data, now).run()
          : await env.DB.prepare('UPDATE workspaces SET state = ?, revision = revision + 1, updated_at = ? WHERE owner = ? AND revision = ?').bind(data, now, owner, body.revision).run();
        if (!result.meta.changes) return json({error: 'A newer version was saved on another device.'}, 409);
        return json({revision: body.revision + 1});
      } catch (error) {
        if (error instanceof SyntaxError) return json({error: 'Invalid JSON'}, 400);
        console.error('Workspace storage unavailable');
        return json({error: 'Shared storage is temporarily unavailable. Your edits are still on this device.'}, 503);
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status: 405});
    const asset = assets[url.pathname === '/' ? '/index.html' : url.pathname];
    if (!asset) return new Response('Not found', {status: 404});
    return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.data), c => c.charCodeAt(0)), {headers: {'Content-Type': asset.type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin'}});
  }
};
