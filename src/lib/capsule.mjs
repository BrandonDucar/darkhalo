import { cloneJson, InputValidationError, LIMITS, ORIGINAL_FIELDS } from './validation.mjs';
import { REDACTED, hasSecret, redact } from './secrets.mjs';
import { ANALYSIS_FLAGS } from './contract.mjs';

const metricKeys = ['records', 'allowed', 'blocked', 'duplicates', 'candidateRoutes', 'originalCharacters',
  'outputCharacters', 'estimatedOriginalTokens', 'estimatedOutputTokens'];
const flagNames = new Set(Object.values(ANALYSIS_FLAGS));

/** Private review projection. Retained provenance/digests bind data, not authority. */
export function exportCapsule(result) {
  const safe = cloneJson(result, { ...LIMITS, inputBytes: 128 * 1024 * 1024, nodes: 2000000 });
  if (!safe || safe.version !== 1 || safe.evidenceClass !== 'LOCAL_ANALYSIS' || !Array.isArray(safe.records) || safe.records.length > LIMITS.records
    || typeof safe.inputDigest !== 'string' || !/^[a-f0-9]{64}$/.test(safe.inputDigest)
    || !safe.metrics || metricKeys.some(key => !Number.isSafeInteger(safe.metrics[key]) || safe.metrics[key] < 0)) {
    throw new InputValidationError('RESULT_CONTRACT');
  }
  const records = safe.records.map(record => {
    if (!record || typeof record.id !== 'string' || record.id.length > 512 || typeof record.text !== 'string' || record.text.length > LIMITS.text
      || typeof record.contentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.contentDigest)
      || typeof record.compressedText !== 'string' || record.compressedText.length > LIMITS.text || !Array.isArray(record.flags)
      || !['ALLOWED', 'BLOCKED'].includes(record.gate?.status) || !Array.isArray(record.routeCandidates) || record.routeCandidates.length > 10) {
      throw new InputValidationError('RESULT_RECORD');
    }
    const secret = hasSecret(record) || record.flags.includes('POSSIBLE_SECRET_REDACTED') || record.text === REDACTED;
    const status = secret ? 'BLOCKED' : record.gate.status;
    const original = Object.fromEntries(ORIGINAL_FIELDS.filter(key => key in record).map(key => [key, record[key]]));
    for (const [key, value] of Object.entries(original)) {
      if (['upstreamAuthorities', 'derivedFrom'].includes(key)) {
        if (!Array.isArray(value) || value.length > LIMITS.lineage || value.some(id => typeof id !== 'string')) throw new InputValidationError('RESULT_PROVENANCE');
      } else if (typeof value !== 'string') throw new InputValidationError('RESULT_PROVENANCE');
    }
    const provenanceRedacted = ORIGINAL_FIELDS.some(key => key !== 'text' && key in record && hasSecret(record[key], key));
    if (typeof record.gate.reason !== 'string') throw new InputValidationError('RESULT_GATE');
    return {
      ...redact(original),
      contentDigest: record.contentDigest,
      text: secret ? REDACTED : record.text,
      compressedText: status === 'ALLOWED' ? record.compressedText : '',
      gate: { status, reason: secret ? 'POSSIBLE_SECRET' : redact(record.gate.reason) },
      flags: [...new Set([...record.flags.filter(flag => flagNames.has(flag)), ...(secret ? ['POSSIBLE_SECRET_REDACTED'] : []),
        ...(provenanceRedacted ? ['PROVENANCE_REDACTED'] : [])])],
      routeCandidates: status === 'ALLOWED' ? record.routeCandidates.map(route => {
        if (!route || typeof route.cellId !== 'string' || typeof route.label !== 'string'
          || !Number.isFinite(route.score) || route.score < 0 || route.score > 1
          || !Array.isArray(route.matchedTerms) || route.matchedTerms.some(term => typeof term !== 'string')) {
          throw new InputValidationError('RESULT_ROUTE');
        }
        return { cellId: redact(route.cellId), label: redact(route.label), score: route.score, matchedTerms: redact(route.matchedTerms) };
      }) : []
    };
  });
  const metrics = Object.fromEntries(metricKeys.map(key => [key, safe.metrics[key]]));
  metrics.records = records.length;
  metrics.allowed = records.filter(record => record.gate.status === 'ALLOWED').length;
  metrics.blocked = records.length - metrics.allowed;
  metrics.candidateRoutes = records.reduce((sum, record) => sum + record.routeCandidates.length, 0);
  metrics.outputCharacters = records.reduce((sum, record) => sum + record.compressedText.length, 0);
  metrics.estimatedOutputTokens = records.reduce((sum, record) => sum + Math.ceil(record.compressedText.length / 4), 0);
  return {
    version: 1, evidenceClass: 'LOCAL_ANALYSIS', purpose: 'REVIEW_ONLY', inputDigest: safe.inputDigest,
    metrics,
    records,
    warnings: [
      'PRIVATE_REVIEW_ONLY: this capsule contains supplied text; do not publish without a separate privacy review.',
      'NO_AUTHORITY: provenance is supplied metadata, not authentication or permission.',
      'DIGESTS_BIND_DATA_ONLY: hashes retain equality/lineage context, never truth, authority, or proof of execution.',
      'NO_EXECUTION_RECEIPT: route matches are candidates only; no dispatch, model call, or network action occurred.',
      'SCOPED_REVIEW_PROPOSAL: covers only included records and candidate cells; does not mutate organ working state or grant authority.',
      'SECRET_HEURISTIC_ONLY: unrecognized credentials or personal data may remain.',
      'TOKEN_ESTIMATES_ONLY: approximate character counts; blocked exclusions are not compression savings.'
    ]
  };
}
