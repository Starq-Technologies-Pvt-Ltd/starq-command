const READ_METHODS = new Set(['GET', 'HEAD']);
const API_PATHS = new Set(['/api/health', '/api/surface', '/api/building', '/api/building/health']);

function reply(res, status, body, allow = null) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  if (allow) res.setHeader('allow', allow);
  res.end(JSON.stringify({ error: body }));
}

/** HTTP boundary installed before Vite's internal middleware and proxy. */
export function observationBoundary(req, res, next) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname); }
  catch { return reply(res, 400, 'invalid request path'); }

  if (!READ_METHODS.has(req.method)) return reply(res, 405, 'observation-only Command accepts GET and HEAD', 'GET, HEAD');
  if (pathname === '/__open-in-editor' || pathname.startsWith('/__open-in-editor/')) {
    return reply(res, 404, 'route unavailable in observation-only Command');
  }
  if ((pathname === '/api' || pathname.startsWith('/api/')) && !API_PATHS.has(pathname)) {
    return reply(res, 404, 'route outside the observation-only projection allowlist');
  }
  return next();
}

export function observationBoundaryPlugin() {
  const install = (server) => { server.middlewares.use(observationBoundary); };
  return {
    name: 'starq-command-observation-boundary',
    // Vite calls configure hooks before installing its proxy/editor middleware.
    configureServer: install,
    configurePreviewServer: install,
  };
}
