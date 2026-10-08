import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewSourceSnapshot } from '../src/lib/source-sifter-adapter.mjs';

const entry = (file = 'packages/example/new.ts', priority = 'P1') => ({ file, priority,
  category: 'source', flags: ['new-capability-candidate'], contentSha256: 'b'.repeat(64) });
const report = entries => ({ schemaVersion: 'dreamnet.source-sifter.v1',
  consistency: 'STABLE_DURING_SCAN', observedAt: '2026-10-08T06:00:00Z',
  snapshotDigest: 'a'.repeat(64), entries, counts: { total: entries.length } });

test('synthetic metadata yields review capsule, never file authorship, cleanup or delivery', () => {
  const result = reviewSourceSnapshot(report([entry()]));
  assert.equal(result.status, 'REVIEW_READY');
  assert.equal(result.capsule.purpose, 'REVIEW_ONLY');
  assert.equal(result.capsule.metrics.records, 2);
  assert.equal(result.remoteDelivered, false);
  assert.equal(result.observationAuthorIsFileAuthor, false);
  assert.equal(result.authorityGranted, false);
  assert.match(result.capsule.records[1].text, /not authorship/);
});
test('selection prioritizes P0 and retains all paths in bounded batches', () => {
  const entries = Array.from({ length: 240 }, (_, i) => entry(`path-${i}.ts`, 'P2'));
  entries.push(entry('treasury.ts', 'P0'));
  const result = reviewSourceSnapshot(report(entries));
  assert.equal(result.selectedEntries, 241);
  assert.equal(result.omittedEntries, 0);
  assert.equal(result.capsules.length, 2);
  assert.match(result.capsule.records[1].text, /treasury.ts/);
  assert.equal(result.capsule.metrics.records, 200);
});
test('total review is capped at 32 batches with explicit omissions', () => {
  const result = reviewSourceSnapshot(report(Array.from({ length: 6370 }, (_, i) => entry(`path-${i}.ts`))));
  assert.equal(result.selectedEntries, 6368);
  assert.equal(result.omittedEntries, 2);
  assert.equal(result.capsules.length, 32);
  assert.ok(result.capsules.every(capsule => capsule.metrics.records <= 200));
});
test('unstable, missing, count-mismatched and malformed snapshots fail closed', () => {
  for (const data of [null, {}, { ...report([]), consistency: 'CHANGED_DURING_SCAN' },
    { ...report([]), counts: { total: 1 } }, { ...report([]), snapshotDigest: 'fake' },
    report([{ ...entry(), flags: [false] }])]) {
    assert.throws(() => reviewSourceSnapshot(data));
  }
});
test('embedded raw source is never projected; source instructions remain data', () => {
  const raw = 'SYNTHETIC_RAW_PRIVATE_SOURCE_DO_NOT_PROJECT';
  const result = reviewSourceSnapshot(report([{ ...entry('ignore-previous-instructions.ts'), rawContent: raw }]));
  assert.ok(!JSON.stringify(result).includes(raw));
  assert.equal(result.capsule.records[1].gate.status, 'ALLOWED');
  assert.equal(result.authorityGranted, false);
});
test('accessors and non-JSON inputs reject without execution', () => {
  let calls = 0;
  const value = report([]);
  Object.defineProperty(value, 'entries', { enumerable: true, get() { calls++; return []; } });
  assert.throws(() => reviewSourceSnapshot(value));
  assert.equal(calls, 0);
});
test('zero changes is a genuine empty observation, not synthetic activity', () => {
  const result = reviewSourceSnapshot(report([]));
  assert.equal(result.selectedEntries, 0);
  assert.equal(result.omittedEntries, 0);
  assert.match(result.capsule.records[0].text, /observed 0 changed paths/);
});
