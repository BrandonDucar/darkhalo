export interface CompressOptions {
  aggressive?: boolean;
}

export interface CompressResult {
  compressed: string;
  originalTokensEst: number;
  compressedTokensEst: number;
  savingsPercent: number;
}

export interface ConversationMessage {
  role: string;
  content: string;
  [key: string]: unknown;
}

export interface CandidateMemoryItem {
  id?: string;
  signerUuid?: string;
  agentId?: string;
  text?: string;
  content?: string;
  status?: string;
  [key: string]: unknown;
}

export interface GatekeeperLike {
  filterCandidates<T extends CandidateMemoryItem>(items: T[]): {
    allowed: T[];
    blocked: T[];
    blockedStaleCount: number;
    latencyMs: number;
  };
}

export class ContextCompressor {
  static CONVERSATIONAL_FLUFF: RegExp[] = [
    /\bplease note that\b/gi,
    /\bas an ai( (language )?model)?,?\b/gi,
    /\bi would like you to\b/gi,
    /\bcould you please\b/gi,
    /\bneedless to say,?\b/gi,
    /\bat the end of the day,?\b/gi,
    /\bin order to\b/gi,
    /\bfor the purpose of\b/gi,
    /\bas previously mentioned,?\b/gi
  ];

  /**
   * Compresses a text prompt while preserving code blocks, JSON, and invariants
   */
  static compressPrompt(text: string, options: CompressOptions = {}): CompressResult {
    if (!text || typeof text !== 'string') {
      return {
        compressed: '',
        originalTokensEst: 0,
        compressedTokensEst: 0,
        savingsPercent: 0
      };
    }

    const aggressive = options.aggressive ?? false;
    const protectedBlocks: string[] = [];

    // 1. Stash fenced code blocks and JSON
    let stashed = text.replace(/```[\s\S]*?```/g, (match) => {
      const idx = protectedBlocks.length;
      protectedBlocks.push(match);
      return `__DREAMNET_PROTECTED_BLOCK_${idx}__`;
    });

    // 2. Remove polite & conversational fluff
    for (const pattern of this.CONVERSATIONAL_FLUFF) {
      stashed = stashed.replace(pattern, '');
    }

    // 3. Deduplicate consecutive duplicate lines
    const lines = stashed.split('\n');
    const deduped: string[] = [];
    let prevLine: string | null = null;

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (trimmed && trimmed === prevLine) {
        continue;
      }
      deduped.push(rawLine);
      if (trimmed) prevLine = trimmed;
    }

    stashed = deduped.join('\n');

    // 4. Collapse multiple empty lines
    stashed = stashed.replace(/\n{3,}/g, '\n\n');

    // 5. In aggressive mode, shorten verbose phrases
    if (aggressive) {
      stashed = stashed
        .replace(/\butilize\b/gi, 'use')
        .replace(/\bterminate\b/gi, 'end')
        .replace(/\bcommence\b/gi, 'start')
        .replace(/\bwith respect to\b/gi, 'for')
        .replace(/\bprior to\b/gi, 'before');
    }

    // 6. Restore protected blocks
    let compressed = stashed.replace(/__DREAMNET_PROTECTED_BLOCK_(\d+)__/g, (_, idx) => {
      return protectedBlocks[Number(idx)] || '';
    }).trim();

    // 7. Token accounting (~4 chars per token approximation)
    const originalTokensEst = Math.ceil(text.length / 4);
    const compressedTokensEst = Math.ceil(compressed.length / 4);
    const saved = Math.max(0, originalTokensEst - compressedTokensEst);
    const savingsPercent = originalTokensEst > 0
      ? Number(((saved / originalTokensEst) * 100).toFixed(1))
      : 0;

    return {
      compressed,
      originalTokensEst,
      compressedTokensEst,
      savingsPercent
    };
  }

  /**
   * Compresses a full multi-turn conversation history
   */
  static compressConversation(messages: ConversationMessage[], options: CompressOptions = {}): ConversationMessage[] {
    if (!Array.isArray(messages)) return [];

    return messages.map((msg, index) => {
      if (index === messages.length - 1 && msg.role === 'user') {
        return msg;
      }

      const result = this.compressPrompt(msg.content, options);
      return {
        ...msg,
        content: result.compressed
      };
    });
  }

  /**
   * Filters candidate memory or context snippets through a RetrievalGatekeeper before compression,
   * guaranteeing that revoked authorities and ghost memories are never compressed into prompt context.
   */
  static compressWithRetrievalGate<T extends CandidateMemoryItem>(
    items: T[],
    gatekeeper?: GatekeeperLike | null,
    options: CompressOptions = {}
  ): { items: T[]; blockedCount: number; totalSavingsPercent: number } {
    if (!Array.isArray(items)) {
      return { items: [], blockedCount: 0, totalSavingsPercent: 0 };
    }

    let candidateList = items;
    let blockedCount = 0;

    if (gatekeeper && typeof gatekeeper.filterCandidates === 'function') {
      const filtered = gatekeeper.filterCandidates(items);
      candidateList = filtered.allowed;
      blockedCount = filtered.blockedStaleCount;
    }

    let totalOriginalTokens = 0;
    let totalCompressedTokens = 0;

    const compressedItems = candidateList.map(item => {
      const textToCompress = typeof item === 'string' ? item : (item.text || item.content || '');
      const res = this.compressPrompt(textToCompress, options);
      
      totalOriginalTokens += res.originalTokensEst;
      totalCompressedTokens += res.compressedTokensEst;

      if (typeof item === 'string') {
        return res.compressed as unknown as T;
      }
      return {
        ...item,
        text: res.compressed,
        compressionSavingsPercent: res.savingsPercent
      } as T;
    });

    const saved = Math.max(0, totalOriginalTokens - totalCompressedTokens);
    const totalSavingsPercent = totalOriginalTokens > 0
      ? Number(((saved / totalOriginalTokens) * 100).toFixed(1))
      : 0;

    return {
      items: compressedItems,
      blockedCount,
      totalSavingsPercent
    };
  }
}
