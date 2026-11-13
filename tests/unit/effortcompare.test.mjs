import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/effort-compare">([\s\S]*?)<\/script>/);
const { EffortCompare: E } = new Function(`${m[1]}\nreturn { EffortCompare };`)();

const done = (n, pts) => ({ id: 'US-' + n, title: 'Concluído ' + n, kind: 'historia', status: 'done', points: pts });
const ent = (id, title, h, st) => ({ wbsRef: id + ' — ' + title, hours: h, status: st || 'aprovado' });
const base = () => ({
  items: [done(1, 2), done(2, 3), done(3, 5), { id: 'US-9', title: 'Aberto', kind: 'historia', status: 'doing', points: 3, assignee: 'Ana' }],
  entries: [ent('US-1', 'Concluído 1', 8), ent('US-2', 'Concluído 2', 12), ent('US-3', 'Concluído 3', 20)] // 4 h por ponto
});

test('estimativa sistêmica: horas por ponto vêm dos concluídos com horas apontadas (mediana, mínimo de 3)', () => {
  const { items, entries } = base();
  assert.equal(E.hoursPerPoint(items, entries), 4);
  assert.equal(E.hoursPerPoint(items, entries.slice(0, 2)), null); // sem base não inventa valor
});
test('estimado × apontado: no ritmo, atenção e estourou; estimativa nunca vira apontado', () => {
  const { items, entries } = base();
  let r = E.rows(items, entries).list[0]; // 3 pontos × 4 = 12 h
  assert.equal(r.est, 12); assert.equal(r.real, 0); assert.equal(r.level, 'grn');
  r = E.rows(items, entries.concat(ent('US-9', 'Aberto', 10))).list[0]; assert.equal(r.level, 'amb'); assert.equal(r.pct, 83);
  r = E.rows(items, entries.concat(ent('US-9', 'Aberto', 13))).list[0]; assert.equal(r.level, 'red');
  r = E.rows(items, entries.concat(ent('US-9', 'Aberto', 13, 'reprovado'))).list[0]; assert.equal(r.real, 0); // reprovado não conta
});
test('estimado × apontado: ligado à tela de horas e à WBS (esperado hoje × real sempre visível)', () => {
  for (const k of ['id="hr-effort-root"', 'function renderEffort()', 'Estimado pelo Sistema × Apontado', 'Confirmar Como Apontado', 'esperado ${expected}% hoje, real ${m.pct}%</span>']) assert.ok(html.includes(k), k);
});
