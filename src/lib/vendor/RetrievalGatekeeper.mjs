// Darkhalo browser adaptation; see NOTICE.md and provenance.json.
/**
 * @file RetrievalGatekeeper.mjs
 * @description In-line Query-Time CRL Gatekeeper for Farcaster Agent Memory
 */

import { sha256 as browserSha256 } from '../hash.mjs';
const performance = globalThis.performance;

export function sha256(content) {
  return browserSha256(content);
}

export class RetrievalGatekeeper {
  constructor(initialRevocations = []) {
    this.crl = new Set(initialRevocations);
    this.crlTimestamps = new Map();
    const now = Date.now();
    for (const id of initialRevocations) {
      this.crlTimestamps.set(id, now);
    }
  }

  registerRevocation(authorityId, timestamp = Date.now()) {
    if (!authorityId) return;
    this.crl.add(authorityId);
    this.crlTimestamps.set(authorityId, timestamp);
  }

  isRevoked(authorityId) {
    if (!authorityId) return false;
    return this.crl.has(authorityId);
  }

  computeHashes(text, signerUuid, fid = '') {
    const contentHash = sha256(text);
    const authorityHash = sha256(`${signerUuid}:${fid}:${text}`);
    return { contentHash, authorityHash };
  }

  filterCandidates(candidates, options = {}) {
    const t0 = performance.now();
    const allowed = [];
    const blocked = [];
    const requireProvenance = options.requireProvenance !== false;

    for (const cand of candidates) {
      // 1. Provenance check: candidates without a signerUuid, author, or authorityDigest must fail closed
      const hasProvenance = Boolean(cand.signerUuid || cand.author || cand.authorityDigest);
      if (requireProvenance && !hasProvenance) {
        blocked.push({
          ...cand,
          gateReason: 'UNPROVENANCED_ANONYMOUS_MEMORY'
        });
        continue;
      }

      // 2. Direct signer, author, or authority digest revocation check
      const isSignerRevoked = cand.signerUuid ? this.isRevoked(cand.signerUuid) : false;
      const isAuthorRevoked = cand.author ? this.isRevoked(cand.author) : false;
      const isAuthorityRevoked = cand.authorityDigest ? this.isRevoked(cand.authorityDigest) : false;
      const isExplicitTombstone = cand.status === 'TOMBSTONED' || cand.status === 'REVOKED';

      // 3. Derived memory invalidation graph: check if any upstream source authority is revoked
      let isUpstreamRevoked = false;
      let revokedUpstreamId = null;
      if (Array.isArray(cand.upstreamAuthorities)) {
        for (const authId of cand.upstreamAuthorities) {
          if (this.isRevoked(authId)) {
            isUpstreamRevoked = true;
            revokedUpstreamId = authId;
            break;
          }
        }
      }
      if (!isUpstreamRevoked && Array.isArray(cand.derivedFrom)) {
        for (const authId of cand.derivedFrom) {
          if (this.isRevoked(authId)) {
            isUpstreamRevoked = true;
            revokedUpstreamId = authId;
            break;
          }
        }
      }

      if (isSignerRevoked || isAuthorRevoked || isAuthorityRevoked || isExplicitTombstone || isUpstreamRevoked) {
        blocked.push({
          ...cand,
          gateReason: isUpstreamRevoked
            ? `DERIVED_UPSTREAM_REVOKED:${revokedUpstreamId}`
            : (isExplicitTombstone ? 'TOMBSTONED' : 'REVOKED_AUTHORITY')
        });
      } else {
        allowed.push(cand);
      }
    }

    const latencyMs = Math.round((performance.now() - t0) * 1000) / 1000;
    return {
      allowed,
      blocked,
      blockedStaleCount: blocked.length,
      latencyMs
    };
  }

  repairThread(candidates, rootId) {
    const byId = new Map();
    const childMap = new Map();

    for (const c of candidates) {
      byId.set(c.id || c.hash, c);
      const pid = c.parentId || c.parentHash;
      if (pid) {
        if (!childMap.has(pid)) childMap.set(pid, []);
        childMap.get(pid).push(c.id || c.hash);
      }
    }

    const root = byId.get(rootId);
    // Thread projection must enforce the same boundary as ordinary retrieval.
    const isRootRevoked = !root || this.filterCandidates([root]).allowed.length === 0;

    if (isRootRevoked) {
      return {
        root: null,
        children: [],
        prunedCount: candidates.length,
        orphanedCount: 0,
        recomputed: true
      };
    }

    const validChildren = [];
    let prunedCount = 0;
    const directChildren = childMap.get(rootId) || [];

    for (const cid of directChildren) {
      const child = byId.get(cid);
      if (!child || this.filterCandidates([child]).allowed.length === 0) {
        prunedCount++;
        continue;
      }
      validChildren.push(child);
    }

    return {
      root,
      children: validChildren,
      prunedCount,
      orphanedCount: 0,
      recomputed: true
    };
  }
}
