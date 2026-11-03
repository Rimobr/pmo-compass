#!/usr/bin/env node
// Gera o CHANGELOG.md a partir do histórico do Git: cada commit que termina com "(x.y.z)" vira uma entrada daquela versão.
//   node scripts/build-changelog.mjs           → grava CHANGELOG.md
//   node scripts/build-changelog.mjs --check   → falha se o CHANGELOG.md estiver desatualizado
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const log = execSync('git log --date=short --pretty=format:%H%x09%ad%x09%s', { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').filter(Boolean);
const entradas = log.map(l => { const [, data, ...r] = l.split('\t'); const s = r.join('\t'); const m = s.match(/^(.*?)\s*\((\d+\.\d+\.\d+)\)\s*$/); return m ? { v: m[2], data, texto: m[1] } : null; }).filter(Boolean);
const vers = [...new Set(entradas.map(e => e.v))];
let out = '# Histórico de versões\n\nGerado do Git por `node scripts/build-changelog.mjs` (nunca editar à mão). Cada linha é um commit publicado; a data é a do commit.\n';
for (const v of vers) {
  const es = entradas.filter(e => e.v === v);
  out += `\n## ${v} — ${es[0].data}\n` + es.map(e => `- ${e.texto}`).join('\n') + '\n';
}
const f = join(root, 'CHANGELOG.md');
if (process.argv.includes('--check')) {
  const atual = existsSync(f) ? readFileSync(f, 'utf8').replace(/\r\n/g, '\n') : '';
  if (atual !== out) { console.error('✖ CHANGELOG.md desatualizado: rode node scripts/build-changelog.mjs'); process.exit(1); }
  console.log('✔ CHANGELOG.md em dia'); process.exit(0);
}
writeFileSync(f, out);
console.log(`CHANGELOG.md gerado (${vers.length} versões).`);
