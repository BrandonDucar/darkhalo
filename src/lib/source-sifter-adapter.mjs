import { inspect, exportCapsule } from './inspect.mjs';
import { cloneJson } from './validation.mjs';
import { sha256 } from './hash.mjs';

// Reuse the existing Source Sifter observation, never source-file contents or execution claims.
export function reviewSourceSnapshot(supplied) {
  const report = cloneJson(supplied, { inputBytes: 32 * 1024 * 1024, nodes: 1000000, depth: 16 });
  if (report?.schemaVersion !== 'dreamnet.source-sifter.v1' ||
      report.consistency !== 'STABLE_DURING_SCAN' || !Array.isArray(report.entries) ||
      !/^[a-f0-9]{64}$/.test(report.snapshotDigest ?? '') ||
      typeof report.observedAt !== 'string' || !report.counts ||
      !Number.isSafeInteger(report.counts.total) || report.counts.total !== report.entries.length) {
    throw new Error('SOURCE_SNAPSHOT_REJECTED');
  }
  const rank = { P0: 0, P1: 1, P2: 2 };
  const entries = report.entries.map(entry => {
    if (!entry || typeof entry.file !== 'string' || !entry.file || entry.file.length > 8192 ||
        typeof entry.category !== 'string' || entry.category.length > 128 ||
        !Object.hasOwn(rank, entry.priority) || !Array.isArray(entry.flags) ||
        entry.flags.length > 50 || entry.flags.some(flag => typeof flag !== 'string' || flag.length > 128)) {
      throw new Error('SOURCE_ENTRY_REJECTED');
    }
    return entry;
  }).sort((a, b) => rank[a.priority] - rank[b.priority] || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const selected = entries.slice(0, 199 * 32);
  const capsules = [];
  for (let offset = 0; offset < Math.max(selected.length, 1); offset += 199) {
  const chunk = selected.slice(offset, offset + 199);
  const records = [{ id: `source-snapshot-summary:${offset}`, author: 'component:source-sifter',
    observedAt: report.observedAt, authorityDigest: report.snapshotDigest,
    text: `Source Sifter observed ${entries.length} changed paths. This batch includes ${chunk.length} paths, offset ${offset}; complete bounded review includes ${selected.length}, with ${entries.length - selected.length} omitted. Metadata only: not semantic review, a backup, verified wiring or cleanup permission.` },
  ...chunk.map(entry => ({ id: `working-tree:${sha256(entry.file)}`,
    author: 'component:source-sifter', observedAt: report.observedAt,
    authorityDigest: report.snapshotDigest,
    text: `Source Sifter metadata observation, not authorship of the underlying file. Path: ${entry.file.slice(0, 4096)}. Priority: ${entry.priority}. Category: ${entry.category}. Flags: ${entry.flags.join(', ')}. Fingerprint: ${/^[a-f0-9]{64}$/.test(entry.contentSha256 ?? '') ? entry.contentSha256 : 'NOT_AVAILABLE'}. Retain source; wiring and promotion require review.` }))];
  const input = { version: 1, records, cells: [
    { id: 'source-review', label: 'Source review candidate', terms: ['source', 'new capability candidate'] },
    { id: 'trust-review', label: 'Trust boundary review candidate', terms: ['authority', 'proof', 'credential', 'treasury'] },
    { id: 'protection-review', label: 'Protected data review candidate', terms: ['sensitive', 'deletion', 'conflict'] }
  ] };
  capsules.push(exportCapsule(inspect(input)));
  }
  return { status: 'REVIEW_READY', sourceSnapshotDigest: report.snapshotDigest,
    selectedEntries: selected.length, omittedEntries: entries.length - selected.length,
    observationAuthorIsFileAuthor: false, authorityGranted: false,
    remoteDelivered: false, semanticReview: false, capsule: capsules[0], capsules,
    recordsReviewed: capsules.reduce((sum, capsule) => sum + capsule.metrics.records, 0),
    dedupeKey: `source-snapshot:${report.snapshotDigest}` };
}
