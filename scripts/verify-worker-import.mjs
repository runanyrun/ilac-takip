import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../cloudflare/mono-preview');
function fail(message) { throw new Error(`Worker aktarımı hazır değil: ${message}`); }
try {
  const path = resolve(root, 'import-manifest.json');
  if (!existsSync(path)) fail('import-manifest.json ve doğrulanmış canlı kaynak eksik. docs/cloudflare-migration.md dosyasını izleyin.');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.worker !== 'ilac-takip-mono-preview' || !manifest.deploymentId || !manifest.exportedAt)
    fail('Worker kimliği, deploymentId ve exportedAt gerekli.');
  if (!Array.isArray(manifest.files) || !manifest.files.length) fail('Dosya envanteri boş.');
  const names = new Set();
  for (const item of manifest.files) {
    if (typeof item.path !== 'string' || !/^(src|public)\//.test(item.path)) fail('Yalnız src/ ve public/ dosyaları envantere alınabilir.');
    const local = resolve(root, item.path);
    const rel = relative(root, local);
    if (isAbsolute(rel) || rel.startsWith('..') || names.has(rel)) fail('Geçersiz veya yinelenen dosya yolu.');
    names.add(rel);
    const hash = createHash('sha256').update(readFileSync(local)).digest('hex');
    if (hash !== item.sha256) fail(`Hash eşleşmiyor: ${item.path}`);
  }
  if (!names.has('src/index.js')) fail('Gerçek giriş modülü src/index.js envanterde yok.');
  console.log('Kaynak envanteri hash kontrolü geçti. Bu sonuç deploy onayı veya canlı davranış doğrulaması değildir.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
