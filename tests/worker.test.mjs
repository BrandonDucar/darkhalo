import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';

const request = (path, method = 'GET') => new Request(`https://example.invalid${path}`, { method });
const env = { ASSETS: { fetch: () => new Response('asset', { status: 200 }) } };

test('health names its narrow static serving scope, not fleet health', async () => {
  const response = await worker.fetch(request('/health'), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.scope, 'STATIC_APP_SERVING');
  assert.equal(body.remoteExecution, false);
  assert.equal(body.authorityGranted, false);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('agent discovery describes real local entrypoints and no permissions', async () => {
  const response = await worker.fetch(request('/.well-known/darkhalo.json'), env);
  const body = await response.json();
  assert.equal(body.entrypoint, 'src/lib/inspect.mjs');
  assert.equal(body.remoteExecution, false);
  assert.equal(body.uploads, false);
  assert.equal(body.modelCalls, false);
  assert.deepEqual(body.permissionsGranted, []);
});

test('remote analysis and dispatch routes are explicitly not implemented', async () => {
  for (const method of ['GET', 'POST']) {
    const response = await worker.fetch(request('/api/inspect', method), env);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).authorityGranted, false);
  }
});

test('read-only discovery and health refuse mutation, HEAD has no body', async () => {
  for (const path of ['/health', '/.well-known/darkhalo.json']) {
    const refused = await worker.fetch(request(path, 'POST'), env);
    assert.equal(refused.status, 405);
    assert.equal(refused.headers.get('Allow'), 'GET, HEAD');
    const head = await worker.fetch(request(path, 'HEAD'), env);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  }
});

test('ordinary asset requests reuse the provider static asset handler', async () => {
  assert.equal(await (await worker.fetch(request('/'), env)).text(), 'asset');
});
