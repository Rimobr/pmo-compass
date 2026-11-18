#!/usr/bin/env node
// Gera o pacote PÚBLICO do app em dist/: o mesmo app, com scripts e estilos minificados e sem comentários,
// para que o que vai ao navegador não carregue o texto-fonte legível (notas, nomes de módulos, comentários).
// O código-fonte legível fica só no repositório privado. A Vercel publica apenas dist/ (vercel.json).
// Uso: node scripts/build-public.mjs            (gera dist/)
//      node scripts/build-public.mjs --check    (falha se dist/ estiver diferente do que seria gerado)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const out = path.join(root, 'dist');
const check = process.argv.includes('--check');
// Módulos de inteligência que, no pacote público, viram chamadas ao servidor (função de borda intel).
// Só valem depois que a função estiver publicada: scripts/intel-live.json {"live": true}. Até lá o dist leva o módulo normal.
const live = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'intel-live.json'), 'utf8')).live === true; } catch(e) { return false; } })();
const KEEP_BEGIN = '// ▼ NAVEGADOR', KEEP_END = '// ▲ fim do trecho que fica no navegador';
// Casca do Dr. PMO: mantém no app só o trecho marcado (clip/ENUM/parse) e pede o resto ao servidor
function drPmoStub(body) {
  const a = body.indexOf(KEEP_BEGIN), b = body.indexOf(KEEP_END);
  if (a < 0 || b < a) throw new Error('Marcadores do Dr. PMO não encontrados');
  const keep = body.slice(body.indexOf('\n', a) + 1, b);
  return "const DrPmoCore = (() => {\n  const clip = (s, n) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim().slice(0, n);\n" + keep + "\n  return { analyze: docs => Intel.call('DrPmoCore.analyze', docs), pack: docs => Intel.call('DrPmoCore.pack', docs), parse };\n})();";
}
const STUBS = {
  'services/dr-pmo': drPmoStub,
  'services/workload': "const WorkloadCalc = { all: (team, ctx) => Intel.get('WorkloadCalc.all', { team, ctx }, null) || {} };",
  'services/decision-center': "const DecisionCenter = (() => { const LV = s => s >= 85 ? 'crit' : s >= 65 ? 'high' : 'med'; return { build: input => Intel.get('DecisionCenter.build', input, [], { stale: true }), LV }; })();",
};
// Troca de UMA função dentro de um módulo (o resto do módulo continua no app). A função precisa ser autocontida.
const FN_STUBS = {
  'services/plan-vs-real': [{ name: 'allocPlan', stub: "function allocPlan(person) { return Intel.get('PlanVsReal.allocPlan', person, null); }" }],
};
// Acha o fim da função (chaves balanceadas, ignorando textos entre aspas, crases e comentários).
function cutFunction(code, name) {
  const start = code.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Função não encontrada para trocar: ' + name);
  let i = code.indexOf('{', start), depth = 0;
  for (; i < code.length; i++) {
    const c = code[i], n = code[i + 1];
    if (c === '/' && n === '/') { i = code.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && n === '*') { i = code.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { const q = c; for (i++; i < code.length && code[i] !== q; i++) if (code[i] === '\\') i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return [start, i + 1]; }
  }
  throw new Error('Chaves não fecham em ' + name);
}
const COPY = ['manifest.json', 'sw.js', 'version.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

function buildHtml(src) {
  const text = src.replace(/\r\n/g, '\n');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>|<style\b([^>]*)>([\s\S]*?)<\/style>/g;
  let res = '', last = 0, m, js = 0, css = 0;
  const plain0 = chunk => chunk.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
  const plain = plain0;
  const modRe = /^\s*<script data-module="([^"]+)"/;
  while ((m = re.exec(text))) {
    res += plain(text.slice(last, m.index));
    if (m[0].startsWith('<script')) {
      const mod = (modRe.exec(m[0]) || [])[1];
      if (live && mod && STUBS[mod]) { const code = typeof STUBS[mod] === 'function' ? STUBS[mod](m[2]) : STUBS[mod]; res += '<script' + m[1] + '>' + esbuild.transformSync(code, { minify: true, target: 'es2020' }).code.trim() + '</script>'; js++; last = m.index + m[0].length; continue; }
      const attrs = m[1];
      let body = m[2];
      if (live && mod && FN_STUBS[mod]) FN_STUBS[mod].forEach(x => { const [a, b] = cutFunction(body, x.name); body = body.slice(0, a) + x.stub + body.slice(b); });
      const type = (/type\s*=\s*["']([^"']+)["']/i.exec(attrs) || [])[1] || '';
      if (/\bsrc\s*=/.test(attrs) || !body.trim() || (type && !/javascript|module/i.test(type))) res += m[0];
      else { res += '<script' + attrs + '>' + esbuild.transformSync(body, { minify: true, target: 'es2020', legalComments: 'none' }).code.trim() + '</script>'; js++; }
    } else {
      res += '<style' + m[3] + '>' + esbuild.transformSync(m[4], { loader: 'css', minify: true, legalComments: 'none' }).code.trim() + '</style>'; css++;
    }
    last = m.index + m[0].length;
  }
  res += plain(text.slice(last));
  return { html: res.replace(/\n[ \t]*\n+/g, '\n'), js, css };
}

const built = buildHtml(fs.readFileSync(path.join(root, 'PMO_Compass_v2.html'), 'utf8'));
const files = new Map([['PMO_Compass_v2.html', Buffer.from(built.html, 'utf8')]]);
COPY.forEach(f => { const p = path.join(root, f); if(fs.existsSync(p)) files.set(f, fs.readFileSync(p)); });

if (check) {
  let bad = 0;
  for (const [name, buf] of files) {
    const p = path.join(out, name);
    if (!fs.existsSync(p) || !fs.readFileSync(p).equals(buf)) { console.log('✖ dist desatualizado:', name); bad++; }
  }
  console.log(bad ? '\nRode: npm run build:public' : '✔ dist/ está igual ao que seria gerado agora.');
  process.exit(bad ? 1 : 0);
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const [name, buf] of files) fs.writeFileSync(path.join(out, name), buf);
const src = fs.statSync(path.join(root, 'PMO_Compass_v2.html')).size, dst = built.html.length;
console.log('dist/ gerado: ' + built.js + ' scripts e ' + built.css + ' estilos minificados; app ' + Math.round(src / 1024) + ' KB → ' + Math.round(dst / 1024) + ' KB.');
