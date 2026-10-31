-- Perfis de acesso por PERMISSÃO (em vez de 4 papéis fixos) + perfis prontos do PMI e do Ágil + perfis personalizados.
--  * profiles.role passa a guardar o ID de um perfil de acesso (access_profiles.id). Os 4 papéis antigos continuam existindo
--    com o mesmo id e o mesmo poder (admin, gerente, consulta, manutencao), exceto: "consulta" deixa de ver custos e orçamento.
--  * has_perm('permissão') diz se a pessoa logada tem aquela permissão (administrador sempre tem todas).
--  * O time (Dev, QA, analista) atualiza SÓ o que é dele: itens e tarefas em que ele é o responsável e as próprias horas.
--    Para o banco saber quem é quem, a conta é vinculada ao colaborador (team_members.user_id), só o administrador vincula.

-- 1) Perfis de acesso -------------------------------------------------------------------------------------------------------
create table if not exists public.access_profiles (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  name text not null check (char_length(name) between 2 and 60),
  description text check (description is null or char_length(description) <= 300),
  family text not null default 'personalizado' check (family in ('geral','pmi','agil','personalizado')),
  is_system boolean not null default false,
  perms jsonb not null default '{}'::jsonb check (jsonb_typeof(perms) = 'object' and pg_column_size(perms) < 4000),
  created_at timestamptz not null default now()
);

insert into public.access_profiles (id, name, description, family, is_system, perms) values
  ('admin', 'Administrador', 'Tudo: acessos, perfis, configurações, limpeza e mensageria. Vê todos os projetos.', 'geral', true,
    '{"view_costs":true,"edit_plan":true,"edit_costs":true,"manage_backlog":true,"run_rites":true,"update_own":true,"log_hours":true,"view_all_hours":true,"approve_decisions":true,"create_projects":true,"manage_settings":true}'),
  ('gerente', 'Gerente de Projeto', 'Conduz plano, custos e equipe dos projetos liberados e cria projetos.', 'pmi', true,
    '{"view_costs":true,"edit_plan":true,"edit_costs":true,"manage_backlog":true,"run_rites":true,"update_own":true,"log_hours":true,"view_all_hours":true,"approve_decisions":true,"create_projects":true}'),
  ('patrocinador', 'Patrocinador / Diretoria', 'Acompanha tudo do projeto, inclusive custos, e aprova decisões. Não edita o plano.', 'pmi', true,
    '{"view_costs":true,"view_all_hours":true,"approve_decisions":true}'),
  ('po', 'Product Owner', 'Prioriza e estima o backlog, conduz a revisão e aceita as entregas.', 'agil', true,
    '{"manage_backlog":true,"run_rites":true,"update_own":true}'),
  ('sm', 'Scrum Master', 'Conduz sprints, ritos, impedimentos e o quadro.', 'agil', true,
    '{"manage_backlog":true,"run_rites":true,"update_own":true,"log_hours":true,"view_all_hours":true}'),
  ('time', 'Membro do time (Dev, QA, analista)', 'Atualiza as próprias atividades, aponta as próprias horas e registra impedimentos. Não vê custos.', 'geral', true,
    '{"update_own":true,"log_hours":true}'),
  ('consulta', 'Consulta (stakeholder)', 'Somente leitura, sem custos.', 'geral', true, '{}'),
  ('manutencao', 'TI / Suporte', 'Configurações do sistema (chaves de IA, integrações, backup). Lê como consulta.', 'geral', true, '{"manage_settings":true}')
on conflict (id) do nothing;

alter table public.access_profiles enable row level security;
create policy "access_profiles_read" on public.access_profiles for select using (auth.role() = 'authenticated');
create policy "access_profiles_insert" on public.access_profiles for insert
  with check (public.current_role() = 'admin' and is_system = false);
create policy "access_profiles_update" on public.access_profiles for update
  using (public.current_role() = 'admin' and id <> 'admin') with check (public.current_role() = 'admin' and id <> 'admin');
