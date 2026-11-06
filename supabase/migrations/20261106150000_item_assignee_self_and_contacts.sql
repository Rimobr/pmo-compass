-- 1) Responsável do cartão: vale também a própria pessoa (conta ativa) com acesso ao projeto, pelo nome do cadastro em Pessoas e Acesso;
--    o administrador, que vê todos os projetos, não precisa de colaborador ligado para ser responsável.
create or replace function public.guard_item_assignee()
returns trigger as $$
declare o record;
begin
  if auth.uid() is null or new.status = 'todo' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status and new.assignee is not distinct from old.assignee then return new; end if;
  else
    select status, assignee into o from public.backlog_items where project_id = new.project_id and id = new.id;
    if found and o.status is not distinct from new.status and o.assignee is not distinct from new.assignee then return new; end if;
  end if;
  if coalesce(btrim(new.assignee), '') = '' then
    raise exception 'Da segunda coluna em diante o cartão precisa de um responsável (pessoa cadastrada em Pessoas e Acesso, com acesso ao projeto).';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.active
      and (p.role = 'admin' or exists (select 1 from public.project_access pa where pa.project_id = new.project_id and pa.user_id = p.id))
      and (lower(btrim(p.name)) = lower(btrim(new.assignee))
           or exists (select 1 from public.team_members tm where tm.project_id = new.project_id and tm.user_id = p.id and lower(btrim(tm.name)) = lower(btrim(new.assignee))))
  ) then
    raise exception '% não é uma pessoa com acesso ao sistema neste projeto. Cadastre em Pessoas e Acesso e dê acesso ao projeto.', new.assignee;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- 2) A quem pedir ajuda: gerente do projeto e administradores ativos (nome, papel e e-mail), só para quem tem acesso ao projeto
create or replace function public.project_contacts(pid text)
returns table (name text, label text, email text) as $$
begin
  if not coalesce(public.has_project_access(pid), false) then raise exception 'Sem acesso a este projeto.'; end if;
  return query
    select t.name, t.label, t.email from (
      select p.name::text as name, 'Gerente do projeto'::text as label, u.email::text as email, 1 as ord
        from public.projects pr join public.profiles p on p.id = pr.manager_id and p.active join auth.users u on u.id = p.id where pr.id = pid
      union all
      select p.name::text, 'Administrador'::text, u.email::text, 2
        from public.profiles p join auth.users u on u.id = p.id where p.role = 'admin' and p.active
    ) t order by t.ord, t.name;
end;
$$ language plpgsql stable security definer set search_path = public;
revoke all on function public.project_contacts(text) from public, anon;
grant execute on function public.project_contacts(text) to authenticated;
