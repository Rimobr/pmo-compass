// Tabelas novas (riscos, horas, escopo, mensagens): o BANCO precisa bloquear, não só a tela. Exige as migrações
// 20261023100100…100600 aplicadas (node scripts/db-apply.mjs). Dados de teste usam prefixo "qa-" e são removidos no fim.
const { test, expect } = require('@playwright/test');
const { supabaseClientAs, requireEnv } = require('./fixtures');

const WITH = () => requireEnv('TEST_PROJECT_WITH_GRANT_ID');
const WITHOUT = () => requireEnv('TEST_PROJECT_WITHOUT_GRANT_ID');
const stamp = Date.now().toString(36);

test.describe('Riscos, horas e escopo — RLS por projeto e por perfil', () => {
  for (const table of ['risks', 'time_entries', 'scope_changes']) {
    test(`consulta sem grant não lê ${table} de projeto alheio`, async () => {
      const c = await supabaseClientAs('consulta');
      const { data, error } = await c.from(table).select('*').eq('project_id', WITHOUT());
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  }

  test('consulta não consegue gravar risco (somente leitura)', async () => {
    const c = await supabaseClientAs('consulta');
    const { error } = await c.from('risks').insert({ project_id: WITH(), id: 'qa-' + stamp, title: 'qa risco', probability: 3, impact: 3 });
    expect(error).not.toBeNull();
  });

  test('gerente grava, lê e apaga risco do projeto liberado; nota = probabilidade × impacto calculada no banco', async () => {
    const c = await supabaseClientAs('gerente');
    const id = 'qa-' + stamp;
    const ins = await c.from('risks').insert({ project_id: WITH(), id, title: 'qa risco crítico', probability: 5, impact: 4 }).select().single();
    expect(ins.error).toBeNull();
    expect(ins.data.score).toBe(20);
    const bad = await c.from('risks').insert({ project_id: WITH(), id: id + 'x', title: 'qa inválido', probability: 6, impact: 1 });
    expect(bad.error).not.toBeNull();
    const del = await c.from('risks').delete().eq('project_id', WITH()).eq('id', id);
    expect(del.error).toBeNull();
  });

  test('gerente não grava horas em projeto sem grant; horas fora de 0–24 são recusadas', async () => {
    const c = await supabaseClientAs('gerente');
    const other = await c.from('time_entries').insert({ project_id: WITHOUT(), id: 'qa-' + stamp, person_name: 'QA Pessoa', work_date: '2026-06-01', hours: 8 });
    expect(other.error).not.toBeNull();
    const big = await c.from('time_entries').insert({ project_id: WITH(), id: 'qa-b' + stamp, person_name: 'QA Pessoa', work_date: '2026-06-01', hours: 30 });
    expect(big.error).not.toBeNull();
  });
});

test.describe('Mensagens (WhatsApp/e-mail) — dado pessoal de terceiros só do administrador', () => {
  for (const role of ['gerente', 'consulta']) {
    test(`${role} não lê nem grava destinatários, fila, log ou configuração`, async () => {
      const c = await supabaseClientAs(role);
      for (const t of ['message_recipients', 'message_recipient_projects', 'notification_outbox', 'message_log', 'messaging_settings']) {
        const { data, error } = await c.from(t).select('*').limit(5);
        expect(error).toBeNull();
        expect(data, `${role} leu ${t}`).toEqual([]);
      }
      const ins = await c.from('message_recipients').insert({ name: 'QA Alheio', whatsapp: '+5511900000001', consent_basis: 'qa', consent_recorded_at: new Date().toISOString() });
      expect(ins.error).not.toBeNull();
    });
  }

  test('administrador cria destinatário, mas NÃO consegue ativar o WhatsApp por conta própria', async () => {
    const c = await supabaseClientAs('admin');
    const phone = '+55119' + String(Date.now()).slice(-8);
    const ins = await c.from('message_recipients').insert({
      name: 'QA Destinatário', whatsapp: phone, consent_basis: 'qa automatizado', consent_recorded_at: new Date().toISOString(),
      whatsapp_status: 'ativo', // tentativa de pular a confirmação da pessoa
    }).select().single();
    expect(ins.error).toBeNull();
    expect(ins.data.whatsapp_status).toBe('aguardando_confirmacao'); // o gatilho reverte
    const upd = await c.from('message_recipients').update({ whatsapp_status: 'ativo' }).eq('id', ins.data.id);
    expect(upd.error).not.toBeNull(); // erro explícito ao tentar ativar numa edição
    await c.from('message_recipients').delete().eq('id', ins.data.id);
  });

  test('sem registro de consentimento nenhum canal pode ficar aguardando/ativo', async () => {
    const c = await supabaseClientAs('admin');
    const { error } = await c.from('message_recipients').insert({ name: 'QA Sem Consentimento', email: `qa-${stamp}@example.com`, email_status: 'ativo' });
    expect(error).not.toBeNull();
  });

  test('número de telefone fora do padrão internacional é recusado', async () => {
    const c = await supabaseClientAs('admin');
    const { error } = await c.from('message_recipients').insert({ name: 'QA Telefone', whatsapp: '11999998888', consent_basis: 'qa', consent_recorded_at: new Date().toISOString() });
    expect(error).not.toBeNull();
  });
});
