import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/agile-calc">([\s\S]*?)<\/script>/);
const { AgileCalc } = new Function(`${m[1]}\nreturn { AgileCalc };`)();
const mk = () => [
  { id: 'H1', kind: 'historia', status: 'todo' },
  { id: 'B1', kind: 'bug', status: 'todo', bugPriority: 1 },
  { id: 'B2', kind: 'bug', status: 'doing', bugPriority: 2 },
  { id: 'B3', kind: 'bug', status: 'todo', bugPriority: 3 },
  { id: 'B4', kind: 'bug', status: 'todo', bugPriority: '' },
];
const order = l => AgileCalc.bugQueue(l).map(x => x.id + ':' + x.bugPriority).join(',');

test('fila de prioridade: encaixar numa posição ocupada empurra os de baixo', () => {
  const l = mk(); const ch = AgileCalc.placeBug(l, 'B4', 2);
  assert.equal(order(l), 'B1:1,B4:2,B2:3,B3:4');
  assert.deepEqual(ch.sort(), ['B2', 'B3']);
});
test('fila de prioridade: posição além do fim vai para a última, sem buracos', () => {
  const l = mk(); AgileCalc.placeBug(l, 'B4', 99);
  assert.equal(order(l), 'B1:1,B2:2,B3:3,B4:4');
});
test('fila de prioridade: mover para cima e para baixo mantém 1..n sem repetir', () => {
  const l = mk(); AgileCalc.placeBug(l, 'B3', 1);
  assert.equal(order(l), 'B3:1,B1:2,B2:3');
  AgileCalc.placeBug(l, 'B3', 3);
  assert.equal(order(l), 'B1:1,B2:2,B3:3');
});
test('fila de prioridade: tirar da fila faz os de baixo subirem', () => {
  const l = mk(); AgileCalc.placeBug(l, 'B1', 0);
  assert.equal(order(l), 'B2:1,B3:2'); assert.equal(l[1].bugPriority, '');
});
test('fila de prioridade: bug concluído ou de outro tipo sai da fila ao compactar', () => {
  const l = mk(); l[1].status = 'done'; l[0].bugPriority = 5;
  AgileCalc.compactQueue(l);
  assert.equal(order(l), 'B2:1,B3:2'); assert.equal(l[1].bugPriority, ''); assert.equal(l[0].bugPriority, '');
});
test('fila de prioridade: só bug em aberto entra; história nunca ganha posição', () => {
  const l = mk(); AgileCalc.placeBug(l, 'H1', 1);
  assert.equal(l[0].bugPriority, ''); assert.equal(order(l), 'B1:1,B2:2,B3:3');
});
test('fila de prioridade: tela, nuvem, leitura de bugs e banco ligados', () => {
  for (const k of ['id="ai-prio"', 'id="bug-f-prio"', 'bug_priority:(x.kind', "bugPriority:r.bug_priority", 'AgileCalc.placeBug(items, it.id', 'AgileCalc.compactQueue(items)', 'Posição ', 'Prioridade do bug na fila']) assert.ok(html.includes(k), k);
  const rb = readFileSync(join(root, 'scripts/read-bugs.mjs'), 'utf8');
  assert.ok(rb.includes('b.bug_priority asc nulls last'));
  const sql = readFileSync(join(root, 'supabase/migrations/20261109120000_bug_priority.sql'), 'utf8');
  for (const k of ['bug_priority int', 'bug_priority_queue', 'bug_priority_gap', 'pg_trigger_depth']) assert.ok(sql.includes(k), k);
});
