import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
const load = (name, exports) => { const m = html.match(new RegExp(`<script data-module="${name.replace('/', '\\/')}">([\\s\\S]*?)<\\/script>`)); return new Function(`${m[1]}\nreturn { ${exports} };`)(); };
const { AgileCalc } = load('services/agile-calc', 'AgileCalc');
const { AgileAi } = load('services/agile-ai', 'AgileAi');

// Sprint de 2 semanas: 01/06/2026 (segunda) a 12/06/2026 (sexta) = 10 dias úteis
const sprint = { id: 'S3', startOn: '2026-06-01', endOn: '2026-06-12', state: 'planejada' };
const closed = n => ({ id: 'S' + n, name: 'S' + n, startOn: `2026-05-${n === 1 ? '04' : '18'}`, endOn: `2026-05-${n === 1 ? '15' : '29'}`, state: 'encerrada' });
const done = (id, pts, sp, who) => ({ id, title: 'T' + id, points: pts, status: 'done', sprintId: sp, assignee: who, doneOn: '2026-05-20' });

test('dias úteis ignoram sábado e domingo', () => {
  assert.equal(AgileCalc.workingDays('2026-06-01', '2026-06-12'), 10);
  assert.equal(AgileCalc.workingDays('2026-06-06', '2026-06-07'), 0);
  assert.equal(AgileCalc.workingDays('2026-06-01', '2026-06-01'), 1);
});

test('ritmo por pessoa: média dos pontos concluídos nas sprints encerradas em que ela teve item', () => {
  const items = [done('a', 8, 'S1', 'Ana'), done('b', 4, 'S1', 'Caio'), done('c', 6, 'S2', 'Ana'), { id: 'd', points: 5, status: 'todo', sprintId: 'S2', assignee: 'Caio' }];
  const r = AgileCalc.personRhythm([closed(1), closed(2)], items);
  assert.deepEqual(r.Ana, { avg: 7, sprints: 2 });
  assert.deepEqual(r.Caio, { avg: 2, sprints: 2 });     // 4 em S1 e 0 em S2 (tinha item, não concluiu)
});

test('capacidade por pessoa: ritmo real descontando folgas; sem histórico usa a média do time pela alocação', () => {
  const team = [{ name: 'Ana', allocationPct: 100 }, { name: 'Caio', allocationPct: 50 }, { name: 'Nova', allocationPct: 100 }];
  const rhythm = { Ana: { avg: 10, sprints: 3 }, Caio: { avg: 6, sprints: 3 } };
  const c = AgileCalc.teamCapacity(sprint, team, { Ana: { daysOff: 5 } }, rhythm, 24);
  const by = Object.fromEntries(c.rows.map(r => [r.name, r]));
  assert.equal(c.workingDays, 10);
  assert.equal(by.Ana.capacity, 5); assert.equal(by.Ana.source, 'histórico');           // 10 pts × (10-5)/10
  assert.equal(by.Caio.capacity, 6);                                                     // 6 × 1
  assert.equal(by.Nova.capacity, 8); assert.equal(by.Nova.source, 'média do time');     // 24 / 3 pessoas × 100%
  assert.equal(c.total, 19);
});

test('folga maior que os dias úteis é limitada; sem nenhuma referência a capacidade é zero', () => {
  const c = AgileCalc.teamCapacity(sprint, [{ name: 'X', allocationPct: 100 }], { X: { daysOff: 99 } }, { X: { avg: 10 } }, null);
  assert.equal(c.rows[0].daysOff, 10); assert.equal(c.rows[0].capacity, 0);
  const s = AgileCalc.teamCapacity(sprint, [{ name: 'Y' }], {}, {}, null);
  assert.equal(s.rows[0].source, 'sem referência'); assert.equal(s.total, 0);
});

