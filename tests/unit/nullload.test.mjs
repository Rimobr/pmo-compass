import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
// as funções puras do Burnout (da definição de hasLoad até labelOf), sem tela
const i0 = html.indexOf('const hasLoad = p =>'), i1 = html.indexOf('function render()', i0);
const { statusOf, labelOf, hasLoad } = new Function(`${html.slice(i0, i1)}
return { statusOf, labelOf, hasLoad };`)();

test('carga não informada é "sem dados": nunca "OK", nunca "null%"', () => {
  for (const v of [null, undefined, '', 'abc']) { assert.equal(hasLoad(v), false); assert.equal(statusOf(v), 'sem_dado'); }
  assert.equal(labelOf('sem_dado', null), 'Carga não informada');
  assert.ok(!/null|undefined/.test(labelOf('sem_dado', null)));
});
test('zero é um valor de verdade (carga 0%) e as faixas continuam as mesmas', () => {
  assert.equal(hasLoad(0), true); assert.equal(statusOf(0), 'saudavel');
  assert.equal(statusOf(59), 'saudavel'); assert.equal(statusOf(60), 'atencao'); assert.equal(statusOf(85), 'critico');
  assert.equal(labelOf('saudavel', 40), '40% — OK');
});
test('as telas que mostram a carga tratam "não informada" (Burnout, Colaboradores, Dashboard, IA e exportação)', () => {
  for (const k of ['Informe a carga em Editar', "carga/burnout ${hasW ? m.workloadPct + '%' : 'não informada'}", "mediaCarga==null?'—':mediaCarga", "'carga não informada' : m.workloadPct + '% de carga'", "r.workloadPct === null || r.workloadPct === undefined"]) assert.ok(html.includes(k), k);
  assert.ok(!html.includes('${m.workloadPct||0}%'), 'não mostra 0% quando a carga não foi informada');
});
