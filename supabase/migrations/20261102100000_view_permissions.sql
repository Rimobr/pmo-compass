-- Cada perfil vê o que precisa para o seu trabalho (e só isso). Três permissões novas de VISÃO:
--   view_portfolio   painéis de portfólio e diretoria (Painel da Diretoria, Visão Executiva, Visão do PMO, Indicadores, Portfólio, Priorização)
--   view_management  gestão do projeto (saúde, decisões da IA e da diretoria, riscos, escopo, linha de base, atas, repositório, chat com contexto completo)
--   view_team_load   carga de trabalho e sinais de burnout dos colegas (dado sensível das pessoas)
-- O menu esconde, MAS o banco também nega: quem não tem a permissão não lê essas tabelas nem pela API.

-- 1) Perfis prontos (os personalizados já existentes ficam sem as visões: menor privilégio; o Administrador marca o que quiser em Perfis de acesso)
update public.access_profiles set perms = perms || '{"view_portfolio":true,"view_management":true,"view_team_load":true}'::jsonb where id = 'gerente';
update public.access_profiles set perms = perms || '{"view_portfolio":true,"view_management":true}'::jsonb where id = 'patrocinador';
update public.access_profiles set perms = perms || '{"view_management":true}'::jsonb where id = 'po';
update public.access_profiles set perms = perms || '{"view_management":true,"view_team_load":true}'::jsonb where id = 'sm';
update public.access_profiles set perms = perms || '{"view_portfolio":true}'::jsonb where id = 'consulta';
update public.access_profiles set perms = perms || '{"view_portfolio":true,"view_management":true,"view_team_load":true}'::jsonb where id = 'admin';
update public.access_profiles set description = 'Atualiza as próprias atividades, aponta as próprias horas e registra impedimentos. Vê só o que é do seu trabalho: as suas entregas, o seu time e o que o projeto deve entregar. Não vê custos, painéis de gestão nem dados dos colegas.' where id = 'time';
update public.access_profiles set description = 'Somente leitura dos painéis executivos e do plano, sem custos nem dados das pessoas.' where id = 'consulta';

-- 2) O banco nega a leitura do que é gestão a quem não tem a visão
drop policy if exists "board_decisions_read" on public.board_decisions;
create policy "board_decisions_read" on public.board_decisions for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id) and public.has_perm('view_management'));
drop policy if exists "decisions_read" on public.decisions;
create policy "decisions_read" on public.decisions for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id) and public.has_perm('view_management'));
drop policy if exists "documents_read" on public.documents;
create policy "documents_read" on public.documents for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id) and public.has_perm('view_management'));
drop policy if exists "scope_changes_read" on public.scope_changes;
create policy "scope_changes_read" on public.scope_changes for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id) and public.has_perm('view_management'));
drop policy if exists "baselines_read" on public.baselines;
create policy "baselines_read" on public.baselines for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id) and public.has_perm('view_management'));
drop policy if exists "risks_read" on public.risks;
create policy "risks_read" on public.risks for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id) and public.has_perm('view_management'));
drop policy if exists "project_snapshots_read" on public.project_snapshots;
create policy "project_snapshots_read" on public.project_snapshots for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id) and public.has_perm('view_management'));

-- 3) Carga e sinais de burnout são dados das PESSOAS: só quem tem view_team_load lê a tabela inteira; cada um lê a própria linha
drop policy if exists "team_members_read" on public.team_members;
create policy "team_members_read" on public.team_members for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id)
    and (public.has_perm('view_team_load') or user_id = auth.uid()));

-- 4) "Quem é o meu time": nome, função e alocação de quem está no projeto — sem carga, sem sinais, sem recomendação
create or replace function public.project_team(pid text)
returns table (id text, name text, role text, allocation_pct int) as $$
begin
  if not public.has_project_access(pid) then raise exception 'Sem acesso a este projeto.'; end if;
  return query select t.id, t.name, t.role, t.allocation_pct from public.team_members t where t.project_id = pid order by t.name;
end;
$$ language plpgsql stable security definer set search_path = public;
grant execute on function public.project_team(text) to authenticated;
