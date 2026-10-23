// Mensagem de status copiável (tela "Mensagem de status"): usa a MESMA lógica de fatos do servidor, copiada para o app por
// scripts/sync-facts-client.mjs. Estes testes garantem que a cópia está em dia e que a mensagem respeita as regras de valores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeFacts as serverFacts } from '../../supabase/functions/_shared/facts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const block = name => { const m = html.match(new RegExp(`<script data-module="${name}">([\\s\\S]*?)<\\/script>`)); if (!m) throw new Error(name); return m[1]; };
const { SharedFacts, StatusMsg } = new Function(`${block('services/shared-facts')}\n${block('pages/statusmsg-js')}\nreturn { SharedFacts, StatusMsg };`)();

const input = name => ({
  project: { id: name, name, reference_date: '2026-06-20' },
  wbs: [{ id: 'm', label: 'Fase A', pct: 40, status: 'amb', start_date: '2026-04-01', end_date: '2026-06-10' }],
  budgetLines: [{ planned_value: 100000, wbs_module_id: 'm' }], costActuals: [{ kind: 'real', amount: 60000 }],
  decisions: [{ status: 'pending', severity: 'crit', title: 'Aprovar contrato com joao@x.com' }],
  risks: [{ status: 'aberto', score: 20, title: 'Fornecedor atrasa', owner_name: 'Ana' }],
  scope: [{ status: 'pending', impact_days: 5, impact_cost: 9000 }], team: [],
});
const now = new Date('2026-10-23T12:00:00Z');

test('a cópia da lógica no app está em dia com o servidor', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'sync-facts-client.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('cópia do app e servidor calculam exatamente os mesmos fatos', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(SharedFacts.computeFacts(input('P'), now))), JSON.parse(JSON.stringify(serverFacts(input('P'), now))));
});

test('mensagem detalhada: sem R$ por padrão, com dados do projeto e e-mail mascarado', () => {
  const t = StatusMsg.buildMessage([SharedFacts.computeFacts(input('Nexus'), now)], { mode: 'detalhado', money: false, today: '23/10/2026', greeting: 'Olá!' });
  assert.ok(t.startsWith('Olá!'));
  assert.ok(t.includes('*Nexus*') && t.includes('Fase A') && t.includes('Fornecedor atrasa'));
  assert.ok(!/R\$/.test(t), 'valor monetário vazou:\n' + t);
  assert.ok(!t.includes('joao@x.com') && t.includes('[E-MAIL REDACTADO]'));
});

test('valores em R$ só aparecem quando permitido', () => {
  const t = StatusMsg.buildMessage([SharedFacts.computeFacts(input('Nexus'), now)], { mode: 'detalhado', money: true, today: '23/10/2026' });
  assert.match(t, /R\$ 60\.000/); assert.match(t, /R\$ 100\.000/);
});

test('resumo: uma linha por projeto; sem projeto escolhido avisa', () => {
  const fs = [SharedFacts.computeFacts(input('A'), now), SharedFacts.computeFacts(input('B'), now)];
  const t = StatusMsg.buildMessage(fs, { mode: 'resumo', money: false, today: '23/10/2026' });
  assert.equal(t.split('\n').filter(l => /^(🟢|🟡|🔴|⚪)/.test(l) && !l.includes('no caminho')).length, 2);
  assert.ok(StatusMsg.buildMessage([], { today: 'x' }).includes('Nenhum projeto selecionado'));
});
