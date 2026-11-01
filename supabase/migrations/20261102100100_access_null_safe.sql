-- Correção: com perfil nulo (conta desconhecida ou inativa) `current_role() = 'admin'` é NULO, e "nulo ou falso" é nulo — dentro de uma função
-- `if not <nulo>` não barrava. Agora o acesso ao projeto devolve sempre verdadeiro ou falso.
create or replace function public.has_project_access(pid text)
returns boolean as $$
  select coalesce(public.current_role() = 'admin', false)
    or exists (select 1 from public.project_access where project_id = pid and user_id = auth.uid());
$$ language sql stable security definer;

create or replace function public.project_team(pid text)
returns table (id text, name text, role text, allocation_pct int) as $$
begin
  if not coalesce(public.has_project_access(pid), false) then raise exception 'Sem acesso a este projeto.'; end if;
  return query select t.id, t.name, t.role, t.allocation_pct from public.team_members t where t.project_id = pid order by t.name;
end;
$$ language plpgsql stable security definer set search_path = public;
