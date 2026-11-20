#!/usr/bin/env node
// Copia para dentro do app (pasta vendor/) as bibliotecas de terceiros que antes vinham de CDN (jsdelivr/unpkg), em VERSÃO FIXA.
// Cada pacote é baixado pelo registro oficial do npm (`npm pack`, que confere a integridade do tarball) numa pasta temporária isolada,
// e só os arquivos listados abaixo são copiados. O resultado fica em vendor/ com vendor/MANIFEST.json (origem, integridade do pacote
// e sha256 de cada arquivo). `--check` confere se os arquivos de vendor/ ainda batem com o MANIFEST (usado no check:all).
//   node scripts/vendor-libs.mjs           # baixa e regrava vendor/ e o MANIFEST
//   node scripts/vendor-libs.mjs --check   # só confere os sha256
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'vendor');
// pacote@versão → arquivos (origem dentro do pacote → destino em vendor/); "dir" copia a pasta inteira
export const LIBS = [
  { pkg: '@supabase/supabase-js', version: '2.119.2', files: { 'dist/umd/supabase.js': 'supabase-js/supabase.js' } },
  { pkg: '@tabler/icons-webfont', version: '3.6.0', files: { 'dist/tabler-icons.min.css': 'tabler-icons/tabler-icons.min.css', 'dist/fonts/tabler-icons.woff2': 'tabler-icons/fonts/tabler-icons.woff2' } }, // só a fonte que o CSS usa (woff2: todos os navegadores atuais)
  { pkg: 'mammoth', version: '1.4.9', files: { 'mammoth.browser.min.js': 'mammoth/mammoth.browser.min.js' } },
  { pkg: 'pdfjs-dist', version: '2.13.216', files: { 'legacy/build/pdf.min.js': 'pdfjs/pdf.min.js', 'legacy/build/pdf.worker.min.js': 'pdfjs/pdf.worker.min.js' } },
  { pkg: '@fontsource/inter', version: '5.3.0', files: Object.fromEntries([300, 400, 500, 600, 700].map(w => ['files/inter-latin-' + w + '-normal.woff2', 'fonts/inter-latin-' + w + '-normal.woff2'])) },
  { pkg: '@fontsource/jetbrains-mono', version: '5.3.0', files: Object.fromEntries([400, 500].map(w => ['files/jetbrains-mono-latin-' + w + '-normal.woff2', 'fonts/jetbrains-mono-latin-' + w + '-normal.woff2'])) },
  { pkg: 'xlsx', version: '0.18.5', files: { 'dist/xlsx.full.min.js': 'xlsx/xlsx.full.min.js' } },
];

const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

if (process.argv.includes('--check')) {
  const mf = JSON.parse(fs.readFileSync(path.join(vendor, 'MANIFEST.json'), 'utf8')); let bad = 0;
  for (const [rel, h] of Object.entries(mf.files)) { const f = path.join(vendor, rel); if (!fs.existsSync(f) || sha(f) !== h) { console.log('✖ vendor/' + rel + ' difere do MANIFEST'); bad++; } }
  const present = fs.existsSync(vendor) ? walk(vendor).map(f => path.relative(vendor, f).replace(/\\/g, '/')).filter(r => r !== 'MANIFEST.json') : [];
  for (const r of present) if (!(r in mf.files)) { console.log('✖ vendor/' + r + ' não está no MANIFEST'); bad++; }
  console.log(bad ? '\nRode: node scripts/vendor-libs.mjs' : '✔ vendor/ confere com o MANIFEST (' + Object.keys(mf.files).length + ' arquivos).');
  process.exit(bad ? 1 : 0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-'));
const manifest = { geradoEm: new Date().toISOString().slice(0, 10), pacotes: [], files: {} };
fs.rmSync(vendor, { recursive: true, force: true }); fs.mkdirSync(vendor, { recursive: true });
for (const lib of LIBS) {
  const dir = path.join(tmp, lib.pkg.replace(/[@/]/g, '_')); fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync('npm', ['pack', lib.pkg + '@' + lib.version, '--json', '--ignore-scripts', '--silent'], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error('Falha ao baixar ' + lib.pkg + '@' + lib.version + ': ' + (r.stderr || r.stdout).slice(0, 300)); process.exit(1); }
  const info = JSON.parse(r.stdout)[0];
  const tgz = path.join(dir, info.filename);
  const x = spawnSync('tar', ['-xzf', info.filename], { cwd: dir, encoding: 'utf8' }); // nome relativo: o tar do Git Bash lê "C:" como máquina remota
  if (x.status !== 0) { console.error('Falha ao extrair ' + info.filename + ': ' + x.stderr.slice(0, 200)); process.exit(1); }
  const pk = path.join(dir, 'package');
  const copy = (from, to) => { const dst = path.join(vendor, to); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(from, dst); manifest.files[to.replace(/\\/g, '/')] = sha(dst); };
  for (const [from, to] of Object.entries(lib.files)) { const src = path.join(pk, from); if (!fs.existsSync(src)) { console.error('Arquivo ausente em ' + lib.pkg + ': ' + from); process.exit(1); } copy(src, to); }
  for (const [from, to] of Object.entries(lib.dirs || {})) for (const f of walk(path.join(pk, from)).filter(f => f.endsWith('.woff2'))) copy(f, path.join(to, path.relative(path.join(pk, from), f)));
  manifest.pacotes.push({ pacote: lib.pkg, versao: lib.version, integridade: info.integrity, shasum: info.shasum });
  console.log('ok  ' + lib.pkg + '@' + lib.version + '  (' + info.integrity.slice(0, 22) + '…)');
}
fs.rmSync(tmp, { recursive: true, force: true });
// CSS das fontes de texto (mesmos nomes de família que o Google Fonts usava; só o subconjunto latino, que cobre o português)
const RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const css = [['Inter', [300, 400, 500, 600, 700], 'inter'], ['JetBrains Mono', [400, 500], 'jetbrains-mono']]
  .flatMap(([fam, ws, slug]) => ws.map(w => "@font-face{font-family:'" + fam + "';font-style:normal;font-weight:" + w + ";font-display:swap;src:url('./" + slug + '-latin-' + w + "-normal.woff2') format('woff2');unicode-range:" + RANGE + '}')).join('\n') + '\n';
fs.writeFileSync(path.join(vendor, 'fonts', 'fonts.css'), css); manifest.files['fonts/fonts.css'] = sha(path.join(vendor, 'fonts', 'fonts.css'));
fs.writeFileSync(path.join(vendor, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('\nvendor/ gerado: ' + Object.keys(manifest.files).length + ' arquivos.');
