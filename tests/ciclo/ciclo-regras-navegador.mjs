// Ciclo de conflitos entre as regras novas (épico, fila de bugs, comentário só de inclusão, devolver card, entrega, sessão).
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
import http from 'node:http'; import { readFileSync } from 'node:fs';
const res = []; const ok = (c, m, extra) => { res.push([c, m]); console.log(c ? 'OK   ' : 'FALHA', m, c ? '' : (extra || '')); };
const srv = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html; charset=utf-8'); r.end(readFileSync(ROOT + 'PMO_Compass_v2.html')); }).listen(0);
const b = await chromium.launch();
const page = async (w = 1280, h = 900) => { const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage(); await p.addInitScript(() => { try { localStorage.setItem('pmo_cloud_v1', JSON.stringify({ localOnly: true })); } catch (e) {} }); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept()); await p.goto('http://localhost:' + srv.address().port + '/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1400); return p; };
const seed = async (p, items, team) => { await p.evaluate(([it, tm]) => { if (tm) DB.set('team', [...(DB.get('team') || []), ...tm]); DB.set('sprints', []); DB.set('backlog', it); }, [items, team || null]); await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1400); await p.evaluate(() => { document.querySelectorAll('[id^="modal-"]').forEach(e => e.classList.add('hidden')); }); };
const base = (o) => ({ kind: 'tarefa', status: 'todo', points: 1, assignee: '', sprintId: '', rank: 1, createdOn: '2026-11-01', doneOn: '', parentId: '', epicId: '', bugPriority: '', attachments: [], history: [{ at: '2026-11-01T00:00:00Z', by: 'Leandro', field: '', from: '', to: 'Card criado' }], checklist: [], ...o });

// 1) Épico x Bug: o bug só se liga a uma entrega (nunca a um épico); fila de bugs e épicos convivem
let p = await page();
await seed(p, [base({ id: 'EP-001', title: 'Relatórios', kind: 'epico', points: '' }), base({ id: 'US-001', title: 'Relatório de vendas', kind: 'historia', epicId: 'EP-001' }), base({ id: 'US-002', title: 'Erro A', kind: 'bug', parentId: 'US-001', bugPriority: 2 }), base({ id: 'US-003', title: 'Erro B', kind: 'bug', parentId: 'US-001', bugPriority: 1 })]);
let r = await p.evaluate(() => ({ refs: Agile.itemRefs().map(x => x.id), epicos: Agile.epicList().map(e => e.id), fila: AgileCalc.bugQueue(DB.get('backlog')).map(x => x.id) }));
ok(!r.refs.includes('EP-001'), 'bug: a lista de entregas (item pai) não oferece o épico', JSON.stringify(r.refs));
ok(r.epicos.join() === 'EP-001', 'épico fica na lista própria do módulo');
ok(r.fila.join() === 'US-003,US-002', 'fila de bugs não é afetada pelo épico', r.fila.join());
await p.evaluate(() => R.go('backlog')); await p.waitForTimeout(400);
r = await p.evaluate(() => [...document.querySelectorAll('#bl-root > *')].map(e => e.classList.contains('ag-epic') ? 'EPICO' : e.classList.contains('ag-epic-h') ? '[sem]' : e.querySelector('.ag-title').innerText));
ok(r[0] === 'Erro B' && r[1] === 'Erro A' && r[2] === 'EPICO' && r[3] === 'Relatório de vendas', 'backlog: bugs com prioridade no topo, depois o épico com as histórias', r.join(' | '));
// salvar um card qualquer não derruba o épico nem a ligação
await p.evaluate(() => Agile.openItem('US-001')); await p.waitForTimeout(250); await p.fill('#ai-note', 'comentário de teste do ciclo'); await p.evaluate(() => Agile.saveItem()); await p.waitForTimeout(400);
r = await p.evaluate(() => ({ epicos: DB.get('backlog').filter(x => x.kind === 'epico').length, liga: DB.get('backlog').find(x => x.id === 'US-001').epicId, coment: DB.get('backlog').find(x => x.id === 'US-001').history.filter(h => String(h.to).startsWith('Comentário')).length }));
ok(r.epicos === 1 && r.liga === 'EP-001' && r.coment === 1, 'salvar história com comentário mantém o épico e a ligação', JSON.stringify(r));
ok(p.errs.length === 0, 'sem erro de script no cenário 1', p.errs.join(';'));

