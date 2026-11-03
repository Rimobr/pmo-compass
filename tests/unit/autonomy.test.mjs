import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/board-rules">([\s\S]*?)<\/script>/);
const { BoardRules } = new Function(`${m[1]}\nreturn { BoardRules };`)();
const mig = readFileSync(join(root, 'supabase/migrations', readdirSync(join(root, 'supabase/migrations')).find(f => f.includes('team_autonomy'))), 'utf8');

const P = over => BoardRules.normPolicy(over);
const ctx = o => ({ manager: false, member: true, mine: false, to: 'review', label: 'Em revisão', ...o });

test('política: sem nada gravado vale "todo o time"; valores inválidos são descartados', () => {
  assert.deepEqual(P(null), { move: 'team', lockedCols: [], noteCols: [] });
  assert.equal(P({ move: 'qualquer' }).move, 'team');
  assert.deepEqual(P({ lockedCols: ['done', 'done', '', 3] }).lockedCols, ['done', '3']);
});
test('o time move qualquer cartão por padrão (a TimeQA move o cartão do Leandro)', () => {
  assert.equal(BoardRules.canMove(P(null), ctx({ mine: false })).ok, true);
});
test('modo "só os meus cartões", "só a gestão" e coluna reservada recusam com o motivo', () => {
  assert.equal(BoardRules.canMove(P({ move: 'own' }), ctx({ mine: false })).ok, false);
  assert.equal(BoardRules.canMove(P({ move: 'own' }), ctx({ mine: true })).ok, true);
  assert.match(BoardRules.canMove(P({ move: 'managers' }), ctx()).why, /só a gestão/);
  const r = BoardRules.canMove(P({ lockedCols: ['done'] }), ctx({ to: 'done', label: 'Concluído' }));
  assert.equal(r.ok, false); assert.match(r.why, /Concluído.*reservada/);
});
test('a gestão nunca é limitada; perfil sem a permissão não move', () => {
  assert.equal(BoardRules.canMove(P({ move: 'managers', lockedCols: ['done'] }), ctx({ manager: true, to: 'done' })).ok, true);
  assert.equal(BoardRules.canMove(P(null), ctx({ member: false })).ok, false);
});
test('a tela: sem permissão não há clique, arrasto nem seta; o time abre o cartão em modo atividade', () => {
  for (const k of ["const act = Auth.can('update_own')", 'canTouch(i, prev, true)', 'function applyItemMode', 'async function saveWork', 'id="ai-note"', 'id="ai-evid"', 'id="ab-move"', "'teamPolicy', pol", "DB.get('teamPolicy')", 'Autonomia do time']) assert.ok(html.includes(k), k);
  assert.ok(/Sair \/ Trocar Usuário/.test(html));
});
test('o servidor impõe a mesma política (inserção que já existe, colunas travadas, anexos)', () => {
  for (const k of ["key = 'teamPolicy'", 'team_can_touch_item', 'team_item_exists', 'backlog_items_member_guard', "locked ? new.status", '"item_files_insert"']) assert.ok(mig.includes(k), k);
  assert.ok(/security definer set search_path = public/.test(mig));
});
