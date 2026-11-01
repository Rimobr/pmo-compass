-- Correção: conta inativa (perfil nulo) passava na checagem "admin ou gerente responsável" porque `null = 'admin'` é nulo, não falso.
create or replace function public.pending_work(pid text, person text) returns jsonb as $$
declare b int; w int;
begin
  if not (coalesce(public.current_role(), '') = 'admin' or coalesce(public.is_project_manager(pid), false)) then
    raise exception 'Só o Administrador ou o gerente responsável pelo projeto.';
  end if;
  select count(*) into b from public.backlog_items where project_id = pid and status <> 'done' and lower(btrim(assignee)) = lower(btrim(person));
  select (select count(*) from public.wbs_modules where project_id = pid and status <> 'grn' and lower(btrim(responsavel)) = lower(btrim(person)))
       + (select count(*) from public.wbs_tasks where project_id = pid and status <> 'grn' and lower(btrim(responsavel)) = lower(btrim(person))) into w;
  return jsonb_build_object('backlog', b, 'cronograma', w);
end;
$$ language plpgsql stable security definer set search_path = public;

create or replace function public.reassign_work(pid text, from_person text, to_person text) returns jsonb as $$
declare b int; m int; t int; dest text := nullif(btrim(coalesce(to_person, '')), '');
begin
  if not (coalesce(public.current_role(), '') = 'admin' or coalesce(public.is_project_manager(pid), false)) then
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