create policy "access_profiles_delete" on public.access_profiles for delete
  using (public.current_role() = 'admin' and is_system = false);
grant select, insert, update, delete on public.access_profiles to authenticated;
revoke all on public.access_profiles from anon;

-- 2) profiles.role passa a apontar para um perfil de acesso -----------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_fk foreign key (role) references public.access_profiles(id) on update cascade on delete restrict;

-- 3) Funções de permissão ---------------------------------------------------------------------------------------------------
create or replace function public.has_perm(p text)
returns boolean as $$
  select public.current_role() = 'admin'
    or coalesce((select (ap.perms ->> p) = 'true' from public.access_profiles ap where ap.id = public.current_role()), false);
$$ language sql stable security definer;

-- 4) Vínculo da conta com o colaborador (só administrador vincula) ---------------------------------------------------------
alter table public.team_members add column if not exists user_id uuid references auth.users(id) on delete set null;
create unique index if not exists team_members_user_uidx on public.team_members(project_id, user_id) where user_id is not null;

create or replace function public.is_my_member(pid text, nm text)
returns boolean as $$
  select nm is not null and exists (select 1 from public.team_members tm where tm.project_id = pid and tm.user_id = auth.uid() and tm.name = nm);
$$ language sql stable security definer;

create or replace function public.guard_member_link()
returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.user_id is not null) or (tg_op = 'UPDATE' and new.user_id is distinct from old.user_id) then
    if public.current_role() <> 'admin' then
      raise exception 'Só o administrador pode vincular uma conta a um colaborador';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;
drop trigger if exists team_members_guard_link on public.team_members;
create trigger team_members_guard_link before insert or update on public.team_members for each row execute procedure public.guard_member_link();

-- 5) Regras de escrita por permissão (o que cada perfil pode gravar) ---------------------------------------------------------
-- Plano: WBS, mudanças de escopo, riscos, RACI, documentos, equipe, linha de base
drop policy if exists "wbs_modules_write" on public.wbs_modules;
create policy "wbs_modules_write" on public.wbs_modules for all
  using (public.has_perm('edit_plan') and public.has_project_access(project_id)) with check (public.has_perm('edit_plan') and public.has_project_access(project_id));

drop policy if exists "wbs_tasks_write" on public.wbs_tasks;
create policy "wbs_tasks_insert" on public.wbs_tasks for insert
  with check (public.has_project_access(project_id) and (public.has_perm('edit_plan') or (public.has_perm('update_own') and public.is_my_member(project_id, responsavel))));
create policy "wbs_tasks_update" on public.wbs_tasks for update
  using (public.has_project_access(project_id) and (public.has_perm('edit_plan') or (public.has_perm('update_own') and public.is_my_member(project_id, responsavel))))
  with check (public.has_project_access(project_id) and (public.has_perm('edit_plan') or (public.has_perm('update_own') and public.is_my_member(project_id, responsavel))));
create policy "wbs_tasks_delete" on public.wbs_tasks for delete
  using (public.has_perm('edit_plan') and public.has_project_access(project_id));

drop policy if exists "decisions_write" on public.decisions;
create policy "decisions_write" on public.decisions for all
  using ((public.has_perm('edit_plan') or public.has_perm('approve_decisions')) and public.has_project_access(project_id))
  with check ((public.has_perm('edit_plan') or public.has_perm('approve_decisions')) and public.has_project_access(project_id));

drop policy if exists "documents_write" on public.documents;
create policy "documents_write" on public.documents for all
  using (public.has_perm('edit_plan') and public.has_project_access(project_id)) with check (public.has_perm('edit_plan') and public.has_project_access(project_id));

drop policy if exists "scope_changes_write" on public.scope_changes;
create policy "scope_changes_write" on public.scope_changes for all
  using (public.has_perm('edit_plan') and public.has_project_access(project_id)) with check (public.has_perm('edit_plan') and public.has_project_access(project_id));

