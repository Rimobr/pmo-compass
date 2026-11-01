import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/work-calendar">([\s\S]*?)<\/script>/);
const { WorkCal } = new Function(`${m[1]}\nreturn { WorkCal };`)();

test('Páscoa e feriados móveis batem com o calendário oficial', () => {
  assert.equal(WorkCal.easter(2026), '2026-04-05');
  assert.equal(WorkCal.easter(2025), '2025-04-20');
  assert.equal(WorkCal.easter(2024), '2024-03-31');
  const n26 = Object.fromEntries(WorkCal.national(2026).map(h => [h.name, h.date]));
  assert.equal(n26['Sexta-feira Santa'], '2026-04-03');
  assert.equal(n26['Corpus Christi'], '2026-06-04');
  assert.equal(n26['Carnaval (terça-feira)'], '2026-02-17');
  assert.equal(n26['Tiradentes'], '2026-04-21');
  assert.equal(n26['Dia da Consciência Negra'], '2026-11-20');
});

test('fim de semana e feriado não são dias úteis; dia comum é', () => {
  assert.equal(WorkCal.reason('2026-11-01'), 'domingo');       // o caso do print: sprint começando num domingo
  assert.equal(WorkCal.reason('2026-11-14'), 'sábado');        // e terminando num sábado
  assert.match(WorkCal.reason('2026-11-02'), /feriado \(Finados\)/);
  assert.match(WorkCal.reason('2026-11-20'), /feriado \(Dia da Consciência Negra\)/);
  assert.equal(WorkCal.reason('2026-11-03'), '');
  assert.equal(WorkCal.reason('2026-11-13'), '');
  assert.equal(WorkCal.reason(''), '');
});

test('pontos facultativos (Carnaval, Corpus Christi) valem por padrão e podem ser desligados', () => {
  assert.match(WorkCal.reason('2026-02-17'), /ponto facultativo \(Carnaval/);
  assert.equal(WorkCal.reason('2026-02-17', { facultativos: false }), '');
  assert.match(WorkCal.reason('2026-04-03', { facultativos: false }), /feriado \(Sexta-feira Santa\)/); // feriado de verdade continua
});

test('feriado do projeto (estado, cidade, empresa) também bloqueia', () => {
  const cfg = WorkCal.addHoliday({}, { date: '2026-11-05', name: 'Aniversário da cidade' });
  assert.match(WorkCal.reason('2026-11-05', cfg), /feriado \(Aniversário da cidade\)/);
  assert.equal(WorkCal.reason('2026-11-05', WorkCal.removeHoliday(cfg, '2026-11-05')), '');
});

test('exceção autorizada libera o dia; remover a exceção bloqueia de novo', () => {
  const cfg = WorkCal.addException({}, { date: '2026-11-14', reason: 'Virada do sistema aos sábados', by: 'Ana' });
  assert.equal(WorkCal.reason('2026-11-14', cfg), '');
  assert.equal(WorkCal.reason('2026-11-15', cfg), 'domingo'); // a exceção vale só para o dia autorizado
  assert.equal(WorkCal.reason('2026-11-14', WorkCal.removeException(cfg, '2026-11-14')), 'sábado');
  assert.equal(cfg.exceptions[0].reason, 'Virada do sistema aos sábados');
});

test('próximo e anterior dia útil, e contagem de dias úteis (capacidade da sprint)', () => {
  assert.equal(WorkCal.nextWorking('2026-11-01'), '2026-11-03'); // domingo → segunda é Finados → terça
  assert.equal(WorkCal.prevWorking('2026-11-14'), '2026-11-13');
  // 01 a 14/11: 14 dias, 4 de fim de semana (1, 7, 8, 14) e o feriado de Finados (2) → 9 dias úteis
  assert.equal(WorkCal.workingDays('2026-11-01', '2026-11-14'), 9);
  assert.equal(WorkCal.workingDays('2026-11-03', '2026-11-13'), 9);
});

test('travas aplicadas onde as datas são atribuídas, e só o gerente autoriza exceção', () => {
  for (const k of ["WorkCal.ensureAll([start, end], 'O início e o fim da sprint')", "WorkCal.ensureAll([start, end], 'O início e o fim planejados')", "WorkCal.ensure(value, 'A data planejada')", 'ctx.offReason', 'id="wc-card"', 'Calendário de trabalho', 'AgileCalc.setOffDay']) assert.ok(html.includes(k), k);
  assert.ok(m[1].includes("Auth.can('edit_plan')") && m[1].includes('Justificativa curta demais'), 'exceção: só edit_plan e com justificativa de 10 letras');
  assert.ok(m[1].includes("calendar_exception"), 'a exceção vai para a auditoria');
});
