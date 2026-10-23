import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/baseline">([\s\S]*?)<\/script>/);
const { BaselineCalc } = new Function(`${m[1]}\nreturn { BaselineCalc };`)();

const plan = () => [
  { id: 'a', label: 'Fase A', start: '2026-01-01', end: '2026-02-01', pct: 100, children: [{ id: 'a1', label: 'A1', start: '2026-01-01', end: '2026-01-15' }, { id: 'a2', label: 'A2', start: '2026-01-16', end: '2026-02-01' }] },
  { id: 'b', label: 'Fase B', start: '2026-02-02', end: '2026-03-01', pct: 0, children: [] },
];
const lines = () => [{ id: 'l1', label: 'Dev', plannedValue: 100000, wbsModuleId: 'a' }, { id: 'l2', label: 'Infra', plannedValue: 50000, wbsModuleId: 'b' }, { id: 'r', label: 'Reserva', plannedValue: 20000, isReserve: true }];

test('capture guarda datas, orçamento e só o escopo aprovado', () => {
  const s = BaselineCalc.capture(plan(), lines(), [{ id: 'S1', status: 'approved', title: 'x', impactDays: 3 }, { id: 'S2', status: 'pending' }]);
  assert.equal(s.wbs.length, 2); assert.equal(s.wbs[0].children.length, 2);
  assert.equal(s.budget.length, 3); assert.deepEqual(s.approvedScope.map(x => x.id), ['S1']);
});

test('sem mudanças: tudo no prazo, desvio zero', () => {
  const s = BaselineCalc.capture(plan(), lines(), []);
  const c = BaselineCalc.compare(s, plan(), lines());
  assert.equal(c.summary.finishVar, 0); assert.equal(c.summary.delayed, 0); assert.equal(c.summary.onTime, 4);
  assert.equal(c.budget.bacVar, 0);
});

test('replanejar não apaga o plano original: atraso aparece como desvio em dias', () => {
  const s = BaselineCalc.capture(plan(), lines(), []);
  const now = plan(); now[1].end = '2026-03-11'; now[0].children[1].end = '2026-02-05'; now[0].end = '2026-02-05';
  const c = BaselineCalc.compare(s, now, lines());
  const rb = c.rows.find(r => r.id === 'b'), ra2 = c.rows.find(r => r.id === 'a2');
  assert.equal(rb.endVar, 10); assert.equal(rb.status, 'atrasado');
  assert.equal(ra2.endVar, 4);
  assert.equal(c.summary.finishVar, 10); assert.equal(c.summary.delayed, 3); assert.equal(c.summary.worstSlip, 10);
});

test('término real vale mais que o planejado vigente; adiantado é negativo', () => {
  const s = BaselineCalc.capture(plan(), lines(), []);
  const now = plan(); now[0].endActual = '2026-01-25'; now[0].children[0].end = '2026-01-10';
  const c = BaselineCalc.compare(s, now, lines());
  assert.equal(c.rows.find(r => r.id === 'a').endVar, -7);
  assert.equal(c.rows.find(r => r.id === 'a1').status, 'adiantado');
});

test('entregas novas e removidas são sinalizadas', () => {
  const s = BaselineCalc.capture(plan(), lines(), []);
  const now = plan(); now.push({ id: 'c', label: 'Nova', start: '2026-03-02', end: '2026-04-01', pct: 0, children: [] }); now.splice(1, 1);
  const c = BaselineCalc.compare(s, now, lines());
  assert.equal(c.summary.added, 1); assert.equal(c.summary.removed, 1);
  assert.equal(c.rows.find(r => r.id === 'b').status, 'removido');
});

test('orçamento: variação do BAC, reserva fora do BAC e linhas alteradas', () => {
  const s = BaselineCalc.capture(plan(), lines(), []);
  const l = lines(); l[0].plannedValue = 130000; l.push({ id: 'l3', label: 'Novo', plannedValue: 10000 });
  const c = BaselineCalc.compare(s, plan(), l);
  assert.equal(c.budget.baseBAC, 150000); assert.equal(c.budget.curBAC, 190000);
  assert.equal(c.budget.bacVar, 40000); assert.equal(c.budget.bacVarPct, 26.7);
  assert.equal(c.budget.baseReserve, 20000); assert.equal(c.budget.changedLines, 2);
});

test('datas ausentes não quebram', () => {
  const s = BaselineCalc.capture([{ id: 'x', label: 'X', pct: 0, children: [] }], [], []);
  const c = BaselineCalc.compare(s, [{ id: 'x', label: 'X', pct: 0, children: [] }], []);
  assert.equal(c.rows[0].status, 'sem_data'); assert.equal(c.summary.finishVar, null); assert.equal(c.budget.bacVarPct, null);
});