test('aviso de sobrecarga por pessoa e de pontos sem responsável', () => {
  const items = [{ id: 'a', points: 10, status: 'todo', sprintId: 'S3', assignee: 'Ana' }, { id: 'b', points: 6, status: 'todo', sprintId: '', assignee: 'Ana' }, { id: 'c', points: 4, status: 'todo', sprintId: '', assignee: '' }];
  const adv = AgileCalc.loadAdvice(items, sprint, ['b', 'c'], [{ name: 'Ana', capacity: 12, daysOff: 2 }]);
  assert.ok(adv.some(a => a.level === 'warn' && /Ana ficaria com 16 pts/.test(a.text) && /2 dia\(s\) de folga/.test(a.text)));
  assert.ok(adv.some(a => /4 pts ainda estão sem responsável/.test(a.text)));
  assert.equal(AgileCalc.loadAdvice(items, sprint, [], [{ name: 'Ana', capacity: 20 }]).filter(a => a.level === 'warn').length, 0);
});

test('IA: candidatos são os itens sem pontos ou acima de 8; histórico só de itens entregues em sprint encerrada', () => {
  const items = [{ id: 'a', points: '', status: 'todo', rank: 2, kind: 'historia', title: 'A' }, { id: 'b', points: 13, status: 'todo', rank: 1, kind: 'historia', title: 'B' }, { id: 'c', points: 3, status: 'todo', rank: 3, title: 'C' },
    { id: 'd', points: 5, status: 'done', sprintId: 'S1', doneOn: '2026-05-10', title: 'D' }, { id: 'e', points: 5, status: 'done', sprintId: 'ATIVA', doneOn: '2026-05-11', title: 'E' }];
  assert.deepEqual(AgileAi.candidates(items).map(i => i.id), ['b', 'a']);
  assert.deepEqual(AgileAi.history(items, [{ id: 'S1', state: 'encerrada' }, { id: 'ATIVA', state: 'ativa' }]).map(h => h.id), ['d']);
  const p = AgileAi.buildPrompt(AgileAi.candidates(items), [{ id: 'd', points: 5, title: 'D' }]);
  assert.match(p.user, /d \| 5 pts \| D/); assert.match(p.system, /1, 2, 3, 5, 8, 13/);
});

test('IA: resposta é validada — escala, ids existentes, 2 a 6 partes; texto solto ao redor do JSON é tolerado', () => {
  const resp = 'Claro!\n' + JSON.stringify({ estimativas: [{ id: 'a', pontos: 6, referencia: 'D (5 pts)', motivo: 'parecido' }, { id: 'zzz', pontos: 3 }, { id: 'c', pontos: -1 }, { id: 'b', pontos: 99 }],
    divisoes: [{ id: 'b', motivo: 'grande', partes: [{ titulo: 'Parte 1', pontos: 5 }, { titulo: 'Parte 2', pontos: 4 }] }, { id: 'x', partes: [] }, { id: 'a', partes: [{ titulo: 'Repetido', pontos: 2 }, { titulo: 'Repetido 2', pontos: 2 }] }] });
  const r = AgileAi.parse(resp, ['a', 'b', 'c']);
  assert.deepEqual(r.estimates.map(e => [e.id, e.points]), [['a', 5]]);     // 6 vira o valor da escala mais próximo (5)
  assert.deepEqual(r.splits.map(s => s.id), ['b']);                           // 'a' já foi estimado: não entra em duas listas
  assert.equal(r.splits[0].parts[1].points, 5);                               // 4 está entre 3 e 5: no empate vale a maior nota (prudência)
  assert.equal(AgileAi.parse('sem json', ['a']), null);
});

test('IA: dividir troca o item pelas partes, mantendo responsável, sprint e tipo', () => {
  const items = [{ id: 'US-001', title: 'Grande', kind: 'historia', assignee: 'Ana', sprintId: 'S3', rank: 4 }];
  let n = 1; const next = () => 'US-00' + (++n);
  const parts = AgileAi.applySplit(items, { id: 'US-001', parts: [{ title: 'P1', points: 5 }, { title: 'P2', points: 3 }] }, next, '2026-06-01');
  assert.deepEqual(parts.map(p => p.id), ['US-002', 'US-003']);
  assert.ok(parts.every(p => p.assignee === 'Ana' && p.sprintId === 'S3' && p.kind === 'historia' && p.status === 'todo'));
  assert.ok(parts[0].rank > 4 && parts[1].rank > parts[0].rank && parts[1].rank < 5);
  assert.match(parts[0].description, /Parte 1 de 2 de US-001/);
});
