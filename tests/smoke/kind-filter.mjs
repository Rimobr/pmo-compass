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
const iso = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10), DONE_RECENT = iso(3), DONE_OLD = iso(40);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('pmo_cloud_v1', JSON.stringify({ url: '', anonKey: '', localOnly: true })); } catch (e) {} });
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(`http://localhost:${srv.address().port}/`, { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(1500);
await pg.evaluate(`(async () => {
  try { document.getElementById('modal-onboarding').classList.add('hidden'); } catch (e) {}
  Auth.setFromCloud('Rita', 'gerente'); document.body.setAttribute('data-can', Auth.grantedScopes().join(' '));
  DB.set('team', [{ id: 't1', name: 'Rita', role: 'Gerente', allocationPct: 100, workloadPct: 60, signals: [] }]);
  DB.set('sprints', [{ id: 'S1', name: 'Sprint 1', startOn: '2026-09-01', endOn: '2026-09-14', state: 'encerrada' }, { id: 'S2', name: 'Sprint 2', startOn: '2026-10-19', endOn: '2026-12-30', state: 'ativa' }]);
  DB.set('backlog', [
    { id: 'US-1', title: 'Cadastro', kind: 'historia', status: 'doing', points: 5, sprintId: 'S2', assignee: 'Rita', createdOn: '2026-10-10', history: [] },
    { id: 'US-2', title: 'Extrato', kind: 'tarefa', status: 'todo', points: 3, sprintId: 'S2', assignee: 'Rita', createdOn: '2026-10-10', history: [] },
    { id: 'US-3', title: 'Boleto', kind: 'bug', status: 'todo', points: 2, sprintId: 'S2', assignee: 'Rita', createdOn: '2026-10-12', parentId: 'US-1', history: [] },
    { id: 'US-4', title: 'Cartão', kind: 'bug', status: 'doing', points: 1, sprintId: 'S2', assignee: 'Rita', createdOn: '2026-10-12', parentId: 'US-1', history: [] },
    { id: 'US-5', title: 'Fatura', kind: 'historia', status: 'done', points: 3, sprintId: 'S1', assignee: 'Rita', createdOn: '2026-09-01', doneOn: '${DONE_RECENT}', history: [] },
    { id: 'US-6', title: 'Antigo', kind: 'tarefa', status: 'done', points: 2, sprintId: 'S1', assignee: 'Rita', createdOn: '2026-08-01', doneOn: '${DONE_OLD}', history: [] },
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
// O filtro fica logo acima das colunas, com rótulo; o limite por coluna conta todos os cards, mesmo com o filtro ligado
const pos = await pg.evaluate(`(() => { const r = document.getElementById('kb-root'), p = r.previousElementSibling; return { junto: p.classList.contains('kb-filter') && p.contains(document.getElementById('kb-sprint')) && p.contains(document.getElementById('kb-kind')), rotulos: [...p.querySelectorAll('label')].map(l => l.textContent).join('|'), n: document.getElementById('kb-count').textContent }; })()`);
ok(pos.junto && pos.rotulos === 'Sprint|Tipo de card' && pos.n === '4 cards no quadro', 'Kanban: filtros logo acima das colunas, com rótulo e a contagem do quadro', JSON.stringify(pos));
const hdr = () => pg.evaluate(`document.querySelector('.kb-col[data-status=doing] .kb-count').textContent`);
const h2all = await hdr();
await pg.evaluate(`Agile.setBoardKind('bug')`); await pg.waitForTimeout(150);
const h2bug = await hdr(), nbug = await pg.evaluate(`document.getElementById('kb-count').textContent`);
ok(/^2( \/ \d+)?$/.test(h2all) && /^1 de 2( · limite \d+)?$/.test(h2bug) && nbug === 'Mostrando 2 de 4 cards', 'Kanban: com o filtro, a coluna diz "1 de 2" (o limite conta todos) e a linha diz quantos mostra', h2all + ' | ' + h2bug + ' | ' + nbug);
await pg.evaluate(`Agile.setBoardKind('')`); await pg.waitForTimeout(150);

// Cartão (bugs US-008 e US-009 do quadro PMO Compass)
await pg.evaluate(`(() => { const b = DB.get('backlog'), it = b.find(x => x.id === 'US-2'); it.history = [{ at: '2026-10-11T10:00:00Z', by: 'Rita', field: '', from: '', to: 'Comentário: primeiro pedido' }, { at: '2026-10-12T10:00:00Z', by: 'Rita', field: '', from: '', to: 'Comentário: pedido mais recente' }]; DB.set('backlog', b); Agile.resetCache(); Agile.openItem('US-2'); })()`);
await pg.waitForTimeout(300);
// a janela de sessão (do ambiente de teste, com sessão simulada) não pode cobrir o cartão
await pg.evaluate(`document.getElementById('modal-session') && document.getElementById('modal-session').remove()`);
const cm = await pg.evaluate(`(() => { const l = document.getElementById('ai-lastnotes'); return { primeiro: (l.children[0] || {}).textContent || '', topo: l.scrollTop }; })()`);
ok(/pedido mais recente/.test(cm.primeiro) && cm.topo === 0, 'Cartão (US-009): o comentário mais recente aparece primeiro, sem rolar', JSON.stringify(cm));
const abre = async sel => { try { const [fc] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 4000 }), pg.click(sel, { timeout: 4000 })]); return fc; } catch (e) { return null; } };
const fc1 = await abre('#ai-files-add');
ok(!!fc1, 'Cartão (US-008): clicar em "Anexos e evidências" abre a escolha de arquivo, mesmo sem anexo');
if (fc1) { await fc1.setFiles({ name: 'print.png', mimeType: 'image/png', buffer: Buffer.from('x') }); await pg.waitForTimeout(150); }
ok(await pg.evaluate(`/print[.]png/.test(document.getElementById('ai-files-pend').textContent) && /1 arquivo/.test(document.getElementById('ai-evid-n').textContent)`), 'Cartão (US-008): o arquivo escolhido aparece junto do título e do clipe');
ok(!!(await abre('#ai-evid-btn')), 'Cartão (US-008): o clipe continua abrindo a escolha de arquivo');
// US-010: botão Enviar grava na hora, sem fechar o cartão (clique e Ctrl+Enter)
await pg.evaluate(`document.getElementById('modal-agile-item').classList.add('hidden'); Agile.openItem('US-2')`); await pg.waitForTimeout(300);
ok(await pg.evaluate(`document.getElementById('ai-send').disabled`), 'Cartão (US-010): sem texto, o botão Enviar fica desligado');
await pg.fill('#ai-note', 'Enviado pelo botão'); await pg.click('#ai-send'); await pg.waitForTimeout(300);
const st1 = await pg.evaluate(`({ aberto: !document.getElementById('modal-agile-item').classList.contains('hidden'), topo: (document.getElementById('ai-lastnotes').children[0] || {}).textContent || '', campo: document.getElementById('ai-note').value, desl: document.getElementById('ai-send').disabled, gravado: (DB.get('backlog').find(x => x.id === 'US-2').history || []).filter(h => h.to === 'Comentário: Enviado pelo botão').length })`);
ok(st1.aberto && /Enviado pelo botão/.test(st1.topo) && st1.campo === '' && st1.desl && st1.gravado === 1, 'Cartão (US-010): Enviar grava, o comentário aparece no topo e o cartão continua aberto', JSON.stringify(st1));
await pg.fill('#ai-note', 'Enviado pelo teclado'); await pg.press('#ai-note', 'Control+Enter'); await pg.waitForTimeout(300);
ok(await pg.evaluate(`/Enviado pelo teclado/.test((document.getElementById('ai-lastnotes').children[0] || {}).textContent) && !document.getElementById('modal-agile-item').classList.contains('hidden')`), 'Cartão (US-010): Ctrl+Enter também envia');
await pg.evaluate(`document.getElementById('modal-agile-item').classList.add('hidden'); Agile.openItem()`); await pg.waitForTimeout(250);
ok(await pg.evaluate(`document.getElementById('ai-send-row').style.display === 'none'`), 'Cartão (US-010): em card novo (ainda não salvo) o botão não aparece');
await pg.evaluate(`document.getElementById('modal-agile-item').classList.add('hidden')`);
// Correção automática: selo no cartão e liga/desliga em Personalizar quadro
await pg.evaluate(`R.go('kanban')`); await pg.waitForTimeout(250);
const selo = () => pg.evaluate(`[...document.querySelectorAll('.kb-card')].filter(c => /Aguardando correção|Em análise|Corrigido, revisar/.test(c.textContent)).map(c => c.dataset.id + ':' + c.textContent.match(/Aguardando correção|Em análise|Corrigido, revisar/)[0]).join(',')`);
ok((await selo()) === 'US-4:Aguardando correção', 'Correção automática: só o bug em Em andamento mostra "Aguardando correção"', await selo());
await pg.evaluate(`(() => { const b = DB.get('backlog'), it = b.find(x => x.id === 'US-4'); it.history = [{ at: '2026-11-26T10:00:00Z', by: 'Claude Code (correção automática)', field: '', from: '', to: 'Comentário: Recebido pela correção automática em 26/11 10:00; em análise.' }]; DB.set('backlog', b); Agile.resetCache(); Agile.render ? Agile.render() : R.go('dashboard'); R.go('kanban'); })()`); await pg.waitForTimeout(300);
ok((await selo()) === 'US-4:Em análise', 'Correção automática: depois do primeiro contato o selo vira "Em análise"', await selo());
await pg.evaluate(`Agile.openBoardCfg(); document.getElementById('ab-fix-on').checked = false; document.getElementById('ab-fix-pub').value = 'approve'; Agile.saveBoardCfg()`); await pg.waitForTimeout(300);
ok((await selo()) === '' && await pg.evaluate(`const c = DB.get('agileConfig').autoFix; c.on === false && c.publish === 'approve'`), 'Correção automática: desligada em Personalizar quadro, o selo some e a escolha é gravada', await selo());
await pg.evaluate(`Agile.openBoardCfg()`); await pg.waitForTimeout(150);
ok(await pg.evaluate(`!document.getElementById('ab-fix-on').checked && document.getElementById('ab-fix-pub').value === 'approve'`), 'Correção automática: a janela reabre com a escolha gravada');
ok(await pg.evaluate(`(() => { const b = document.getElementById('ab-fix-sched'); return !!b && /Próxima Fase/.test(b.textContent) && /Ainda não executa nada/.test(b.textContent) && b.querySelectorAll('select').length === 3 && [...b.querySelectorAll('select')].every(s => s.disabled); })()`), 'Execução sozinha: aparece como "Próxima Fase", desligada e dizendo que ainda não executa nada');
await pg.evaluate(`document.getElementById('ab-fix-on').checked = true; document.getElementById('ab-fix-pub').value = 'auto'; Agile.saveBoardCfg()`); await pg.waitForTimeout(250);

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
ok(await pg.evaluate(`document.getElementById('cc-cols-btn').textContent.trim() === 'Concluir' && document.getElementById('cc-cols-btn').classList.contains('btn-acc') && /Salvo automaticamente/.test(document.getElementById('cc-cols-panel').textContent)`), 'Colunas: com o painel aberto o botão vira Concluir (destacado) e o painel diz que salva sozinho');
ok(await pg.evaluate(`!document.getElementById('cc-cols-panel').hidden && document.getElementById('cc-cols-btn').getAttribute('aria-expanded') === 'true' && document.querySelectorAll('#cc-cols-panel input[type=checkbox]').length === 10 && document.querySelector('#cc-cols-panel input[data-c=card]').disabled`), 'Colunas: o painel abre com as 10 opções e "Card" não sai');
await pg.evaluate(`CardControl.colsSet('age', false); CardControl.colsSet('kind', true)`); await pg.waitForTimeout(150);
const h1 = await heads();
ok(h1 === 'Projeto|Card|Tipo|Situação|Responsável|Aberto há|Prazo|Devol.|Leitura do sistema', 'Colunas: tira "Na etapa" e põe "Tipo"', h1);
const cell = await pg.evaluate(`document.querySelector('#cc-root tbody tr[data-key] td:nth-child(3)').textContent.trim()`);
ok(['Bug', 'História', 'Tarefa'].includes(cell), 'Colunas: a coluna Tipo traz o tipo do card', cell);
await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(1200);
await pg.evaluate(`R.go('cardcontrol')`); await pg.waitForTimeout(400);
ok((await heads()) === h1, 'Colunas: a escolha continua depois de recarregar a página');
await pg.evaluate('CardControl.colsToggle()'); await pg.waitForTimeout(100);
// arrasto de verdade: solta Responsável na metade esquerda de Situação (fica antes dela)
await pg.dragAndDrop('#cc-cols-panel .cc-chip[data-c=who]', '#cc-cols-panel .cc-chip[data-c=st]', { targetPosition: { x: 4, y: 8 } }); await pg.waitForTimeout(200);
const h2 = await heads();
ok(h2 === 'Projeto|Card|Tipo|Responsável|Situação|Aberto há|Prazo|Devol.|Leitura do sistema', 'Colunas: arrastar muda a ordem (Responsável passa antes de Situação)', h2);
ok(await pg.evaluate('document.querySelectorAll("#cc-cols-panel .cc-chip[draggable=true]").length === document.querySelectorAll("#cc-root thead th").length && !document.querySelector("#cc-cols-panel button[aria-label^=Mover]") && !document.querySelector("#cc-cols-panel .cc-chip:not(.on)[draggable]")'), 'Colunas: só as marcadas se arrastam e não há botões de seta');
await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(1200);
await pg.evaluate(`R.go('cardcontrol')`); await pg.waitForTimeout(400);
ok((await heads()) === h2, 'Colunas: a ordem escolhida continua depois de recarregar a página');
await pg.evaluate(`CardControl.colsReset()`); await pg.waitForTimeout(150);
ok((await heads()) === h0, 'Colunas: "Restaurar Padrão" volta ao padrão (campos e ordem)');
// Uma só fonte da ordem: arrastar o título NA TABELA muda também a seleção do painel
await pg.evaluate('CardControl.colsToggle(true)'); await pg.waitForTimeout(500);
await pg.dragAndDrop('#cc-root thead th:nth-child(5)', '#cc-root thead th:nth-child(3)', { targetPosition: { x: 4, y: 8 } }); await pg.waitForTimeout(400);
const hT = await heads();
const chips = () => pg.evaluate("[...document.querySelectorAll('#cc-cols-panel .cc-chip.on label')].map(l => l.textContent.replace(' (sempre)', '').trim()).join('|')");
ok(hT === 'Projeto|Card|Na etapa|Situação|Responsável|Aberto há|Prazo|Devol.|Leitura do sistema', 'Tabela: arrastar o título muda a ordem das colunas', hT);
ok((await chips()) === hT, 'Tabela e painel: a ordem dos títulos e a das colunas marcadas são a mesma depois de arrastar na tabela', (await chips()) + ' != ' + hT);
await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(1200);
await pg.evaluate("R.go('cardcontrol'); CardControl.colsToggle(true)"); await pg.waitForTimeout(500);
ok((await heads()) === hT && (await chips()) === hT, 'Tabela e painel: a ordem arrastada na tabela continua igual nos dois depois de recarregar');
await pg.evaluate('CardControl.colsReset()'); await pg.waitForTimeout(150);
ok((await heads()) === h0 && (await chips()) === h0, 'Tabela e painel: Restaurar Padrão volta os dois ao padrão');
await pg.focus('#cc-cols-panel .cc-chip[data-c=proj] input'); await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
ok(await pg.evaluate(`document.getElementById('cc-cols-panel').hidden && document.getElementById('cc-cols-btn').textContent.trim() === 'Colunas' && !document.getElementById('cc-cols-btn').classList.contains('btn-acc')`), 'Colunas: Esc (ou clicar em Concluir) esconde a seleção e o botão volta a Colunas');
// Período: o que a tela mostra precisa bater com o seletor, com o cartão "Concluídos" e com a linha de escopo
await pg.evaluate(`CardControl.clearFilters(); const pn = DB.listProjects().concat(DB.listPortfolio ? [] : []).find(p => p.id === DB.getActiveProjectId()); window.__pn = pn ? pn.name : ''; const s = document.getElementById('cc-proj'); if (window.__pn) s.value = window.__pn; CardControl.render()`); await pg.waitForTimeout(200);
const perInfo = () => pg.evaluate(`(() => {
  const sel = document.getElementById('cc-per'), cur = sel.value, opt = sel.options[sel.selectedIndex], n = Number((opt.textContent.match(/[(]([0-9]+)[)]/) || [])[1]);
  const kpi = [...document.querySelectorAll('#cc-kpis .kpi')].find(k => k.querySelector('.kpi-lbl').textContent === 'Concluídos');
  const ids = [...document.querySelectorAll('#cc-root tbody tr[data-key] td:nth-child(2) b')].map(b => b.textContent.trim());
  return { cur, n, rows: ids.length, ids, concl: kpi ? Number(kpi.querySelector('.kpi-val').textContent) : -1, scope: document.getElementById('cc-scope').textContent };
})()`);
const setPer = v => pg.evaluate(`document.getElementById('cc-per').value = ${JSON.stringify(v)}; CardControl.render()`).then(() => pg.waitForTimeout(200));
const hasProj = await pg.evaluate(`!!window.__pn`);
ok(hasProj, 'Período: o projeto de teste foi encontrado');
await setPer('d15'); const p15 = await perInfo();
ok(p15.ids.includes('US-5') && !p15.ids.includes('US-6') && p15.rows === p15.n && p15.concl === p15.rows, 'Período: últimos 15 dias traz só o concluído recente, e lista, seletor e cartão concordam', JSON.stringify(p15));
ok(/concluídos de/.test(p15.scope) && new RegExp(p15.rows + ' card').test(p15.scope), 'Período: a linha de escopo diz o que está sendo mostrado', p15.scope);
await setPer('d90'); const p90 = await perInfo();
ok(p90.ids.includes('US-5') && p90.ids.includes('US-6') && p90.rows === p90.n, 'Período: últimos 90 dias traz também o concluído de 40 dias atrás', JSON.stringify(p90));
const spVal = await pg.evaluate(`([...document.querySelectorAll('#cc-per option')].find(o => /^Sprint 1 /.test(o.textContent)) || {}).value`); ok(!!spVal, 'Período: a sprint aparece com nome e datas, agrupada em "Sprints"');
await setPer(spVal); const ps = await perInfo();
ok(ps.ids.includes('US-5') && ps.ids.includes('US-6') && !ps.ids.includes('US-1') && ps.rows === ps.n, 'Período: escolher uma sprint traz os cards dela (concluídos inclusive)', JSON.stringify(ps));
await setPer('all'); const pa = await perInfo();
ok(pa.ids.includes('US-5') && pa.ids.includes('US-1') && pa.rows === pa.n, 'Período: "Tudo" traz abertos e concluídos (no lugar da caixa Incluir concluídos)', JSON.stringify(pa));
await setPer('now'); const pn0 = await perInfo();
ok(!pn0.ids.includes('US-5') && pn0.concl >= 2, 'Período: "Abertos agora" esconde os concluídos mas o cartão conta o histórico', JSON.stringify(pn0));
// Abas: o que obedece aos filtros fica logo abaixo deles; a evolução é outra aba, com filtros próprios
const ord = await pg.evaluate(`(() => { const q = id => document.getElementById(id), before = (a, b) => !!(q(a).compareDocumentPosition(q(b)) & Node.DOCUMENT_POSITION_FOLLOWING); return { filtrosAntes: before('cc-per', 'cc-kpis') && before('cc-kpis', 'cc-matrix') && before('cc-matrix', 'cc-root'), evoFora: !q('cc-pane-cards').contains(q('cc-evo')), evoOculta: q('cc-pane-evo').hidden, aba: q('cc-tab-cards').getAttribute('aria-selected') }; })()`);
ok(ord.filtrosAntes && ord.evoFora && ord.evoOculta && ord.aba === 'true', 'Abas: filtros primeiro, depois números, quadro e lista; a evolução fica em outra aba', JSON.stringify(ord));
await pg.evaluate(`CardControl.tab('evo')`); await pg.waitForTimeout(150);
const ab = await pg.evaluate(`({ cards: document.getElementById('cc-pane-cards').hidden, evo: document.getElementById('cc-pane-evo').hidden, sel: document.getElementById('cc-tab-evo').getAttribute('aria-selected') })`);
ok(ab.cards && !ab.evo && ab.sel === 'true', 'Abas: Evolução das Entregas troca o painel e marca a aba', JSON.stringify(ab));
await pg.evaluate(`document.getElementById('ev-proj').value = window.__pn; CardControl.render()`); await pg.waitForTimeout(150);
// Evolução das entregas
const evo = () => pg.evaluate(`(() => { const t = document.querySelectorAll('#cc-evo tbody tr'); return { n: t.length, first: t[0] ? [...t[0].cells].map(c => c.textContent.trim()) : [], text: document.getElementById('cc-evo').textContent }; })()`);
const e1 = await evo();
const rowS1 = await pg.evaluate(`[...document.querySelectorAll('#cc-evo tbody tr')].map(r => [...r.cells].map(c => c.textContent.trim().replace(/\\s+/g, ' '))).find(c => /Sprint 1/.test(c[0]))`);
ok(rowS1 && rowS1[1] === '2' && rowS1[2] === '2' && rowS1[3] === '0' && rowS1[4] === '100%', 'Evolução por sprint: Sprint 1 entrou 2, concluiu 2, transbordo 0, 100%', JSON.stringify(rowS1));
ok(/Como (corrigir|manter|melhorar)|Sem dados suficientes/.test(e1.text), 'Evolução: traz a leitura e o que fazer (ou diz que faltam dados)');
await pg.evaluate(`CardControl.evoSet('month')`); await pg.waitForTimeout(150);
const em = await evo(); ok(em.n === 6, 'Evolução por mês: 6 meses', String(em.n));
await pg.evaluate(`CardControl.evoSet('week')`); await pg.waitForTimeout(150);
const ew = await evo(); ok(ew.n === 8, 'Evolução por semana: 8 semanas', String(ew.n));
const sumW = await pg.evaluate(`[...document.querySelectorAll('#cc-evo tbody tr')].reduce((a, r) => a + Number(r.cells[1].textContent), 0)`);
ok(sumW >= 1, 'Evolução por semana: o concluído de 3 dias atrás aparece', String(sumW));
// Independência: mexer nos filtros dos Cards não muda a evolução, e limpar os da evolução não mexe nos Cards
const evoAntes = (await evo()).text;
await pg.evaluate(`CardControl.tab('cards'); document.getElementById('cc-per').value = 'd15'; document.getElementById('cc-who').value = ''; CardControl.render()`); await pg.waitForTimeout(150);
ok((await evo()).text === evoAntes, 'Abas: filtrar os Cards (Período) não muda a Evolução');
await pg.evaluate(`CardControl.evoClear()`); await pg.waitForTimeout(150);
ok(await pg.evaluate(`document.getElementById('cc-per').value === 'd15' && document.getElementById('ev-proj').value === ''`), 'Abas: limpar os filtros da Evolução não mexe nos filtros dos Cards');
await pg.evaluate(`CardControl.clearFilters()`); await pg.waitForTimeout(150);
ok(await pg.evaluate(`document.getElementById('cc-per').value === 'now'`), 'Período: "Limpar Filtros" volta a Abertos agora');
ok(!errs.length, 'nenhum erro de JavaScript', errs.slice(0, 2).join(' | '));
await b.close(); srv.close();
console.log(fail ? `\n${fail} falha(s).` : '\nFiltro por tipo: tudo certo.');
process.exit(fail ? 1 : 0);
