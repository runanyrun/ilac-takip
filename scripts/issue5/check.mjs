import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanTracked } from './secret-scan.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const findings = scanTracked(root, readFileSync(0, 'utf8'));
if (findings.length) { console.error(`Sensitive material detected in ${findings.length} file(s); values withheld.`); process.exitCode = 1; }
else console.log('Tracked/new source pattern scan passed; manual source review is still required.');
