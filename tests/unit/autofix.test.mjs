import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/agile-calc">([\s\S]*?)<\/script>/);
const { AgileCalc } = new Function(`${m[1]}\nreturn { AgileCalc };`)();
const move = (to, by = 'Rita') => ({ at: '2026-11-26T10:00:00Z', by, field: 'Situação', from: 'x', to });
const took = (by = 'Claude Code (correção automática)') => ({ at: '2026-11-26T10:05:00Z', by, field: '', from: '', to: 'Comentário: Recebido pela correção automática em 26/11 10:05; em análise.' });
const bug = (status, history) => ({ id: 'B1', kind: 'bug', status, history });

test('correção automática: situação do bug lida do histórico', () => {
  assert.equal(AgileCalc.autoFixState(bug('doing', [move('Em andamento')]), true), 'wait');
  assert.equal(AgileCalc.autoFixState(bug('doing', []), true), 'wait');
  assert.equal(AgileCalc.autoFixState(bug('doing', [move('Em andamento'), took()]), true), 'working');
  // voltou para Em andamento depois de recebido: aguarda de novo
  assert.equal(AgileCalc.autoFixState(bug('doing', [move('Em andamento'), took(), move('A fazer'), move('Em andamento')]), true), 'wait');
  // comentário igual escrito por pessoa não conta como recebido
  assert.equal(AgileCalc.autoFixState(bug('doing', [move('Em andamento'), took('Rita')]), true), 'wait');
  assert.equal(AgileCalc.autoFixState(bug('review', [took(), move('Em revisão', 'Claude Code (correção automática)')]), true), 'fixed');
  assert.equal(AgileCalc.autoFixState(bug('review', [move('Em revisão', 'Rita')]), true), '');
});
test('correção automática: desligada, outro tipo ou outra situação não têm selo', () => {
  assert.equal(AgileCalc.autoFixState(bug('doing', []), false), '');
  assert.equal(AgileCalc.autoFixState({ kind: 'historia', status: 'doing', history: [] }, true), '');
  assert.equal(AgileCalc.autoFixState(bug('todo', []), true), '');
  assert.equal(AgileCalc.autoFixState(bug('done', []), true), '');
});
test('configuração do quadro: ligada e publicação automática por padrão; "approve" e desligada são respeitadas', () => {
  assert.deepEqual(AgileCalc.cfgOf(null).autoFix, { on: true, publish: 'auto' });
  assert.deepEqual(AgileCalc.cfgOf({ autoFix: { on: false, publish: 'approve' } }).autoFix, { on: false, publish: 'approve' });
  assert.deepEqual(AgileCalc.cfgOf({ autoFix: { publish: 'outra' } }).autoFix, { on: true, publish: 'auto' });
});
test('script: respeita a configuração do quadro e registra o primeiro contato', () => {
  const rb = readFileSync(join(root, 'scripts/read-bugs.mjs'), 'utf8');
  assert.ok(rb.includes("key = 'agileConfig'") && rb.includes('fix.on !== false'), 'lê a configuração');
  assert.ok(rb.includes("val('--take')") && rb.includes('Comentário: Recebido pela correção automática em '), 'primeiro contato');
  assert.ok(rb.includes('SÓ COM APROVAÇÃO (produção)'), 'informa a publicação');
});
test('próximo passo do bug: mover, aguardar, em análise, revisar, desligada ou nada', () => {
  const h = (status, history = [], c = null) => AgileCalc.autoFixHint(bug(status, history), c);
  assert.equal(h('todo'), 'move');
  assert.equal(h('doing'), 'wait');
  assert.equal(h('doing', [took()]), 'working');
  assert.equal(h('review', [move('Em revisão', 'Claude Code (correção automática)')]), 'fixed');
  assert.equal(h('review', [move('Em revisão', 'Rita')]), '');
  assert.equal(h('done'), '');
  assert.equal(h('todo', [], { autoFix: { on: false } }), 'off');
  assert.equal(h('doing', [], { autoFix: { on: false } }), 'off');
  assert.equal(AgileCalc.autoFixHint({ kind: 'historia', status: 'todo' }, null), '');
});
