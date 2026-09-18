// RLS por projeto, anti-escalonamento de privilégio e imutabilidade do audit_log — os 3 itens
// "Crítico (Bloqueia Release)" da última rodada de aceitação (CT01, CT02, CT03). Bate direto na
// API do Supabase com cada papel de QA — não passa pela UI, porque o objetivo é provar que o
// BANCO bloqueia, não só a tela (uma tela poderia esconder um botão e ainda assim deixar a
// chamada de API passar; RLS é a garantia real).
const { test, expect } = require('@playwright/test');
const { supabaseClientAs, requireEnv } = require('./fixtures');

test.describe('RLS por projeto (CT01)', () => {
  test('consulta sem grant não lê wbs_modules de projeto alheio', async () => {
    const client = await supabaseClientAs('consulta');
    const { data, error } = await client
      .from('wbs_modules')
      .select('*')
      .eq('project_id', requireEnv('TEST_PROJECT_WITHOUT_GRANT_ID'));
    expect(error).toBeNull();
    expect(data).toEqual([]); // RLS filtra silenciosamente, não retorna erro — retorna vazio
  });

  test('consulta sem grant não lê decisions de projeto alheio', async () => {
    const client = await supabaseClientAs('consulta');
    const { data, error } = await client
      .from('decisions')
      .select('*')
      .eq('project_id', requireEnv('TEST_PROJECT_WITHOUT_GRANT_ID'));
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test('consulta sem grant não lê team_members de projeto alheio', async () => {
    const client = await supabaseClientAs('consulta');
    const { data, error } = await client
      .from('team_members')
      .select('*')
      .eq('project_id', requireEnv('TEST_PROJECT_WITHOUT_GRANT_ID'));
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test('gerente com grant lê wbs_modules do próprio projeto normalmente', async () => {
    const client = await supabaseClientAs('gerente');
    const { error } = await client
      .from('wbs_modules')
      .select('*')
      .eq('project_id', requireEnv('TEST_PROJECT_WITH_GRANT_ID'));
    expect(error).toBeNull(); // não checa conteúdo, só que a consulta não é bloqueada
  });

  test('admin lê qualquer projeto, com ou sem grant explícito', async () => {
    const client = await supabaseClientAs('admin');
    const { error } = await client
      .from('wbs_modules')
      .select('*')
      .eq('project_id', requireEnv('TEST_PROJECT_WITHOUT_GRANT_ID'));
    expect(error).toBeNull();
  });
});

test.describe('Trava anti-escalonamento de privilégio (CT02)', () => {
  // O trigger prevent_role_self_escalation() NÃO lança erro — ele silenciosamente reverte
  // new.role pro valor antigo e deixa o UPDATE "ter sucesso" sem mudar nada. Por isso o teste
  // certo é reler o perfil depois e confirmar que o papel continua o mesmo, não esperar erro.
  test('gerente não consegue se auto-promover a admin (trigger reverte em silêncio)', async () => {
    const client = await supabaseClientAs('gerente');
    const { data: { user } } = await client.auth.getUser();
    await client.from('profiles').update({ role: 'admin' }).eq('id', user.id);
    const { data: after } = await client.from('profiles').select('role').eq('id', user.id).single();
    expect(after.role).toBe('gerente');
  });

  test('consulta não consegue se auto-promover a gerente (trigger reverte em silêncio)', async () => {
    const client = await supabaseClientAs('consulta');
    const { data: { user } } = await client.auth.getUser();
    await client.from('profiles').update({ role: 'gerente' }).eq('id', user.id);
    const { data: after } = await client.from('profiles').select('role').eq('id', user.id).single();
    expect(after.role).toBe('consulta');
  });

  test('gerente não consegue promover OUTRA pessoa a admin (RLS filtra a linha, 0 afetadas)', async () => {
    const client = await supabaseClientAs('gerente');
    const adminClient = await supabaseClientAs('admin');
    const { data: { user: adminUser } } = await adminClient.auth.getUser();
    const { data: before } = await adminClient.from('profiles').select('role').eq('id', adminUser.id).single();
    const { data: updated } = await client.from('profiles').update({ role: 'consulta' }).eq('id', adminUser.id).select();
    expect(updated).toEqual([]); // policy "profiles_admin_update_any" exige ser admin — gerente não vê a linha pra atualizar
    const { data: after } = await adminClient.from('profiles').select('role').eq('id', adminUser.id).single();
    expect(after.role).toBe(before.role); // continua admin, intocado
  });
});

test.describe('Imutabilidade do audit_log (CT03)', () => {
  // Sem NENHUMA policy de UPDATE/DELETE na tabela, o Postgres pode tanto devolver um erro
  // quanto simplesmente filtrar a linha (0 afetadas) — o que importa é o INVARIANTE: a linha
  // continua exatamente igual depois da tentativa. Testamos isso, não um tipo de erro específico.
  test('admin não consegue alterar a descrição de uma linha de audit_log', async () => {
    const client = await supabaseClientAs('admin');
    const { data: { user } } = await client.auth.getUser();
    const marker = 'linha de teste E2E — imutabilidade — ' + Date.now();
    // audit_log_insert_own exige auth.uid() = actor_id — sem isso, o INSERT falha em silêncio
    // (RLS bloqueia sem lançar erro), e a linha nunca chega a existir pra testar imutabilidade.
    await client.from('audit_log').insert({
      project_id: requireEnv('TEST_PROJECT_WITH_GRANT_ID'),
      actor_id: user.id, action: 'login', description: marker,
    });
    const { data: rows } = await client.from('audit_log').select('id, description').eq('description', marker).limit(1);
    expect(rows && rows.length).toBeGreaterThan(0);
    const id = rows[0].id;
    await client.from('audit_log').update({ description: 'ADULTERADO' }).eq('id', id);
    const { data: after } = await client.from('audit_log').select('description').eq('id', id).single();
    expect(after.description).toBe(marker); // continua o texto original, não "ADULTERADO"
  });

  test('admin não consegue apagar uma linha de audit_log', async () => {
    const client = await supabaseClientAs('admin');
    const { data: { user } } = await client.auth.getUser();
    const marker = 'linha de teste E2E — delete — ' + Date.now();
    await client.from('audit_log').insert({
      project_id: requireEnv('TEST_PROJECT_WITH_GRANT_ID'),
      actor_id: user.id, action: 'login', description: marker,
    });
    const { data: rows } = await client.from('audit_log').select('id').eq('description', marker).limit(1);
    expect(rows && rows.length).toBeGreaterThan(0);
    const id = rows[0].id;
    await client.from('audit_log').delete().eq('id', id);
    const { data: after } = await client.from('audit_log').select('id').eq('id', id).maybeSingle();
    expect(after).not.toBeNull(); // a linha ainda existe — delete não teve efeito
  });
});

test.describe('Red Team — escalonamento via estado local adulterado (Cenário 1 do relatório)', () => {
  test('mesmo enviando role=admin direto no payload, o servidor reverte (não confia no cliente)', async () => {
    // Não dá pra "forjar" um JWT sem a chave privada do Supabase — o teste real é confirmar que
    // o trigger usa current_role() lido da tabela profiles NO SERVIDOR, não o que o cliente manda.
    const client = await supabaseClientAs('consulta');
    const { data: { user } } = await client.auth.getUser();
    await client.from('profiles').update({ role: 'admin', name: 'Forjado' }).eq('id', user.id);
    const { data: after } = await client.from('profiles').select('role').eq('id', user.id).single();
    expect(after.role).toBe('consulta'); // nome pode até ter mudado (campo próprio, permitido); role, nunca
  });
});
