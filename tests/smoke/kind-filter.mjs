// Filtro por tipo (Bug, História, Tarefa, Épico) no Backlog, no Kanban e no Controle de Cards. Dados só na memória da página.
//   npm run test:kind
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/PMO_Compass_v2.html'; const f = join(root, p); if (!existsSync(f)) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); r.end(readFileSync(f)); }).listen(0);
await new Promise(r => srv.on('listening', r));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('pmo_cloud_v1', JSON.stringify({ url: '', anonKey: '', localOnly: true })); } catch (e) {} });
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(`http://localhost:${srv.address().port}/`, { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(1500);
await pg.evaluate(`(async () => {
  try { document.getElementById('modal-onboarding').classList.add('hidden'); } catch (e) {}
  Auth.setFromCloud('Rita', 'gerente'); document.body.setAttribute('data-can', Auth.grantedScopes().join(' '));
  DB.set('team', [{ id: 't1', name: 'Rita', role: 'Gerente', allocationPct: 100, workloadPct: 60, signals: [] }]);
  DB.set('sprints', [{ id: 'S2', name: 'Sprint 2', startOn: '2026-10-19', endOn: '2026-12-30', state: 'ativa' }]);
  DB.set('backlog', [
    { id: 'US-1', title: 'Cadastro', kind: 'historia', status: 'doing', points: 5, sprintId: 'S2', assignee: 'Rita', createdOn: '2026-10-10', history: [] },
    { id: 'US-2', title: 'Extrato', kind: 'tarefa', status: 'todo', points: 3, sprintId: 'S2', assignee: 'Rita', createdOn: '2026-10-10', history: [] },
    { id: 'US-3', title: 'Boleto', kind: 'bug', status: 'todo', points: 2, sprintId: 'S2', assignee: 'Rita', createdOn: '2026-10-12', parentId: 'US-1', history: [] },
    { id: 'US-4', title: 'Cartão', kind: 'bug', status: 'doing', points: 1, sprintId: 'S2', assignee: 'Rita', createdOn: '2026-10-12', parentId: 'US-1', history: [] },
    { id: 'EP-1', title: 'Pagamentos', kind: 'epico', createdOn: '2026-10-01' }]);
  Methodology.set('agil', { silent: true }); try { Agile.resetCache(); } catch (e) {}
  Cloud.isSignedIn = () => true; Store.hasKeyOrCloud = () => true;
})()`);
let fail = 0; const ok = (c, m, x) => { console.log((c ? '  ok  ' : ' FALHA ') + m + (!c && x ? ' — ' + x : '')); if (!c) fail++; };
const rows = sel => pg.evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

// Backlog
await pg.evaluate(`R.go('backlog')`); await pg.waitForTimeout(300);
const opts = await pg.evaluate(`[...document.querySelectorAll('#bl-kind option')].map(o => o.textContent)`);
ok(opts.join('|') === 'Todos os tipos|Bug (2)|Épico (1)|História (1)|Tarefa (1)', 'Backlog: seletor de tipo com a contagem de cada um', opts.join('|'));
const all = await rows('#bl-root .ag-row:not(.ag-epic)');
await pg.evaluate(`Agile.setBacklogKind('bug')`); await pg.waitForTimeout(150);
ok(await rows('#bl-root .ag-row') === 2, 'Backlog: tipo Bug mostra só os 2 bugs');
await pg.evaluate(`Agile.setBacklogKind('epico')`); await pg.waitForTimeout(150);
ok(await rows('#bl-root .ag-epic') === 1 && await rows('#bl-root .ag-row') === 1, 'Backlog: tipo Épico mostra só o épico');
await pg.evaluate(`Agile.setBacklogKind('')`); await pg.waitForTimeout(150);
ok(await rows('#bl-root .ag-row:not(.ag-epic)') === all && all === 4, 'Backlog: Todos os tipos volta à lista inteira', String(all));

// Kanban
await pg.evaluate(`R.go('kanban')`); await pg.waitForTimeout(300);
ok(await rows('.kb-card') === 4, 'Kanban: 4 cards na sprint ativa');
await pg.evaluate(`Agile.setBoardKind('bug')`); await pg.waitForTimeout(150);
ok(await rows('.kb-card') === 2, 'Kanban: tipo Bug mostra só os 2 bugs');
const kopts = await pg.evaluate(`[...document.querySelectorAll('#kb-kind option')].map(o => o.textContent).join('|')`);
ok(kopts === 'Todos os tipos|Bug (2)|História (1)|Tarefa (1)', 'Kanban: contagem por tipo continua inteira com o filtro ligado', kopts);
await pg.evaluate(`Agile.setBoardKind('')`); await pg.waitForTimeout(150);
ok(await rows('.kb-card') === 4, 'Kanban: Todos os tipos volta aos 4 cards');

// Controle de Cards
// sem sessão, a lista de projetos inclui o projeto local deste teste (com sessão ele só mostra o que vem da nuvem)
await pg.evaluate(`Cloud.isSignedIn = () => false; R.go('cardcontrol')`); await pg.waitForTimeout(400);
const total = await rows('#cc-root tr[data-key]');
const bugN = await pg.evaluate(`Number(((([...document.querySelectorAll('#cc-kind option')].find(o => o.value === 'bug') || {}).textContent || '').match(/[(]([0-9]+)[)]/) || [])[1])`);
await pg.evaluate(`const s = document.getElementById('cc-kind'); s.value = 'bug'; CardControl.render()`); await pg.waitForTimeout(200);
const bugRows = await rows('#cc-root tr[data-key]');
ok(bugN > 0 && bugRows === bugN && bugRows < total, 'Controle de Cards: tipo Bug mostra só os bugs (' + bugRows + ' de ' + total + ', igual à contagem do seletor)', 'seletor ' + bugN);
await pg.evaluate(`CardControl.clearFilters()`); await pg.waitForTimeout(200);
ok(await rows('#cc-root tr[data-key]') === total && await pg.evaluate(`document.getElementById('cc-kind').value === ''`), 'Controle de Cards: "Limpar" zera o tipo também');
ok(!errs.length, 'nenhum erro de JavaScript', errs.slice(0, 2).join(' | '));
await b.close(); srv.close();
console.log(fail ? `\n${fail} falha(s).` : '\nFiltro por tipo: tudo certo.');
process.exit(fail ? 1 : 0);
