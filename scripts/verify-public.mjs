import assert from 'node:assert/strict';

const base = 'https://darkhalo.dreamnet-intel.workers.dev';
const checks = [];
for (const [path, expectedStatus] of [['/', 200], ['/health', 200],
  ['/.well-known/darkhalo.json', 200], ['/api/inspect', 404],
  ['/not-a-real-route', 404], ['/darkhalo-workspace.png', 200]]) {
  const response = await fetch(base + path, {
    signal: AbortSignal.timeout(10_000), redirect: 'error',
  });
  assert.equal(response.status, expectedStatus, `${path} status`);
  const contentType = response.headers.get('content-type') ?? '';
  let summary;
  if (path === '/') {
    assert.match(contentType, /text\/html/);
    const html = await response.text();
    assert.match(html, /og:image/);
    assert.match(html, /darkhalo-workspace\.png/);
    assert.match(response.headers.get('content-security-policy') ?? '', /connect-src 'none'/);
    summary = { headMetadata: true, outsideConnectionsDenied: true };
  } else if (['/health', '/.well-known/darkhalo.json', '/api/inspect'].includes(path)) {
    const data = await response.json();
    assert.equal(data.remoteExecution ?? false, false);
    if (path === '/health') {
      assert.equal(data.service, 'darkhalo');
      assert.equal(data.scope, 'STATIC_APP_SERVING');
      assert.equal(data.authorityGranted, false);
    } else if (path.includes('.well-known')) {
      assert.equal(data.uploads, false);
      assert.equal(data.persistence, false);
      assert.equal(data.modelCalls, false);
      assert.deepEqual(data.permissionsGranted, []);
    } else {
      assert.equal(data.error, 'REMOTE_EXECUTION_NOT_IMPLEMENTED');
    }
    summary = data;
  } else if (path.endsWith('.png')) {
    assert.match(contentType, /image\/png/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    summary = { bytes: bytes.length };
  }
  checks.push({ path, status: response.status, contentType, summary });
}
console.log(JSON.stringify({ observedAt: new Date().toISOString(), base, status: 'PASS',
  scope: 'Public static serving and narrow discovery only; not remote execution, whole-fleet health or revenue',
  requests: checks.length, checks }, null, 2));
