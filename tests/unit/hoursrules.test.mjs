import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/hours-rules">([\s\S]*?)<\/script>/);
const { HoursRules } = new Function(`${m[1]}\nreturn { HoursRules };`)();
const weekend = d => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w === 0 || w === 6; };
const R = o => HoursRules.norm(o);

test('regras vêm saneadas: padrões, limites e períodos fechados únicos e válidos', () => {
  const d = R(null);
  assert.deepEqual([d.dailyNormal, d.requireDelivery, d.approval, d.daysAfter.on, d.monthCutoff.on, d.closeOnDelivery], [8, true, 'all', false, false, false]);
  const r = R({ dailyNormal: '99', approval: 'xx', daysAfter: { on: true, days: -3 }, monthCutoff: { on: true, bd: 50 }, closedPeriods: [{ period: '2026-10' }, { period: '2026-10' }, { period: '2026-13' }, { period: 'abc' }] });
  assert.equal(r.dailyNormal, 24); assert.equal(r.approval, 'all'); assert.equal(r.daysAfter.days, 0); assert.equal(r.monthCutoff.bd, 20);
  assert.deepEqual(r.closedPeriods.map(p => p.period), ['2026-10']);
});

test('hora extra: o que passa das horas normais do dia, somando os outros apontamentos', () => {
  assert.equal(HoursRules.extraOf(0, 8, 8), 0);
  assert.equal(HoursRules.extraOf(0, 9, 8), 1);
  assert.equal(HoursRules.extraOf(6, 4, 8), 2);   // já tinha 6 h: dessas 4 h, 2 h passam
  assert.equal(HoursRules.extraOf(10, 3, 8), 3);  // dia já estourado: tudo é extra
  assert.equal(HoursRules.extraOf(0, 2.5, 2), 0.5);
});

test('situação inicial: gerente aprova o que lança; "só extras" deixa o resto passar; "nenhuma" aprova tudo', () => {
  assert.equal(HoursRules.statusFor(R({ approval: 'all' }), 0, false), 'pendente');
  assert.equal(HoursRules.statusFor(R({ approval: 'all' }), 0, true), 'aprovado');
  assert.equal(HoursRules.statusFor(R({ approval: 'extra' }), 0, false), 'aprovado');
  assert.equal(HoursRules.statusFor(R({ approval: 'extra' }), 1, false), 'pendente');
  assert.equal(HoursRules.statusFor(R({ approval: 'none' }), 3, false), 'aprovado');
});

test('prazos em dias úteis: X dias depois do dia trabalhado e até o N-ésimo dia útil do mês seguinte', () => {
  // 03/11/2026 é terça; 3 dias úteis depois (sem feriados) = sexta 06/11
  assert.equal(HoursRules.daysAfterDeadline('2026-11-03', 3, weekend), '2026-11-06');
  // sexta 06/11 + 1 dia útil = segunda 09/11 (pula o fim de semana)
  assert.equal(HoursRules.daysAfterDeadline('2026-11-06', 1, weekend), '2026-11-09');
  // 5º dia útil de dezembro/2026 (1º é terça): 1,2,3,4 e 7 → 07/12
  assert.equal(HoursRules.nthWorkingDay(2026, 12, 5, weekend), '2026-12-07');
  assert.equal(HoursRules.monthDeadline('2026-11-20', 5, weekend), '2026-12-07');
  assert.equal(HoursRules.monthDeadline('2026-12-10', 1, weekend), '2027-01-01'); // virada do ano (01/01/2027 é sexta)
});

test('conferência do lançamento: período fechado vale para todos; prazos e entrega encerrada o gerente supera', () => {
  const rules = R({ daysAfter: { on: true, days: 3 }, monthCutoff: { on: true, bd: 5 }, closeOnDelivery: true, closedPeriods: [{ period: '2026-09' }] });
  const base = { isOff: weekend, deliveryClosed: false };
  assert.equal(HoursRules.check(rules, { ...base, workDate: '2026-09-10', today: '2026-11-03', isManager: true }).code, 'periodo');
  assert.equal(HoursRules.check(rules, { ...base, workDate: '2026-09-10', today: '2026-11-03', isManager: false }).code, 'periodo');
  assert.equal(HoursRules.check(rules, { ...base, workDate: '2026-11-03', today: '2026-11-06', isManager: false }).ok, true, 'dentro de 3 dias úteis');
  const late = HoursRules.check(rules, { ...base, workDate: '2026-11-03', today: '2026-11-09', isManager: false });
  assert.equal(late.ok, false); assert.equal(late.code, 'prazo'); assert.equal(late.deadline, '2026-11-06');
  assert.equal(HoursRules.check(rules, { ...base, workDate: '2026-11-03', today: '2026-11-09', isManager: true }).ok, true, 'o gerente supera o prazo');
  assert.equal(HoursRules.check(rules, { ...base, workDate: '2026-11-03', today: '2026-11-04', isManager: false, deliveryClosed: true }).code, 'entrega');
  const so = R({ monthCutoff: { on: true, bd: 5 } });
  assert.equal(HoursRules.check(so, { ...base, workDate: '2026-10-20', today: '2026-11-06', isManager: false }).ok, true, 'ainda dentro do 5º dia útil de novembro (06/11)');
  assert.equal(HoursRules.check(so, { ...base, workDate: '2026-10-20', today: '2026-11-09', isManager: false }).code, 'mes');
});

test('ligações no app e no servidor', () => {
  for (const k of ['Escolha a entrega…', 'id="hr-extra-grp"', 'id="hr-appr-root"', 'id="hr-rules-root"', 'id="hr-close-root"', 'Hours.review(', 'Hours.closePeriod(', "pushProjectSetting(DB.getActiveProjectId(), 'hoursRules'", "'hours_period_close'", "'hours_review'", 'status:x.status||\'aprovado\'']) assert.ok(html.includes(k), k);
  const sql = readFileSync(join(root, 'supabase/migrations/20261103100000_hours_control.sql'), 'utf8');
  for (const k of ['time_entries_guard', 'Informe a entrega', 'Hora extra precisa do motivo', 'está fechado para lançamento', 'guard_hours_rules', "when mode = 'none' then 'aprovado'"]) assert.ok(sql.includes(k), k);
});
