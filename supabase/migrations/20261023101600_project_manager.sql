-- Gerente responsável pelo projeto: além do Administrador, só ele inclui ou tira pessoas do projeto.
-- Sem gerente definido, só o Administrador mexe no acesso (nada é concedido por acidente a quem já existia).

alter table public.projects add column if not exists manager_id uuid references auth.users(id) on delete set null;

-- É o gerente responsável por este projeto? (precisa continuar com permissão de editar o plano)
create or replace function public.is_project_manager(pid text) returns boolean as $$
  select public.has_perm('edit_plan')
    and exists (select 1 from public.projects where id = pid and manager_id = auth.uid());
$$ language sql stable security definer;

-- É o gerente responsável por algum projeto? (libera ver a lista de contas para escolher quem incluir)
create or replace function public.is_any_project_manager() returns boolean as $$
  select public.has_perm('edit_plan') and exists (select 1 from public.projects where manager_id = auth.uid());
$$ language sql stable security definer;

-- Quem cria o projeto sendo gerente já nasce como responsável; trocar o responsável é só do Administrador.
create or replace function public.guard_project_manager() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    if new.manager_id is null and public.current_role() = 'gerente' then new.manager_id := auth.uid(); end if;
    if new.manager_id is not null and auth.uid() is not null and public.current_role() <> 'admin' and new.manager_id <> auth.uid() then
      raise exception 'Só o Administrador define outra pessoa como gerente responsável.';
    end if;
  elsif new.manager_id is distinct from old.manager_id and auth.uid() is not null and coalesce(public.current_role(), '') <> 'admin' then
    raise exception 'Só o Administrador troca o gerente responsável pelo projeto.';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists guard_project_manager on public.projects;
create trigger guard_project_manager before insert or update on public.projects
  for each row execute function public.guard_project_manager();

-- O gerente responsável vê, inclui e remove pessoas SÓ dos projetos dele (nunca remove a si mesmo)
create policy "project_access_manager_read" on public.project_access for select using (public.is_project_manager(project_id));
create policy "project_access_manager_insert" on public.project_access for insert
  with check (public.is_project_manager(project_id) and granted_by = auth.uid());
create policy "project_access_manager_update" on public.project_access for update
  using (public.is_project_manager(project_id)) with check (public.is_project_manager(project_id) and granted_by = auth.uid());
create policy "project_access_manager_delete" on public.project_access for delete
  using (public.is_project_manager(project_id) and user_id <> auth.uid());

-- Para escolher quem incluir, o gerente responsável precisa enxergar as contas (nome e perfil); só leitura
create policy "profiles_manager_select" on public.profiles for select using (public.is_any_project_manager());
