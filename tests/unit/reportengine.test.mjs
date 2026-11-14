import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const { ReportEngine: R } = new Function(`${html.match(/<script data-module="services\/report-engine">([\s\S]*?)<\/script>/)[1]}\nreturn { ReportEngine };`)();

const data = { P1: {
  backlog: [{ id: 'US-1', title: 'A', kind: 'historia', status: 'done', points: 3, assignee: 'Ana', sprintId: 'S1', createdOn: '2026-11-01', doneOn: '2026-11-05' }, { id: 'US-2', title: 'B', kind: 'bug', status: 'doing', points: '', assignee: 'Bia', bugPriority: 1, createdOn: '2026-11-02' }, { id: 'US-3', title: 'C', kind: 'historia', status: 'doing', points: 5, assignee: 'Ana', createdOn: '2026-11-03' }],
  sprints: [{ id: 'S1', name: 'Sprint 1' }], timeEntries: [{ person: 'Ana', date: '2026-11-04', hours: 8 }, { person: 'Bia', date: '2026-11-04', hours: 6 }, { person: 'Ana', date: '2026-10-01', hours: 2 }],
  costActuals: [{ label: 'x', amount: 1000, date: '2026-11-05', kind: 'real' }], scopeChanges: [{ id: 'SC-1', title: 's', status: 'approved', impactDays: 5, impactCost: 900, createdAt: '2026-11-02' }]
}, P2: { backlog: [{ id: 'US-9', title: 'Z', kind: 'tarefa', status: 'todo', points: 2, assignee: 'Zé', createdOn: '2026-11-02' }] } };
const ctx = (can = [], projects = [{ id: 'P1', name: 'Proj 1' }]) => ({ projects, get: (p, t) => (data[p] || {})[t] || [], can: k => can.includes(k), today: '2026-11-12', me: 'Ana' });
const pad = id => R.PADROES.find(x => x.id === id);

test('relatório: agrupar e somar com linha de total (só soma e contagem)', () => {
  const r = R.run(pad('p-cards-sit'), ctx());
  assert.deepEqual(r.colunas.map(c => c.label), ['Situação', 'Quantidade', 'Soma de Pontos']);
  assert.deepEqual(r.linhas.find(l => l[0] === 'Em andamento'), ['Em andamento', 2, 5]);
  assert.deepEqual(R.totals(r), ['Total', 3, 8]);
  assert.equal(R.totals(Object.assign({}, r, { truncado: true })), null); // linha cortada: sem total
});
test('relatório: lista, filtro, ordem e período', () => {
  const b = R.run(R.usable(pad('p-bugs'), () => false), ctx());
  assert.deepEqual(b.linhas.map(l => l[1]), ['US-2']);
  const h = R.run(Object.assign({}, pad('p-horas-dia'), { inicio: '2026-11-01', fim: '2026-11-30' }), ctx(['view_all_hours']));
  assert.deepEqual(h.linhas, [['2026-11-04', 14]]); // a hora de outubro fica fora do período
});
test('relatório: permissão por campo e por entidade; horas só do próprio nome sem "ver horas de todos"', () => {
  assert.equal(R.usable(pad('p-custos-mes'), () => false), null); // custos exigem view_costs
  assert.ok(R.usable(pad('p-custos-mes'), k => k === 'view_costs'));
  assert.deepEqual(R.usable(pad('p-escopo'), () => false).medidas.map(m => m.campo), ['*', 'impacto_dias']); // o campo em R$ sai do padrão
  assert.deepEqual(R.run(pad('p-horas-pessoa'), ctx()).linhas.map(l => l[0]), ['Ana']);
  assert.deepEqual(R.run(pad('p-horas-pessoa'), ctx(['view_all_hours'])).linhas.map(l => l[0]).sort(), ['Ana', 'Bia']);
  assert.throws(() => R.run({ ent: 'custos', campos: ['valor'] }, ctx()), /sem permissão|entidade inválida/);
  assert.throws(() => R.run({ ent: 'escopo', campos: ['impacto_custo'] }, ctx()), /inexistente/);
});
test('relatório: a definição é conferida contra o catálogo (campo inventado, agrupar por número, soma de texto)', () => {
  assert.match(R.validate({ ent: 'cards', campos: ['inventado'] }, () => true), /inexistente/);
  assert.match(R.validate({ ent: 'cards', grupos: ['pontos'], medidas: [{ campo: '*', fn: 'count' }] }, () => true), /texto ou data/);
  assert.match(R.validate({ ent: 'cards', grupos: ['situacao'], medidas: [{ campo: 'titulo', fn: 'sum' }] }, () => true), /numéricos/);
  assert.match(R.validate({ ent: 'cards', campos: ['id'], filtros: [{ campo: 'id', op: 'drop table', valor: 'x' }] }, () => true), /Filtro inválido/);
  assert.match(R.validate({ ent: 'cards', campos: [] }, () => true), /ao menos um campo/);
});
test('relatório: vários projetos ganham a coluna Projeto; todos os padrões são válidos para quem vê tudo', () => {
  const r = R.run({ ent: 'cards', campos: ['id'], ordem: 'id' }, ctx([], [{ id: 'P1', name: 'Proj 1' }, { id: 'P2', name: 'Proj 2' }]));
  assert.equal(r.colunas[0].label, 'Projeto'); assert.equal(r.linhas.length, 4);
  assert.ok(R.PADROES.every(p => R.usable(p, () => true)));
  assert.equal(new Set(R.PADROES.map(p => p.id)).size, R.PADROES.length);
});
test('relatório: código do modelo leva só a definição e volta igual', () => {
  const def = Object.assign({}, pad('p-cards-resp'), { nome: 'Meu' }), back = R.fromCode(R.toCode(def));
  assert.equal(back.nome, 'Meu'); assert.deepEqual(back.grupos, ['responsavel', 'situacao']); assert.equal(R.fromCode('lixo'), null);
});
test('relatório: formatos (data dd/mm/aaaa, dinheiro, número com vírgula)', () => {
  assert.equal(R.fmt('2026-11-05', 'data'), '05/11/2026'); assert.equal(R.fmt(1234.5, 'dinheiro', true), 1234.5); assert.match(R.fmt(1234.5, 'dinheiro'), /R\$ 1\.234,50/); assert.equal(R.fmt(2.5, 'numero'), '2,5');
});
test('central de relatórios: ligada ao menu, às Configurações e à navegação', () => {
  for (const k of ['id="p-reports"', 'id="sbg-relatorios"', 'id="settings-panel-relat"', "TABS = ['pmo','acesso','ia','relat','comunic','dados']", "reports: 'view_management'", "reports:'sbg-relatorios'", 'Reports.builderRender()', 'Central de Relatórios', "MODELS_KEY = 'reportModels'"]) assert.ok(html.includes(k), k);
});
