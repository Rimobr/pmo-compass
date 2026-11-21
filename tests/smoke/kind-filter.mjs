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
// Coerência: com um responsável filtrado, o Tipo (contagem), a lista, a pizza e o quadro Responsável × Situação mostram o mesmo conjunto
await pg.evaluate(`CardControl.clearFilters(); const w = document.getElementById('cc-who'); const names = [...w.options].map(o => o.value).filter(Boolean); w.value = names[0]; CardControl.render()`); await pg.waitForTimeout(250);
const co = await pg.evaluate(`(() => {
  const n = id => [...document.querySelectorAll('#' + id + ' option')].map(o => [o.value, Number((o.textContent.match(/[(]([0-9]+)[)]/) || [])[1])]);
  const list = document.querySelectorAll('#cc-root tr[data-key]').length, who = document.getElementById('cc-who').value;
  const kinds = n('cc-kind').filter(x => x[0]).reduce((a, x) => a + x[1], 0), sts = n('cc-st').filter(x => x[0]).reduce((a, x) => a + x[1], 0);
  const pie = Number((document.querySelector('#cc-pie text') || {}).textContent || 0);
  const mxNames = [...document.querySelectorAll('#cc-matrix tbody tr td:first-child')].map(t => t.textContent.trim());
  return { list, kinds, sts, pie, who, mxNames };
})()`);
ok(co.list > 0 && co.kinds === co.list && co.sts === co.list && co.pie === co.list, 'Controle de Cards: Tipo, Situação, pizza e lista concordam com o responsável filtrado', JSON.stringify(co));
ok(co.mxNames.length === 1 && co.mxNames[0] === co.who, 'Controle de Cards: o quadro Responsável × Situação mostra só o responsável filtrado', JSON.stringify(co.mxNames));
// Colunas da lista: a pessoa escolhe quais aparecem (e a escolha fica no navegador)
await pg.evaluate(`CardControl.clearFilters()`); await pg.waitForTimeout(150);
const heads = () => pg.evaluate(`[...document.querySelectorAll('#cc-root thead th')].map(t => t.textContent.trim()).join('|')`);
const h0 = await heads();
ok(h0 === 'Projeto|Card|Situação|Responsável|Na etapa|Aberto há|Prazo|Devol.|Leitura do sistema', 'Colunas: o padrão continua igual ao de antes', h0);
await pg.evaluate(`CardControl.colsToggle()`); await pg.waitForTimeout(100);
ok(await pg.evaluate(`!document.getElementById('cc-cols-panel').hidden && document.getElementById('cc-cols-btn').getAttribute('aria-expanded') === 'true' && document.querySelectorAll('#cc-cols-panel input[type=checkbox]').length === 10 && document.querySelector('#cc-cols-panel input[data-c=card]').disabled`), 'Colunas: o painel abre com as 10 opções e "Card" não sai');
await pg.evaluate(`CardControl.colsSet('age', false); CardControl.colsSet('kind', true)`); await pg.waitForTimeout(150);
const h1 = await heads();
ok(h1 === 'Projeto|Card|Tipo|Situação|Responsável|Aberto há|Prazo|Devol.|Leitura do sistema', 'Colunas: tira "Na etapa" e põe "Tipo"', h1);
const cell = await pg.evaluate(`document.querySelector('#cc-root tbody tr[data-key] td:nth-child(3)').textContent.trim()`);
ok(['Bug', 'História', 'Tarefa'].includes(cell), 'Colunas: a coluna Tipo traz o tipo do card', cell);
await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(1200);
await pg.evaluate(`R.go('cardcontrol')`); await pg.waitForTimeout(400);
ok((await heads()) === h1, 'Colunas: a escolha continua depois de recarregar a página');
await pg.evaluate(`CardControl.colsReset()`); await pg.waitForTimeout(150);
ok((await heads()) === h0, 'Colunas: "Restaurar Padrão" volta ao padrão');
ok(!errs.length, 'nenhum erro de JavaScript', errs.slice(0, 2).join(' | '));
await b.close(); srv.close();
console.log(fail ? `\n${fail} falha(s).` : '\nFiltro por tipo: tudo certo.');
process.exit(fail ? 1 : 0);
