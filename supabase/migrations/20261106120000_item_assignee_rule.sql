-- Responsável do cartão: na primeira coluna (todo) pode ficar vazio; da segunda em diante tem de ser alguém da equipe do projeto.
-- A tela já avisa; aqui o banco impõe a mesma regra, para quem gravar direto pela API.
-- Só olha o que mudou (coluna ou responsável): cartão antigo que já estava fora da regra continua podendo receber comentário e anexo.
-- Scripts do administrador do banco (sem usuário logado) ficam de fora, como nas outras travas.
create or replace function public.guard_item_assignee()
returns trigger as $$
declare o record;
begin
  if auth.uid() is null or new.status = 'todo' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status and new.assignee is not distinct from old.assignee then return new; end if;
  else
    -- o app grava com "inserir ou atualizar": se o cartão já existe e nada mudou nesses dois campos, deixa passar
    select status, assignee into o from public.backlog_items where project_id = new.project_id and id = new.id;
    if found and o.status is not distinct from new.status and o.assignee is not distinct from new.assignee then return new; end if;
  end if;
  if coalesce(btrim(new.assignee), '') = '' then
    raise exception 'Da segunda coluna em diante o cartão precisa de um responsável (alguém da equipe do projeto).';
  end if;
  if not exists (select 1 from public.team_members tm where tm.project_id = new.project_id and lower(btrim(tm.name)) = lower(btrim(new.assignee))) then
    raise exception '% não está na equipe deste projeto. Escolha o responsável entre as pessoas cadastradas em Equipe.', new.assignee;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists guard_item_assignee on public.backlog_items;
create trigger guard_item_assignee before insert or update on public.backlog_items
  for each row execute function public.guard_item_assignee();

revoke all on function public.guard_item_assignee() from public, anon;
