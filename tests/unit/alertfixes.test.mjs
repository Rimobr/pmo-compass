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
  const c = T.candidates(gente, l, projetos[0].team.map(m => m.name));
  assert.deepEqual(c.map(x => x.name), ['Ana', 'Beto']); assert.ok(c[0].sameRole && !c[1].sameRole);
  assert.deepEqual(T.candidates(gente, l, ['Leandro R']), []);
  assert.equal(T.filter(gente, { role: 'dev' }).length, 1); assert.equal(T.filter(gente, { onlyOver: true }).length, 1);
});
test('transferência de atividades: banco com reassign_items e tela com janela própria', () => {
  const sql = readFileSync(join(root, 'supabase/migrations/20261115120000_reassign_items.sql'), 'utf8');
  for(const k of ['reassign_items', 'is_project_manager', "kind <> 'epico'", "status <> 'done'", 'array_length(ids, 1) > 200', 'não é uma pessoa com acesso']) assert.ok(sql.includes(k), k);
  for(const k of ['id="modal-transfer"', 'Resources.confirmTransfer()', 'reassignItems', 'id="res-team-root"', 'Transferir Atividades']) assert.ok(html.includes(k), k);
});
