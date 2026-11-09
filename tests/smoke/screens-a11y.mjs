// Acessibilidade (axe, WCAG 2 A e AA) e largura de 375 px das telas e janelas que mais mudaram, nos três temas.
// Usa dados de teste só na memória da página (nada vai para a nuvem). Falha se uma tela nova tiver violação ou rolagem lateral.
//   npm run test:a11y
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/PMO_Compass_v2.html'; const f = join(root, p); if (!existsSync(f)) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript' }); r.end(readFileSync(f)); }).listen(0);
await new Promise(r => srv.on('listening', r));
const port = srv.address().port;

// Cenário: o que preparar e abrir. "open" roda dentro da página.
const SCENES = [
  ['Meus Indicadores', `R.go('myind')`, null],
  ['Diagnóstico PMO (antes de analisar)', `R.go('drpmo')`, null],
  ['Diagnóstico PMO (resultado)', `R.go('drpmo'); await DrPmo.run([new File(['Tarefa;Prazo;Trocar piso;01/11;Pintar sala;05/11 atraso pendente bloqueado impedimento'], 'tarefas.csv'), new File(['EAP marcos fases cronograma'], 'plano.txt')])`, null],
  ['Quadro Kanban', `R.go('kanban')`, null],
  ['Modelos de Documentos', `R.go('modelos')`, null],
  ['Orçamento e Custos (ágil)', `R.go('budget')`, null],
  ['Burnout Radar', `Burnout.resetCache(); Burnout.render(); R.go('burnout')`, null],
  ['Bússola de Negócios (janela)', `Compass.open(); await Compass.ask('Qual projeto está com maior desvio?'); await Compass.ask('Quem trabalhou mais horas?')`, 'modal-compass'],
  ['Cartão do quadro (gestão)', `Agile.openItem('US-3')`, 'modal-agile-item'],
  ['Impedimentos abertos (janela)', `Agile.openImpediments()`, 'modal-agile-imp'],
  ['Personalizar quadro (janela)', `Agile.openBoardCfg()`, 'modal-agile-board'],
  ['Mover em nome de outra pessoa (janela)', `Agile.openBehalf(DB.get('backlog')[2], 'doing', [])`, 'modal-agile-behalf'],
  ['Renovar a sessão (janela)', `window.__restoreCloud = (o => () => { Object.assign(Cloud, o); window.__restoreCloud = null; })({ isSignedIn: Cloud.isSignedIn, sessionStart: Cloud.sessionStart, authProvider: Cloud.authProvider }); Cloud.isSignedIn = () => true; Cloud.sessionStart = () => Date.now() - 479 * 60000; Cloud.authProvider = () => 'email'; SessionGuard.open()`, 'modal-session'],
  ['Rascunho da IA (janela)', `await Models.createWithAi()`, 'modal-models-ai'],
  ['Confirmação de exclusão (janela)', `Dlg.ask({ title: 'Apagar toda a base', body: 'Isso apaga tudo. Não pode ser desfeito.', okLabel: 'Apagar Toda a Base', cancelLabel: 'Manter', danger: true, check: 'Entendo que isso apaga os dados de todas as pessoas' })`, 'modal-dlg']
];

const SETUP = `
  try { document.getElementById('modal-onboarding').classList.add('hidden'); } catch (e) {}
  Auth.setFromCloud('Rita', 'gerente'); document.body.setAttribute('data-can', Auth.grantedScopes().join(' '));
  DB.set('team', [{ id: 't1', name: 'Rita', role: 'Gerente', allocationPct: 100, workloadPct: 60, signals: [] }, { id: 't2', name: 'Leandro', role: 'Dev', allocationPct: null, workloadPct: null, signals: [] }]);
  DB.set('sprints', [{ id: 'S1', name: 'Sprint 1', startOn: '2026-10-05', endOn: '2026-10-16', state: 'encerrada' }, { id: 'S2', name: 'Sprint 2', startOn: '2026-10-19', endOn: '2026-12-30', state: 'ativa' }]);
  DB.set('backlog', [{ id: 'US-1', title: 'Cadastro', kind: 'historia', status: 'done', points: 5, sprintId: 'S1', assignee: 'Rita', doneOn: '2026-10-15', createdOn: '2026-10-01' },
    { id: 'US-2', title: 'Extrato', kind: 'historia', status: 'doing', points: 3, sprintId: 'S2', assignee: 'Rita', createdOn: '2026-10-10', history: [], checklist: [{ text: 'Executar cenários', done: true }, { text: 'Anexar evidências', done: false }] },
    { id: 'US-3', title: 'Boleto', kind: 'bug', status: 'todo', points: 8, sprintId: 'S2', assignee: 'Leandro', createdOn: '2026-10-12', parentId: 'US-2' }]);
  DB.set('impediments', [{ id: 'IMP-001', title: 'Sem acesso ao ambiente de testes', owner: 'Leandro', sprintId: 'S2', status: 'aberto', note: '', createdOn: '2026-10-20' }]);
  DB.set('budgetLines', [{ id: 'b1', label: 'Time ágil', plannedValue: 32000, wbsModuleId: '', isReserve: false }]);
  DB.set('costActuals', [{ id: 'c1', label: 'Sprint 1', amount: 9600, date: '2026-10-16', kind: 'real', budgetLineId: 'b1' }]);
  DB.set('risks', [{ id: 'RK-1', title: 'Acesso ao ambiente', probability: 5, impact: 4, status: 'aberto', owner: 'Rita' }]);
  Methodology.set('agil', { silent: true });
  Cloud.isSignedIn = () => true;
  Cloud.compassDigest = async () => ({ today: '2026-11-04', canSeeCosts: false, canSeeHours: true, projects: [{ id: 'a', name: 'Implantação Cla Guard Pro', client: 'Maverick', modules: { count: 4, avgPct: 30, lateCount: 2, maxLate: 12, worst: [{ label: 'Homologação', daysLate: 12 }] }, sprint: null, risks: { open: 3, critical: 1, top: [{ title: 'Acesso ao ambiente', score: 20 }] }, decisions: { pending: 2, critical: 1 }, scope: { pending: 1, impactDays: 6 }, impediments: 1, hours: { consumed: 39, last28: 39, pending: 9, budget: null }, team: 2 }], people: [{ name: 'Marina Costa', hours28: 190, hoursTotal: 250, projects: 2 }], overallocated: [] });
  Cloud.myWorkload = async () => [];
  Store.hasKeyOrCloud = () => true;
  AI.send = async () => ({ text: JSON.stringify({ guidance: 'Confirme os responsáveis.', data: { rows: [{ what: 'Tratar o risco de acesso', why: 'Maior risco', who: 'Rita' }] } }) });
`;

