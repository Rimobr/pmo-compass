import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FUNCS } from '../../supabase/functions/_shared/intel.generated.mjs';
import { INTEL, sourceOf, generate } from '../../scripts/build-intel.mjs';
const html = fs.readFileSync(new URL('../../PMO_Compass_v2.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const input = {
  projects: [{ id: 'p1', name: 'Projeto A', facts: { decisions: { pendingCritical: ['Escolher fornecedor'] }, risks: { top: [{ level: 'crítico', owner: '', title: 'Sem backup' }] }, schedule: { delayedCount: 2, delayed: [{ label: 'Entrega 1', daysLate: 5 }], spi: 0.8 }, scope: { openCount: 1, daysImpact: 6, costImpact: 0 } }, sprint: { etaLate: 3, gap: 4 } }],
  capacity: [{ key: 'ana', name: 'Ana', total: 180, open: 7, plan: { kind: 'capacity', headline: 'Ana é ponto único de falha', steps: ['Priorizar'], mitigate: 'Ampliar equipe', solo: [{ projectName: 'Projeto A' }], cuts: [] } }],
  sysRisks: [], canCosts: false,
};
test('servidor: o código gerado dá o mesmo resultado do módulo do app (paridade)', () => {
  const app = new Function(sourceOf(html, 'services/decision-center') + '\nreturn DecisionCenter;')();
  assert.deepEqual(FUNCS['DecisionCenter.build'](input), app.build(input));
  assert.ok(FUNCS['DecisionCenter.build'](input).length >= 3, 'gerou decisões');
});
test('servidor: só roda o que está na lista fechada e o arquivo gerado está em dia', () => {
  assert.deepEqual(Object.keys(FUNCS), INTEL.flatMap(x => x.funcs.map(f => x.name + '.' + f)));
  const cur = fs.readFileSync(new URL('../../supabase/functions/_shared/intel.generated.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(cur, generate(), 'rode: node scripts/build-intel.mjs');
});
test('função intel: exige usuário logado, lista fechada, limite de tamanho; sem DOM no código gerado', () => {
  const fn = fs.readFileSync(new URL('../../supabase/functions/intel/index.ts', import.meta.url), 'utf8');
  assert.ok(fn.includes('/auth/v1/user') && fn.includes('hasOwnProperty.call(FUNCS') && fn.includes('MAX_BYTES'));
  const dep = fs.readFileSync(new URL('../../scripts/deploy-functions.mjs', import.meta.url), 'utf8');
  const pub = (dep.match(/const PUBLIC = new Set\(\[([^\]]*)\]\)/) || [])[1] || '';
  assert.ok(pub && pub.indexOf('intel') < 0, 'intel não é pública: o JWT é conferido');
  const gen = fs.readFileSync(new URL('../../supabase/functions/_shared/intel.generated.mjs', import.meta.url), 'utf8');
  assert.ok(!/document\.|window\.|localStorage|\bDB\.|Cloud\./.test(gen), 'módulo puro');
});
test('servidor: plano de capacidade (allocPlan) igual ao do app, nos dois tipos de plano', () => {
  const app = new Function(sourceOf(html, 'services/plan-vs-real') + '\nreturn PlanVsReal;')();
  const rows = [{ projectId: 'a', projectName: 'A', pct: 70, priorityValue: 5, openCards: 4 }, { projectId: 'b', projectName: 'B', pct: 60, priorityValue: 2, openCards: 2 }];
  for (const person of [{ name: 'Ana', total: 130, rows }, { name: 'Ana', total: 130, receivers: 0, rows: rows.map(r => ({ ...r, receivers: 0 })) }, { name: 'Bia', total: 90, rows }]) {
    assert.deepEqual(FUNCS['PlanVsReal.allocPlan'](person), app.allocPlan(person));
  }
  assert.equal(FUNCS['PlanVsReal.allocPlan']({ name: 'Ana', total: 130, receivers: 0, rows }).kind, 'capacity');
});
