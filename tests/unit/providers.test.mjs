import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyMetaSignature, parseWhatsAppPayload } from '../../supabase/functions/_shared/providers.mjs';
import { hmacSha256Hex } from '../../supabase/functions/_shared/util.mjs';
import { unsubToken, verifyUnsubToken, isCron } from '../../supabase/functions/_shared/runtime.mjs';
import { loadFacts, findRecipientByWaId } from '../../supabase/functions/_shared/store.mjs';

test('assinatura da Meta: aceita a correta, recusa adulterada e ausente', async () => {
  const body = '{"entry":[]}';
  const sig = 'sha256=' + await hmacSha256Hex('app-secret', body);
  assert.ok(await verifyMetaSignature(body, sig, 'app-secret'));
  assert.ok(!await verifyMetaSignature(body + ' ', sig, 'app-secret'));
  assert.ok(!await verifyMetaSignature(body, sig, 'outro'));
  assert.ok(!await verifyMetaSignature(body, null, 'app-secret'));
  assert.ok(!await verifyMetaSignature(body, sig, ''));
  assert.ok(!await verifyMetaSignature(body, 'abc', 'app-secret'));
});

test('parseWhatsAppPayload: texto, botão e ignora recibos', () => {
  const payload = { entry: [{ changes: [{ value: {
    statuses: [{ id: 'x', status: 'delivered' }],
    messages: [
      { id: 'm1', from: '5511999998888', type: 'text', text: { body: 'Como está o Nexus?' }, timestamp: '1' },
      { id: 'm2', from: '5511999998888', type: 'button', button: { text: 'SIM' } },
      { id: 'm3', from: '5511999998888', type: 'image' },
      { from: '5511999998888', type: 'text', text: { body: 'sem id' } },
    ] } }] }] };
  const r = parseWhatsAppPayload(payload);
  assert.deepEqual(r.map(m => [m.id, m.text]), [['m1', 'Como está o Nexus?'], ['m2', 'SIM'], ['m3', '']]);
  assert.deepEqual(parseWhatsAppPayload({}), []);
});

test('token de descadastro e segredo do agendador', async () => {
  const env = { get: k => ({ CRON_SECRET: 'x'.repeat(32) })[k] };
  const t = await unsubToken(env, 'abc-123');
  assert.equal(await verifyUnsubToken(env, t), 'abc-123');
  assert.equal(await verifyUnsubToken(env, t.slice(0, -1) + (t.endsWith('0') ? '1' : '0')), null);
  assert.equal(await verifyUnsubToken(env, 'abc-123.'), null);
  const req = tok => ({ headers: { get: () => 'Bearer ' + tok } });
  assert.ok(isCron(req('x'.repeat(32)), env));
  assert.ok(!isCron(req('y'.repeat(32)), env));
  assert.ok(!isCron(req('x'), { get: () => 'x' }), 'segredo curto nunca vale');
});

// Cliente falso mínimo: devolve tabelas fixas e registra o filtro de cada consulta.
function fakeDb(tables) {
  const calls = [];
  const q = name => {
    const st = { name, filters: {} };
    const api = {
      select: () => api, order: () => api, limit: () => api,
      eq: (c, v) => { st.filters[c] = v; return api; },
      in: (c, v) => { st.filters[c] = v; return api; },
      then: (res, rej) => { calls.push(st); let rows = tables[name] || [];
        for (const [c, v] of Object.entries(st.filters)) rows = rows.filter(r => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v) || (name === 'projects' && c === 'id' && v.includes(r.id)));
        return Promise.resolve({ data: rows, error: null }).then(res, rej); },
    };
    return api;
  };
  return { from: q, calls };
}

test('loadFacts devolve só os projetos pedidos (escopo)', async () => {
  const db = fakeDb({
    projects: [{ id: 'a', name: 'A', reference_date: '2026-06-20' }, { id: 'b', name: 'B', reference_date: '2026-06-20' }],
    wbs_modules: [{ id: 'm', project_id: 'a', label: 'X', pct: 10, status: 'amb' }, { id: 'n', project_id: 'b', label: 'Y', pct: 90, status: 'grn' }],
  });
  const facts = await loadFacts(db, ['a'], new Date('2026-10-23'));
  assert.deepEqual(facts.map(f => f.project.id), ['a']);
  assert.equal(facts[0].schedule.avgPct, 10);
});

test('findRecipientByWaId tenta as variantes com e sem o 9º dígito', async () => {
  const db = fakeDb({ message_recipients: [{ id: 'r', whatsapp: '+5511999998888' }] });
  const spy = db.from; let seen;
  db.from = n => { const a = spy(n); const inFn = a.in; a.in = (c, v) => { seen = v; return inFn(c, v); }; return a; };
  const r = await findRecipientByWaId(db, '551199998888');
  assert.ok(seen.includes('+5511999998888') && seen.includes('+551199998888'));
  assert.equal(r?.id, 'r');
});
