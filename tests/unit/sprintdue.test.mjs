import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');

test('fim da sprint: aviso nas telas da sprint e decisão com três caminhos (estender, transbordar, devolver)', () => {
  for (const k of ['const dueSprint = ', 'a.endOn <= todayIso()', 'id="modal-sprint-due"', 'value="ext"', 'value="carry"', 'value="back"', 'Estender por mais uma semana', 'Agile.openDue(', 'weekAfter']) assert.ok(html.includes(k), k);
  assert.equal((html.match(/class="sprint-due-slot"/g) || []).length, 3, 'Kanban, Sprints e Sprint Atual');
  assert.ok(html.includes('WorkCal.nextWorking(d)'), 'a nova data de fim respeita o calendário de trabalho');
});

test('a extensão fica registrada na sprint (de, para, quem, quando, motivo) e vai para a nuvem', () => {
  assert.ok(html.includes('extensions:Array.isArray(x.extensions)') && html.includes('extensions:Array.isArray(r.extensions)'));
  assert.ok(readFileSync(join(root, 'supabase/migrations/20261102120000_sprint_extensions.sql'), 'utf8').includes('add column if not exists extensions jsonb'));
  assert.ok(html.includes('{ from: s.endOn, to, by: Auth.getName(), on: todayIso(), reason }'));
});
