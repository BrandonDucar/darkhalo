import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

export function sha256(content) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return Array.from(nobleSha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
