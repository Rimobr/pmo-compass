import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/estimate-auto">([\s\S]*?)<\/script>/);
const { EstimateAuto: E } = new Function(`${m[1]}\nreturn { EstimateAuto };`)();
const wd = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000) + 1; // contagem simples para o teste
const item = (id, o = {}) => ({ id, status: 'grn', start: '2026-11-02', end: '2026-11-06', startActual: '2026-11-02', endActual: '2026-11-09', responsavel: 'Ana', ...o });

test('histórico automático: só entra o concluído com as quatro datas e o responsável (entrega e subtarefa)', () => {
  const wbs = [item('m1', { children: [item('t1', { responsavel: 'Bia', endActual: '2026-11-04' }), item('t2', { status: 'amb' }), item('t3', { endActual: null }), item('t4', { responsavel: '' })] }), item('m2', { status: 'red' })];
  const r = E.fromWbs(wbs, wd);
  assert.deepEqual(r.map(x => x.wbsId + ':' + x.member + ':' + x.planned + '/' + x.actual), ['m1:Ana:5/8', 't1:Bia:5/3']);
});
test('histórico automático: sincroniza sem tocar no que foi lançado à mão e atualiza ou retira o que mudou na WBS', () => {
  const manual = { id: 'e1', member: 'Rafael', planned: 5, actual: 6 };
  const c1 = E.fromWbs([item('m1')], wd);
  let r = E.sync([manual], c1);
  assert.equal(r.changed, true); assert.equal(r.auto, 1); assert.equal(r.list.length, 2); assert.deepEqual(r.list[0], manual);
  assert.equal(r.list[1].auto, true); assert.equal(r.list[1].wbsId, 'm1');
  r = E.sync(r.list, c1); assert.equal(r.changed, false); assert.equal(r.list.length, 2); // idempotente: não duplica
  const c2 = E.fromWbs([item('m1', { endActual: '2026-11-12' })], wd);
  r = E.sync(r.list, c2); assert.equal(r.changed, true); assert.equal(r.list.find(e => e.wbsId === 'm1').actual, 11); // mudou na WBS: atualiza
  r = E.sync(r.list, []); assert.equal(r.changed, true); assert.deepEqual(r.list, [manual]); // deixou de estar concluído: sai
});
test('histórico automático: ligado à tela de estimativas', () => {
  for (const k of ['function syncAuto()', 'id="estimates-auto-note"', 'EstimateAuto.sync(data, EstimateAuto.fromWbs(', 'A WBS já alimenta este histórico sozinha']) assert.ok(html.includes(k), k);
});
