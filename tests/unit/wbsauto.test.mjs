import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/wbs-auto">([\s\S]*?)<\/script>/);
const { WbsAuto: W } = new Function(`${m[1]}\nreturn { WbsAuto };`)();

test('WBS automático: o avanço da entrega é a média das subtarefas (concluída 100, andamento 50, bloqueada 25, não iniciada 0)', () => {
  assert.equal(W.rollup([{ status: 'grn' }, { status: 'amb' }, { status: 'neu' }, { status: 'red' }]), 44); // (100+50+0+25)/4 = 43,75
  assert.equal(W.rollup([{ status: 'grn' }, { status: 'grn' }]), 100);
  assert.equal(W.rollup([]), null); assert.equal(W.rollup(undefined), null);
});
test('WBS automático: a entrega está no automático quando o % gravado é o do cálculo (ou ainda 0)', () => {
  assert.equal(W.isAuto({ pct: 50, children: [{ status: 'grn' }, { status: 'neu' }] }), true);
  assert.equal(W.isAuto({ pct: 80, children: [{ status: 'grn' }, { status: 'neu' }] }), false); // ajuste manual do gerente
  assert.equal(W.isAuto({ pct: 0, children: [] }), true); assert.equal(W.isAuto({ pct: 30, children: [] }), false);
  assert.equal(W.isAuto({ pct: 0, children: [{ status: 'grn' }, { status: 'neu' }] }), true); // 0 = nunca informado: vale o cálculo
});
test('WBS automático: status sugerido pelo prazo e pelo avanço', () => {
  const s = (o) => W.suggestStatus({ start: '2026-11-01', end: '2026-11-21', today: '2026-11-11', ...o }); // metade do prazo
  assert.equal(W.expectedPct('2026-11-01', '2026-11-21', '2026-11-11'), 50);
  assert.equal(s({ pct: 100 }).status, 'grn');
  assert.equal(s({ pct: 60 }).status, 'amb'); assert.equal(s({ pct: 40 }).status, 'amb'); // até 25 pontos de atraso é aceitável
  assert.equal(s({ pct: 20 }).status, 'red'); assert.match(s({ pct: 20 }).why, /atraso de 30 pontos/);
  assert.equal(s({ pct: 0 }).status, 'red'); // metade do prazo e nada iniciado
  assert.equal(s({ pct: 10, today: '2026-11-25' }).status, 'red'); assert.match(s({ pct: 10, today: '2026-11-25' }).why, /prazo planejado venceu/);
  assert.equal(s({ pct: 0, today: '2026-10-20' }).status, 'neu');
  assert.equal(s({ pct: 0, today: '2026-11-03' }).status, 'neu'); // 10% do prazo: ainda dá tempo de começar
});
test('WBS automático: datas reais carimbadas sem sobrescrever o que a pessoa informou', () => {
  assert.deepEqual(W.stamp({}, 'amb', '2026-11-11'), { startActual: '2026-11-11', endActual: null });
  assert.deepEqual(W.stamp({}, 'grn', '2026-11-11'), { startActual: '2026-11-11', endActual: '2026-11-11' });
  assert.deepEqual(W.stamp({ startActual: '2026-11-03' }, 'grn', '2026-11-11'), { startActual: '2026-11-03', endActual: '2026-11-11' });
  assert.deepEqual(W.stamp({ startActual: '2026-11-03', endActual: '2026-11-05' }, 'grn', '2026-11-11'), { startActual: '2026-11-03', endActual: '2026-11-05' });
  assert.deepEqual(W.stamp({ endActual: '2026-11-05' }, 'grn', '2026-11-11'), { startActual: '2026-11-05', endActual: '2026-11-05' }); // fim real informado no passado: o início não pode ser depois dele
  assert.deepEqual(W.stamp({}, 'neu', '2026-11-11'), { startActual: null, endActual: null });
});
test('WBS automático: ligado ao formulário, à edição pela tabela e ao salvar', () => {
  for (const k of ['id="wbs-f-sug"', 'function renderSystemHint(pctVal)', 'function useStatus(v)', 'WbsAuto.rollup(editedM.children)', 'const rollWasAuto =', 'WbsAuto.stamp(item, value, isoDate(todayRef()))', 'placeholder="Automático"']) assert.ok(html.includes(k), k);
});
