import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspect, exportCapsule, LIMITS } from '../src/lib/inspect.mjs';

const args = process.argv.slice(2);
if (args.length !== 1 && !(args.length === 3 && args[1] === '--output')) {
  console.error('Usage: node scripts/inspect-file.mjs INPUT.json [--output CAPSULE.json]');
  process.exitCode = 2;
} else {
  try {
    const inputPath = resolve(args[0]);
    const outputPath = args.length === 3 ? resolve(args[2]) : null;
    if (outputPath === inputPath) throw new Error('Output must not overwrite the input.');
    if (statSync(inputPath).size > LIMITS.inputBytes) throw new Error('Input exceeds the 2 MiB limit.');
    const result = inspect(readFileSync(inputPath, 'utf8'));
    const capsule = exportCapsule(result);
    if (outputPath) writeFileSync(outputPath, JSON.stringify(capsule, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ evidenceClass: result.evidenceClass, inputDigest: result.inputDigest,
      metrics: result.metrics, capsuleWritten: Boolean(outputPath), authorityGranted: false }));
  } catch (error) {
    // Do not echo source records or credential-shaped values on failure.
    console.error(error.code?.startsWith('E') ? `File operation failed: ${error.code}`
      : (error.name === 'InputValidationError' ? error.message : 'Inspection failed; no input was overwritten.'));
    process.exitCode = 1;
  }
}