// 2) Épico x Meus Indicadores / resumo: não conta entrega nem card sem responsável
const mi = await p.evaluate(() => { const c = MyInd.compute({ names: ['Leandro', 'Ricardo M'], today: '2026-11-11', items: DB.get('backlog'), wbs: [], sprints: [], cols: AgileCalc.cols(Agile.cfgNow()), hours: [], imps: [], risks: [], win: 7 }); return { linhas: c.rows.map(x => x.ref), done28: c.kpis.done28 }; });
ok(!mi.linhas.includes('EP-001'), 'Meus Indicadores não lista o épico', mi.linhas.join());
ok(p.errs.length === 0, 'sem erro de script no cenário 2');

// 3) Quadro (is-board): sem épico (opção e botão somem), sem campo Épico
await p.evaluate(() => { Methodology.isBoard = () => true; document.body.classList.add('is-board'); R.go('backlog'); });
await p.waitForTimeout(300);
r = await p.evaluate(() => { Agile.openItem(); const o = [...document.getElementById('ai-kind').options].find(x => x.value === 'epico'); return { opcaoOculta: !!(o.hidden || o.disabled), campoEpic: document.getElementById('ai-epic-grp').style.display, botao: getComputedStyle(document.querySelector('.btn-epic')).display }; });
ok(r.opcaoOculta && r.campoEpic === 'none' && r.botao === 'none', 'Quadro: tipo Épico, campo Épico e botão Novo Épico ficam ocultos', JSON.stringify(r));
await p.close();

// 4) Devolver card x comentário x histórico (card meu)
p = await page();
const eu = await p.evaluate(() => Auth.getName());
await seed(p, [base({ id: 'US-010', title: 'Meu card', kind: 'tarefa', status: 'review', assignee: eu }), base({ id: 'US-011', title: 'Outro card', kind: 'tarefa', status: 'doing', assignee: eu })], [{ id: 'tm-eu', name: eu, role: 'Dev', allocation: 50, workload: 50, signals: [], recommendation: '', actionPage: '' }]);
await p.evaluate(() => { R.go('kanban'); Agile.setBoardSprint('__all'); }); await p.waitForTimeout(500);
await p.click('.kb-card[data-id="US-010"] .kb-mv button >> nth=0'); await p.waitForTimeout(300);
r = await p.evaluate(() => ({ janela: !!document.getElementById('modal-return') && !document.getElementById('modal-return').classList.contains('hidden'), form: !document.getElementById('modal-agile-item').classList.contains('hidden') }));
ok(r.janela && !r.form, 'devolver pelo botão ◀: abre só a janela de motivo (não o cartão inteiro)', JSON.stringify(r));
await p.fill('#rt-why', 'Faltou o log do caixa'); await p.click('#rt-ok'); await p.waitForTimeout(300);
r = await p.evaluate(() => { const it = DB.get('backlog').find(x => x.id === 'US-010'); return { st: it.status, primeiro: it.history[0].to, ultimos: it.history.slice(-2).map(h => (h.field ? h.field + ':' : '') + h.to) }; });
ok(r.st === 'doing' && r.primeiro === 'Card criado' && /Comentário: Faltou/.test(r.ultimos[0]) && /Situação/.test(r.ultimos[1]), 'devolver: motivo vira comentário no histórico, antes da mudança de situação, e "Card criado" continua primeiro', JSON.stringify(r));
// entrega: quem levou à revisão pela última vez
await p.evaluate(([nome]) => { const l = DB.get('backlog'); const it = l.find(x => x.id === 'US-011'); it.status = 'done'; it.doneOn = '2026-11-10'; it.assignee = 'Leandro R'; it.history.push({ at: '2026-11-09T10:00:00Z', by: nome, field: 'Situação', from: 'A fazer', to: 'Em andamento' }, { at: '2026-11-09T11:00:00Z', by: nome, field: 'Situação', from: 'Em andamento', to: 'Em revisão' }, { at: '2026-11-10T09:00:00Z', by: 'Leandro', field: 'Situação', from: 'Em revisão', to: 'Concluído' }); DB.set('backlog', l); }, [eu]);
r = await p.evaluate(([nome]) => { const base = { today: '2026-11-11', items: DB.get('backlog'), wbs: [], sprints: [], cols: AgileCalc.cols(Agile.cfgNow()), hours: [], imps: [], risks: [], win: 7 }; return { eu: MyInd.compute({ ...base, names: [nome] }).kpis.done28, leandro: MyInd.compute({ ...base, names: ['Leandro R'] }).kpis.done28 }; }, [eu]);
ok(r.eu === 1 && r.leandro === 0, 'entrega vai para quem levou à revisão (não para o revisor/responsável atual)', JSON.stringify(r));
ok(p.errs.length === 0, 'sem erro de script no cenário 4', p.errs.join(';'));
await p.close();

