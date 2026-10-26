import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/raci-calc">([\s\S]*?)<\/script>/);
const { RaciCalc } = new Function(`${m[1]}\nreturn { RaciCalc };`)();

test('clique troca a letra em ciclo: vazio → R → A → C → I → vazio', () => {
  let v = ''; const seen = [];
  for (let i = 0; i < 5; i++) { v = RaciCalc.next(v); seen.push(v); }
  assert.deepEqual(seen, ['R', 'A', 'C', 'I', '']);
});

test('entrega precisa de um R e de um único A', () => {
  assert.deepEqual(RaciCalc.problems({ Ana: 'R', Bia: 'A' }), []);
  assert.deepEqual(RaciCalc.problems({ Ana: 'R' }), ['sem aprovador (A)']);
  assert.deepEqual(RaciCalc.problems({ Ana: 'A' }), ['sem responsável (R)']);
  assert.deepEqual(RaciCalc.problems({ Ana: 'R', Bia: 'A', Cai: 'A' }), ['mais de um aprovador (A)']);
  assert.equal(RaciCalc.problems({}).length, 2);
});

test('resumo e carga por colaborador', () => {
  const rows = [{ id: '1', assignments: { Ana: 'R', Bia: 'A' } }, { id: '2', assignments: { Ana: 'R' } }, { id: '3', assignments: { Ana: 'A', Bia: 'A' } }];
  const s = RaciCalc.summarize(rows);
  assert.deepEqual(s, { total: 3, noR: 1, noA: 1, multiA: 1, ok: 1 });
  const l = RaciCalc.loadByPerson(rows, ['Ana', 'Bia']);
  assert.equal(l.Ana.R, 2); assert.equal(l.Bia.A, 2);
});

test('sanitize descarta letra inválida, nome vazio e chave perigosa', () => {
  const out = RaciCalc.sanitize({ Ana: 'R', '': 'A', Bia: 'X', '__proto__': 'R', '  Cai  ': 'C' });
  assert.deepEqual(Object.keys(out).sort(), ['Ana', 'Cai']);
});
