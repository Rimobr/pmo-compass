import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/agile-calc">([\s\S]*?)<\/script>/);
const { AgileCalc } = new Function(`${m[1]}\nreturn { AgileCalc };`)();

const sprint = { id: 'SP-1', name: 'S1', startOn: '2026-06-01', endOn: '2026-06-05', capacity: 10, state: 'ativa' };
const mk = (id, points, status, doneOn) => ({ id, points, status, sprintId: 'SP-1', doneOn: doneOn || '' });

test('limite WIP: acusa só a coluna que passou do limite; 0 = sem limite', () => {
  const items = ['a', 'b', 'c', 'd'].map(id => mk(id, 1, 'doing'));
  const w = AgileCalc.wip(items, { wip: { doing: 3, review: 0 } });
  assert.equal(w.find(c => c.key === 'doing').over, true);
  assert.equal(w.find(c => c.key === 'review').over, false);
  assert.equal(w.find(c => c.key === 'todo').limit, 0);
});

test('mover para Concluído grava a data; sair de Concluído apaga', () => {
  const it = { status: 'doing', doneOn: '' };
  AgileCalc.moveTo(it, 'done', '2026-06-03'); assert.equal(it.doneOn, '2026-06-03');
  AgileCalc.moveTo(it, 'done', '2026-06-09'); assert.equal(it.doneOn, '2026-06-03'); // não regrava
  AgileCalc.moveTo(it, 'review', '2026-06-10'); assert.equal(it.doneOn, '');
  assert.equal(AgileCalc.neighbor('todo', -1), null); assert.equal(AgileCalc.neighbor('todo', 1), 'doing'); assert.equal(AgileCalc.neighbor('done', 1), null);
});

test('burndown: ideal desce em linha reta e o real só conta o que foi concluído até o dia', () => {
  const items = [mk('a', 4, 'done', '2026-06-02'), mk('b', 6, 'doing')];
  const s = AgileCalc.sprintStats(sprint, items, '2026-06-03');
  assert.equal(s.committed, 10); assert.equal(s.done, 4); assert.equal(s.pct, 40);
  assert.equal(s.series.length, 5);
  assert.equal(s.series[0].ideal, 10); assert.equal(s.series[4].ideal, 0);
  assert.equal(s.series[0].real, 10); assert.equal(s.series[1].real, 6); assert.equal(s.series[2].real, 6);
  assert.equal(s.series[3].real, null); // dias futuros não têm valor real
  assert.equal(s.daysLeft, 2);
});

test('sprint atrasada e acima da capacidade são detectadas', () => {
  const atrasada = AgileCalc.sprintStats(sprint, [mk('a', 10, 'doing')], '2026-06-04');
  assert.equal(atrasada.behind, true);
  const cheia = AgileCalc.sprintStats({ ...sprint, capacity: 5 }, [mk('a', 10, 'todo')], '2026-06-01');
  assert.equal(cheia.overCapacity, true);
  const livre = AgileCalc.sprintStats({ ...sprint, capacity: '' }, [mk('a', 10, 'todo')], '2026-06-01');
  assert.equal(livre.overCapacity, false);
});

test('velocidade usa só sprints encerradas (média das 3 últimas) e a previsão divide o que falta', () => {
  const sprints = [1, 2, 3, 4].map(n => ({ id: 'S' + n, name: 'S' + n, startOn: '2026-0' + n + '-01', endOn: '2026-0' + n + '-10', state: n === 4 ? 'ativa' : 'encerrada' }));
  const items = [
    { id: 'a', points: 10, status: 'done', sprintId: 'S1' }, { id: 'b', points: 20, status: 'done', sprintId: 'S2' }, { id: 'c', points: 30, status: 'done', sprintId: 'S3' },
    { id: 'd', points: 99, status: 'done', sprintId: 'S4' }, { id: 'e', points: 25, status: 'todo', sprintId: '' }, { id: 'f', points: '', status: 'todo', sprintId: '' }];
  const v = AgileCalc.velocity(sprints, items);
  assert.equal(v.list.length, 3); assert.equal(v.avg, 20);
  const f = AgileCalc.forecast(items, v.avg);
  assert.equal(f.remaining, 25); assert.equal(f.unestimated, 1); assert.equal(f.sprints, 2);
  assert.equal(AgileCalc.forecast(items, null).sprints, null);
});

test('próximo código de item e de sprint', () => {
  assert.equal(AgileCalc.nextId('US', []), 'US-001');
  assert.equal(AgileCalc.nextId('US', [{ id: 'US-009' }, { id: 'US-002' }]), 'US-010');
});
