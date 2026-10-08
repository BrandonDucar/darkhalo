// Mechanical, offline vendoring only. Never imports or executes upstream code.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(process.argv[2] || 'C:/Users/brand/.antigravity/dream-net');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = resolve(root, 'src/lib/vendor');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = [
  ['packages/farcaster-agent-memory-gate/src/RetrievalGatekeeper.mjs',
    'a3a17822c347783c4d3774dec2a05d682b28ccf6ef663ebce8b86fba0b0ff627'],
  ['packages/context-compressor/src/ContextCompressor.ts',
    '4357c376ad3fa9712e838802eb7d2dc3b2f231e530327d92dc8981d897e33208']
];
const files = sources.map(([path, expected]) => {
  const bytes = readFileSync(resolve(sourceRoot, path));
  if (digest(bytes) !== expected) throw new Error('Source changed: review before re-vendoring');
  return { path, bytes, sha256: expected };
});
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
const changed = execFileSync('git', ['status', '--porcelain', '--', ...sources.map(([path]) => path)],
  { cwd: sourceRoot, encoding: 'utf8' }).trim();
const banner = '// Darkhalo browser adaptation; see NOTICE.md and provenance.json.\n';
const original = files[0].bytes.toString('utf8');
const gate = banner + original
  .replace("import { createHash } from 'node:crypto';", "import { sha256 as browserSha256 } from '../hash.mjs';")
  .replace("import { performance } from 'node:perf_hooks';", 'const performance = globalThis.performance;')
  .replace("return createHash('sha256').update(content).digest('hex');", 'return browserSha256(content);');
const compressor = banner + stripTypeScriptTypes(files[1].bytes.toString('utf8'), { mode: 'strip' }).replace(/[ \t]+$/gm, '');
mkdirSync(vendor, { recursive: true });
writeFileSync(resolve(vendor, 'RetrievalGatekeeper.mjs'), gate);
writeFileSync(resolve(vendor, 'ContextCompressor.ts'), files[1].bytes);
writeFileSync(resolve(vendor, 'ContextCompressor.mjs'), compressor);
writeFileSync(resolve(vendor, 'provenance.json'), JSON.stringify({
  repository: 'BrandonDucar/dream-net',
  head,
  sourceFilesDirty: Boolean(changed),
  nodeVersion: process.version,
  sources: files.map(({ path, sha256 }) => ({ path, sha256 })),
  generated: [
    { path: 'RetrievalGatekeeper.mjs', sha256: digest(gate), modifications: 'Browser hash/performance imports only; algorithm unchanged.' },
    { path: 'ContextCompressor.mjs', sha256: digest(compressor), modifications: 'Node stripTypeScriptTypes mode strip and trailing-whitespace cleanup; no algorithm edits.' }
  ]
}, null, 2) + '\n');
console.log(`Vendored ${files.length} source files at ${head}; sourceFilesDirty=${Boolean(changed)}`);