// 5) Sessão x atualização automática: modal aberto bloqueia a releitura; política inválida volta ao padrão
p = await page();
r = await p.evaluate(async () => {
  Cloud.isSignedIn = () => true; Cloud.authProvider = () => 'email'; Cloud.sessionStart = () => Date.now() - (480 * 60000 - 20000); let n = 0; Cloud.pullAll = async () => { n++; };
  await new Promise(r => setTimeout(r, 1400));
  const aberta = !document.getElementById('modal-session').classList.contains('hidden');
  const refresh = await AutoRefresh.tick(Date.now() + 40 * 60000);
  return { aberta, refresh, pulls: n, pol: SessionGuard.clean({ refreshMin: 7, sessionMin: 99 }) };
});
ok(r.aberta && r.refresh === false && r.pulls === 0, 'janela de renovação aberta bloqueia a atualização automática', JSON.stringify(r));
ok(r.pol.refreshMin === 10 && r.pol.sessionMin === 480, 'política inválida volta ao padrão (10 min / 8 h)');
await p.close();

// 6) Épico x regra do responsável: só ligar ao épico passa num card sem responsável; outra mudança continua barrada
p = await page();
await seed(p, [base({ id: 'EP-001', title: 'Relatórios', kind: 'epico', points: '', description: '' }), base({ id: 'US-020', title: 'Concluída sem responsável', kind: 'historia', status: 'done', doneOn: '2026-11-04', description: '' })]);
await p.evaluate(() => { R.go('backlog'); Agile.openItem('US-020'); }); await p.waitForTimeout(300);
await p.selectOption('#ai-epic', 'EP-001'); await p.evaluate(() => Agile.saveItem()); await p.waitForTimeout(400);
r = await p.evaluate(() => DB.get('backlog').find(x => x.id === 'US-020').epicId);
ok(r === 'EP-001', 'ligar a um épico um card concluído sem responsável (única mudança) é permitido', r);
await p.evaluate(() => { const l = DB.get('backlog'); l.find(x => x.id === 'US-020').epicId = ''; DB.set('backlog', l); }); await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1300);
await p.evaluate(() => { document.querySelectorAll('[id^="modal-"]').forEach(e => e.classList.add('hidden')); R.go('backlog'); Agile.openItem('US-020'); }); await p.waitForTimeout(300);
await p.selectOption('#ai-epic', 'EP-001'); await p.fill('#ai-title', 'Concluída (editada)'); await p.evaluate(() => Agile.saveItem()); await p.waitForTimeout(400);
r = await p.evaluate(() => DB.get('backlog').find(x => x.id === 'US-020').title);
ok(r === 'Concluída sem responsável', 'épico + outra mudança num card sem responsável continua barrado (regra antiga preservada)', r);
await p.close();

// 7) Resumo da revisão da sprint por pessoa, igual à regra de entrega de Meus Indicadores
p = await page();
const h2 = (by, de, para) => ({ at: '2026-11-09T10:00:00Z', by, field: 'Situação', from: de, to: para });
await p.evaluate(() => { DB.set('sprints', [{ id: 'S1', name: 'Sprint 1', goal: '', startOn: '2026-11-02', endOn: '2026-11-13', state: 'ativa', capacity: 10 }]); });
await seed(p, [base({ id: 'US-030', title: 'A', kind: 'historia', status: 'done', doneOn: '2026-11-05', assignee: 'Leandro R', sprintId: 'S1', description: '', history: [h2('Ricardo M', 'A fazer', 'Em andamento'), h2('Ricardo M', 'Em andamento', 'Em revisão'), h2('Leandro', 'Em revisão', 'Concluído')] })]);
await p.evaluate(() => DB.set('sprints', [{ id: 'S1', name: 'Sprint 1', goal: '', startOn: '2026-11-02', endOn: '2026-11-13', state: 'ativa', capacity: 10 }])); await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1300);
await p.evaluate(() => { document.querySelectorAll('[id^="modal-"]').forEach(e => e.classList.add('hidden')); R.go('ritos'); Rites.setSprint('S1'); Rites.select('revisao'); }); await p.waitForTimeout(500);
r = await p.evaluate(() => document.querySelector('#p-ritos').innerText);
ok(/Quem entregou/.test(r) && /Ricardo M · 1 item/.test(r) && !/Leandro R · 1 item/.test(r), 'revisão da sprint: a entrega aparece para quem levou à revisão (Ricardo M), não para o responsável atual', r.slice(r.indexOf('Quem entregou'), r.indexOf('Quem entregou') + 80));
await p.close();

