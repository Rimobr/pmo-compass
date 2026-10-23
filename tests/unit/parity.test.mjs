// Paridade cliente × servidor: o assistente de WhatsApp calcula os números NO SERVIDOR (_shared/facts.mjs) e o app os calcula
// no navegador (PMO_Compass_v2.html). Se um dia divergirem, o diretor receberia no WhatsApp um número diferente do que o gerente
// vê na tela — por isso as duas implementações são rodadas com os MESMOS dados e comparadas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeFacts, riskLevel, ratioCode } from '../../supabase/functions/_shared/facts.mjs';
import { normalizePhone } from '../../supabase/functions/_shared/util.mjs';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
function loadModule(name, exported) {
  const m = html.match(new RegExp(`<script data-module="${name}">([\\s\\S]*?)<\\/script>`));
  if (!m) throw new Error('módulo não encontrado: ' + name);
  return new Function(`${m[1]}\nreturn ${exported};`)();
}

// ── dados de um projeto, nos DOIS formatos (navegador e banco) ──
const REF = '2026-06-20';
const client = {
  wbs: [
    { id: 'm1', label: 'A', pct: 100, status: 'grn', start: '2026-01-01', end: '2026-03-01' },
    { id: 'm2', label: 'B', pct: 40, status: 'amb', start: '2026-04-01', end: '2026-06-10' },
    { id: 'm3', label: 'C', pct: 10, status: 'amb', start: '2026-06-01', end: '2026-09-01' },
    { id: 'm4', label: 'D sem datas', pct: 30, status: 'neu' },
  ],
  budgetLines: [
    { id: 'l1', plannedValue: 100000, wbsModuleId: 'm1' }, { id: 'l2', plannedValue: 200000, wbsModuleId: 'm2' },
    { id: 'l3', plannedValue: 100000, wbsModuleId: 'm3' }, { id: 'l4', plannedValue: 50000, wbsModuleId: 'm4' },
    { id: 'l5', plannedValue: 30000, wbsModuleId: '' }, { id: 'l6', plannedValue: 40000, isReserve: true },
  ],
  costActuals: [{ amount: 150000, kind: 'real' }, { amount: 45000, kind: 'real' }, { amount: 99999, kind: 'comprometido' }],
  scopeChanges: [{ status: 'pending', impactDays: 5, impactCost: 30000 }, { status: 'analysis', impactDays: 2, impactCost: 1000 }, { status: 'approved', impactDays: 9, impactCost: 5 }],
};
const server = {
  project: { id: 'p', name: 'P', reference_date: REF },
  wbs: client.wbs.map(m => ({ id: m.id, label: m.label, pct: m.pct, status: m.status, start_date: m.start || null, end_date: m.end || null })),
  budgetLines: client.budgetLines.map(l => ({ id: l.id, planned_value: l.plannedValue, wbs_module_id: l.wbsModuleId || null, is_reserve: !!l.isReserve })),
  costActuals: client.costActuals.map(a => ({ amount: a.amount, kind: a.kind })),
  scope: client.scopeChanges.map(s => ({ status: s.status, impact_days: s.impactDays, impact_cost: s.impactCost })),
};

test('Orçamento: BAC, AC, CPI, SPI, EAC e consumo iguais no app e no servidor', () => {
  globalThis.DB = { getActiveProjectId: () => 'p', listProjects: () => [{ id: 'p', refDate: REF }], getForProject: (_pid, t) => client[t] || [] };
  globalThis.Clock = loadModule('core/clock', 'Clock');
  const Budget = loadModule('pages/budget-js', 'Budget');
  const m = Budget.computeMetrics('p');
  const f = computeFacts(server, new Date('2026-10-23T12:00:00Z'));
  assert.equal(f.asOf, REF);
  assert.equal(f.budget.amounts.bac, m.BAC);
  assert.equal(f.budget.amounts.ac, m.AC);
  assert.ok(Math.abs(f.budget.cpi - m.CPI) < 1e-9, `CPI ${f.budget.cpi} × ${m.CPI}`);
  assert.ok(Math.abs(f.budget.spi - m.SPI) < 1e-9, `SPI ${f.budget.spi} × ${m.SPI}`);
  assert.ok(Math.abs(f.budget.amounts.eac - m.EAC) < 1e-6, `EAC ${f.budget.amounts.eac} × ${m.EAC}`);
  assert.equal(f.budget.consumoPct, m.consumoPct);
  assert.equal(f.budget.amounts.reserveInitial, m.reserveInitial);
});

test('Escopo em aberto: mesmos dias e custo no app (soma de pendentes + em análise) e no servidor', () => {
  const f = computeFacts(server, new Date('2026-10-23'));
  const open = client.scopeChanges.filter(s => s.status === 'pending' || s.status === 'analysis');
  assert.equal(f.scope.openCount, open.length);
  assert.equal(f.scope.daysImpact, open.reduce((s, x) => s + x.impactDays, 0));
  assert.equal(f.scope.costImpact, open.reduce((s, x) => s + x.impactCost, 0));
});

test('Faixas de risco: matriz do app = faixas do servidor para todas as 25 combinações', () => {
  const RiskMatrix = loadModule('services/risk-matrix', 'RiskMatrix');
  const map = { critico: 'crítico', alto: 'alto', medio: 'médio', baixo: 'baixo' };
  for (let p = 1; p <= 5; p++) for (let i = 1; i <= 5; i++) {
    assert.equal(map[RiskMatrix.level(p * i).key], riskLevel(p * i), `P${p} × I${i}`);
  }
});

test('Atrasos: o servidor conta como atrasada a entrega não concluída com término antes de "hoje"', () => {
  const f = computeFacts(server, new Date('2026-10-23'));
  assert.deepEqual(f.schedule.delayed.map(d => d.label), ['B']);
  assert.equal(f.schedule.delayed[0].daysLate, 10);
});

test('Telefone: a validação da tela e a do servidor aceitam e recusam o mesmo', () => {
  const Messaging = loadModule('ui/messaging-js', 'Messaging');
  for (const s of ['(11) 99999-8888', '11999998888', '+55 11 99999-8888', '1133334444', '+1 415 555 2671', '55119', '123', '', '(11) 9999-88', '+5511999998888', '5511999998888', 'abc'])
    assert.equal(Messaging.normalizePhone(s), normalizePhone(s), `entrada: "${s}"`);
});

test('Semáforo por índices usa os mesmos limiares do Farol da Diretoria', () => {
  assert.equal(ratioCode(1), 'grn'); assert.equal(ratioCode(0.9), 'amb'); assert.equal(ratioCode(0.89), 'red');
  assert.equal(ratioCode(1.31), 'amb'); assert.equal(ratioCode(0.49), 'amb');
});
