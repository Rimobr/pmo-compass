#!/usr/bin/env node
// Confere a versão: a mesma nos 4 lugares e, quando o app (HTML) muda, a versão também muda (senão a faixa "Atualizar agora" não aparece).
//   node scripts/check-version.mjs            → só consistência
//   node scripts/check-version.mjs <commit>   → também compara com o commit informado (ex.: origin/main ou HEAD~1)
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const v = {
  'version.json': JSON.parse(read('version.json')).version,
  'package.json': JSON.parse(read('package.json')).version,
  'BRAND.version': (read('PMO_Compass_v2.html').match(/version:\s*'([\d.]+)'/) || [])[1],
  'sw.js': (read('sw.js').match(/pmo-compass-v([\d.]+)'/) || [])[1]
};
let bad = 0;
if (new Set(Object.values(v)).size !== 1) { bad++; console.error('✖ Versões diferentes: ' + JSON.stringify(v)); } else console.log('✔ Versão ' + v['version.json'] + ' igual nos 4 lugares');
const base = process.argv[2];
if (base) {
  try {
    const changed = execSync(`git diff --name-only ${base} -- PMO_Compass_v2.html`, { cwd: root }).toString().trim();
    const old = JSON.parse(execSync(`git show ${base}:version.json`, { cwd: root }).toString()).version;
    if (changed && old === v['version.json']) { bad++; console.error(`✖ O app mudou desde ${base}, mas a versão continua ${old}. Suba a versão (4 lugares).`); }
    else console.log(changed ? `✔ O app mudou e a versão subiu (${old} → ${v['version.json']})` : '✔ O app não mudou');
  } catch (e) { console.log('(comparação com ' + base + ' não feita: ' + String(e.message).split('\n')[0] + ')'); }
}
process.exit(bad ? 1 : 0);
