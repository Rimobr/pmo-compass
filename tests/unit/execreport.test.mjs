import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
const block = n => html.match(new RegExp(`<script data-module="${n}">([\\s\\S]*?)<\\/script>`))[1];
const { SharedFacts, ExecReport } = new Function(`${block('services/shared-facts')}\n${block('services/portfolio-kpi')}\n${block('services/exec-report')}\nreturn { SharedFacts, ExecReport };`)();
const now = new Date('2026-10-23T12:00:00Z');

const facts = (name, o = {}) => SharedFacts.computeFacts({
  project: { id: name, name, reference_date: '2026-06-20' },
  wbs: o.wbs ?? [{ id: 'm', label: 'Fase A', pct: 40, status: 'amb', start_date: '2026-04-01', end_date: '2026-06-10' }],
  budgetLines: o.lines ?? [{ planned_value: 100000, wbs_module_id: 'm' }],
  costActuals: o.actuals ?? [{ kind: 'real', amount: 50000 }],
  decisions: o.decisions ?? [], risks: o.risks ?? [], scope: o.scope ?? [], team: [],
  snapshot: o.snapshot,
}, now);
const row = (name, o = {}) => ({ id: name, name, area: '', f: facts(name, o), health: { score: o.score ?? 70, status: o.status ?? 'Atenção', dims: { schedule: 45, budget: 90 } },
  items: [{ label: 'Fase A', pct: 40, expected: 90 }], delayedCrit: [], scopeOpen: [], loaded: [], risksTop: [], stakeholderCrit: null,
  pendingActions: 0, done: [], daysSinceUpdate: 3, hasBaseline: true, ...o.extra });

test('decisões críticas pendentes lideram a lista e a urgência vale mais que o impacto', () => {
  const r = row('Nexus', { decisions: [{ status: 'pending', severity: 'crit', title: 'Aprovar integração' }],
    extra: { scopeOpen: [{ id: 'SC-1', title: 'Painel extra', days: 20, cost: 5000 }] } });
  const out = ExecReport.build([r], {});
  assert.equal(out.decisions[0].urgency, 'urgente');
  assert.match(out.decisions[0].title, /Aprovar integração/);
  assert.equal(out.decisions.find(d => d.kind === 'escopo').urgency, 'semana');
  assert.ok(out.decisions[0].score > out.decisions.find(d => d.kind === 'escopo').score);
});

test('risco crítico sem responsável ou com revisão vencida é urgente; com dono e em dia, esta semana', () => {
  const mk = x => ExecReport.build([row('A', { extra: { risksTop: [x] } })], {}).decisions.find(d => d.kind === 'risco');
  assert.equal(mk({ title: 'R1', score: 20, owner: '', mitigation: '' }).urgency, 'urgente');
  assert.equal(mk({ title: 'R2', score: 20, owner: 'Ana', reviewOverdue: true }).urgency, 'urgente');
  assert.equal(mk({ title: 'R3', score: 16, owner: 'Ana', mitigation: 'Antecipar o teste' }).urgency, 'semana');
  assert.equal(ExecReport.build([row('A', { extra: { risksTop: [{ title: 'baixo', score: 6, owner: 'x' }] } })], {}).decisions.some(d => d.kind === 'risco'), false);
});

test('sem permissão de valores, nenhum R$ aparece em decisões, ações e gráficos', () => {
  const r = row('Caro', { actuals: [{ kind: 'real', amount: 95000 }], extra: { scopeOpen: [{ id: 'SC-9', title: 'Extra', days: 3, cost: 12000 }] } });
  const sem = ExecReport.build([r], { money: false });
  assert.ok(!/R\$/.test(JSON.stringify(sem)), 'vazou valor: ' + JSON.stringify(sem).match(/.{20}R\$.{20}/));
  assert.equal(sem.charts.budget, null);
  const com = ExecReport.build([r], { money: true });
  assert.match(JSON.stringify(com), /R\$/);
  assert.ok(com.charts.budget.bac === 100000 && com.charts.budget.ac === 95000);
});

test('portfólio: KPIs por taxa, farol somado e decisões de vários projetos', () => {
  const a = row('A', { score: 85, status: 'Saudável' }), b = row('B', { score: 40, status: 'Em risco', decisions: [{ status: 'pending', severity: 'crit', title: 'Pausar?' }] });
  const out = ExecReport.build([a, b], {});
  assert.equal(out.mode, 'portfolio'); assert.equal(out.count, 2);
  assert.deepEqual(out.kpis.map(k => k.key), ['saude', 'prazo', 'custo', 'escopo', 'riscos', 'decisoes']);
  assert.equal(out.kpis[0].value, '63');
  assert.equal(out.kpis.find(k => k.key === 'decisoes').value, '1');
  assert.equal(out.charts.progress.length, 2);
  assert.match(out.headline, /2 projetos/);
});

test('projeto único: 6 KPIs com gauges, avanço por entrega e saúde por dimensão', () => {
  const out = ExecReport.build([row('Solo')], {});
  assert.equal(out.mode, 'projeto');
  assert.deepEqual(out.kpis.map(k => k.key), ['saude', 'avanco', 'prazo', 'custo', 'riscos', 'decisoes']);
  assert.equal(out.charts.progress[0].expected, 90);
  assert.equal(out.charts.health.length, 2);
});

test('ações sugeridas trazem a justificativa nos dados', () => {
  const out = ExecReport.build([row('P', { extra: { daysSinceUpdate: 30, hasBaseline: false, pendingActions: 3 } })], {});
  const texts = out.actions.map(a => a.text + ' | ' + a.why).join('\n');
  assert.match(texts, /Atualizar o status de P \| sem edição há 30 dias/);
  assert.match(texts, /Salvar a linha de base de P/);
  assert.match(texts, /Cobrar 3 ação/);
});

test('limites: no máximo 6 decisões, total real informado; lista vazia não quebra', () => {
  const many = row('M', { decisions: Array.from({ length: 3 }, (_, i) => ({ status: 'pending', severity: 'crit', title: 'D' + i })),
    extra: { scopeOpen: Array.from({ length: 5 }, (_, i) => ({ id: 'S' + i, title: 't', days: i + 1 })), risksTop: [{ title: 'r', score: 20, owner: '' }, { title: 'r2', score: 18, owner: '' }] } });
  const out = ExecReport.build([many, row('N')], {});
  assert.equal(out.decisions.length, 6); assert.ok(out.decisionsTotal > 6);
  const vazio = ExecReport.build([row('Zen', { wbs: [], lines: [], actuals: [], extra: { hasBaseline: false } })], {});
  assert.equal(vazio.decisions.length, 0);
});

test('expectedPct segue a mesma regra de datas planejadas', () => {
  assert.equal(ExecReport.expectedPct('2026-01-01', '2026-01-11', '2026-01-06'), 50);
  assert.equal(ExecReport.expectedPct('2026-01-01', '2026-01-11', '2025-12-01'), 0);
  assert.equal(ExecReport.expectedPct('2026-01-01', '2026-01-11', '2026-03-01'), 100);
  assert.equal(ExecReport.expectedPct('', '2026-01-11', '2026-01-06'), null);
});
