import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/agile-calc">([\s\S]*?)<\/script>/);
const { AgileCalc } = new Function(`${m[1]}\nreturn { AgileCalc };`)();

const bug = { id: 'US-1', kind: 'bug', assignee: 'Ana', points: 2 };
const hist = { id: 'US-2', kind: 'historia', assignee: '', points: '' };
const tarefa = { id: 'US-3', kind: 'tarefa', assignee: 'Beto', points: 3 };

test('raia filtra por tipo, responsável e estimativa: "ou" dentro do campo, "e" entre campos', () => {
  const [soBug] = AgileCalc.normLanes({ lanes: [{ id: 'a', name: 'Bugs', kinds: ['bug'] }] });
  assert.deepEqual([bug, hist, tarefa].filter(i => AgileCalc.laneMatch(soBug, i)).map(i => i.id), ['US-1']);
  const [dois] = AgileCalc.normLanes({ lanes: [{ id: 'b', kinds: ['bug', 'tarefa'] }] });
  assert.equal([bug, hist, tarefa].filter(i => AgileCalc.laneMatch(dois, i)).length, 2);
  const [semDono] = AgileCalc.normLanes({ lanes: [{ id: 'c', assignees: [AgileCalc.NO_ASSIGNEE] }] });
  assert.deepEqual([bug, hist, tarefa].filter(i => AgileCalc.laneMatch(semDono, i)).map(i => i.id), ['US-2']);
  const [ana] = AgileCalc.normLanes({ lanes: [{ id: 'd', assignees: ['ana'] }] });
  assert.ok(AgileCalc.laneMatch(ana, bug), 'responsável sem diferenciar maiúscula');
  const [bugSemPontos] = AgileCalc.normLanes({ lanes: [{ id: 'e', kinds: ['bug'], estimate: 'sem' }] });
  assert.equal(AgileCalc.laneMatch(bugSemPontos, bug), false, 'bug com pontos não entra em "só sem pontos"');
  const [comPontos] = AgileCalc.normLanes({ lanes: [{ id: 'f', estimate: 'com' }] });
  assert.deepEqual([bug, hist, tarefa].filter(i => AgileCalc.laneMatch(comPontos, i)).map(i => i.id), ['US-1', 'US-3']);
});

test('configuração de raias é saneada: máximo 6, tipo inválido some, raia sem filtro não aparece', () => {
  const many = AgileCalc.normLanes({ lanes: Array.from({ length: 9 }, (_, i) => ({ id: 'x' + i, name: 'R' + i, kinds: ['bug', 'inexistente'] })) });
  assert.equal(many.length, 6);
  assert.deepEqual(many[0].kinds, ['bug']);
  assert.equal(AgileCalc.normLanes(null).length, 0);
  assert.equal(AgileCalc.laneEmpty(AgileCalc.normLanes({ lanes: [{ name: 'Vazia' }] })[0]), true);
  for (const k of ['data-sec="lane-', "DB.get('boardLanes')", "'boardLanes', lanes", 'id="ab-lanes"', 'Raias (filtros do quadro)', 'Sec.restore(root)']) assert.ok(html.includes(k), k);
});
