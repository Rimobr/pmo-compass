import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/agile-calc"[^>]*>([\s\S]*?)<\/script>/);
const { AgileCalc: A } = new Function(`${m[1]}\nreturn { AgileCalc };`)();
const sp = { id: 'S1', startOn: '2026-11-02', endOn: '2026-11-13', state: 'ativa', capacity: '' };
const it = (n, st, on) => ({ id: 'US-' + n, sprintId: 'S1', status: st, points: 5, doneOn: on || '', kind: 'historia' });
test('sprint sistêmico × real: atrás da linha ideal projeta atraso; adiantada fica verde', () => {
  const atras = [it(1, 'done', '2026-11-04'), it(2, 'doing'), it(3, 'doing'), it(4, 'doing')];
  const st = A.sprintStats(sp, atras, '2026-11-09'), r = A.sprintReading(sp, st, '2026-11-09');
  assert.equal(r.behind, true); assert.ok(r.gap > 0); assert.ok(r.etaLate > 0); assert.equal(r.level, 'red');
  const bem = [it(1, 'done', '2026-11-03'), it(2, 'done', '2026-11-05'), it(3, 'done', '2026-11-06'), it(4, 'doing')];
  const r2 = A.sprintReading(sp, A.sprintStats(sp, bem, '2026-11-09'), '2026-11-09');
  assert.equal(r2.behind, false); assert.equal(r2.level, 'grn');
  assert.equal(A.sprintReading(sp, A.sprintStats(sp, [], '2026-11-09'), '2026-11-09'), null); // sem pontos: sem dado
});
