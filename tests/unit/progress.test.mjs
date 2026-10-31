import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="ui\/progress">([\s\S]*?)<\/script>/);
const { Progress } = new Function(`${m[1]}\nreturn { Progress };`)();

test('porcentagem só existe com etapas reais (sem total = nenhuma porcentagem)', () => {
  assert.equal(Progress.pct(0, 0), null);
  assert.equal(Progress.pct(3, 0), null);
  assert.equal(Progress.pct(3, 12), 25);
  assert.equal(Progress.pct(6, 12), 50);
  assert.equal(Progress.pct(9, 12), 75);
  assert.equal(Progress.pct(20, 12), 100);
  assert.equal(Progress.pct(-1, 12), 0);
});

test('tempo decorrido em segundos e minutos', () => {
  assert.equal(Progress.elapsed(4200), '4 s');
  assert.equal(Progress.elapsed(65000), '1 min 05 s');
});