const b = await chromium.launch();
let fail = 0;
const ok = (c, m, extra) => { console.log((c ? '  ok  ' : ' FALHA ') + m + (!c && extra ? '\n        ' + extra : '')); if (!c) fail++; };
// A nuvem é o padrão do app; o teste roda no modo local (nada sai do computador)
const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('pmo_cloud_v1', JSON.stringify({ url: '', anonKey: '', localOnly: true })); } catch (e) {} });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(1500);
await pg.evaluate(`(async () => { ${SETUP} })()`);

const closeAll = () => pg.evaluate(`if(window.__restoreCloud) window.__restoreCloud(); document.querySelectorAll('.modal-ov').forEach(m => m.classList.add('hidden'))`);
for (const theme of ['dark', 'light', 'gray', 'green']) {
  await pg.evaluate(`Theme.set('${theme}')`);
  for (const [name, open, modal] of SCENES) {
    await closeAll();
    await pg.evaluate(`(async () => { ${open} })()`); await pg.waitForTimeout(350);
    // axe só dentro da janela aberta, ou da tela inteira quando é uma página
    const sel = modal ? '#' + modal : '.page.on';
    const res = await new AxeBuilder({ page: pg }).include(sel).withTags(['wcag2a', 'wcag2aa']).analyze();
    const v = res.violations.map(x => `${x.id} (${x.impact}) ×${x.nodes.length}: ${x.nodes[0].target.join(' ')}`);
    ok(!v.length, `[${theme}] ${name}: acessibilidade`, v.join('\n        '));
  }
}
await closeAll();

// 375 px: sem rolagem lateral e a janela cabe na tela
await pg.setViewportSize({ width: 375, height: 700 });
await pg.evaluate(`Theme.set('dark')`);
for (const [name, open, modal] of SCENES) {
  await closeAll();
  await pg.evaluate(`(async () => { ${open} })()`); await pg.waitForTimeout(350);
  const m = await pg.evaluate(`(() => { const d = document.documentElement, box = ${modal ? `document.querySelector('#${modal} .modal-box')` : 'null'}, r = box && box.getBoundingClientRect(); return { lateral: d.scrollWidth > d.clientWidth, cabe: r ? (r.top >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1) : true }; })()`);
  ok(!m.lateral && m.cabe, `[375 px] ${name}: sem rolagem lateral e cabe na tela`, JSON.stringify(m));
}
// Celular: o Dashboard recolhe os grupos de números, menos Prazo e cronograma (que traz o farol e as decisões)
await pg.evaluate(`R.go('dashboard'); KG.compactForPhone()`); await pg.waitForTimeout(250);
const kgs = await pg.evaluate(`[...document.querySelectorAll('#p-dashboard .kg')].filter(k => !k.classList.contains('m-hidden')).map(k => [k.id, !k.querySelector('.kg-body').classList.contains('cl')])`);
ok(kgs.filter(([id, open]) => open).every(([id]) => id === 'kg-sch'), '[375 px] Dashboard: só Prazo e cronograma aberto', JSON.stringify(kgs));
// Celular: o cabeçalho cabe inteiro (nenhum botão fica para fora da tela) e a tela não mostra o texto explicativo
for (const pgName of ['dashboard', 'kanban', 'backlog']) {
  await closeAll(); await pg.evaluate(`R.go('${pgName}')`); await pg.waitForTimeout(350); await closeAll();
  const h = await pg.evaluate(`(() => { const t = document.querySelector('.topbar'), out = [...t.querySelectorAll('button')].filter(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > t.clientWidth + 1).map(e => e.title || e.id); return { sobra: t.scrollWidth > t.clientWidth, fora: out }; })()`);
  ok(!h.sobra && !h.fora.length, `[375 px] ${pgName}: cabeçalho cabe inteiro`, JSON.stringify(h));
}
ok(!errs.length, 'nenhum erro de JavaScript durante a varredura', errs.slice(0, 3).join(' | '));
await b.close(); srv.close();
console.log(fail ? `\n${fail} falha(s).` : '\nVarredura de acessibilidade e 375 px: tudo certo');
process.exit(fail ? 1 : 0);
