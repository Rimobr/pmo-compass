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
test('escopo: impacto sugerido pelas aprovadas parecidas (ou todas, com 3+) × desvio real do término', () => {
  const ch = [{ status: 'approved', title: 'Painel operacional do depósito', impactDays: 5, impactCost: 4000 }, { status: 'approved', title: 'Painel gerencial de estoque', impactDays: 9, impactCost: 6000 }, { status: 'approved', title: 'Exportar relatório fiscal', impactDays: 2, impactCost: 900 }, { status: 'rejected', title: 'Painel gigante', impactDays: 40, impactCost: 90000 }];
  const sg = P.scopeSuggest(ch, 'Novo painel para o depósito');
  assert.equal(sg.days, 5); assert.equal(sg.cost, 4000); assert.equal(sg.n, 1); assert.match(sg.basis, /parecidas/);
  assert.match(P.scopeSuggest(ch, 'Zzz yyyy').basis, /todas/);
  assert.equal(P.scopeSuggest(ch.slice(0, 2), 'Zzz yyyy'), null); // sem parecidas e menos de 3: sem base
  assert.deepEqual(P.scopeReality(ch, 20), { declared: 16, real: 20, gap: 4, level: 'amb' });
  assert.equal(P.scopeReality(ch, null).gap, null);
});
test('ata: rascunho do que aconteceu desde a última reunião e quem esteve ativo', () => {
  const r = P.meetingDigest({ since: '2026-11-05', today: '2026-11-12', items: [{ id: 'US-1', status: 'done', doneOn: '2026-11-08', history: [{ by: 'Ana', at: '2026-11-08T10:00:00Z' }, { by: 'Claude Code', at: '2026-11-08T11:00:00Z' }] }, { id: 'US-2', status: 'done', doneOn: '2026-11-01', history: [{ by: 'Bia', at: '2026-11-01T10:00:00Z' }] }, { id: 'US-3', status: 'doing', history: [] }], impediments: [{ status: 'aberto', createdOn: '2026-11-07' }], risks: [], scope: [{ status: 'pending' }] });
  assert.equal(r.done, 1); assert.deepEqual(r.attendees, ['Ana']); assert.match(r.lines[0], /1 card\(s\) concluído/); assert.match(r.lines[1], /há 5 dia/); assert.ok(r.lines.some(l => /escopo/.test(l)));
});
test('escopo e ata: ligados às telas', () => { for (const k of ['id="scope-f-sug"', 'Scope.sugUse()', 'Preencher Com o Que Aconteceu', 'PlanVsReal.meetingDigest']) assert.ok(html.includes(k), k); });
test('ritmo das entregas: esperado pelo cronograma × real, ponderado pela duração', () => {
  const r = P.pace([{ start: '2026-11-02', end: '2026-11-12', pct: 40, status: 'amb' }, { start: '2026-11-02', end: '2026-11-22', pct: 0, status: 'neu' }, { start: '', end: '' }], '2026-11-12');
  assert.equal(r.n, 2); assert.equal(r.expected, 67); assert.equal(r.real, 13); assert.equal(r.level, 'red');
  assert.equal(P.pace([], '2026-11-12'), null);
});
