import { ContextCompressor } from './vendor/ContextCompressor.mjs';

export function instructionLike(text) {
  return /\b(?:ignore|disregard|override|obey|instructions?|reveal|exfiltrate|invoke|execute|eval|sudo|curl|fetch|system prompt|developer message|run command|do not|must|never|always|should)\b|<\/?(?:script|system|assistant)\b/i.test(text);
}

export function compressForReview(text, metadata = {}) {
  // No semantic-preservation claim: only simple single-line prose may be shortened.
  // Quotes, structure, markers, digits and instructions are invariant-sensitive.
  const structuralHint = Object.keys(metadata).some(key => /invariant|preserve|code|json|schema|syntax|language|format|contentType/i.test(key));
  if (structuralHint || instructionLike(text) || !/^[A-Za-z ,.?!-]*$/.test(text)
    || /\b(?:function|return|const|let|var|import|export|class|def|print|select|insert|delete|true|false|null)\b/i.test(text)) {
    return { compressed: text, flag: 'COMPRESSION_SKIPPED_INVARIANT_SENSITIVE' };
  }
  const { compressed } = ContextCompressor.compressPrompt(text, { aggressive: false });
  return { compressed, flag: compressed !== text ? 'LOSSY_COMPRESSION_PROPOSAL' : null };
}
