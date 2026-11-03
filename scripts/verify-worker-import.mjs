// Both historical import commands enforce the same fail-closed gate.
import { verifyImport } from './issue5/source-gate.mjs';
try {
  console.log(JSON.stringify(verifyImport(new URL('../cloudflare/mono-preview/', import.meta.url).pathname)));
} catch {
  console.error('BLOCKED: reviewed live source/provenance missing or invalid. See docs/issue5/implementation.md.');
  process.exitCode = 1;
}
