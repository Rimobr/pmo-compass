import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
const load = (name, exports) => { const m = html.match(new RegExp(`<script data-module="${name.replace('/', '\\/')}">([\\s\\S]*?)<\\/script>`)); return new Function(`${m[1]}\nreturn { ${exports} };`)(); };
const { AgileCalc } = load('services/agile-calc', 'AgileCalc');
const { SheetParse, SheetImport } = load('services/sheet-import', 'SheetParse, SheetImport');

const it = (id, points, rank, extra) => ({ id, title: 'Item ' + id, points, rank, status: 'todo', sprintId: '', ...extra });
const sprint = { id: 'SP-9', name: 'Sprint 9' };

test('planejamento enche a capacidade útil, na ordem de prioridade, e deixa a reserva', () => {
  const items = [it('a', 8, 1), it('b', 5, 2), it('c', 5, 3), it('d', 3, 4)];
  const p = AgileCalc.planSprint(items, sprint, { capacity: 20, reservePct: 15, velocityAvg: 20 });
  assert.equal(p.target, 17);                   // 20 - 15% = 17 pts úteis
  assert.deepEqual(p.selected, ['a', 'b', 'd']); // a(8)+b(5)=13; c(5) não cabe (faltam 1); d(3) cabe: 16
  assert.equal(p.used, 16); assert.equal(p.free, 1);
  assert.deepEqual(p.skipped.map(s => s.id), ['c']);
  assert.match(p.skipped[0].reason, /não coube/);
  assert.ok(p.advice.some(a => /menor prioridade/.test(a.text)));  // d entrou depois de c ficar de fora
});

test('item sem estimativa e item grande demais ficam de fora, com o motivo', () => {
  const items = [it('a', '', 1), it('b', 30, 2), it('c', 5, 3)];
  const p = AgileCalc.planSprint(items, sprint, { capacity: 20, reservePct: 0, velocityAvg: 20 });
  assert.deepEqual(p.selected, ['c']);
  assert.match(p.skipped.find(s => s.id === 'a').reason, /sem estimativa/);
  assert.match(p.skipped.find(s => s.id === 'b').reason, /divida/);
  assert.ok(p.advice.some(a => a.level === 'warn' && /sem estimativa/.test(a.text)));
});

test('mentoria compara a capacidade com a velocidade média do time', () => {
  const items = [it('a', 5, 1)];
  const alta = AgileCalc.planSprint(items, sprint, { capacity: 40, velocityAvg: 20 });
  assert.ok(alta.advice.some(a => a.level === 'warn' && /acima da velocidade média/.test(a.text) && /100%/.test(a.text)));
  const ok = AgileCalc.planSprint(items, sprint, { capacity: 21, velocityAvg: 20 });
  assert.ok(ok.advice.some(a => a.level === 'ok'));
  const semHist = AgileCalc.planSprint(items, sprint, { capacity: 20, velocityAvg: null });
  assert.ok(semHist.advice.some(a => /Ainda não há sprint encerrada/.test(a.text)));
  const semCap = AgileCalc.planSprint(items, sprint, { capacity: 0, velocityAvg: 18 });
  assert.ok(semCap.advice.some(a => a.level === 'warn' && /Defina a capacidade/.test(a.text) && /18/.test(a.text)));
  assert.deepEqual(semCap.selected, []);
});

test('o que já está na sprint conta; concluídos e itens de outras sprints não entram', () => {
  const items = [it('x', 10, 1, { sprintId: 'SP-9' }), it('y', 5, 2), it('z', 3, 3, { status: 'done' }), it('w', 2, 4, { sprintId: 'SP-OUTRA' })];
  const p = AgileCalc.planSprint(items, sprint, { capacity: 20, reservePct: 0 });
  assert.equal(p.committed, 10); assert.equal(p.free, 5); // 20 úteis − 10 já na sprint − 5 do item novo
  assert.deepEqual(p.selected, ['y']);
  assert.equal(p.total, 15);
});

test('importar backlog: colunas do Jira/Excel são reconhecidas', () => {
  const map = SheetImport.autoMap(['Summary', 'Issue Type', 'Story Points', 'Assignee', 'Status', 'Sprint', 'Priority', 'Description'], 'backlog');
  assert.deepEqual(Object.keys(map).sort(), ['assignee', 'description', 'kind', 'points', 'priority', 'sprint', 'status', 'title']);
});

test('importar backlog: tipos, situações, pontos, sprint existente e ordem por prioridade', () => {
  const header = ['Título', 'Tipo', 'Pontos', 'Responsável', 'Situação', 'Sprint', 'Prioridade'];
  const map = SheetImport.autoMap(header, 'backlog');
  const rows = [
    ['Pagar com Pix', 'História', '13', 'Ana', 'A fazer', '', '3'],
    ['Corrigir login', 'Bug', '2', '', 'Em andamento', 'Sprint 4', '1'],
    ['Tela nova', 'Tarefa', 'muitos', '', 'Concluído', 'Sprint 99', '2'],
    ['Item repetido', '', '5', '', '', '', ''], ['Item repetido', '', '5', '', '', '', ''],
    ['', '', '', '', '', '', ''], ['x', '', '', '', '', '', '']];
  const r = SheetImport.build('backlog', rows, map, { today: '2026-06-20', existingTitles: [], sprints: [{ id: 'SP-004', name: 'Sprint 4' }] }, 1);
  assert.deepEqual(r.rows.map(x => x.title), ['Corrigir login', 'Tela nova', 'Pagar com Pix', 'Item repetido']); // por prioridade 1, 2, 3, sem prioridade
  const bug = r.rows[0]; assert.equal(bug.kind, 'bug'); assert.equal(bug.points, 2); assert.equal(bug.status, 'doing'); assert.equal(bug.sprintId, 'SP-004');
  const tela = r.rows[1]; assert.equal(tela.points, ''); assert.equal(tela.status, 'done'); assert.equal(tela.doneOn, '2026-06-20'); assert.equal(tela.sprintId, '');
  assert.ok(r.warnings.some(w => /pontos inválidos/.test(w.msg)));
  assert.ok(r.warnings.some(w => /sprint "Sprint 99" não existe/.test(w.msg)));
  assert.ok(r.warnings.some(w => /já existe no backlog/.test(w.msg)));   // repetido na própria planilha
  assert.ok(r.errors.some(e => /sem título/.test(e.msg)));                // "x" tem 1 letra
});

test('importar backlog: não duplica o que já existe e exige a coluna de título', () => {
  const map = SheetImport.autoMap(['Título'], 'backlog');
  const r = SheetImport.build('backlog', [['Já existe'], ['Novo']], map, { existingTitles: ['já existe'], sprints: [] }, 1);
  assert.deepEqual(r.rows.map(x => x.title), ['Novo']);
  const semTitulo = SheetImport.build('backlog', [['a']], {}, {}, 1);
  assert.ok(semTitulo.errors.some(e => /coluna obrigatória/.test(e.msg)));
});
