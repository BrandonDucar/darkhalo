# Darkhalo Local Analysis Core

Copyright 2026 Brandon Ducar / DreamNet Systems.
The existing root Apache-2.0 LICENSE has not been changed.

## Upstream Source Provenance

Two implementation files were mechanically vendored from the local
BrandonDucar/dream-net checkout, branch hermes/proof-cli-v1, at HEAD
`284449f3c4c53688c1c97de8d822aeddc7bfcbae`. Both source files were clean
relative to that HEAD when copied. No private inputs or audit inventories are
included. Source SHA-256 (raw file bytes):

- `packages/farcaster-agent-memory-gate/src/RetrievalGatekeeper.mjs`:
  `a3a17822c347783c4d3774dec2a05d682b28ccf6ef663ebce8b86fba0b0ff627`
- `packages/context-compressor/src/ContextCompressor.ts`:
  `4357c376ad3fa9712e838802eb7d2dc3b2f231e530327d92dc8981d897e33208`

`src/lib/vendor/provenance.json` records source and generated hashes.
`scripts/vendor-core.mjs` regenerates only those vendor files offline, refusing
changed source hashes. The original compressor TypeScript is retained verbatim;
its runnable MJS is generated with Node stripTypeScriptTypes, mode strip, followed
by mechanical trailing-whitespace cleanup. The pinned source has no multiline
template string contents affected by that cleanup.
The gate changes only its node:crypto hash implementation to the local noble
SHA-256 adapter and node:perf_hooks to globalThis.performance, plus a change
notice. The gate algorithm, reason strings, and upstream comments are retained.
No gate trust algorithm was rewritten.

The original compressor TypeScript retains one upstream whitespace-only line
at line 175 to preserve its raw-byte hash. Adapter/tests/generated MJS whitespace
checks are clean. Git on this checkout warns of LF-to-CRLF conversion: the parent
must preserve vendored bytes in its integration/config ownership (for example,
mark vendor files as binary/-text in .gitattributes) before a future checkout.
This worker did not change Git configuration or attributes.

## Retained Package Notice

The upstream root declares Apache-2.0. The gate package's package.json declares
Apache-2.0, but its package-local LICENSE also includes the following additional
notice, retained here without interpreting or removing it. This discrepancy
requires owner review before commercial distribution; this file does not
relicense upstream code or modify the root LICENSE.

Copyright 2026 Brandon Ducar / DreamNet Systems

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

COMMONS CLAUSE ADDITIONAL PERMISSION & CONDITION

The "Commons Clause" Condition applies to the Software:

1. Free Use: You may copy, modify, distribute, and execute this Software free of
   charge for research, open-source development, and building autonomous agents
   on the Farcaster protocol.
2. Commercial Restriction: You may not sell the Software, or provide the Software
   as a commercial SaaS/PaaS multi-tenant memory gateway service to third parties,
   without an explicit commercial license agreement from DreamNet.

## Browser Adapter Boundaries

`inspect(input)` accepts a version-1 object or JSON string. It is synchronous,
has no fetch/network/model/storage calls, and rejects non-JSON values, accessors,
custom prototypes, duplicate record/cell IDs, unsafe keys and malformed known
fields. Limits are 2 MiB UTF-8 JSON, 2000 records, 10000 UTF-16 characters per
record text, depth 16, 100000 nodes, 100 cells, 100 terms per cell, and 2000
revocation/lineage entries. Empty record text and empty collections are valid.
Unknown JSON record fields are accepted as data but omitted from display/export.

Imported provenance is shape metadata only, never authenticated or verified
identity, truth, authority or execution permission. Author and record ID remain
separate from any supplied thread owner. Local revocations are not a globally
authenticated CRL. The adapter projects local record IDs into upstream edges,
normalizes supplied tombstone/revoked status casing, and propagates blocked
in-batch record IDs using the unchanged gate. Missing-provenance and secret
sources also exclude their in-batch derivatives. External lineage identifiers
are checked only against the supplied revocation list. Cycles with no blocked
source are not authenticated or adjudicated. Shared identifier namespaces can
conservatively overblock collisions.

Keyword matching uses normalized whole words/phrases, not regexes from inputs;
scores are matched distinct terms divided by distinct configured terms. Only
the first ten cells (score descending, then ID) and ten matched terms are
returned, with an explicit truncation flag. Matching uses original text, not
compressed output. Repeated exact text is a duplicate warning, not independent
corroboration. A narrow negation-pair heuristic and supplied disputed status
produce possible-contradiction flags, not truth declarations. Staleness is a
flag from supplied status or a timestamp over 30 days behind the newest input
timestamp, never the wall clock. Output omits latency for determinism.

The compressor adapter permits only simple single-line ASCII prose without
digits, quotes, structural punctuation, marker syntax or instruction/code
hints. Everything else is returned byte-for-byte unchanged when allowed.
Changed prose is explicitly a lossy review proposal, not a safe prompt or
semantic equivalence claim. All blocked records have empty compressedText and
no route candidates. Exclusion is not compression savings. Token counts are
per-record ceil(UTF-16 characters / 4), not model-specific tokens or ROI.

