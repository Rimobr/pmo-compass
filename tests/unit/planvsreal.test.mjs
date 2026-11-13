import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const { PlanVsReal: P } = new Function(`${html.match(/<script data-module="services\/plan-vs-real">([\s\S]*?)<\/script>/)[1]}\nreturn { PlanVsReal };`)();
const T = '2026-11-12';
test('impedimento: esperado pela mediana dos resolvidos (mínimo 3) ou regra de 3 dias; atraso gradua a cor', () => {
  const abertos = [{ id: 'A', status: 'aberto', createdOn: '2026-11-11' }, { id: 'B', status: 'aberto', createdOn: '2026-11-08' }, { id: 'C', status: 'aberto', createdOn: '2026-11-01' }];
  let r = P.impediments(abertos, T);
  assert.equal(r[0].expected, 3); assert.match(r[0].basis, /regra padrão/);
  assert.deepEqual(r.map(x => x.level), ['grn', 'amb', 'red']);
  const res = d => ({ status: 'resolvido', createdOn: '2026-10-01', resolvedOn: '2026-10-0' + (1 + d) });
  r = P.impediments(abertos.concat([res(1), res(2), res(3)]), T);
  assert.equal(r[0].expected, 2); assert.match(r[0].basis, /mediana/);
});
test('decisão: esperado pela mediana das decididas; pendente sem data não entra', () => {
  const dec = d => ({ boardDecision: 'ok', aiGeneratedAt: '2026-10-01', decidedAt: '2026-10-0' + (1 + d) });
  const r = P.decisions([{ id: 'x', aiSuggestion: 'Escalar', aiGeneratedAt: '2026-11-06' }, { id: 'y' }, dec(1), dec(1), dec(5)], T);
  assert.equal(r.length, 1); assert.equal(r[0].expected, 1); assert.equal(r[0].age, 6); assert.equal(r[0].level, 'red');
});
test('risco: revisão vencida e aberta gradua; encerrado não conta', () => {
  const r = P.riskReviews([{ id: 'a', status: 'aberto', reviewOn: '2026-11-20' }, { id: 'b', status: 'mitigando', reviewOn: '2026-11-08' }, { id: 'c', status: 'aberto', reviewOn: '2026-10-01' }, { id: 'd', status: 'encerrado', reviewOn: '2026-10-01' }], T);
  assert.deepEqual(r.map(x => [x.id, x.level, x.late]), [['a', 'grn', 0], ['b', 'amb', 4], ['c', 'red', 42]]);
});
test('parte interessada: contato esperado pela influência (14/30/60 dias)', () => {
  const r = P.stakeholders([{ id: 'a', influence: 'alta', lastContact: '2026-11-01' }, { id: 'b', influence: 'baixa', lastContact: '2026-10-20' }, { id: 'c', influence: 'alta' }], T);
  assert.equal(r.length, 2); assert.equal(r[0].expected, 14); assert.equal(r[0].level, 'grn'); assert.equal(r[1].expected, 60);
});
test('plano × real: ligado às telas', () => { for (const k of ['PlanVsReal.impediments(impediments()', 'PlanVsReal.stakeholders(data', 'esperado a cada ${pv.expected} dias']) assert.ok(html.includes(k), k); });
