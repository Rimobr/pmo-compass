import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const mod = n => html.match(new RegExp(`<script data-module="${n}">([\\s\\S]*?)<\\/script>`))[1];
const { PmoViews: V } = new Function(`const PortfolioKpi={aggregate:()=>({total:{}}),evaluate:()=>({})};\n${mod('services/pmo-views')}\nreturn { PmoViews };`)();
const { PlanVsReal: P } = new Function(`${mod('services/plan-vs-real')}\nreturn { PlanVsReal };`)();
test('todo motivo de atenção da Visão do PMO tem correção e mitigação', () => {
  const motivos = ['prazo fora do plano', 'custo acima do previsto', 'mudança de escopo sem decisão', 'término 12 dia(s) depois da linha de base', 'sem linha de base', 'sem atualização há 20 dias', '2 revisão(ões) de risco vencida(s)', 'projeto em risco', '1 risco(s) crítico(s)', '1 risco(s) crítico(s) sem responsável', '2 decisão(ões) crítica(s)', '1 colaborador(es) com carga muito alta', 'redistribuir 2 colaborador(es) sobrealocado(s)', '3 item(ns) bloqueado(s)', '2 ação(ões) de reunião pendente(s)', 'sem entregas cadastradas: apoiar o planejamento', '2 entrega(s) atrasada(s)'];
  for(const m of motivos) { const t = V.fixFor(m); assert.match(t, /Corrigir:/, m); assert.match(t, /Mitigar:/, m); }
  assert.match(V.fixFor('1 risco(s) crítico(s) sem responsável'), /nomear/);
  assert.match(V.fixFor('motivo desconhecido'), /Corrigir:.*Mitigar:/);
});
test('Estimado × Real: só tema fora do esperado ganha sugestão', () => {
  const cells = { entregas: { level: 'red', text: 'x' }, horas: { level: 'grn', text: 'y' }, riscos: { level: 'amb', text: 'z' }, sprint: null };
  const f = P.fixesOf(cells);
  assert.deepEqual(f.map(x => x.key), ['entregas', 'riscos']);
  assert.ok(f.every(x => /mitig/i.test(x.text)));
  assert.deepEqual(P.fixesOf({}), []);
});
test('alertas soltos das telas trazem "Como corrigir"', () => {
  for(const trecho of ['colaborador(es) em zona crítica', 'Gargalo crítico:', 'mudança(s) aberta(s)', 'sem entrega da WBS vinculada', 'stakeholder crítico sem contato']) {
    const i = html.indexOf(trecho); assert.ok(i > 0, trecho);
    assert.match(html.slice(i, i + 1600), /Como corrigir/, trecho);
  }
  assert.match(html, /pp atrasado · corrigir:/);
});
test('sobrealocação: plano diz de onde tirar, quanto e como mitigar', () => {
  const p = P.allocPlan({ name: 'Leandro R', total: 200, rows: [{ projectId: 'a', projectName: 'Barbearia', pct: 100, openCards: 4 }, { projectId: 'b', projectName: 'Financeira', pct: 100, openCards: 1 }] });
  assert.equal(p.excess, 100); assert.equal(p.cuts[0].projectName, 'Financeira'); assert.equal(p.cuts[0].to, 0);
  assert.match(p.steps[0], /1 card/); assert.ok(p.escalate); assert.match(p.mitigate, /diretoria/);
  const q = P.allocPlan({ name: 'X', total: 120, rows: [{ projectId: 'a', projectName: 'A', pct: 60, priorityValue: 80 }, { projectId: 'b', projectName: 'B', pct: 60, priorityValue: 20 }] });
  assert.equal(q.cuts[0].projectName, 'B'); assert.equal(q.cuts[0].to, 40); assert.ok(!q.escalate);
  assert.equal(P.allocPlan({ name: 'Y', total: 100, rows: [{ pct: 50 }, { pct: 50 }] }), null);
});
test('Diagnóstico de Documentos é porta única: transformar em projeto, aplicar ao aberto ou descartar tudo; Raio-X só em lote', () => {
  for(const k of ['DrPmo.create()', 'DrPmo.apply()', 'DrPmo.discard()', 'id="drpmo-apply"', 'Transformar em Projeto', 'Descartar Tudo', 'Raio-X em Lote', 'function open(kind, afterFn)', "onclick=\"R.go('drpmo')\" title=\"Aponte"]) assert.ok(html.includes(k) || k.startsWith('onclick'), k);
  assert.ok(!html.includes('aria-label="Diagnóstico de documentos"'), 'sem abas duplicadas');
  assert.ok(!html.includes("'drpmo' : 'xray')"), 'o menu abre sempre o Dr. PMO');
});
test('Meu time em todos os projetos: soma por pessoa e sugere quem recebe (mesmo cargo, com folga)', () => {
  const { TeamCapacity: T } = new Function(`${mod('services/team-capacity')}\nreturn { TeamCapacity };`)();
  const projetos = [
    { id: 'a', name: 'Barbearia', team: [{ name: 'Leandro R', role: 'QA', allocationPct: 100 }, { name: 'Ana', role: 'QA', allocationPct: 40 }, { name: 'Beto', role: 'Dev', allocationPct: 20 }], sprints: [{ id: 's1', endOn: '2026-11-10' }],
      items: [{ id: 'US-1', title: 'x', kind: 'historia', status: 'doing', points: 3, assignee: 'leandro r', sprintId: 's1' }, { id: 'US-2', title: 'y', kind: 'bug', status: 'done', assignee: 'Leandro R' }, { id: 'EP-1', kind: 'epico', status: 'todo', assignee: 'Leandro R' }] },
    { id: 'b', name: 'Financeira', team: [{ name: 'Leandro R', role: 'QA', allocationPct: 100 }], sprints: [], items: [{ id: 'T-1', title: 'z', kind: 'tarefa', status: 'todo', assignee: 'Leandro R' }] }];
  const gente = T.build(projetos, '2026-11-15');
  const l = gente.find(p => p.key === 'leandro r');
  assert.equal(l.total, 200); assert.equal(l.level, 'over'); assert.equal(l.open, 2); assert.equal(l.late, 1); assert.equal(l.points, 3);
  const c = T.candidates(gente, l, projetos[0].team);
  assert.deepEqual(c.map(x => x.name), ['Ana', 'Beto']); assert.ok(c[0].sameRole && !c[1].sameRole);
  assert.deepEqual(T.candidates(gente, l, [{ name: 'Leandro R' }]), []);
  assert.equal(T.filter(gente, { role: 'dev' }).length, 1); assert.equal(T.filter(gente, { onlyOver: true }).length, 1);
});
test('transferência de atividades: banco com reassign_items e tela com janela própria', () => {
  const sql = readFileSync(join(root, 'supabase/migrations/20261115120000_reassign_items.sql'), 'utf8');
  for(const k of ['reassign_items', 'is_project_manager', "kind <> 'epico'", "status <> 'done'", 'array_length(ids, 1) > 200', 'não é uma pessoa com acesso']) assert.ok(sql.includes(k), k);
  for(const k of ['id="modal-transfer"', 'Resources.confirmTransfer()', 'reassignItems', 'id="res-team-root"', 'Transferir Atividades']) assert.ok(html.includes(k), k);
});
test('nome digitado sem conta: o sistema aponta quem parece ser a mesma pessoa', () => {
  const { TeamCapacity: T } = new Function(`${mod('services/team-capacity')}\nreturn { TeamCapacity };`)();
  const contas = ['Leandro R', 'Ana Souza'];
  assert.equal(T.similar('Lendro R', contas), 'Leandro R'); assert.equal(T.similar('Leandro', contas), 'Leandro R');
  assert.equal(T.similar('TimeQA', contas), ''); assert.equal(T.similar('Ana', contas), '');
});
test('sem ninguém para receber: o sistema traduz em falta de capacidade (priorizar, ampliar o time, avisar a diretoria)', () => {
  const rows = [{ projectId: 'a', projectName: 'A', pct: 100, openCards: 4 }, { projectId: 'b', projectName: 'B', pct: 100, openCards: 1 }, { projectId: 'c', projectName: 'C', pct: 100, openCards: 2 }, { projectId: 'd', projectName: 'D', pct: 100, openCards: 0 }];
  const p = P.allocPlan({ name: 'Leandro R', total: 400, receivers: 0, rows });
  assert.equal(p.kind, 'capacity'); assert.equal(p.peopleNeeded, 3); assert.equal(p.keep, 'A'); assert.deepEqual(p.cuts.map(c => c.projectName).sort(), ['B', 'C', 'D']);
  assert.match(p.headline, /única pessoa/); assert.match(p.steps.join(' '), /Não há para quem transferir/); assert.match(p.steps.join(' '), /Amplie o time/); assert.match(p.mitigate, /diretoria hoje/); assert.ok(p.escalate);
  const q = P.allocPlan({ name: 'X', total: 200, receivers: 2, rows: rows.slice(0, 2) }); assert.notEqual(q.kind, 'capacity');
  assert.ok(html.includes('id="board-capacity-root"') && html.includes('Decisões da Diretoria'), 'alerta no Painel da Diretoria');
});
test('caso real: há gente em outro projeto, mas onde estão os cards ninguém recebe: é decisão de capacidade e nomeia os projetos', () => {
  const rows = [{ projectId: 'g', projectName: 'Cla Guard', pct: 100, openCards: 0, receivers: 1 }, { projectId: 'b', projectName: 'Barbearia', pct: 100, openCards: 4, receivers: 0 }, { projectId: 'v', projectName: 'Vida-Financeira', pct: 100, openCards: 1, receivers: 0 }, { projectId: 'p', projectName: 'PMO Compass', pct: 100, openCards: 0, receivers: 0 }];
  const p = P.allocPlan({ name: 'Leandro R', total: 400, receivers: 0, rows });
  assert.equal(p.kind, 'capacity'); assert.deepEqual(p.solo.map(x => x.projectName), ['Barbearia', 'Vida-Financeira', 'PMO Compass']);
  assert.match(p.headline, /única pessoa disponível em Barbearia, Vida-Financeira, PMO Compass/);
  for(const k of ['function systemRisks()', 'function registerRisk(key, pid)', 'Ponto único de falha', 'id="risk-sys-root"', 'Identificado pelo Sistema', 'forPid || DB.getActiveProjectId()']) assert.ok(html.includes(k), k);
});
test('Central de Decisões: ordena por urgência e cada decisão traz porquê, previsão, o que fazer, prazo e ação', () => {
  const { DecisionCenter: D } = new Function(`${mod('services/decision-center')}\nreturn { DecisionCenter };`)();
  const plan = P.allocPlan({ name: 'Leandro R', total: 400, receivers: 0, rows: [{ projectId: 'a', projectName: 'A', pct: 100, openCards: 4, receivers: 0 }, { projectId: 'b', projectName: 'B', pct: 100, openCards: 1, receivers: 0 }] });
  const facts = { decisions: { pendingCritical: ['Aprovar contrato'], pendingCriticalCount: 1 }, risks: { top: [{ title: 'Sem QA', score: 20, level: 'crítico', owner: '' }] }, schedule: { delayed: [{ label: 'Relatórios', daysLate: 6 }], delayedCount: 1, spi: 0.8 }, budget: { hasBudget: true, cpi: 0.8, eacPctOfBac: 120 }, scope: { openCount: 2, daysImpact: 8, costImpact: 5000 } };
  const r = D.build({ projects: [{ id: 'a', name: 'A', facts, ev: {}, sprint: { etaLate: 3, gap: 4 } }], capacity: [{ key: 'u:1', name: 'Leandro R', total: 400, open: 5, plan }], sysRisks: [{ key: 'u:1', person: 'Leandro R', projectId: 'a', projectName: 'A', title: 't' }], canCosts: true });
  assert.equal(r[0].kind, 'capacidade'); assert.equal(r[0].level, 'crit'); assert.equal(r[1].kind, 'decisao');
  assert.deepEqual(r.map(x => x.score), [...r.map(x => x.score)].sort((a, b) => b - a));
  for(const d of r) { assert.ok(d.why && d.forecast && d.recommend.length && d.decideBy, d.kind); }
  assert.ok(r[0].actions.some(a => a.type === 'risk') && r.some(x => x.kind === 'custo') && r.some(x => x.kind === 'sprint') && r.some(x => x.kind === 'escopo'));
  assert.match(r.find(x => x.kind === 'prazo').forecast, /25% mais longo/);
  assert.equal(D.build({ projects: [], capacity: [] }).length, 0);
  assert.ok(html.includes('id="mg-center"') && html.includes('MgrPanel.act(this)') && html.includes('pullPortfolio'), 'tela e carga do portfólio');
});
test('com conta na nuvem a demonstração nunca aparece em lista de projetos nem em painel', () => {
  for(const k of ["const withoutDemo = list => (typeof Cloud !== 'undefined' && Cloud.isSignedIn())", 'function listProjects() { return withoutDemo(loadProjects()); }', 'function listPortfolio() { return withoutDemo(loadProjects())']) assert.ok(html.includes(k), k);
});
test('Controle de Cards: tempo por etapa pela história, devolução com motivo, alertas com o que fazer e previsão', () => {
  const { CardFlow: C } = new Function(`${mod('services/card-flow')}\nreturn { CardFlow };`)();
  const cols = [{ key: 'todo', label: 'A fazer' }, { key: 'doing', label: 'Em andamento' }, { key: 'review', label: 'Em revisão' }, { key: 'done', label: 'Concluído' }];
  const D = d => `2026-11-${String(d).padStart(2, '0')}T12:00:00.000Z`, now = Date.parse(D(20));
  const hist = (...ev) => [{ at: D(1), by: 'Ana', field: '', from: '', to: 'Card criado' }].concat(ev);
  const mv = (d, from, to, by) => ({ at: D(d), by, field: 'Situação', from, to });
  const feitos = [3, 4, 5].map(n => ({ id: 'D' + n, kind: 'tarefa', status: 'done', history: hist(mv(2, 'A fazer', 'Em andamento', 'Ana'), mv(2 + n, 'Em andamento', 'Em revisão', 'Ana'), mv(3 + n, 'Em revisão', 'Concluído', 'Beto')) }));
  const bench = C.benchmarks(feitos, cols, now);
  assert.equal(bench.n, 3); assert.ok(bench.stage.doing >= 3 && bench.cycle > 0);
  // card parado em revisão há 10 dias, devolvido duas vezes, com prazo vencido e sem responsável na etapa
  const card = { id: 'US-1', kind: 'historia', status: 'review', assignee: '', history: hist(mv(2, 'A fazer', 'Em andamento', 'Ana'), mv(5, 'Em andamento', 'Em revisão', 'Ana'), mv(6, 'Em revisão', 'Em andamento', 'Beto'), { at: D(6), by: 'Beto', field: '', from: '', to: 'Comentário: faltou o teste do relatório' }, mv(8, 'Em andamento', 'Em revisão', 'Ana'), mv(9, 'Em revisão', 'Em andamento', 'Beto'), mv(10, 'Em andamento', 'Em revisão', 'Ana')) };
  const a = C.analyze(card, cols, now, { bench, due: '2026-11-15' });
  assert.equal(a.stageKey, 'review'); assert.equal(a.stageAge, 10); assert.equal(a.returns, 2); assert.equal(a.lastReturn.reason, '' ); 
  assert.equal(a.timeline.length, 7); assert.equal(a.timeline[1].label, 'Em andamento');
  const txt = a.alerts.map(x => x.text).join(' | ');
  assert.match(txt, /Parado há 10 dia/); assert.match(txt, /Prazo vencido há 5/); assert.match(txt, /Sem responsável/); assert.match(txt, /Devolvido 2 vezes/);
  assert.ok(a.alerts.every(x => x.fix && x.fix.length > 20)); assert.equal(a.level, 'red'); assert.ok(a.eta && a.eta.late);
  const r1 = C.analyze({ id: 'X', kind: 'tarefa', status: 'doing', assignee: 'Ana', history: hist(mv(2, 'A fazer', 'Em andamento', 'Ana'), { at: D(2), by: 'Ana', field: '', from: '', to: 'Comentário: puxei' }) }, cols, now, { bench });
  assert.equal(r1.returns, 0); assert.equal(r1.lastReturn, null);
  const devolvido = C.analyze({ id: 'Y', kind: 'tarefa', status: 'doing', assignee: 'Ana', history: hist(mv(2, 'A fazer', 'Em andamento', 'Ana'), mv(4, 'Em andamento', 'Em revisão', 'Ana'), mv(5, 'Em revisão', 'Em andamento', 'Beto'), { at: D(5), by: 'Beto', field: '', from: '', to: 'Comentário: critério não atendido' }) }, cols, now, { bench });
  assert.equal(devolvido.lastReturn.reason, 'critério não atendido'); assert.match(devolvido.why, /devolvido de "Em revisão" para "Em andamento": critério não atendido/);
  for(const k of ['id="p-cardcontrol"', 'CardControl.render()', "cardcontrol: 'view_management'", 'Controle de Cards']) assert.ok(html.includes(k), k);
});