drop policy if exists "risks_write" on public.risks;
create policy "risks_write" on public.risks for all
  using (public.has_perm('edit_plan') and public.has_project_access(project_id)) with check (public.has_perm('edit_plan') and public.has_project_access(project_id));

drop policy if exists "baselines_insert" on public.baselines;
create policy "baselines_insert" on public.baselines for insert
  with check (public.has_perm('edit_plan') and public.has_project_access(project_id));

drop policy if exists "raci_insert" on public.raci_entries;
drop policy if exists "raci_update" on public.raci_entries;
drop policy if exists "raci_delete" on public.raci_entries;
create policy "raci_insert" on public.raci_entries for insert with check (public.has_perm('edit_plan') and public.has_project_access(project_id));
create policy "raci_update" on public.raci_entries for update
  using (public.has_perm('edit_plan') and public.has_project_access(project_id)) with check (public.has_perm('edit_plan') and public.has_project_access(project_id));
create policy "raci_delete" on public.raci_entries for delete using (public.has_perm('edit_plan') and public.has_project_access(project_id));

drop policy if exists "team_members_write" on public.team_members;
create policy "team_members_write" on public.team_members for all
  using (public.has_perm('edit_plan') and public.has_project_access(project_id)) with check (public.has_perm('edit_plan') and public.has_project_access(project_id));

-- Custos e orçamento: só quem tem a permissão enxerga e edita (o time e a consulta não veem)
drop policy if exists "budget_lines_read" on public.budget_lines;
drop policy if exists "budget_lines_write" on public.budget_lines;
create policy "budget_lines_read" on public.budget_lines for select using (public.has_project_access(project_id) and public.has_perm('view_costs'));
create policy "budget_lines_write" on public.budget_lines for all
  using (public.has_perm('edit_costs') and public.has_project_access(project_id)) with check (public.has_perm('edit_costs') and public.has_project_access(project_id));
drop policy if exists "cost_actuals_read" on public.cost_actuals;
drop policy if exists "cost_actuals_write" on public.cost_actuals;
create policy "cost_actuals_read" on public.cost_actuals for select using (public.has_project_access(project_id) and public.has_perm('view_costs'));
create policy "cost_actuals_write" on public.cost_actuals for all
  using (public.has_perm('edit_costs') and public.has_project_access(project_id)) with check (public.has_perm('edit_costs') and public.has_project_access(project_id));

-- Configurações do projeto e decisões da diretoria
drop policy if exists "project_settings_write" on public.project_settings;
create policy "project_settings_write" on public.project_settings for all
  using ((public.has_perm('edit_plan') or public.has_perm('manage_backlog') or public.has_perm('run_rites')) and public.has_project_access(project_id))
  with check ((public.has_perm('edit_plan') or public.has_perm('manage_backlog') or public.has_perm('run_rites')) and public.has_project_access(project_id));
drop policy if exists "board_decisions_write" on public.board_decisions;
create policy "board_decisions_write" on public.board_decisions for all
  using ((public.has_perm('approve_decisions') or public.has_perm('edit_plan')) and public.has_project_access(project_id))
  with check ((public.has_perm('approve_decisions') or public.has_perm('edit_plan')) and public.has_project_access(project_id));
drop policy if exists "project_docs_write" on public.project_docs;
create policy "project_docs_write" on public.project_docs for all
  using ((public.has_perm('edit_plan') or public.has_perm('run_rites')) and public.has_project_access(project_id))
  with check ((public.has_perm('edit_plan') or public.has_perm('run_rites')) and public.has_project_access(project_id));

-- Ágil: backlog (o time mexe só no que é dele), sprints, ritos e impedimentos
drop policy if exists "backlog_items_write" on public.backlog_items;
create policy "backlog_items_insert" on public.backlog_items for insert
  with check (public.has_project_access(project_id) and (public.has_perm('manage_backlog') or (public.has_perm('update_own') and public.is_my_member(project_id, assignee))));
