import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const { HoursCost: H } = new Function(`${html.match(/<script data-module="services\/hours-cost">([\s\S]*?)<\/script>/)[1]}\nreturn { HoursCost };`)();
test('custo pelas horas: valor da hora = orçamento ÷ horas previstas; compara com o lançado', () => {
  const r = H.compute({ bac: 80000, hoursTotal: 800, entries: [{ hours: 100 }, { hours: 50, status: 'reprovado' }], ac: 13000 });
  assert.equal(r.rate, 100); assert.equal(r.apurado, 10000); assert.equal(r.gap, 3000);
  assert.equal(H.compute({ bac: 80000, hoursTotal: 800, entries: [{ hours: 100 }], ac: 0 }).gap, null); // nada lançado: sem comparação
});
test('custo pelas horas: sem orçamento ou sem total de horas não inventa valor', () => {
  assert.equal(H.compute({ bac: 0, hoursTotal: 800, entries: [] }).rate, null);
  assert.match(H.compute({ bac: 5000, hoursTotal: 0, entries: [] }).reason, /total de horas/);
});
test('custo pelas horas: ligado à tela de orçamento', () => { for (const k of ['id="bud-hours-root"', 'function renderHoursCost()', 'Custo Pelas Horas × Custo Lançado']) assert.ok(html.includes(k), k); });
