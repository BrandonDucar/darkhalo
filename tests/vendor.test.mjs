import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { RetrievalGatekeeper } from '../src/lib/vendor/RetrievalGatekeeper.mjs';
import { sha256 } from '../src/lib/hash.mjs';

const read = name => readFileSync(new URL('../src/lib/vendor/' + name, import.meta.url));
const nativeHash = text => createHash('sha256').update(text).digest('hex');
const banner = '// Darkhalo browser adaptation; see NOTICE.md and provenance.json.\n';

test('vendor byte hashes and original compressor source are pinned', () => {
  const provenance = JSON.parse(read('provenance.json'));
  assert.equal(provenance.head, '284449f3c4c53688c1c97de8d822aeddc7bfcbae');
  assert.equal(provenance.sourceFilesDirty, false);
  assert.equal(nativeHash(read('ContextCompressor.ts')), provenance.sources[1].sha256);
  for (const file of provenance.generated) assert.equal(nativeHash(read(file.path)), file.sha256);
  assert.equal(read('ContextCompressor.mjs').toString(), banner + stripTypeScriptTypes(read('ContextCompressor.ts').toString(), { mode: 'strip' }).replace(/[ \t]+$/gm, ''));
});

test('gate reverses to the exact upstream byte hash after only browser substitutions', () => {
  const original = read('RetrievalGatekeeper.mjs').toString().slice(banner.length)
    .replace("import { sha256 as browserSha256 } from '../hash.mjs';", "import { createHash } from 'node:crypto';")
    .replace('const performance = globalThis.performance;', "import { performance } from 'node:perf_hooks';")
    .replace('return browserSha256(content);', "return createHash('sha256').update(content).digest('hex');");
  assert.equal(nativeHash(original), JSON.parse(read('provenance.json')).sources[0].sha256);
});

test('noble adapter matches native SHA-256 for UTF-8, empty and byte inputs', () => {
  for (const text of ['', 'abc', 'supplied author', '\u00e9\u{1f680}', 'line\nline']) assert.equal(sha256(text), nativeHash(text));
  assert.equal(sha256(new Uint8Array([0, 1, 255])), nativeHash(new Uint8Array([0, 1, 255])));
  assert.deepEqual(new RetrievalGatekeeper().computeHashes('text', 'signer', 'author'), {
    contentHash: nativeHash('text'), authorityHash: nativeHash('signer:author:text')
  });
});

test('unaltered gate checks provenance, author identity, upstream revocation and thread pruning', () => {
  const gate = new RetrievalGatekeeper(['revoked']);
  const items = [ { id: 'anonymous', text: 'a', threadOwner: 'owner' },
    { id: 'direct', author: 'revoked', text: 'a' }, { id: 'derived', author: 'bob', derivedFrom: ['revoked'], text: 'a' },
    { id: 'root', author: 'alice', text: 'a' }, { id: 'child', parentId: 'root', author: 'revoked', text: 'a' } ];
  const filtered = gate.filterCandidates(items);
  assert.deepEqual(filtered.allowed.map(row => row.id), ['root']);
  assert.deepEqual(filtered.blocked.map(row => row.gateReason), ['UNPROVENANCED_ANONYMOUS_MEMORY', 'REVOKED_AUTHORITY', 'DERIVED_UPSTREAM_REVOKED:revoked', 'REVOKED_AUTHORITY']);
  assert.equal(gate.repairThread(items, 'root').prunedCount, 1);
  gate.registerRevocation('alice', 0);
  assert.equal(gate.repairThread(items, 'root').root, null);
});

test('browser runtime library graph does not import Node or access network/storage', () => {
  const names = ['inspect.mjs', 'validation.mjs', 'compression.mjs', 'secrets.mjs', 'hash.mjs', 'capsule.mjs', 'contract.mjs',
    'vendor/RetrievalGatekeeper.mjs', 'vendor/ContextCompressor.mjs'];
  for (const name of names) {
    const source = readFileSync(new URL('../src/lib/' + name, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /(?:from\s*|import\s*\()['"]node:/);
    assert.doesNotMatch(source, /\b(?:fetch|eval|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket)\s*[.(]/);
  }
});
