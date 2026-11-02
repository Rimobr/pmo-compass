import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/board-rules">([\s\S]*?)<\/script>/);
const { BoardRules } = new Function(`${m[1]}\nreturn { BoardRules };`)();

const rule = (over = {}) => ({ id: 'r1', name: 'Teste', on: true, trigger: { type: 'enter', column: 'review' }, cond: {}, actions: [{ type: 'assign', who: 'Ana' }], ...over });

test('regra é saneada: ação inválida some, sem ação ou sem coluna a regra cai, limites respeitados', () => {
  const n = BoardRules.norm({ rules: [
    rule(),
    rule({ id: 'r2', actions: [{ type: 'assign', who: '' }, { type: 'inexistente' }] }),        // sem ação válida
    rule({ id: 'r3', trigger: { type: 'enter', column: '' } }),                                  // entra na coluna sem coluna
    rule({ id: 'r4', trigger: { type: 'sprint_end', days: 99 }, actions: [{ type: 'notify', to: 'manager', title: 'Sprint acabando' }] }),
    rule({ id: 'r5', actions: [{ type: 'notify', to: 'member', who: '', title: 'x' }] }),       // aviso a pessoa sem nome
    rule({ id: 'r6', actions: [{ type: 'set', field: 'kind', value: 'epico' }] })                // tipo inválido
  ] }).rules;
  assert.deepEqual(n.map(r => r.id), ['r1', 'r4']);
  assert.equal(n[1].trigger.days, 14);
  assert.equal(BoardRules.norm({ rules: Array.from({ length: 40 }, (_, i) => rule({ id: 'x' + i })) }).rules.length, 30);
  assert.equal(BoardRules.norm(null).rules.length, 0);
  assert.equal(BoardRules.norm({ rules: [rule({ actions: [{ type: 'set', field: 'points', value: '500' }] })] }).rules[0].actions[0].value, 100);
});

test('gatilho: coluna certa, evento certo, condições de tipo e de responsável, regra desligada nunca roda', () => {
  const r = BoardRules.norm({ rules: [rule({ cond: { kind: 'bug', unassigned: true } })] }).rules[0];
  assert.ok(BoardRules.matches(r, { type: 'enter', column: 'review' }, { kind: 'bug', assignee: '' }));
  assert.ok(!BoardRules.matches(r, { type: 'enter', column: 'doing' }, { kind: 'bug', assignee: '' }), 'outra coluna');
  assert.ok(!BoardRules.matches(r, { type: 'created' }, { kind: 'bug', assignee: '' }), 'outro evento');
  assert.ok(!BoardRules.matches(r, { type: 'enter', column: 'review' }, { kind: 'historia', assignee: '' }), 'outro tipo');
  assert.ok(!BoardRules.matches(r, { type: 'enter', column: 'review' }, { kind: 'bug', assignee: 'Ana' }), 'já tem responsável');
  const off = BoardRules.norm({ rules: [rule({ on: false })] }).rules[0];
  assert.ok(!BoardRules.matches(off, { type: 'enter', column: 'review' }, { kind: 'bug' }));
  const fim = BoardRules.norm({ rules: [rule({ trigger: { type: 'sprint_end', days: 2 }, actions: [{ type: 'notify', to: 'all', title: 'x' }] })] }).rules[0];
  assert.ok(!BoardRules.matches(fim, { type: 'sprint_end' }, {}), 'fim da sprint é por data, não por evento de item');
});

test('texto do aviso aceita as variáveis e ignora o resto', () => {
  assert.equal(BoardRules.fill('{id} foi para {coluna} ({responsavel}) {x}', { id: 'US-1', coluna: 'QA', responsavel: 'Ana' }), 'US-1 foi para QA (Ana) {x}');
});

test('ligações no app: ganchos, encadeamento limitado, avisos na tela e travas do servidor', () => {
  for (const k of ['let ruleDepth = 0', 'ruleDepth >= 3', '!seen.includes(r.id)', "fireRules({ type: 'enter', column: status }, it)", "fireRules({ type: 'created' }, it)", 'Agile.openRules()', 'id="modal-board-rules"', 'id="modal-notices"', 'id="tb-notices"', 'Cloud.notifyProject(', "client.rpc('notify_project'", 'user_notices']) assert.ok(html.includes(k), k);
  const sql = readFileSync(join(root, 'supabase/migrations/20261102130000_user_notices.sql'), 'utf8');
  for (const k of ['enable row level security', 'user_id = auth.uid()', 'has_project_access(pid)', "interval '20 hours'", 'Destino de aviso inválido']) assert.ok(sql.includes(k), k);
  assert.ok(!/create policy "[^"]*" on public\.user_notices for insert/.test(sql), 'ninguém insere aviso direto: só pela função');
});
