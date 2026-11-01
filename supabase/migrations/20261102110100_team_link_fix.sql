-- Correção: o colaborador criado automaticamente precisa nascer ligado à conta (user_id).
create or replace function public._link_team_member(pid text, uid uuid) returns text as $$
declare nm text; tid text;
begin
  select p.name into nm from public.profiles p
    join public.access_profiles ap on ap.id = p.role
    where p.id = uid and p.role <> 'admin' and (ap.perms ->> 'update_own' = 'true' or ap.perms ->> 'log_hours' = 'true');
  if nm is null then return null; end if; -- perfil que só acompanha: não é da equipe
  select id into tid from public.team_members where project_id = pid and user_id = uid limit 1;
  if tid is not null then return tid; end if;
  select id into tid from public.team_members where project_id = pid and user_id is null and lower(btrim(name)) = lower(btrim(nm)) limit 1;
  if tid is not null then update public.team_members set user_id = uid where id = tid; return tid; end if;
  tid := 'tm-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into public.team_members(id, project_id, name, role, allocation_pct, workload_pct, signals, user_id) values (tid, pid, nm, null, null, null, '[]'::jsonb, uid);
  return tid;
end;
$$ language plpgsql security definer set search_path = public;
revoke all on function public._link_team_member(text, uuid) from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select project_id, user_id from public.project_access loop
    perform public._link_team_member(r.project_id, r.user_id);
  end loop;
end $$;
