import { readFileSync, realpathSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sensitive } from './secret-scan.mjs';
export function verifyImport(root) {
  const base = realpathSync(root);
  const manifest = JSON.parse(readFileSync(resolve(base, 'import-manifest.json'), 'utf8'));
  if (manifest.worker !== 'ilac-takip-mono-preview' || manifest.compatibilityDate !== '2026-10-01' || manifest.cron !== '* * * * *' || typeof manifest.deploymentId !== 'string' || !manifest.deploymentId.trim() || typeof manifest.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(manifest.exportedAt) || !Number.isFinite(Date.parse(manifest.exportedAt))) throw new Error('Invalid source provenance or protected configuration');
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Missing source inventory');
  const names = new Set();
  for (const item of manifest.files) {
    if (typeof item.path !== 'string' || !/^(src|public)\//.test(item.path) || item.path.split('/').some(p => p === '..' || p === '.' || !p) || names.has(item.path)) throw new Error('Invalid inventory path');
    const target = realpathSync(resolve(base, item.path));
    const rel = relative(base, target);
    if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('Source escapes import directory');
    const content = readFileSync(target);
    if (!/^[a-f0-9]{64}$/.test(item.sha256) || createHash('sha256').update(content).digest('hex') !== item.sha256) throw new Error('Source hash mismatch');
    if (sensitive(content.toString('utf8'))) throw new Error('Sensitive source rejected');
    names.add(item.path);
  }
  if (!names.has('src/index.js')) throw new Error('Missing Worker entrypoint');
  function walk(path) {
    for (const entry of readdirSync(resolve(base, path), { withFileTypes: true })) {
      const name = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed');
      if (entry.isDirectory()) walk(name);
      else if (!names.has(name)) throw new Error('Uninventoried source file');
    }
  }
  walk('src');
  if (existsSync(resolve(base, 'public'))) walk('public');
  return { status: 'hash-verified', productionReady: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(verifyImport(resolve(dirname(fileURLToPath(import.meta.url)), '../../cloudflare/mono-preview')))); }
  catch { console.error('BLOCKED: reviewed live source/provenance missing or invalid. See docs/issue5/implementation.md.'); process.exitCode = 1; }
}
