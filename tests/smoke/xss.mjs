// Teste de injeção de script (XSS): põe um texto malicioso em todos os campos de texto dos dados (só na memória da página),
// abre todas as telas e janelas e falha se algum script dispara, se aparece elemento injetado (img/svg/iframe/on*) ou se um atributo é quebrado.
//   npm run test:xss
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/PMO_Compass_v2.html'; const f = join(root, p); if (!existsSync(f)) { r.writeHead(404); r.end(); return; } const ext = p.slice(p.lastIndexOf('.')); r.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' }); r.end(readFileSync(f)); }).listen(0);
await new Promise(r => srv.on('listening', r));
const port = srv.address().port;

// Cargas: uma quebra texto e outra quebra atributo (aspas simples e duplas). Todas marcam window.__xss se executarem.
const MARK = `window.__xss=(window.__xss||0)+1`;
const P1 = `<img src=x onerror="${MARK}">`;
const P2 = `"><svg onload="${MARK}">`;
const P3 = `' autofocus onfocus='${MARK}' x='`;
const P4 = `</script><script>${MARK}</script>`;
const PAYLOAD = P1 + P2 + P3 + P4;

// Campos que carregam texto de pessoa (ids, datas, tipos e situações ficam intactos para a tela continuar funcionando)
const TEXT_FIELDS = ['title', 'name', 'label', 'description', 'desc', 'text', 'note', 'body', 'summary', 'owner', 'assignee', 'who', 'area', 'role', 'reason', 'comment', 'message', 'mitigation', 'contingency', 'client', 'sponsor', 'org', 'responsible', 'resp', 'impact', 'decision', 'outcome', 'agenda', 'location', 'riskNote', 'recommendation', 'person', 'author', 'by'];

