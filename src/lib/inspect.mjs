import { RetrievalGatekeeper } from './vendor/RetrievalGatekeeper.mjs';
import { sha256 } from './hash.mjs';
import { ORIGINAL_FIELDS, validateInput } from './validation.mjs';
import { REDACTED, hasSecret, redact } from './secrets.mjs';
import { compressForReview, instructionLike } from './compression.mjs';

const BASE_WARNINGS = [
  'LOCAL_ANALYSIS_ONLY: supplied provenance is not authenticated, verified, or execution authority.',
  'ROUTE_CANDIDATES_ONLY: keyword matches are review suggestions, not trusted gold or dispatches.',
  'TOKEN_ESTIMATES_ONLY: ceil(characters / 4), not model tokenizer counts or economic savings.',
  'COMPRESSION_REVIEW_ONLY: prose changes may be lossy; structural and invariant-sensitive content is not compressed.',
  'SECRET_HEURISTIC_ONLY: redaction is best-effort, not a guarantee; keep inputs and results private.'
];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const words = text => text.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, ' ').trim();

function routes(text, cells) {
  const haystack = ` ${words(text)} `;
  const candidates = cells.flatMap(cell => {
    const terms = cell.normalizedTerms;
    const matchedTerms = terms.filter(term => haystack.includes(` ${term} `));
    return matchedTerms.length ? [{ cellId: cell.id, label: cell.label,
      score: Number((matchedTerms.length / terms.length).toFixed(4)), matchedTerms: matchedTerms.slice(0, 10),
      truncated: matchedTerms.length > 10 }] : [];
  }).sort((a, b) => b.score - a.score || compare(a.cellId, b.cellId));
  return { truncated: candidates.length > 10 || candidates.some(candidate => candidate.truncated),
    candidates: candidates.slice(0, 10).map(({ truncated, ...candidate }) => candidate) };
}

function applyLocalGate(records, revocations) {
  const gatekeeper = new RetrievalGatekeeper(revocations);
  // Project local record-ID edges into the existing CRL algorithm, not a new trust service.
  const candidates = records.map(record => ({ ...record,
    status: record.status?.trim().toUpperCase(),
    upstreamAuthorities: [...(record.upstreamAuthorities || []), record.id] }));
  for (const record of records) if (hasSecret(record)) gatekeeper.registerRevocation(record.id, 0);
  let filtered;
  let changed;
  const firstReasons = new Map();
  do {
    filtered = gatekeeper.filterCandidates(candidates);
    changed = false;
    for (const record of filtered.blocked) {
      if (!firstReasons.has(record.id)) firstReasons.set(record.id, record.gateReason);
      if (!gatekeeper.isRevoked(record.id)) {
        gatekeeper.registerRevocation(record.id, 0);
        changed = true;
      }
    }
  } while (changed);
  return { ...filtered, blocked: filtered.blocked.map(record => ({ ...record, gateReason: firstReasons.get(record.id) })) };
}

function contradictionHints(records) {
  const groups = new Map();
  for (const record of records) {
    // A deliberately narrow negation pair is a hint, never adjudication of truth.
    const normalized = words(record.text);
    const negative = /\b(?:is|are|was|were) not\b/.test(normalized);
    const base = normalized.replace(/\b(is|are|was|were) not\b/g, '$1');
    if (!/\b(?:is|are|was|were)\b/.test(base)) continue;
    const group = groups.get(base) || { positive: [], negative: [] };
    group[negative ? 'negative' : 'positive'].push(record.id);
    groups.set(base, group);
  }
  return new Set([...groups.values()].flatMap(group => group.positive.length && group.negative.length
    ? [...group.positive, ...group.negative] : []));
}

