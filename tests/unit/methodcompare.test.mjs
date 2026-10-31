import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/method-compare">([\s\S]*?)<\/script>/);
const { MethodCompare } = new Function(`${m[1]}\nreturn { MethodCompare };`)();
const ORDER = ['agil', 'cascata', 'hibrido'];

test('resumo por metodologia: média de saúde, situação e dimensões', () => {
  const rows = [
    { id: 'a', name: 'A', method: 'agil', health: 90, dims: { schedule: 80, budget: 100, team: 90, quality: 70 }, criticalDecisions: 0 },
    { id: 'b', name: 'B', method: 'agil', health: 50, dims: { schedule: 40, budget: 60, team: 70, quality: 30 }, criticalDecisions: 2 },
    { id: 'c', name: 'C', method: 'cascata', health: null, dims: {}, criticalDecisions: 1 }];
  const s = MethodCompare.summarize(rows, ORDER);
  const ag = s.find(x => x.method === 'agil');
  assert.equal(ag.n, 2); assert.equal(ag.avgHealth, 70);
  assert.deepEqual(ag.counts, { grn: 1, amb: 0, red: 1, none: 0 });
  assert.equal(ag.dims.schedule, 60); assert.equal(ag.criticalDecisions, 2);
  const ca = s.find(x => x.method === 'cascata');
  assert.equal(ca.avgHealth, null); assert.equal(ca.counts.none, 1);
  assert.equal(s.find(x => x.method === 'hibrido').n, 0);
});

test('evolução: usa o último registro de cada projeto no dia e a média por método', () => {
  const methodOf = { p1: 'agil', p2: 'agil', p3: 'cascata' };
  const snaps = [
    { project_id: 'p1', captured_at: '2026-06-01T08:00:00Z', health_score: 40 }, { project_id: 'p1', captured_at: '2026-06-01T18:00:00Z', health_score: 60 },
    { project_id: 'p2', captured_at: '2026-06-01T09:00:00Z', health_score: 80 },
    { project_id: 'p1', captured_at: '2026-06-02T09:00:00Z', health_score: 70 }, { project_id: 'p2', captured_at: '2026-06-02T09:00:00Z', health_score: 90 },
    { project_id: 'p3', captured_at: '2026-06-02T09:00:00Z', health_score: 55 }, { project_id: 'p3', captured_at: '2026-06-03T09:00:00Z', health_score: null }];
  const ev = MethodCompare.evolution(snaps, pid => methodOf[pid], ORDER, 30);
  assert.deepEqual(ev.dates, ['2026-06-01', '2026-06-02']); // o registro sem nota (06-03) não vira um dia no gráfico
  assert.equal(ev.series.agil[0].avg, 70);   // (60 + 80) / 2 — o registro das 18h vale, não o das 8h
  assert.equal(ev.series.agil[1].avg, 80);
  assert.deepEqual(ev.delta.agil, { from: '2026-06-01', to: '2026-06-02', first: 70, last: 80, diff: 10 });
  assert.equal(ev.delta.cascata, null);       // só 1 dia com nota: não dá para falar em evolução
  assert.equal(ev.delta.hibrido, null);
});

test('evolução respeita o limite de dias e ignora projeto sem metodologia conhecida', () => {
  const snaps = [];
  for (let d = 1; d <= 40; d++) snaps.push({ project_id: 'p', captured_at: `2026-05-${String(Math.min(d, 28)).padStart(2, '0')}T10:00:00Z`.replace('2026-05', d > 28 ? '2026-06' : '2026-05'), health_score: d });
  snaps.push({ project_id: 'x', captured_at: '2026-06-01T10:00:00Z', health_score: 10 });
  const ev = MethodCompare.evolution(snaps, pid => pid === 'p' ? 'agil' : 'desconhecida', ORDER, 5);
  assert.ok(ev.dates.length <= 5);
});