const SETUP = `
  try { document.getElementById('modal-onboarding').classList.add('hidden'); } catch (e) {}
  Auth.setFromCloud('Rita', 'admin'); document.body.setAttribute('data-can', Auth.grantedScopes().join(' '));
  const PL = ${JSON.stringify(PAYLOAD)}, FIELDS = new Set(${JSON.stringify(TEXT_FIELDS)});
  const taint = v => { if (Array.isArray(v)) return v.map(taint); if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = (FIELDS.has(k) && typeof v[k] === 'string') ? PL : taint(v[k]); return o; } return v; };
  const nm = PL;
  DB.set('team', [{ id: 't1', name: nm, role: nm, allocationPct: 100, workloadPct: 120, signals: [nm], recommendation: nm }, { id: 't2', name: 'Leandro', role: nm, allocationPct: 50, workloadPct: 90, signals: [] }]);
  DB.set('sprints', [{ id: 'S1', name: nm, startOn: '2026-10-05', endOn: '2026-10-16', state: 'encerrada', goal: nm }, { id: 'S2', name: nm, startOn: '2026-10-19', endOn: '2026-12-30', state: 'ativa', goal: nm }]);
  DB.set('backlog', taint([{ id: 'US-1', title: 'x', kind: 'historia', status: 'done', points: 5, sprintId: 'S1', assignee: 'x', doneOn: '2026-10-15', createdOn: '2026-10-01', description: 'x', history: [{ at: '2026-10-02', by: 'x', text: 'Comentário: x' }], checklist: [{ text: 'x', done: false }] },
    { id: 'US-2', title: 'x', kind: 'bug', status: 'doing', points: 3, sprintId: 'S2', assignee: 'x', createdOn: '2026-10-10', description: 'x', parentId: 'US-1', history: [], checklist: [], files: [{ name: 'x', size: 1 }] },
    { id: 'EP-1', title: 'x', kind: 'epico', description: 'x', createdOn: '2026-10-01' }]));
  DB.set('impediments', taint([{ id: 'IMP-001', title: 'x', owner: 'x', sprintId: 'S2', status: 'aberto', note: 'x', createdOn: '2026-10-20' }]));
  DB.set('budgetLines', taint([{ id: 'b1', label: 'x', plannedValue: 32000, wbsModuleId: '', isReserve: false }]));
  DB.set('costActuals', taint([{ id: 'c1', label: 'x', amount: 9600, date: '2026-10-16', kind: 'real', budgetLineId: 'b1' }]));
  DB.set('risks', taint([{ id: 'RK-1', title: 'x', probability: 5, impact: 4, status: 'aberto', owner: 'x', mitigation: 'x', contingency: 'x', category: 'x', description: 'x' }]));
  DB.set('wbs', taint([{ id: 'w1', label: 'x', pct: 40, status: 'doing', critical: true, owner: 'x', start: '2026-10-01', end: '2026-10-20', plannedStart: '2026-10-01', plannedEnd: '2026-10-20', deps: [], parentId: '', children: [] }]));
  DB.set('decisions', taint([{ id: 'd1', title: 'x', body: 'x', severity: 'alto', status: 'pending', origin: 'ia', createdOn: '2026-10-20' }]));
  DB.set('stakeholders', taint([{ id: 's1', name: 'x', role: 'x', org: 'x', influence: 'alta', interest: 'alta', email: 'x', lastContact: '2026-10-01', notes: 'x' }]));
  DB.set('meetings', taint([{ id: 'm1', title: 'x', date: '2026-10-20', summary: 'x', participants: ['x'], actions: [{ who: 'x', text: 'x', due: '2026-10-30' }], decisions: ['x'] }]));
  DB.set('lessons', taint([{ id: 'l1', title: 'x', severity: 'alto', sourceProject: 'x', description: 'x', recommendation: 'x' }]));
  DB.set('scopeChanges', taint([{ id: 'sc1', title: 'x', status: 'pending', body: 'x', impactDays: 3, impactCost: 100, riskNote: 'x', createdOn: '2026-10-20' }]));
  DB.set('timeEntries', taint([{ id: 'h1', person: 'x', date: '2026-10-20', hours: 6, note: 'x', itemId: 'US-2' }]));
  try { DB.updateProject(DB.getActiveProjectId(), { name: PL, client: PL, area: PL }); } catch (e) {}
  try { const id2 = DB.createProject(PL, PL, PL); DB.switchProject(DB.getActiveProjectId()); } catch (e) {}
  Methodology.set('agil', { silent: true });
  Cloud.isSignedIn = () => true;
  Cloud.compassDigest = async () => ({ today: '2026-11-04', canSeeCosts: true, canSeeHours: true, projects: [] });
  Cloud.myWorkload = async () => [];
  Store.hasKeyOrCloud = () => true;
  AI.send = async () => ({ text: JSON.stringify({ guidance: PL, data: { rows: [{ what: PL, why: PL, who: PL }] } }) });
`;

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('pmo_cloud_v1', JSON.stringify({ url: '', anonKey: '', localOnly: true })); } catch (e) {} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message.slice(0, 120)));
pg.on('dialog', d => d.dismiss().catch(() => {}));
await pg.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(1500);
await pg.evaluate(`(async () => { ${SETUP} })()`);

// todas as páginas registradas
const pages = await pg.evaluate(`[...new Set([...document.querySelectorAll('.page')].map(p => p.id.replace(/^p-/, '')))]`);
let fail = 0, seen = 0;
const ok = (c, m, extra) => { console.log((c ? '  ok  ' : ' FALHA ') + m + (!c && extra ? '\n        ' + extra : '')); if (!c) fail++; };
const probe = () => pg.evaluate(`(() => {
  const bad = [];
  // só a tela aberta, as janelas abertas e os avisos (telas escondidas guardam o que já foi achado antes)
  const scope = [...document.querySelectorAll('.page.on, .modal-ov:not(.hidden), #toast, .toast, [role="alert"], [role="status"]')];
  const all = sel => scope.flatMap(s => [...s.querySelectorAll(sel), ...(s.matches(sel) ? [s] : [])]);
  all('img[src="x"], svg[onload], [onerror], [onfocus], [autofocus]').forEach(e => { if (/__xss/.test(e.outerHTML)) bad.push(e.tagName + ' em ' + (e.closest('.page,.modal-ov') || {}).id); });
  const inj = all('script').filter(s => /__xss/.test(s.textContent) && !s.hasAttribute('data-module')).length;
  return { fired: window.__xss || 0, bad: [...new Set(bad)].slice(0, 5), inj };
})()`);
const closeAll = () => pg.evaluate(`document.querySelectorAll('.modal-ov').forEach(m => m.classList.add('hidden'))`);

