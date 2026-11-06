-- Entrar numa sprint também exige responsável cadastrado (pessoa ativa de Pessoas e Acesso com acesso ao projeto), como sair da primeira coluna.
-- Só vale na ENTRADA na sprint (de "sem sprint" para uma sprint): mover um item de uma sprint para outra (sobra de sprint) não é barrado.
create or replace function public.guard_item_assignee()
returns trigger as $$
declare o record; need boolean := false;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.status <> 'todo' and (new.status is distinct from old.status or new.assignee is distinct from old.assignee) then need := true; end if;
    if new.sprint_id is not null and old.sprint_id is null then need := true; end if;
  else
    -- o app grava com "inserir ou atualizar": se o cartão já existe, vale a comparação com o que está gravado
    select status, assignee, sprint_id into o from public.backlog_items where project_id = new.project_id and id = new.id;
    if found then
      if new.status <> 'todo' and (new.status is distinct from o.status or new.assignee is distinct from o.assignee) then need := true; end if;
      if new.sprint_id is not null and o.sprint_id is null then need := true; end if;
    else
      need := new.status <> 'todo' or new.sprint_id is not null;
    end if;
  end if;
  if not need then return new; end if;
  if coalesce(btrim(new.assignee), '') = '' then
    raise exception 'Para sair da primeira coluna ou entrar numa sprint, o cartão precisa de um responsável (pessoa cadastrada em Pessoas e Acesso, com acesso ao projeto).';
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
