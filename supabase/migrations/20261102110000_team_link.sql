-- Incluir uma pessoa de execução (time, Scrum Master, PO, gerente) em um projeto cria, ou reaproveita, o colaborador dela na equipe
-- e liga a conta a ele. Sem essa ligação o "Meu trabalho" não sabe quem é a pessoa. Quem só acompanha (patrocinador, consulta,
-- TI/suporte) não entra na equipe. O administrador e o gerente responsável pelo projeto fazem a ligação.

-- 1) Quem pode ligar uma conta a um colaborador: o administrador ou o gerente responsável (e falha FECHADO com perfil nulo)
create or replace function public.guard_member_link()
returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.user_id is not null) or (tg_op = 'UPDATE' and new.user_id is distinct from old.user_id) then
    if auth.uid() is not null and not (coalesce(public.current_role(), '') = 'admin' or coalesce(public.is_project_manager(new.project_id), false)) then
      raise exception 'Só o administrador ou o gerente responsável pelo projeto liga uma conta a um colaborador';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- 2) Cria/reaproveita o colaborador e liga a conta (uso interno; não é chamável pelo app)
create or replace function public._link_team_member(pid text, uid uuid) returns text as $$
declare nm text; tid text;
begin
  select p.name into nm from public.profiles p
    join public.access_profiles ap on ap.id = p.role
    where p.id = uid and (ap.perms ->> 'update_own' = 'true' or ap.perms ->> 'log_hours' = 'true' or p.role = 'admin') and p.role <> 'admin';
  if nm is null then return null; end if; -- perfil que só acompanha: não é da equipe
  select id into tid from public.team_members where project_id = pid and user_id = uid limit 1;
  if tid is not null then return tid; end if;
  select id into tid from public.team_members where project_id = pid and user_id is null and lower(btrim(name)) = lower(btrim(nm)) limit 1;
  if tid is not null then update public.team_members set user_id = uid where id = tid; return tid; end if;
  tid := 'tm-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into public.team_members(id, project_id, name, role, allocation_pct, workload_pct, signals) values (tid, pid, nm, null, null, null, '[]'::jsonb);
  return tid;
end;
$$ language plpgsql security definer set search_path = public;
revoke all on function public._link_team_member(text, uuid) from public, anon, authenticated;

-- 3) O que o app chama
create or replace function public.ensure_team_member(pid text, uid uuid) returns text as $$
begin
  if not (coalesce(public.current_role() = 'admin', false) or coalesce(public.is_project_manager(pid), false)) then
    raise exception 'Só o administrador ou o gerente responsável pelo projeto.';
  end if;
  if not exists (select 1 from public.project_access where project_id = pid and user_id = uid) then
    raise exception 'A pessoa não tem acesso a este projeto.';
  end if;
  return public._link_team_member(pid, uid);
end;
$$ language plpgsql security definer set search_path = public;
grant execute on function public.ensure_team_member(text, uuid) to authenticated;

-- 4) Quem já estava em projetos sem a ligação passa a ter
do $$
declare r record;
begin
  for r in select project_id, user_id from public.project_access loop
    perform public._link_team_member(r.project_id, r.user_id);
  end loop;
end $$;
