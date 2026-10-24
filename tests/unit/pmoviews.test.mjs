import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
const block = n => html.match(new RegExp(`<script data-module="${n}">([\\s\\S]*?)<\\/script>`))[1];
const { PortfolioKpi, PmoViews } = new Function(`${block('services/shared-facts')}\n${block('services/portfolio-kpi')}\n${block('services/pmo-views')}\nreturn { PortfolioKpi, PmoViews };`)();

const ev = (o = {}) => ({ prazo: true, custo: true, escopo: true, saudavel: true, farol: 'verde', atrasadas: 0, decisoesCriticas: 0, riscosCriticos: 0, consumoPct: 40, ...o });
const row = (id, o = {}) => ({ id, name: id, area: 'TI', ev: ev(o.ev), days: 3, hasBaseline: true, finishVar: 0, risksNoOwner: 0, risksOverdue: 0, lessons: { total: 0, applied: 0 },
  docs: 0, pendingActions: 0, blocked: 0, doneLast28: 0, highLoad: 0, overallocated: 0, decisionsOpen: 0, scopeOpen: 0, ...o, ev: ev(o.ev) });

test('os 6 tipos de PMO existem e cada um monta 6 indicadores com o foco explicado', () => {
  assert.deepEqual([...PmoViews.ORDER].sort(), ['agil', 'controle', 'departamental', 'diretivo', 'estrategico', 'suporte']);
  for (const t of PmoViews.ORDER) {
    const v = PmoViews.build(t, [row('a')], { area: 'TI', overallocatedPeople: 0 });
    assert.equal(v.kpis.length, 6, t); assert.ok(v.foco.length > 20, t);
    assert.ok(v.kpis.every(k => k.label && k.value !== undefined), t);
  }
});

test('controle: lista só quem foge do padrão, com o motivo', () => {
  const rows = [row('ok'), row('ruim', { ev: { prazo: false, custo: false }, finishVar: 12, hasBaseline: false, days: 30 })];
  const v = PmoViews.build('controle', rows);
  assert.deepEqual(v.list.map(x => x.id), ['ruim']);
  assert.ok(v.list[0].reasons.some(r => /12 dia/.test(r)) && v.list[0].reasons.some(r => /sem linha de base/.test(r)) && v.list[0].reasons.some(r => /30 dias/.test(r)));
  assert.equal(v.kpis.find(k => k.label === 'Sem linha de base').value, 1);
});

test('departamental: só os projetos da área escolhida', () => {
  const rows = [row('a', { area: 'TI' }), row('b', { area: 'Financeiro', ev: { farol: 'vermelho' } }), row('c', { area: '' })];
  assert.equal(PmoViews.build('departamental', rows, { area: 'Financeiro' }).projects, 1);
  assert.equal(PmoViews.build('departamental', rows, { area: 'Sem área' }).projects, 1);
  assert.equal(PmoViews.build('departamental', rows, { area: 'Financeiro' }).kpis.find(k => k.label === 'Em risco').value, 1);
});

test('diretivo: decisões, sobrealocação e escopo viram ações', () => {
  const rows = [row('p', { ev: { decisoesCriticas: 2, farol: 'vermelho' }, overallocated: 1, scopeOpen: 3 })];
  const v = PmoViews.build('diretivo', rows, { overallocatedPeople: 4 });
  assert.equal(v.kpis.find(k => k.label === 'Colaboradores sobrealocados').value, 4);
  assert.equal(v.list[0].reasons.length, 4);
});

test('ágil e estratégico avisam o que o produto ainda não tem (sem inventar número)', () => {
  assert.match(PmoViews.build('agil', [row('a', { doneLast28: 8, blocked: 2 })]).note, /Backlog, sprints/);
  assert.equal(PmoViews.build('agil', [row('a', { doneLast28: 8 })]).kpis[1].value, '2');
  assert.match(PmoViews.build('estrategico', [row('a')]).note, /objetivos estratégicos/);
});

test('suporte: lições aplicadas em %, projetos parados e sem linha de base pedem apoio', () => {
  const rows = [row('a', { lessons: { total: 4, applied: 1 }, days: 40, hasBaseline: false, risksNoOwner: 1 }), row('b', { lessons: { total: 1, applied: 1 } })];
  const v = PmoViews.build('suporte', rows);
  assert.equal(v.kpis[0].value, '40%');
  assert.deepEqual(v.list.map(x => x.id), ['a']);
});

test('sem projetos: não quebra e a lista fica vazia', () => {
  for (const t of PmoViews.ORDER) { const v = PmoViews.build(t, [], {}); assert.deepEqual(v.list, []); assert.equal(v.projects, 0); }
});
