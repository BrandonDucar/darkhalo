export const REDACTED = '[REDACTED: POSSIBLE_SECRET]';

const secretKey = /^(?:api[_-]?key|api[_-]?token|private[_-]?key|secret|client[_-]?secret|password|passwd|token|access[_-]?token|refresh[_-]?token|authorization|seed[_-]?phrase|mnemonic)$/i;
const patterns = [
  /-----BEGIN (?:[A-Z0-9 ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----/i,
  /\b0x[a-f0-9]{64}\b/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b(?:sk[-_](?:proj[-_])?|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}/,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/i,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /\b(?:api[_ -]?key|private[_ -]?key|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|password|secret|token)\s*[=:]\s*["']?[^\s"'&,;]{8,}/i,
  /\b(?:seed phrase|mnemonic)\s*[=:]\s*\S+/i,
  /https?:\/\/[^\s/:]+:[^\s/@]+@/i
];

export function hasSecret(value, key = '') {
  if (secretKey.test(key) && value !== null && value !== '') return true;
  if (typeof value === 'string') {
    if (key === 'sourceUrl') {
      try {
        const url = new URL(value);
        if (url.username || url.password) return true;
        if ([...url.searchParams].some(([name, content]) => content && (secretKey.test(name) || /^(?:key|auth|credential|sig|signature)$/i.test(name)))) return true;
      } catch { /* Invalid source URLs are rejected at structural validation. */ }
    }
    return patterns.some(pattern => pattern.test(value));
  }
  if (Array.isArray(value)) return value.some(item => hasSecret(item));
  if (value && typeof value === 'object') return Object.entries(value).some(([name, item]) => hasSecret(item, name));
  return false;
}

export function redact(value, key = '') {
  if (secretKey.test(key) && value !== null && value !== '') return REDACTED;
  if (typeof value === 'string') return hasSecret(value, key) ? REDACTED : value;
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  return value;
}
