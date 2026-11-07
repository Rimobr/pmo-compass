// Varredura de "projeto vazio": reproduz o que acontece num navegador novo que entra na nuvem
// (o app carrega primeiro os dados de demonstração do Portal Nexus e só depois troca para o projeto real)
// e percorre TODAS as telas. Falha se aparecer qualquer dado de exemplo ou uma situação positiva/crítica sem dado por trás.
//   npm run test:smoke
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/PMO_Compass_v2.html'; const f = join(root, p); if (!existsSync(f)) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); r.end(readFileSync(f)); }).listen(0);
await new Promise(r => srv.on('listening', r));
const port = srv.address().port;

// Textos que só existem nos dados de demonstração
const DEMO = /Portal Nexus|Valdori|Beltrano|\bSC-00\d|Carla Nogueira|Diretor de TI|leitor de código de barras|homologação do leitor|Maverick IT|Controle de estoque/i;
const b = await chromium.launch();
let fail = 0; const ok = (c, m, extra) => { console.log((c ? '  ok  ' : ' FALHA ') + m + (!c && extra ? '\n        ' + extra : '')); if (!c) fail++; };
// A nuvem é o padrão do app; o teste roda no modo local (nada sai do computador)
const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('pmo_cloud_v1', JSON.stringify({ url: '', anonKey: '', localOnly: true })); } catch (e) {} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(`http://localhost:${port}/`); await pg.waitForTimeout(900);
await pg.evaluate(() => { document.getElementById('modal-onboarding').classList.add('hidden'); });

// 1) o app começa com o demo na memória (é o que acontece antes de o login terminar)
const demoLoaded = await pg.evaluate(() => (DB.get('risks') || []).length + (DB.get('scopeChanges') || []).length);
ok(demoLoaded > 0, 'ponto de partida: o Portal Nexus de demonstração está carregado na memória (' + demoLoaded + ' registros)');

// 2) a nuvem entrega o projeto real (vazio) e o projeto ativo troca
await pg.evaluate(() => DB.setProjectsFromCloud([{ id: 'pReal1', name: 'Projeto Real do Cliente', client: 'Cliente X', icon: 'compass', area: '', refDate: '', methodology: 'agil' }]));
await pg.waitForTimeout(300);
const tables = await pg.evaluate(() => { const out = {}; ['wbs', 'decisions', 'repository', 'stakeholders', 'lessons', 'scopeChanges', 'team', 'meetings', 'budgetLines', 'costActuals', 'risks', 'timeEntries', 'baselines', 'raci', 'backlog', 'sprints', 'rites', 'impediments', 'projectDocs', 'trail'].forEach(k => { out[k] = (DB.get(k) || []).length; }); return out; });
const sobra = Object.entries(tables).filter(([, n]) => n > 0);
ok(!sobra.length, 'ao trocar para o projeto real, nenhuma tabela traz dado do demonstração', JSON.stringify(sobra));
ok(await pg.evaluate(() => DB.getActiveProjectId() === 'pReal1'), 'o projeto ativo é o real');
// o que está em memória nunca pode ser gravado na chave de outro projeto
const keys = await pg.evaluate(() => Object.keys(localStorage).filter(k => /^pmo_db_v1/.test(k)));
const demoGravadoNoReal = await pg.evaluate(() => { const raw = localStorage.getItem('pmo_db_v1__pReal1'); return raw ? /Nexus|SC-00/.test(raw) : false; });
ok(!demoGravadoNoReal, 'os dados de demonstração não foram gravados na chave do projeto real');

// 3) percorre todas as telas
const pages = await pg.evaluate(() => Array.from(document.querySelectorAll('section.page')).map(s => s.id.replace(/^p-/, '')));
const hits = [];
// A Ajuda explica o produto com exemplos (Portal Nexus é o caso de demonstração citado no texto): não entra na varredura
for (const id of pages.filter(p => p !== 'help')) {
  const txt = await pg.evaluate(async id => { try { R.go(id); } catch (e) { return ''; } await new Promise(r => setTimeout(r, 160)); const el = document.getElementById('p-' + id); return el ? el.innerText : ''; }, id);
  const m = txt.match(DEMO);
  if (m) hits.push(id + ' → "' + m[0] + '"');
}
ok(!hits.length, 'nenhuma das ' + (pages.length - 1) + ' telas mostra texto de demonstração', hits.join(' | '));