create policy "backlog_items_update" on public.backlog_items for update
  using (public.has_project_access(project_id) and (public.has_perm('manage_backlog') or (public.has_perm('update_own') and public.is_my_member(project_id, assignee))))
  with check (public.has_project_access(project_id) and (public.has_perm('manage_backlog') or (public.has_perm('update_own') and public.is_my_member(project_id, assignee))));
create policy "backlog_items_delete" on public.backlog_items for delete
  using (public.has_perm('manage_backlog') and public.has_project_access(project_id));

drop policy if exists "sprints_write" on public.sprints;
create policy "sprints_write" on public.sprints for all
  using ((public.has_perm('manage_backlog') or public.has_perm('run_rites')) and public.has_project_access(project_id))
  with check ((public.has_perm('manage_backlog') or public.has_perm('run_rites')) and public.has_project_access(project_id));
drop policy if exists "sprint_rites_write" on public.sprint_rites;
create policy "sprint_rites_write" on public.sprint_rites for all
  using (public.has_perm('run_rites') and public.has_project_access(project_id)) with check (public.has_perm('run_rites') and public.has_project_access(project_id));

drop policy if exists "impediments_write" on public.impediments;
create policy "impediments_insert" on public.impediments for insert
  with check ((public.has_perm('run_rites') or public.has_perm('update_own')) and public.has_project_access(project_id));
create policy "impediments_update" on public.impediments for update
  using ((public.has_perm('run_rites') or public.has_perm('update_own')) and public.has_project_access(project_id))
  with check ((public.has_perm('run_rites') or public.has_perm('update_own')) and public.has_project_access(project_id));
create policy "impediments_delete" on public.impediments for delete
  using (public.has_perm('run_rites') and public.has_project_access(project_id));

-- Horas: cada pessoa lança e vê as próprias; quem tem "ver horas de todos" vê tudo; quem edita o plano corrige as de qualquer um
drop policy if exists "time_entries_read" on public.time_entries;
drop policy if exists "time_entries_write" on public.time_entries;
create policy "time_entries_read" on public.time_entries for select
  using (public.has_project_access(project_id) and (public.has_perm('view_all_hours') or created_by = auth.uid()));
create policy "time_entries_insert" on public.time_entries for insert
  with check (public.has_project_access(project_id) and (public.has_perm('log_hours') or public.has_perm('edit_plan')) and created_by = auth.uid());
create policy "time_entries_update" on public.time_entries for update
  using (public.has_project_access(project_id) and ((created_by = auth.uid() and public.has_perm('log_hours')) or public.has_perm('edit_plan')))
  with check (public.has_project_access(project_id) and ((created_by = auth.uid() and public.has_perm('log_hours')) or public.has_perm('edit_plan')));
create policy "time_entries_delete" on public.time_entries for delete
  using (public.has_project_access(project_id) and ((created_by = auth.uid() and public.has_perm('log_hours')) or public.has_perm('edit_plan')));

-- Projetos: quem cria, quem edita e quem exclui
drop policy if exists "projects_write" on public.projects;
create policy "projects_insert" on public.projects for insert with check (public.has_perm('create_projects'));
create policy "projects_update" on public.projects for update
  using (public.has_perm('edit_plan') and public.has_project_access(id)) with check (public.has_perm('edit_plan') and public.has_project_access(id));
create policy "projects_delete" on public.projects for delete using (public.current_role() = 'admin');

drop policy if exists "project_access_self_grant" on public.project_access;
create policy "project_access_self_grant" on public.project_access for insert
  with check (user_id = auth.uid() and public.has_perm('create_projects'));

-- Excluir um projeto inteiro (administrador) precisa apagar também o histórico de fotos de saúde
create policy "project_snapshots_admin_delete" on public.project_snapshots for delete using (public.current_role() = 'admin');
