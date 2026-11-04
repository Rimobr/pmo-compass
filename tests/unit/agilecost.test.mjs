import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const { AgileCost } = new Function(`${html.match(/<script data-module="services\/agile-cost">([\s\S]*?)<\/script>/)[1]}\nreturn { AgileCost };`)();

const it = (id, points, status) => ({ id, points, status });
const sprints = [{ id: 'S1', state: 'encerrada' }, { id: 'S2', state: 'ativa' }, { id: 'S3', state: 'planejada' }];

test('avanço do escopo: pontos concluídos ÷ total; sem ponto nenhum conta itens; sem itens é nulo', () => {
  const a = AgileCost.progress([it('a', 5, 'done'), it('b', 3, 'doing'), it('c', 2, 'todo')]);
  assert.deepEqual([a.unit, a.total, a.done, a.remaining, a.pct], ['pts', 10, 5, 5, 50]);
  const b = AgileCost.progress([it('a', '', 'done'), it('b', '', 'todo'), it('c', '', 'todo')]);
  assert.deepEqual([b.unit, b.total, b.done, b.pct], ['itens', 3, 1, 33]);
  assert.equal(AgileCost.progress([]).pct, null);
});
test('custo por ponto, previsto por ponto e a razão (1,0 = no previsto; até 1,15 atenção; acima crítico)', () => {
  const items = [it('a', 5, 'done'), it('b', 5, 'todo')];                // 10 pts, 5 concluídos
  const ok = AgileCost.compute({ bac: 10000, ac: 4000, items, sprints, velAvg: 5 });   // previsto 1000/pt, real 800/pt
  assert.equal(ok.costPerUnit, 800); assert.equal(ok.plannedPerUnit, 1000); assert.equal(ok.level, 'ok');
  const at = AgileCost.compute({ bac: 10000, ac: 5500, items, sprints });             // 1100/pt = 110% do previsto
  assert.equal(at.level, 'atencao');
  const cr = AgileCost.compute({ bac: 10000, ac: 7000, items, sprints });             // 1400/pt
  assert.equal(cr.level, 'critico');
});
test('previsão no término: gasto + o que falta × custo por ponto; delta contra a base', () => {
  const items = [it('a', 5, 'done'), it('b', 5, 'todo')];
  const a = AgileCost.compute({ bac: 10000, ac: 6000, items, sprints });             // 1200/pt × 5 restantes = 6000 → 12000
  assert.equal(a.eac, 12000); assert.equal(a.eacDelta, 2000);
  assert.equal(a.ev, 5000);
});
test('sprints e ritmo: custo médio por sprint usa só sprints ativa e encerradas; faltam N sprints pela velocidade', () => {
  const items = [it('a', 5, 'done'), it('b', 5, 'todo'), it('c', 6, 'todo')];     // 16 pts, 11 restantes
  const a = AgileCost.compute({ bac: 20000, ac: 6000, items, sprints, velAvg: 5 });
  assert.equal(a.sprintsUsed, 2); assert.equal(a.costPerSprint, 3000);
  assert.equal(a.sprintsLeft, 3); assert.equal(a.etcBySprint, 9000);               // ceil(11/5) = 3 sprints × 3000
  assert.equal(AgileCost.compute({ bac: 1, ac: 1, items, sprints, velAvg: null }).sprintsLeft, null);
});
test('sem dado = nulo, nunca verde: sem gasto, sem item concluído ou sem orçamento', () => {
  const items = [it('a', 5, 'todo')];
  for (const inp of [{ bac: 10000, ac: 0, items, sprints }, { bac: 10000, ac: 500, items, sprints }, { bac: 0, ac: 500, items: [it('a', 5, 'done')], sprints }]) {
    const a = AgileCost.compute(inp);
    if (inp.bac === 0) { assert.equal(a.plannedPerUnit, null); assert.equal(a.level, 'sem_dado'); }
    else { assert.equal(a.costPerUnit, null); assert.equal(a.eac, null); assert.equal(a.level, 'sem_dado'); }
  }
  assert.equal(AgileCost.compute({ bac: 100, ac: 10, items: [], sprints }).progress.pct, null);
});
test('a tela de orçamento: cartões trocam de nome no ágil, a linha não pede entrega da WBS e Cascata/Híbrido ficam como estavam', () => {
  for (const k of ['id="bud-cpi-lbl"', 'id="bud-eac-lbl"', 'function renderKpisAgile', "AgileCost.compute({ bac: m.BAC", "'Custo por '", "'Previsão no Término'", 'const hideWbsField', "isAgile() ? 'none' : ''", "setText('bud-cpi-lbl', 'CPI'); setText('bud-eac-lbl', 'EAC');"]) assert.ok(html.includes(k), k);
  assert.ok(html.includes("m.CPI.toFixed(2)"), 'o CPI de Cascata e Híbrido continua sendo calculado pela WBS');
});
