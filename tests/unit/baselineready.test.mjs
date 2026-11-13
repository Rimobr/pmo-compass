import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const { BaselineCalc: B } = new Function(`${html.match(/<script data-module="services\/baseline">([\s\S]*?)<\/script>/)[1]}\nreturn { BaselineCalc };`)();
test('linha de base: o sistema diz se o plano já está pronto para virar foto', () => {
  const ok = B.readiness([{ start: '2026-11-01', end: '2026-12-01' }], [{ plannedValue: 5000 }]);
  assert.equal(ok.ready, true); assert.equal(ok.orcado, 5000); assert.deepEqual(ok.missing, []);
  const sem = B.readiness([{ start: '2026-11-01', end: '2026-12-01' }, { start: '', end: '' }], []);
  assert.equal(sem.ready, false); assert.ok(sem.missing.some(m => /sem início/.test(m)));
  assert.equal(B.readiness([], []).ready, false);
});
