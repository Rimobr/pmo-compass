import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/hours-suggest">([\s\S]*?)<\/script>/);
const { HoursSuggest: H } = new Function(`${m[1]}\nreturn { HoursSuggest };`)();

const TODAY = '2026-11-11'; // quarta
const at = d => d + 'T15:00:00Z'; // meio-dia no Brasil, mesmo dia em qualquer fuso razoável
const hist = (by, d, n = 1) => Array.from({ length: n }, () => ({ at: at(d), by, field: 'Situação', from: 'A fazer', to: 'Em andamento' }));
const card = (id, history, o = {}) => ({ id, title: 'Card ' + id, kind: 'tarefa', history, ...o });
const base = (o = {}) => ({ me: 'Ana', today: TODAY, days: 7, dailyNormal: 8, allocationPct: 100, entries: [], items: [], isOff: d => ['2026-11-07', '2026-11-08'].includes(d), ...o });

test('sugestão de horas: divide a jornada entre os cards mexidos no dia, na proporção da atividade, fechando a soma', () => {
  const r = H.compute(base({ items: [card('1', hist('Ana', '2026-11-10', 3)), card('2', hist('Ana', '2026-11-10', 1))] }));
  assert.equal(r.length, 1); assert.equal(r[0].date, '2026-11-10'); assert.equal(r[0].total, 8);
  assert.deepEqual(r[0].rows.map(x => x.hours), [6, 2]); assert.equal(r[0].rows.reduce((s, x) => s + x.hours, 0), 8);
  assert.equal(r[0].rows[0].ref, '1 — Card 1');
});
test('sugestão de horas: alocação reduz a jornada; sem atividade, fim de semana, dia já lançado e atividade de outra pessoa ou do sistema não geram sugestão', () => {
  const items = [card('1', [...hist('Ana', '2026-11-09'), ...hist('Bia', '2026-11-10'), ...hist('Claude Code (correção automática)', '2026-11-11'), ...hist('Ana', '2026-11-07')])];
  let r = H.compute(base({ items, allocationPct: 50 }));
  assert.deepEqual(r.map(x => x.date + ':' + x.total), ['2026-11-09:4']); // 10 é da Bia, 11 é do sistema, 07 é sábado
  r = H.compute(base({ items, entries: [{ person: 'ana', date: '2026-11-09', hours: 8, status: 'aprovado' }] }));
  assert.equal(r.length, 0); // o dia já tem horas lançadas
  r = H.compute(base({ items, entries: [{ person: 'Ana', date: '2026-11-09', hours: 8, status: 'reprovado' }] }));
  assert.equal(r.length, 1); // horas reprovadas não contam: o dia volta a ser sugerido
});
test('sugestão de horas: épico não conta, janela de 7 dias, nome sem acento e no máximo 6 cards por dia', () => {
  const muitos = Array.from({ length: 9 }, (_, i) => card('C' + i, hist('Ana', '2026-11-10', 1 + (i % 2))));
  let r = H.compute(base({ items: [...muitos, card('E', hist('Ana', '2026-11-10', 5), { kind: 'epico' })] }));
  assert.equal(r[0].rows.length, 6); assert.equal(r[0].rows.reduce((s, x) => s + x.hours, 0), 8); assert.ok(!r[0].rows.some(x => x.ref.startsWith('E ')));
  r = H.compute(base({ items: [card('1', hist('Ana', '2026-11-02'))] })); assert.equal(r.length, 0); // 9 dias atrás: fora da janela
  r = H.compute(base({ me: 'José', items: [card('1', hist('jose', '2026-11-10'))] })); assert.equal(r.length, 1);
});
test('sugestão de horas: a divisão em quartos de hora sempre fecha no total', () => {
  for (const [t, w] of [[8, [1, 1, 1]], [8, [5, 3, 1]], [6, [2, 2, 2, 2, 2]], [4.5, [7, 1]]]) { const h = H.split(t, w); assert.equal(h.reduce((a, b) => a + b, 0), t); assert.ok(h.every(x => x * 4 === Math.round(x * 4))); }
});
test('sugestão de horas: ligada à tela de horas e ao formulário, passando pelas regras de lançamento (addMany)', () => {
  for (const k of ['id="hr-suggest-root"', 'function renderSuggest()', 'function suggestApply(date)', 'const n = addMany(items);', 'Sugestão do Sistema — suas horas pelas suas atividades', "suggestions()[0]"]) assert.ok(html.includes(k), k);
});
