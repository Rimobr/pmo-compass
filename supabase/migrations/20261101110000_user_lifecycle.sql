-- Ciclo de vida do usuário: inativar (reversível, mantém o histórico) e trocar o responsável das atividades pendentes.
--  * Conta inativa: não entra mais (a função de borda também bloqueia o login no Auth) e perde, na hora, o perfil de acesso
--    (current_role() passa a devolver nulo), mesmo que o token ainda não tenha vencido.
--  * Trocar responsável: o Administrador, ou o gerente responsável pelo projeto, passa as atividades NÃO concluídas
--    (itens do backlog e tarefas/módulos do cronograma) de uma pessoa para outra — ou para "sem responsável".

alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles add column if not exists deactivated_at timestamptz;

-- Só o Administrador (ou o servidor) liga/desliga a conta; ninguém reativa a si mesmo
create or replace function public.guard_profile_active() returns trigger as $$
begin
  if new.active is distinct from old.active and auth.uid() is not null and coalesce(public.current_role(), '') <> 'admin' then
    new.active := old.active;
  end if;
  if new.active is distinct from old.active then
    new.deactivated_at := case when new.active then null else now() end;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists guard_profile_active on public.profiles;
create trigger guard_profile_active before update on public.profiles
  for each row execute function public.guard_profile_active();

-- Conta inativa não tem perfil: todas as regras que dependem do perfil passam a negar
create or replace function public.current_role()
returns text as $$
  select role from public.profiles where id = auth.uid() and active;
$$ language sql stable security definer;

-- Quantas atividades pendentes uma pessoa tem no projeto (para mostrar antes de trocar)
create or replace function public.pending_work(pid text, person text) returns jsonb as $$
declare b int; w int;
begin
  if not (public.current_role() = 'admin' or public.is_project_manager(pid)) then
    raise exception 'Só o Administrador ou o gerente responsável pelo projeto.';
  end if;
  select count(*) into b from public.backlog_items where project_id = pid and status <> 'done' and lower(btrim(assignee)) = lower(btrim(person));
  select (select count(*) from public.wbs_modules where project_id = pid and status <> 'grn' and lower(btrim(responsavel)) = lower(btrim(person)))
       + (select count(*) from public.wbs_tasks where project_id = pid and status <> 'grn' and lower(btrim(responsavel)) = lower(btrim(person))) into w;
  return jsonb_build_object('backlog', b, 'cronograma', w);
end;
$$ language plpgsql stable security definer set search_path = public;

-- Passa as atividades NÃO concluídas de uma pessoa para outra (to_person vazio = sem responsável). Concluídas não mudam.
create or replace function public.reassign_work(pid text, from_person text, to_person text) returns jsonb as $$
declare b int; m int; t int; dest text := nullif(btrim(coalesce(to_person, '')), '');
begin
  if not (public.current_role() = 'admin' or public.is_project_manager(pid)) then
    raise exception 'Só o Administrador ou o gerente responsável pelo projeto.';
  end if;
  if nullif(btrim(coalesce(from_person, '')), '') is null then raise exception 'Informe de quem as atividades serão tiradas.'; end if;
  if dest is not null and lower(dest) = lower(btrim(from_person)) then raise exception 'A pessoa de origem e a de destino são a mesma.'; end if;
  update public.backlog_items set assignee = dest, updated_at = now()
    where project_id = pid and status <> 'done' and lower(btrim(assignee)) = lower(btrim(from_person));
  get diagnostics b = row_count;
  update public.wbs_modules set responsavel = dest, updated_at = now()
    where project_id = pid and status <> 'grn' and lower(btrim(responsavel)) = lower(btrim(from_person));
  get diagnostics m = row_count;
  update public.wbs_tasks set responsavel = dest, updated_at = now()
    where project_id = pid and status <> 'grn' and lower(btrim(responsavel)) = lower(btrim(from_person));
  get diagnostics t = row_count;
  return jsonb_build_object('backlog', b, 'cronograma', m + t);
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.pending_work(text, text) to authenticated;
grant execute on function public.reassign_work(text, text, text) to authenticated;