Secret detection is heuristic (PEM/private keys, common provider credentials,
bearer/JWT, labeled secrets, credential-bearing URLs and secret metadata keys).
A hit anywhere in a record redacts its entire text and blocks compression and
routing. Sensitive display metadata is redacted; unknown metadata is dropped.
Unrecognized formats, standalone recovery phrases, personal data, obfuscation,
and malicious JavaScript Proxy traps are not comprehensively covered. Object
input should come from JSON.parse; this is not a sandbox for hostile JS objects.

`exportCapsule(result)` returns a detached review-only object. It independently
checks/redacts data and projects an allowlist: original author/ID/text, sourceUrl,
observedAt, status, signerUuid, authorityDigest, parentId, threadId, threadOwner,
upstreamAuthorities, derivedFrom, contentDigest, inputDigest, local gate status,
known flags, routes and estimates. Provenance remains supplied metadata, not
authenticated bindings. Digests bind data, never truth or authority. Fields
containing likely secrets are redacted with an explicit PROVENANCE_REDACTED
flag, not silently removed. Arbitrary claims remain omitted. It is not signed
and grants no authority. It includes no execution receipt.
Capsules and full results remain private review data, not publication-safe
artifacts; a separate privacy review is required before any export is shared.

## Stable UI / Parent Integration Contract

Entry point: `src/lib/inspect.mjs`. Named exports: `inspect`, `exportCapsule`,
`InputValidationError`, `LIMITS`, `ANALYSIS_FLAGS`, and `ANALYSIS_CONTRACT`.
`inspect` and `exportCapsule` return plain objects synchronously, not JSON strings
or promises. The UI owns import parsing/display and any explicit local download;
the core has no side effects. Render imported text as text, not HTML or code.
Offline validation commands are `node --test tests/*.test.mjs` and
`node tests/browser-core.mjs`. The latter bundles in memory and runs synthetic
fixtures in headless Edge, with network and storage disabled; no server is
started and no bundle files are written. DARKHALO_TEST_BROWSER may choose an
installed Playwright browser channel. UI and full application build verification
remain parent-owned.
Catch InputValidationError and display its static message/code without echoing
private input. Unknown record fields are never promoted into the result.

Flag codes are exported in frozen ANALYSIS_FLAGS and have these meanings:

| Flag | Display Interpretation |
| --- | --- |
| SUPPLIED_PROVENANCE_NOT_AUTHENTICATED | Metadata present or absent, never authentication |
| EXACT_DUPLICATE_TEXT | Repeated exact content, not an independent witness |
| POSSIBLE_CONTRADICTION | Heuristic or supplied dispute hint, not adjudication |
| POSSIBLY_STALE_RELATIVE_TO_INPUT | Supplied stale status or relative input age |
| INSTRUCTION_LIKE_TEXT_IS_DATA | Imported directive-looking text remains data |
| UNSUPPORTED_FIELDS_OMITTED | Undocumented JSON metadata excluded from output |
| POSSIBLE_SECRET_REDACTED | Entire text redacted and context/routing excluded |
| PROVENANCE_REDACTED | Sensitive supplied provenance retained as a redaction marker |
| UNKNOWN_TIMESTAMP | No observation timestamp supplied; age is unknown |
| COMPRESSION_SKIPPED_INVARIANT_SENSITIVE | Baseline preserved unchanged |
| LOSSY_COMPRESSION_PROPOSAL | Prose shortened for review, no equivalence claim |
| ROUTE_CANDIDATES_TRUNCATED | Display cap hit; scores still use all terms |

Gate statuses ALLOWED/BLOCKED mean this local context filter only. Display raw
record status, author, and threadOwner as supplied fields, never a trust badge.
The originalCharacters and estimatedOriginalTokens metrics count all input
texts; outputCharacters and estimatedOutputTokens count only allowed context.
Do not label their difference as compression savings because blocked exclusions
also affect the difference. candidateRoutes counts returned review candidates,
not deliveries. duplicates counts occurrences beyond the first exact text.
inputDigest uses canonical key-sorted JSON; arrays retain supplied order.
contentDigest binds original UTF-8 text, including before redaction; hashes are
not proof of truth and may reveal equality, so remain private with full results
and review capsules. Timestamp absence produces UNKNOWN_TIMESTAMP, never an
invented age. Capsule provenance and comments preserve exact authors separately
from the thread owner, including for selective revocations and derivatives.

Warnings are explanatory strings prefixed with stable uppercase codes. The
capsule's purpose is REVIEW_ONLY: a scoped proposal over included records and
candidate cells, never automatic authority, a working-state write, or an action
receipt. Parent-owned audit/handoff integration may consume these proposals
across organs subject to its existing scope and review controls; the core does
not change those controls or create a competing service.