for (const name of pages) {
  await closeAll();
  try { await pg.evaluate(`(async () => { R.go(${JSON.stringify(name)}); })()`); } catch (e) {}
  await pg.waitForTimeout(250);
  const r = await probe(); seen++;
  ok(!r.fired && !r.bad.length && !r.inj, `tela ${name}`, JSON.stringify(r));
  if (r.fired) await pg.evaluate(`window.__xss = 0`);
}

// Janelas e detalhes que montam HTML na hora
const OPEN = [
  ['Cartão do item', `Agile.openItem('US-2')`], ['Cartão do épico', `Agile.openItem('EP-1')`], ['Impedimentos', `Agile.openImpediments()`], ['Personalizar quadro', `Agile.openBoardCfg()`],
  ['Colaborador', `Burnout.openEdit('t1')`], ['Burnout', `Burnout.resetCache(); Burnout.render(); R.go('burnout')`], ['Painel do Gerente (decisões)', `R.go('mgrpanel'); MgrPanel.toggle('dec')`],
  ['Painel do Gerente (riscos)', `R.go('mgrpanel'); MgrPanel.toggle('rsk')`], ['Painel da Diretoria', `R.go('board'); Board.drill('proj')`], ['Visão do PMO', `R.go('pmoview'); PmoView.drill('No prazo')`],
  ['Controle de Cards (detalhe)', `R.go('cardcontrol'); const r = document.querySelector('#cc-root tr[data-key]'); if (r) CardControl.toggle(r.dataset.key)`],
  ['Central de Relatórios', `R.go('reports'); Reports.open('padrao', 'p-cards-sit'); Reports.run()`], ['Relatório de riscos', `R.go('reports'); Reports.open('padrao', 'p-riscos'); Reports.run()`],
  ['Bússola', `Compass.open(); await Compass.ask('Qual projeto está com maior desvio?')`], ['Rascunho da IA', `await Models.createWithAi()`],
  ['Transferir atividades', `R.go('mgrpanel'); const b = document.querySelector('#res-team-root [data-k]'); if (b) Resources.openTransfer(b.dataset.k)`],
  ['Dr. PMO', `R.go('drpmo'); await DrPmo.run([new File([${JSON.stringify(PAYLOAD + ';Prazo;' + PAYLOAD + ';01/11')}], 'tarefas.csv')])`],
  ['Alerta de confirmação', `Dlg.ask({ title: ${JSON.stringify(PAYLOAD)}, body: ${JSON.stringify(PAYLOAD)}, okLabel: 'Ok', cancelLabel: 'Cancelar' })`],
  ['Aviso', `T.show(${JSON.stringify(PAYLOAD)})`],
];
for (const [name, code] of OPEN) {
  await closeAll();
  try { await pg.evaluate(`(async () => { ${code} })()`); } catch (e) { /* tela pode recusar; o que importa é não executar */ }
  await pg.waitForTimeout(350);
  const r = await probe(); seen++;
  ok(!r.fired && !r.bad.length && !r.inj, `janela/detalhe ${name}`, JSON.stringify(r));
  if (r.fired) await pg.evaluate(`window.__xss = 0`);
}
console.log(`\n${seen} telas e janelas varridas com texto malicioso em todos os campos.`);
if (errs.length) console.log('(erros de JavaScript ignorados nesta varredura: ' + errs.length + ')');
await b.close(); srv.close();
console.log(fail ? `\n${fail} ponto(s) com injeção de script.` : '\nNenhum script injetado executou: tudo certo.');
process.exit(fail ? 1 : 0);
