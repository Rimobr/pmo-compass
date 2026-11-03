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
  assert.deepEqual(P(null), { move: 'team', lockedCols: [], noteCols: [], behalfNote: true, gates: [], template: [] });
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
test('a gestão move o cartão de outra pessoa informando o motivo (caso excepcional); dá para desligar', () => {
  assert.equal(P(null).behalfNote, true);
  assert.equal(P({ behalfNote: false }).behalfNote, false);
  for (const k of ['function confirmBehalf', 'id="modal-agile-behalf"', 'Movido pela gestão em nome de', 'Agile.setPolicyBehalf(']) assert.ok(html.includes(k), k);
});
test('a tela: sem permissão não há clique, arrasto nem seta; o time abre o cartão em modo atividade', () => {
  for (const k of ["const act = Auth.can('update_own')", 'canTouch(i, prev, true)', 'function applyItemMode', 'async function saveWork', 'id="ai-note"', 'id="ai-evid"', 'id="ab-move"', "'teamPolicy', pol", "DB.get('teamPolicy')", 'Autonomia do Time']) assert.ok(html.includes(k), k);
  assert.ok(html.includes('max-height:92vh;overflow-y:auto" role="dialog" aria-modal="true" aria-labelledby="ai-title-h"'), 'a janela do cartão rola');
  assert.ok(/Sair \/ Trocar Usuário/.test(html));
});
test('o servidor impõe a mesma política (inserção que já existe, colunas travadas, anexos)', () => {
  for (const k of ["key = 'teamPolicy'", 'team_can_touch_item', 'team_item_exists', 'backlog_items_member_guard', "locked ? new.status", '"item_files_insert"']) assert.ok(mig.includes(k), k);
  assert.ok(/security definer set search_path = public/.test(mig));
});

test('boas-vindas: aparece uma vez por conta (marca no servidor), não a cada atualização', () => {
  for (const k of ['async function markOnboarded', 'onboarded_at', 'function markSeen', 'show(); markSeen();', 'maybeShow(n + 1)']) assert.ok(html.includes(k), k);
  assert.ok(readdirSync(join(root, 'supabase/migrations')).some(f => f.includes('onboarded')));
});

test('ao entrar, o quadro é refeito depois que as configurações do projeto chegam (colunas criadas pela gestão não somem)', () => {
  const i = html.indexOf("settings.data.forEach(row => { if(row.key) DB.set(row.key, row.value || {}); });");
  assert.ok(i > 0);
  assert.ok(html.slice(i, i + 900).includes('Agile.resetCache(); Agile.render();'));
});

test('regra de passagem: sair da coluna exige todas as tarefas concluídas; sem tarefas ou sem regra não trava', () => {
  const p = P({ gates: [{ from: 'x1', to: 'review' }, { from: 'doing', to: '' }, { from: 'a', to: 'a' }, { from: '' }] });
  assert.equal(p.gates.length, 2);
  const list = [{ text: 'A', done: true }, { text: 'B', done: false }];
  assert.deepEqual(BoardRules.pendingFor(p, 'x1', 'review', list).map(x => x.text), ['B']);
  assert.equal(BoardRules.pendingFor(p, 'x1', 'doing', list).length, 0);          // destino fora da regra
  assert.equal(BoardRules.pendingFor(p, 'doing', 'done', list).length, 1);         // "qualquer coluna"
  assert.equal(BoardRules.pendingFor(p, 'x1', 'review', []).length, 0);            // cartão sem tarefas não é travado
  assert.equal(BoardRules.pendingFor(P(null), 'x1', 'review', list).length, 0);    // sem regra
  assert.deepEqual(P({ template: [' Executar  testes ', '', 'Anexar evidências'] }).template, ['Executar testes', 'Anexar evidências']);
});
test('a tela e o servidor das tarefas do cartão', () => {
  for (const k of ['id="ai-check"', 'function applyChecklist', 'function guardMove', 'Agile.checkToggle(', 'Agile.addGate()', 'Tarefas Padrão dos Cartões Novos', 'checklist:Array.isArray(x.checklist)', 'Mover com Tarefas Pendentes']) assert.ok(html.includes(k), k);
  const m2 = readFileSync(join(root, 'supabase/migrations', readdirSync(join(root, 'supabase/migrations')).find(f => f.includes('card_checklist'))), 'utf8');
  for (const k of ['add column if not exists checklist', "pol->'gates'", 'Conclua todas as tarefas do cartão', 'backlog_items_member_guard']) assert.ok(m2.includes(k), k);
});

test('o botão "impedimento aberto" do quadro abre a lista dos impedimentos, não leva a outra tela', () => {
  assert.ok(html.includes('onclick="Agile.openImpediments()"'));
  assert.ok(!html.includes("onclick=\"R.go('ritos')\"><i class=\"ti ti-alert-octagon\"></i>${open}"));
  for (const k of ['id="modal-agile-imp"', 'function resolveImpediment', "Auth.canOpen('ritos')"]) assert.ok(html.includes(k), k);
});

test('toda janela do sistema rola por dentro quando não cabe na tela (regra global do .modal-box)', () => {
  const css = html.match(/.modal-box{[^}]*}/)[0];
  assert.ok(/max-height:92vh/.test(css) && /overflow-y:auto/.test(css) && /dvh/.test(css));
});
