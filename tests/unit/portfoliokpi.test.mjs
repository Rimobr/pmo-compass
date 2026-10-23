import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
const block = n => html.match(new RegExp(`<script data-module="${n}">([\\s\\S]*?)<\\/script>`))[1];
const { SharedFacts, PortfolioKpi } = new Function(`${block('services/shared-facts')}\n${block('services/portfolio-kpi')}\nreturn { SharedFacts, PortfolioKpi };`)();
const now = new Date('2026-10-23T12:00:00Z');

const proj = (name, o = {}) => SharedFacts.computeFacts({
  project: { id: name, name, reference_date: '2026-06-20' },
  wbs: o.wbs ?? [{ id: 'm', label: 'A', pct: 60, status: 'amb', start_date: '2026-04-01', end_date: '2026-08-01' }],
  budgetLines: o.lines ?? [{ planned_value: 100000, wbs_module_id: 'm' }],
  costActuals: o.actuals ?? [{ kind: 'real', amount: 50000 }],
  decisions: o.decisions ?? [], risks: o.risks ?? [], scope: o.scope ?? [], team: [],
}, now);

test('projeto no prazo, no custo e no escopo é saudável nos três critérios', () => {
  const ev = PortfolioKpi.evaluate(proj('Ok'));
  assert.equal(ev.prazo, true); assert.equal(ev.custo, true); assert.equal(ev.escopo, true); assert.equal(ev.saudavel, true);
});

test('entrega atrasada reprova o prazo; mudança de escopo aberta reprova o escopo', () => {
  const late = PortfolioKpi.evaluate(proj('Atrasado', { wbs: [{ id: 'm', label: 'A', pct: 20, status: 'amb', start_date: '2026-03-01', end_date: '2026-06-01' }] }));
  assert.equal(late.prazo, false); assert.equal(late.saudavel, false);
  const sc = PortfolioKpi.evaluate(proj('Escopo', { scope: [{ status: 'pending', impact_days: 5, impact_cost: 0 }] }));
  assert.equal(sc.escopo, false); assert.equal(sc.prazo, true);
});

test('custo: CPI baixo ou previsão acima de 105% do orçado reprova', () => {
  const over = PortfolioKpi.evaluate(proj('Caro', { actuals: [{ kind: 'real', amount: 90000 }] })); // EV 60k / AC 90k = 0,67
  assert.equal(over.custo, false);
});

test('projeto sem dados não entra nas taxas (null), nunca vira "ok"', () => {
  const ev = PortfolioKpi.evaluate(proj('Vazio', { wbs: [], lines: [], actuals: [] }));
  assert.equal(ev.prazo, null); assert.equal(ev.custo, null); assert.equal(ev.escopo, null); assert.equal(ev.saudavel, null);
});

test('agregação: taxas só entre quem tem dados, por área, e "Sem área" por último', () => {
  const rows = [
    { id: '1', name: 'A', area: 'TI', ev: PortfolioKpi.evaluate(proj('A')) },
    { id: '2', name: 'B', area: 'TI', ev: PortfolioKpi.evaluate(proj('B', { wbs: [{ id: 'm', label: 'A', pct: 20, status: 'amb', start_date: '2026-03-01', end_date: '2026-06-01' }] })) },
    { id: '3', name: 'C', area: '', ev: PortfolioKpi.evaluate(proj('C', { wbs: [], lines: [], actuals: [] })) },
    { id: '4', name: 'D', area: 'Engenharia', ev: PortfolioKpi.evaluate(proj('D')) },
  ];
  const g = PortfolioKpi.aggregate(rows);
  assert.equal(g.total.projetos, 4);
  assert.deepEqual([g.total.prazo.ok, g.total.prazo.known, g.total.prazo.unknown, g.total.prazo.pct], [2, 3, 1, 67]);
  assert.deepEqual(g.areas.map(a => a.area), ['Engenharia', 'TI', 'Sem área']);
  assert.equal(g.areas.find(a => a.area === 'TI').prazo.pct, 50);
  assert.equal(g.farol.semDados, 1);
});
