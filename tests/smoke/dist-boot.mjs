// Smoke do PACOTE PÚBLICO (dist/): abre o app servido com a política de conteúdo REAL (vercel.json) e falha se houver erro de JavaScript,
// bloqueio de política, pedido a domínio externo, biblioteca que não carrega ou módulo que não definiu o seu nome (ex.: um corte do pacote
// que deixa um nome citado no return do módulo, o que derruba o módulo inteiro). Roda em modo local (sem nuvem), como os outros testes de navegador.
//   node tests/smoke/dist-boot.mjs
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(root, 'dist');
if (!existsSync(join(dir, 'PMO_Compass_v2.html'))) { console.error('dist/ não existe. Rode: npm run build:public'); process.exit(2); }
const vj = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const headers = {}; vj.headers.find(h => h.source === '/(.*)').headers.forEach(h => { headers[h.key] = h.value; });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/PMO_Compass_v2.html'; const f = join(dir, p); if (!existsSync(f)) { r.writeHead(404); r.end(); return; } r.writeHead(200, { ...headers, 'Content-Type': MIME[extname(f)] || 'application/octet-stream' }); r.end(readFileSync(f)); }).listen(0);
await new Promise(r => srv.on('listening', r));
const base = `http://localhost:${srv.address().port}`;
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('pmo_cloud_v1', JSON.stringify({ url: '', anonKey: '', localOnly: true })); } catch (e) {} });
const pg = await ctx.newPage(); const errs = [], ext = [], csp = []; let bad = 0;
pg.on('pageerror', e => errs.push(e.message.slice(0, 160)));
pg.on('console', m => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(t.slice(0, 200)); });
pg.on('request', r => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) ext.push(u.slice(0, 100)); });
const ok = (cond, msg) => { console.log((cond ? '  ok  ' : '  FALHA ') + msg); if (!cond) bad++; };
await pg.goto(base + '/', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(3000);

// 1) todos os módulos definiram o seu nome (um módulo que falha ao carregar deixa a constante sem definir)
const mods = readFileSync(join(dir, 'PMO_Compass_v2.html'), 'utf8').match(/^<script data-module="[^"]+">/gm) || [];
const names = await pg.evaluate(`['HealthScore','AgileCalc','DecisionCenter','PlanVsReal','WorkloadCalc','DrPmoCore','CompassCore','Prompts','AgileAi','ModelsAi','ModelsCalc','ReportEngine','Intel','Cloud','AI','Reports','CardControl','MgrPanel','Burnout','Compass'].filter(n => { try { return eval('typeof ' + n) === 'undefined'; } catch (e) { return true; } })`);
ok(names.length === 0, 'módulos principais definidos' + (names.length ? ' — FALTAM: ' + names.join(', ') : ' (' + mods.length + ' blocos no pacote)'));
ok(await pg.evaluate(`typeof ModelsAi !== 'undefined' && typeof ModelsAi.prompt === 'function' && typeof ModelsAi.parse === 'function'`), 'ModelsAi com prompt e parse (Rascunho de documentos)');
ok(await pg.evaluate(`typeof DrPmoCore.analyze === 'function' && typeof DrPmoCore.parse === 'function'`), 'DrPmoCore com analyze e parse');

// 2) bibliotecas locais carregam sob a política de conteúdo
const load = src => pg.evaluate(`new Promise(res => { const s = document.createElement('script'); s.src = ${JSON.stringify(src)}; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); })`);
for (const [src, g] of [['vendor/supabase-js/supabase.js', 'supabase.createClient'], ['vendor/pdfjs/pdf.min.js', 'pdfjsLib.getDocument'], ['vendor/mammoth/mammoth.browser.min.js', 'mammoth.extractRawText'], ['vendor/xlsx/xlsx.full.min.js', 'XLSX.read']]) {
  ok((await load(src)) && await pg.evaluate(`typeof window.${g.split('.')[0]} !== 'undefined' && typeof window.${g} === 'function'`), 'biblioteca ' + src);
}
ok(await pg.evaluate(`new Promise(res => { try { const w = new Worker('vendor/pdfjs/pdf.worker.min.js'); w.onerror = () => res(false); setTimeout(() => { w.terminate(); res(true); }, 600); } catch (e) { res(false); } })`), 'worker do leitor de PDF abre sob a política');
await pg.evaluate(`document.fonts.ready`);
ok(await pg.evaluate(`document.fonts.check('16px tabler-icons') && [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Inter' && f.status === 'loaded')`), 'fontes de ícones e de texto carregadas do próprio app');

// 3) nada de externo, nada bloqueado, nenhum erro
ok(ext.length === 0, 'nenhum pedido a domínio externo' + (ext.length ? ': ' + [...new Set(ext)].join(', ') : ''));
ok(csp.length === 0, 'nenhum bloqueio da política de conteúdo' + (csp.length ? ': ' + csp.join(' | ') : ''));
ok(errs.length === 0, 'nenhum erro de JavaScript' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close(); srv.close();
console.log(bad ? `\n${bad} falha(s) no pacote público.` : '\nPacote público: tudo certo.');
process.exit(bad ? 1 : 0);