/** Synchronous, pure local analysis. Ingested text is data, never executable instructions. */
export function inspect(input) {
  const { data, json } = validateInput(input);
  const warnings = [...BASE_WARNINGS];
  const filtered = applyLocalGate(data.records, data.revokedAuthorities || []);
  const blockedReasons = new Map(filtered.blocked.map(record => [record.id, record.gateReason]));
  const cells = (data.cells || []).filter(cell => !hasSecret(cell))
    .map(cell => ({ ...cell, normalizedTerms: [...new Set(cell.terms.map(words).filter(Boolean))] }));
  if (cells.length !== (data.cells || []).length) warnings.push('SECRET_CELL_OMITTED: possible credential in cell configuration.');
  const contradictions = contradictionHints(data.records);
  const newest = Math.max(0, ...data.records.map(record => Date.parse(record.observedAt || '') || 0));
  const digests = new Map();
  let duplicates = 0;
  let secretRecords = 0;
  let omittedFields = false;
  const records = data.records.map(record => {
    const flags = ['SUPPLIED_PROVENANCE_NOT_AUTHENTICATED'];
    if (!record.observedAt) flags.push('UNKNOWN_TIMESTAMP');
    const contentDigest = sha256(record.text);
    if (digests.has(contentDigest)) { duplicates++; flags.push('EXACT_DUPLICATE_TEXT'); }
    else digests.set(contentDigest, record.id);
    if (contradictions.has(record.id) || /^(?:CONTRADICTED|CONTRADICTORY|DISPUTED)$/i.test(record.status || '')) flags.push('POSSIBLE_CONTRADICTION');
    if (/^STALE$/i.test(record.status || '')
      || (record.observedAt && newest - Date.parse(record.observedAt) > 30 * 86400000)) flags.push('POSSIBLY_STALE_RELATIVE_TO_INPUT');
    if (instructionLike(record.text)) flags.push('INSTRUCTION_LIKE_TEXT_IS_DATA');
    if (Object.keys(record).some(key => !ORIGINAL_FIELDS.includes(key))) { flags.push('UNSUPPORTED_FIELDS_OMITTED'); omittedFields = true; }
    const secret = hasSecret(record);
    let reason = blockedReasons.get(record.id);
    if (secret) { secretRecords++; flags.push('POSSIBLE_SECRET_REDACTED'); reason = reason || 'POSSIBLE_SECRET'; }
    const status = reason ? 'BLOCKED' : 'ALLOWED';
    const safe = redact(Object.fromEntries(ORIGINAL_FIELDS.filter(key => key in record).map(key => [key, record[key]])));
    if (ORIGINAL_FIELDS.some(key => key !== 'text' && key in record && hasSecret(record[key], key))) flags.push('PROVENANCE_REDACTED');
    if (secret) safe.text = REDACTED;
    // Revocation/provenance filtering happens before any compression or routing.
    let compressedText = '';
    let routeCandidates = [];
    if (status === 'ALLOWED') {
      const proposal = compressForReview(record.text, record);
      compressedText = proposal.compressed;
      if (proposal.flag) flags.push(proposal.flag);
      const routing = routes(record.text, cells);
      routeCandidates = routing.candidates;
      if (routing.truncated) flags.push('ROUTE_CANDIDATES_TRUNCATED');
    }
    return { ...safe, contentDigest, gate: { status, reason: redact(reason || 'SUPPLIED_PROVENANCE_PRESENT_LOCAL_CHECK_ONLY') },
      routeCandidates, flags, compressedText };
  });
  if (duplicates) warnings.push(`EXACT_DUPLICATES: ${duplicates} repeated text records; repeated content is not independent provenance.`);
  if (secretRecords) warnings.push(`POSSIBLE_SECRETS: ${secretRecords} records redacted and blocked from routing/compression.`);
  if (omittedFields) warnings.push('UNSUPPORTED_FIELDS_OMITTED: only documented display/provenance fields are returned.');
  if (records.some(record => record.flags.includes('ROUTE_CANDIDATES_TRUNCATED'))) warnings.push('ROUTE_CANDIDATES_TRUNCATED: at most ten cells and ten displayed matching terms per record. Scores use all matching terms.');
  const originalCharacters = data.records.reduce((sum, record) => sum + record.text.length, 0);
  const outputCharacters = records.reduce((sum, record) => sum + record.compressedText.length, 0);
  return { version: 1, evidenceClass: 'LOCAL_ANALYSIS', inputDigest: sha256(json), metrics: {
    records: records.length,
    allowed: records.filter(record => record.gate.status === 'ALLOWED').length,
    blocked: records.filter(record => record.gate.status === 'BLOCKED').length,
    duplicates,
    candidateRoutes: records.reduce((sum, record) => sum + record.routeCandidates.length, 0),
    originalCharacters, outputCharacters,
    estimatedOriginalTokens: data.records.reduce((sum, record) => sum + Math.ceil(record.text.length / 4), 0),
    estimatedOutputTokens: records.reduce((sum, record) => sum + Math.ceil(record.compressedText.length / 4), 0)
  }, records, warnings };
}

export { exportCapsule } from './capsule.mjs';
export { InputValidationError, LIMITS } from './validation.mjs';
export { ANALYSIS_FLAGS, ANALYSIS_CONTRACT } from './contract.mjs';
