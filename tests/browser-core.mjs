// Run explicitly: node tests/browser-core.mjs. Builds in memory; no server or files.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { inspect, exportCapsule } from '../src/lib/inspect.mjs';

const bundle = await build({ configFile: false, publicDir: false, logLevel: 'silent',
  build: { write: false, emptyOutDir: false, minify: false,
    lib: { entry: resolve('src/lib/inspect.mjs'), name: 'DarkhaloCore', formats: ['iife'] } } });
const chunk = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(item => item.output).find(output => output.type === 'chunk');
assert.ok(chunk);
const browser = await chromium.launch({ headless: true, channel: process.env.DARKHALO_TEST_BROWSER || 'msedge' });
try {
  const context = await browser.newContext({ offline: true });
  const requests = [];
  await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  const page = await context.newPage();
  await page.evaluate(() => {
    globalThis.fetch = () => { throw new Error('Network forbidden'); };
    for (const name of ['localStorage', 'sessionStorage', 'indexedDB']) {
      Object.defineProperty(globalThis, name, { get() { throw new Error('Storage forbidden'); } });
    }
  });
  await page.addScriptTag({ content: chunk.code });
  const fixtures = [
    { version: 1, records: [{ id: 'a', author: 'alice', text: 'Please note that supplier research is available.' }],
      cells: [{ id: 'research', label: 'Research', terms: ['supplier'] }] },
    { version: 1, records: [{ id: 'json', author: 'bob', text: '{"note":"please note that"}' },
      { id: 'marker', author: 'bob', text: '__DREAMNET_PROTECTED_BLOCK_0__' },
      { id: 'secret', author: 'bob', text: 'supplier api_key=syntheticfixture012345' }] },
    { version: 1, records: [{ id: 'derived', author: 'other', text: 'supplier', derivedFrom: ['source'] },
      { id: 'source', author: 'alice', text: 'supplier' }], revokedAuthorities: ['alice'] },
    { version: 1, records: [{ id: 'unicode', author: 'alice', text: '\u00e9\u{1f680}' }] },
    { version: 1, records: [{ id: 'url', author: 'bob', text: 'supplier',
      sourceUrl: 'https://u:p@example.invalid/source', signerUuid: 'supplied-signer',
      authorityDigest: 'supplied-digest', derivedFrom: ['external-source'], threadOwner: 'owner' }] }
  ];
  for (const fixture of fixtures) {
    const actual = await page.evaluate(input => {
      const result = globalThis.DarkhaloCore.inspect(input);
      return { result, capsule: globalThis.DarkhaloCore.exportCapsule(result) };
    }, fixture);
    const result = inspect(fixture);
    assert.deepEqual(actual, { result, capsule: exportCapsule(result) });
  }
  assert.deepEqual(requests, []);
  console.log(`Browser core PASS: ${fixtures.length} fixtures, native browser/Node parity, no network/storage, bundle ${chunk.code.length} characters.`);
} finally {
  await browser.close();
}
