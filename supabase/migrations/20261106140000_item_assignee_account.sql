-- Responsável do cartão: da segunda coluna em diante tem de ser uma pessoa cadastrada em "Pessoas e Acesso" (conta ativa) com acesso ao projeto.
-- No cadastro, dar acesso ao projeto já cria o colaborador ligado à conta (ensure_team_member); a trava confere esse vínculo.
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
    select 1 from public.team_members tm join public.profiles p on p.id = tm.user_id and p.active
    where tm.project_id = new.project_id and lower(btrim(tm.name)) = lower(btrim(new.assignee))
      and (p.role = 'admin' or exists (select 1 from public.project_access pa where pa.project_id = tm.project_id and pa.user_id = tm.user_id))
  ) then
    raise exception '% não é uma pessoa com acesso ao sistema neste projeto. Cadastre em Pessoas e Acesso e dê acesso ao projeto.', new.assignee;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
