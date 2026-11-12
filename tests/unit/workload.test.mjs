import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/workload">([\s\S]*?)<\/script>/);
const { WorkloadCalc: W } = new Function(`${m[1]}\nreturn { WorkloadCalc };`)();

const TODAY = '2026-11-11'; // quarta-feira; a janela de 14 dias tem 10 dias úteis
const ctx = (o = {}) => ({ today: TODAY, items: [], sprints: [{ id: 'S1', state: 'ativa', startOn: '2026-11-02', endOn: '2026-11-13' }], hours: [], imps: [], capacity: null, ...o });
const card = (id, o = {}) => ({ id, title: 'Card ' + id, kind: 'tarefa', status: 'todo', points: 2, assignee: 'Ana', sprintId: 'S1', rank: 1, ...o });
const ana = { id: 'a', name: 'Ana', allocationPct: 100 };
const horas = (n, h, pessoa = 'Ana') => Array.from({ length: n }, (_, i) => ({ person: pessoa, date: ['2026-11-11', '2026-11-10', '2026-11-09', '2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02', '2026-10-30', '2026-10-29'][i], hours: h, extra: 0 }));

test('carga: sem cards nem horas é "sem dado" (nunca verde, nunca zero)', () => {
  const r = W.compute(ana, ctx());
  assert.equal(r.pct, null); assert.equal(r.level, 'sem_dado'); assert.match(r.signals[0], /Sem cards em aberto nem horas/);
});
test('carga: só cards em aberto estima pela quantidade, com confiança baixa', () => {
  const r = W.compute(ana, ctx({ items: [card('1'), card('2'), card('3', { sprintId: '' })] }));
  assert.equal(r.pct, 50); assert.equal(r.confidence, 'baixa'); assert.equal(r.level, 'saudavel');
});
test('carga: horas lançadas acima do esperado deixam crítico', () => {
  const r = W.compute(ana, ctx({ hours: horas(10, 10) })); // 100 h em 10 dias úteis (esperado 80 h) = 125%
  assert.equal(r.parts.hoursRatio, 125); assert.equal(r.pct, 125); assert.equal(r.level, 'critico'); assert.equal(r.confidence, 'média');
  assert.ok(r.signals.some(s => /média de 10 h por dia/.test(s)));
});
test('carga: horas e pontos × capacidade combinam (confiança alta)', () => {
  const r = W.compute(ana, ctx({ hours: horas(10, 8), items: [card('1', { points: 3 })], capacity: { Ana: 6 } })); // horas 100%, pontos 50% -> 75%
  assert.equal(r.pct, 75); assert.equal(r.confidence, 'alta'); assert.equal(r.level, 'atencao');
  assert.ok(r.signals.some(s => /3 pts para uma capacidade de 6 pts/.test(s)));
});
test('carga: prazo vencido, muitos cards em andamento e impedimento aumentam a pressão', () => {
  const items = [card('1', { status: 'doing', sprintId: 'S0' }), card('2', { status: 'doing' }), card('3', { status: 'review' }), card('4', { status: 'doing' }), card('5', { status: 'doing' })];
  const r = W.compute(ana, ctx({ items, sprints: [{ id: 'S0', state: 'encerrada', endOn: '2026-11-01' }, { id: 'S1', state: 'ativa', endOn: '2026-11-13' }], imps: [{ status: 'aberto', owner: 'ana' }] }));
  assert.equal(r.overdue, 1); assert.equal(r.doing, 5);
  assert.equal(r.parts.pressure, 6 + 10 + 5); // 1 vencido + 2 acima de 3 em andamento + 1 impedimento
  assert.ok(r.signals.some(s => /5 cards em andamento ao mesmo tempo/.test(s)) && r.signals.some(s => /prazo vencido/.test(s)) && r.signals.some(s => /impedimento aberto/.test(s)));
});
test('carga: alocação de 50% reduz pela metade as horas esperadas; nome sem acento e maiúscula casa; épico e concluído não contam', () => {
  const meia = W.compute({ id: 'a', name: 'ANA', allocationPct: 50 }, ctx({ hours: horas(10, 4) })); // 40 h de 40 h esperadas = 100%
  assert.equal(meia.parts.hoursRatio, 100);
  const r = W.compute({ id: 'j', name: 'José', allocationPct: 100 }, ctx({ items: [card('1', { assignee: 'jose' }), card('2', { assignee: 'Jose', status: 'done' }), card('E', { assignee: 'Jose', kind: 'epico' })] }));
  assert.equal(r.open, 1);
});
test('carga: 7 dias seguidos lançando horas é sinal de falta de folga', () => {
  const h = ['2026-11-11', '2026-11-10', '2026-11-09', '2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05'].map(d => ({ person: 'Ana', date: d, hours: 6, extra: 0 }));
  const r = W.compute(ana, ctx({ hours: h }));
  assert.ok(r.signals.some(s => /7 dias seguidos/.test(s)));
});
test('sugestão: quem está no limite passa o card menos prioritário para quem tem folga; sem folga, renegocia', () => {
  const bia = { id: 'b', name: 'Bia', allocationPct: 100 };
  const items = [card('1', { rank: 1 }), card('2', { rank: 5, points: 3 }), card('3', { rank: 2, assignee: 'Bia' })];
  const r = W.all([ana, bia], ctx({ items, hours: horas(10, 10), capacity: { Ana: 4, Bia: 20 } }));
  assert.ok(r.a.pct >= 85 && r.b.pct < 60);
  assert.equal(r.a.suggestion.cardId, '2'); assert.equal(r.a.suggestion.toName, 'Bia'); assert.match(r.a.suggestion.text, /Redistribuir: passe 2 — Card 2 \(3 pts\) para Bia/);
  assert.match(r.b.suggestion.text, /tem folga/);
  const sozinha = W.all([ana], ctx({ items, hours: horas(10, 10) }));
  assert.match(sozinha.a.suggestion.text, /Sem folga na equipe/);
});

test('Burnout automático e botões no cabeçalho: ligações no app', () => {
  for (const k of ["const Burnout = (() => {", 'function autoMap()', 'const effectivePct = m =>', 'function useAuto(id)', "pctRaw === '' ? null", 'workloadPct: wl == null ? null', "Burnout.effectivePct(m)", 'Voltar ao cálculo automático', 'calculado pelo sistema', 'Ajuste manual da carga (%) — opcional']) assert.ok(html.includes(k), k);
  assert.ok(!html.includes('os percentuais de carga são lançados manualmente'));
  assert.ok(!html.includes('id="burnout-f-signals"'));
  for (const k of ['const ModalPin = (() =>', '.mh-bar{position:sticky;top:0', 'function isFooter(d)', "ModalPin.pin(d)", "ModalPin.pin(m)"]) assert.ok(html.includes(k), k);
});
