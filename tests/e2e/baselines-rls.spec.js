// Linha de base: o BANCO precisa garantir que ela é imutável e quem pode salvar/excluir. Dados de teste com prefixo "qa-bl-".
const { test, expect } = require('@playwright/test');
const { supabaseClientAs, requireEnv } = require('./fixtures');

const WITH = () => requireEnv('TEST_PROJECT_WITH_GRANT_ID');
const WITHOUT = () => requireEnv('TEST_PROJECT_WITHOUT_GRANT_ID');
const id = 'qa-bl-' + Date.now().toString(36);
const snap = { v: 1, wbs: [{ id: 'a', label: 'A', start: '2026-01-01', end: '2026-02-01', pct: 0, children: [] }], budget: [], approvedScope: [] };

test.describe.serial('Linha de base — imutável, e com permissões por perfil', () => {
  test('consulta não consegue salvar linha de base', async () => {
    const c = await supabaseClientAs('consulta');
    const { error } = await c.from('baselines').insert({ project_id: WITH(), id: id + 'c', name: 'qa consulta', snapshot: snap });
    expect(error).not.toBeNull();
  });

  test('gerente salva em projeto liberado, mas não em projeto sem grant', async () => {
    const c = await supabaseClientAs('gerente');
    const ok = await c.from('baselines').insert({ project_id: WITH(), id, name: 'qa linha de base', note: 'teste', snapshot: snap });
    expect(ok.error).toBeNull();
    const other = await c.from('baselines').insert({ project_id: WITHOUT(), id: id + 'x', name: 'qa alheio', snapshot: snap });
    expect(other.error).not.toBeNull();
  });

  test('ninguém altera uma linha de base salva (nem gerente, nem administrador)', async () => {
    for (const role of ['gerente', 'admin']) {
      const c = await supabaseClientAs(role);
      const { data } = await c.from('baselines').update({ name: 'ADULTERADA' }).eq('project_id', WITH()).eq('id', id).select();
      expect(data || [], `${role} alterou a linha de base`).toEqual([]);
    }
    const admin = await supabaseClientAs('admin');
    const { data } = await admin.from('baselines').select('name').eq('project_id', WITH()).eq('id', id).single();
    expect(data.name).toBe('qa linha de base');
  });

  test('gerente não exclui; administrador exclui', async () => {
    const g = await supabaseClientAs('gerente');
    const del1 = await g.from('baselines').delete().eq('project_id', WITH()).eq('id', id).select();
    expect(del1.data || []).toEqual([]);
    const a = await supabaseClientAs('admin');
    const del2 = await a.from('baselines').delete().eq('project_id', WITH()).eq('id', id).select();
    expect((del2.data || []).length).toBe(1);
  });

  test('consulta sem grant não lê linhas de base de projeto alheio', async () => {
    const c = await supabaseClientAs('consulta');
    const { data, error } = await c.from('baselines').select('*').eq('project_id', WITHOUT());
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