// 4) situação sem dado: nada de verde nem de vermelho
await pg.evaluate(() => { R.go('dashboard'); Dashboard.render(); }); await pg.waitForTimeout(250);
const dash = await pg.evaluate(() => ({ ring: document.getElementById('hs-ring-lbl').innerText.trim(), idx: document.getElementById('hs-index-text').innerText, pcts: Array.from(document.querySelectorAll('[id^="hs-hbar-"][id$="-pct"]')).map(e => e.innerText), alerts: document.getElementById('p-dashboard').innerText }));
ok(dash.ring === '—' && /sem dados/i.test(dash.idx), 'dashboard: índice de saúde "sem dados" (não um número)', JSON.stringify(dash.ring + ' | ' + dash.idx));
ok(dash.pcts.every(p => /Sem dados/.test(p)), 'dashboard: todas as dimensões da saúde dizem "Sem dados"', JSON.stringify(dash.pcts));
await pg.evaluate(() => { R.go('board'); Board.render && Board.render(); }); await pg.waitForTimeout(300);
const heat = await pg.evaluate(() => ((document.querySelector('#board-heatmap-root table') || {}).innerText || ''));
ok(!/Cr[ií]tico|Saudável|Atenção/.test(heat.replace(/\s+/g, ' ').replace(/Projeto|Prazo|Custo|Equipe|Qualidade|Risco|Geral/g, '')), 'Painel da Diretoria: o farol do projeto vazio é "Sem dados" (sem Crítico, Saudável ou Atenção)', heat.replace(/\s+/g, ' ').slice(0, 200));
// 5) Base totalmente vazia: nenhum projeto (depois de "Apagar toda a base" ou conta sem projeto)
await pg.evaluate(() => DB.setProjectsFromCloud([]));
await pg.waitForTimeout(300);
ok(await pg.evaluate(() => DB.isEmpty() && DB.getActiveProjectId() === DB.NONE_ID), 'base vazia: não existe nenhum projeto (nem "Meu projeto" de enchimento)');
const semProjeto = [];
for (const id of pages.filter(p => !['settings', 'account', 'help', 'noproject', 'drpmo'].includes(p))) {
  const on = await pg.evaluate(async id => { try { R.go(id); } catch (e) { return 'erro: ' + e.message; } await new Promise(r => setTimeout(r, 120)); return Array.from(document.querySelectorAll('section.page.on')).map(s => s.id).join(','); }, id);
  if (on !== 'p-noproject') semProjeto.push(id + ' → ' + on);
}
ok(!semProjeto.length, 'sem projeto, toda tela de projeto leva ao convite "Nenhum projeto ainda"', semProjeto.join(' | '));
const np = await pg.evaluate(() => ({ txt: document.getElementById('p-noproject').innerText, label: document.getElementById('proj-name') && document.getElementById('proj-name').textContent, areaHidden: getComputedStyle(document.querySelector('.sb-proj-area')).display === 'none' }));
ok(/Nenhum projeto ainda/.test(np.txt) && /Criar o Meu Projeto/.test(np.txt), 'o convite oferece criar o primeiro projeto');
ok(np.label === 'Nenhum projeto' && np.areaHidden, 'o topo diz "Nenhum projeto" e o menu do projeto some');
ok(!DEMO.test(np.txt), 'nenhum texto de demonstração');
for (const id of ['settings', 'account', 'help', 'drpmo']) { const on = await pg.evaluate(async id => { R.go(id); await new Promise(r => setTimeout(r, 150)); return document.getElementById('p-' + id).classList.contains('on'); }, id); ok(on, 'sem projeto, "' + id + '" continua abrindo'); }
ok(!errs.length, 'sem erros de script', errs.join(' | '));

await b.close(); srv.close();
console.log(fail ? `\n${fail} falha(s) na varredura do projeto vazio` : '\nVarredura do projeto vazio: tudo certo');
process.exitCode = fail ? 1 : 0;
