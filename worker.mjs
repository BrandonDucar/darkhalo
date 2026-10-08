const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Darkhalo-Scope': 'local-analysis-only',
    'Referrer-Policy': 'no-referrer',
  },
});

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) {
      return json({ error: 'REMOTE_EXECUTION_NOT_IMPLEMENTED', authorityGranted: false }, 404);
    }
    if (path === '/health' || path === '/.well-known/darkhalo.json') {
      if (!['GET', 'HEAD'].includes(request.method)) {
        const response = json({ error: 'METHOD_NOT_ALLOWED' }, 405);
        response.headers.set('Allow', 'GET, HEAD');
        return response;
      }
      const data = path === '/health'
        ? { service: 'darkhalo', version: '0.1.0', scope: 'STATIC_APP_SERVING',
          analysisRuntime: 'browser-local', remoteExecution: false, authorityGranted: false }
        : { name: 'Darkhalo', version: '0.1.0', mode: 'LOCAL_ANALYSIS',
          repository: 'https://github.com/BrandonDucar/darkhalo',
          operatingContract: 'https://github.com/BrandonDucar/darkhalo/blob/main/AGENTS.md',
          entrypoint: 'src/lib/inspect.mjs',
          cli: 'node scripts/inspect-file.mjs INPUT.json --output PRIVATE_REVIEW_CAPSULE.json',
          capabilities: ['inspect-input', 'local-revocation-filter', 'candidate-routing', 'context-compare', 'review-capsule'],
          inputVersion: 1, maxInputBytes: 2097152, remoteExecution: false, uploads: false,
          modelCalls: false, persistence: false, permissionsGranted: [],
          evidence: 'LOCAL_ANALYSIS_ONLY', capsulePurpose: 'REVIEW_ONLY' };
      const response = json(data);
      return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    return env.ASSETS.fetch(request);
  },
};