// 8) Automáticos × regras: horas sugeridas pela atividade passam pelas regras de lançamento e alimentam a carga do Burnout; WBS automática × ajuste manual
p = await page();
const eu8 = await p.evaluate(() => Auth.getName());
await p.evaluate(([nome]) => {
  const hoje = Clock.iso(Clock.today()); const dia = n => { const x = new Date(hoje + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
  const util = n => { let d = dia(n); while ([0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())) { n++; d = dia(n); } return d; };
  const h = d => ({ at: d + 'T15:00:00Z', by: nome, field: 'Situação', from: 'A fazer', to: 'Em andamento' });
  DB.set('team', [{ id: 'tmE', name: nome, role: 'Dev', allocationPct: 100, workloadPct: null, signals: [], recommendation: '', actionPage: '' }]);
  DB.set('sprints', []); DB.set('timeEntries', []); DB.set('wbs', []); DB.set('hoursRules', {});
  DB.set('backlog', [{ id: 'US-1', title: 'Relatório de vendas', kind: 'historia', status: 'doing', points: 3, assignee: nome, sprintId: '', rank: 1, createdOn: '2026-11-01', doneOn: '', description: '', attachments: [], history: [h(util(1)), h(util(2))], checklist: [] }]);
}, [eu8]);
await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1400);
await p.evaluate(() => { document.querySelectorAll('[id^="modal-"]').forEach(e => e.classList.add('hidden')); R.go('hours'); }); await p.waitForTimeout(400);
r = await p.evaluate(() => { const antes = Burnout.effectivePct(DB.get('team')[0]); Hours.suggestApply(''); Burnout.resetCache(); return { antes, lancadas: DB.get('timeEntries').length, depois: Burnout.effectivePct(DB.get('team')[0]), conf: WorkloadCalc.compute(DB.get('team')[0], { items: DB.get('backlog'), sprints: [], hours: DB.get('timeEntries'), imps: [], today: Clock.iso(Clock.today()), capacity: null }).confidence }; });
ok(r.lancadas >= 2 && r.depois != null && r.depois !== r.antes, 'horas sugeridas pela atividade são lançadas e mudam a carga calculada do Burnout', JSON.stringify(r));
// período fechado: a sugestão passa pelas mesmas regras e não lança
await p.evaluate(() => { DB.set('timeEntries', []); const mes = Clock.iso(Clock.today()).slice(0, 7), ant = new Date(Clock.iso(Clock.today()) + 'T12:00:00Z'); ant.setUTCDate(ant.getUTCDate() - 12); DB.set('hoursRules', { closedPeriods: [...new Set([mes, ant.toISOString().slice(0, 7)])].map(p => ({ period: p, by: 'teste', at: '' })) }); });
await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1400);
await p.evaluate(() => { document.querySelectorAll('[id^="modal-"]').forEach(e => e.classList.add('hidden')); R.go('hours'); Hours.suggestApply(''); }); await p.waitForTimeout(300);
r = await p.evaluate(() => DB.get('timeEntries').length);
ok(r === 0, 'sugestão de horas respeita o período fechado (nada é lançado)', String(r));
// WBS automática × ajuste manual
await p.evaluate(() => { DB.set('wbs', [{ id: 'wmA', label: 'Entrega A', status: 'amb', pct: 0, start: '2026-11-02', end: '2026-12-20', startActual: null, endActual: null, responsavel: '', critical: false, predecessors: [], children: [{ id: 'wtA', label: 'T1', status: 'grn', start: '2026-11-02', end: '2026-11-06', predecessors: [] }, { id: 'wtB', label: 'T2', status: 'neu', start: '2026-11-09', end: '2026-11-13', predecessors: [] }] }]); WBS.resetCache(); R.go('wbs'); });
await p.waitForTimeout(300);
await p.evaluate(() => WBS.updateField('task', 'wmA', 'wtB', 'status', 'grn')); await p.waitForTimeout(300);
r = await p.evaluate(() => DB.get('wbs')[0].pct);
ok(r === 100, 'WBS no automático: concluir a última subtarefa leva a entrega a 100%', String(r));
await p.evaluate(() => { const l = DB.get('wbs'); l[0].pct = 70; DB.set('wbs', l); WBS.resetCache(); WBS.updateField('task', 'wmA', 'wtA', 'status', 'amb'); }); await p.waitForTimeout(300);
r = await p.evaluate(() => DB.get('wbs')[0].pct);
ok(r === 70, 'WBS com ajuste manual do gerente (70%): o automático não sobrescreve', String(r));
await p.close();

await b.close(); srv.close();
const falhas = res.filter(x => !x[0]).length;
console.log('\nRESULTADO: ' + (res.length - falhas) + ' de ' + res.length + ' verificações OK' + (falhas ? ' — ' + falhas + ' FALHA(S)' : ''));
process.exit(falhas ? 1 : 0);
