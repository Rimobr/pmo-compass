import test from 'node:test';
import assert from 'node:assert/strict';
import { handleInbound, parseCommand, buildSystemPrompt, sanitizeAnswer } from '../../supabase/functions/_shared/assistant.mjs';
import { computeFacts } from '../../supabase/functions/_shared/facts.mjs';
import { buildDigest, nextAllowedTime, whatsappAlertParams } from '../../supabase/functions/_shared/notify.mjs';

const f1 = computeFacts({ project: { id: 'p1', name: 'Nexus', reference_date: '2026-06-20' }, wbs: [{ id: 'm', label: 'A', pct: 50, status: 'amb', start_date: '2026-01-01', end_date: '2026-12-01' }],
  budgetLines: [{ planned_value: 1000, wbs_module_id: 'm' }], costActuals: [{ kind: 'real', amount: 400 }] });
const mk = (over = {}) => ({ id: 'r1', name: 'Maria Souza', active: true, whatsapp_status: 'ativo', can_see_financials: false, ...over });
const mkDeps = (over = {}) => {
  const calls = { ai: 0, status: null };
  return { calls, deps: {
    allowedProjectIds: async () => ['p1'], loadFacts: async ids => { calls.loaded = ids; return [f1]; },
    setWhatsappStatus: async (_id, s) => { calls.status = s; }, countQuestions: async () => 0, recentTurns: async () => [],
    askAI: async () => { calls.ai++; return { text: 'Está *bem*. Custo R$ 400,00.' }; }, ...over } };
};

test('parseCommand: só mensagem inteira vira comando', () => {
  assert.equal(parseCommand('PARAR'), 'stop'); assert.equal(parseCommand(' Sim! '), 'confirm');
  assert.equal(parseCommand('como cancelar o escopo?'), null); assert.equal(parseCommand('Olá'), 'help');
});
test('antes do SIM nenhuma pergunta chega à IA', async () => {
  const { deps, calls } = mkDeps();
  const r = await handleInbound({ recipient: mk({ whatsapp_status: 'aguardando_confirmacao' }), text: 'como está o Nexus?', deps });
  assert.equal(r.kind, 'lembrete'); assert.equal(calls.ai, 0);
});
test('SIM ativa e PARAR descadastra; depois fica em silêncio', async () => {
  const { deps, calls } = mkDeps();
  let r = await handleInbound({ recipient: mk({ whatsapp_status: 'aguardando_confirmacao' }), text: 'sim', deps });
  assert.equal(r.kind, 'confirmacao'); assert.equal(calls.status, 'ativo');
  r = await handleInbound({ recipient: mk(), text: 'PARAR', deps });
  assert.equal(r.kind, 'descadastro'); assert.equal(calls.status, 'descadastrado');
  r = await handleInbound({ recipient: mk({ whatsapp_status: 'descadastrado' }), text: 'oi', deps });
  assert.deepEqual(r.replies, []); assert.equal(r.kind, 'ignorado');
});
test('escopo: só os projetos liberados são carregados', async () => {
  const { deps, calls } = mkDeps({ allowedProjectIds: async () => ['p1', 'p9'] });
  await handleInbound({ recipient: mk(), text: 'status do nexus?', deps });
  assert.deepEqual(calls.loaded, ['p1', 'p9']);
  const none = mkDeps({ allowedProjectIds: async () => [] });
  const r = await handleInbound({ recipient: mk(), text: 'status?', deps: none.deps });
  assert.equal(r.kind, 'sem_projetos'); assert.equal(none.calls.ai, 0);
});
test('sem permissão financeira: prompt sem R$ e resposta mascarada', async () => {
  const { deps } = mkDeps();
  const r = await handleInbound({ recipient: mk(), text: 'quanto gastamos no nexus?', deps });
  assert.ok(!/R\$/.test(r.replies[0]), r.replies[0]);
  assert.ok(!/R\$\s*\d/.test(buildSystemPrompt(mk(), [f1])), 'prompt sem valores monetários');
  assert.ok(/R\$\s*\d/.test(buildSystemPrompt(mk({ can_see_financials: true }), [f1])), 'com permissão, os valores entram');
});
test('limites: rajada/diário e falha da IA', async () => {
  let r = await handleInbound({ recipient: mk(), text: 'como vai o nexus?', deps: mkDeps({ countQuestions: async () => 99 }).deps });
  assert.equal(r.kind, 'limite');
  r = await handleInbound({ recipient: mk(), text: 'e o prazo?', deps: mkDeps({ askAI: async () => ({ error: 'x' }) }).deps });
  assert.equal(r.kind, 'erro_ia');
});
test('saída da IA é sanitizada', () => {
  assert.equal(sanitizeAnswer('## Título\n**forte** fale com a@b.com', mk()), 'Título\n*forte* fale com [E-MAIL REDACTADO]');
});
test('avisos: uma linha, sem R$ para quem não vê finanças, adiamento por silêncio', () => {
  const p = whatsappAlertParams({ event_type: 'risco_alto', detail: 'linha 1\nlinha 2 custo R$ 5.000' }, 'Nexus', mk());
  assert.equal(p.length, 3); assert.ok(p.every(x => !/[\n\r]/.test(x))); assert.ok(!/R\$|5\.000/.test(p[2]));
  assert.ok(buildDigest(mk(), [f1]).short.length <= 220);
  const t = nextAllowedTime(new Date('2026-10-23T01:30:00Z'), { quiet_start: 21, quiet_end: 7 }); // 22h30 em Brasília
  assert.ok(t > new Date('2026-10-23T01:30:00Z'));
});
