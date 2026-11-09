-- Fila de prioridade dos BUGS: bug_priority = posição na fila (1 = primeiro a corrigir) entre os bugs em aberto do projeto/quadro.
-- Cada posição vale para um bug só: ao encaixar um bug numa posição ocupada, os de baixo descem; ao sair da fila (concluído, outro tipo, excluído), os de baixo sobem.
alter table public.backlog_items add column if not exists bug_priority int check (bug_priority is null or bug_priority between 1 and 9999);
create index if not exists backlog_items_bug_priority_idx on public.backlog_items(project_id, bug_priority) where bug_priority is not null;

create or replace function public.bug_priority_queue() returns trigger as $$
declare oldp int; newp int; n int;
begin
  if pg_trigger_depth() > 1 then return new; end if; -- as correções de posição feitas aqui dentro não disparam de novo
  if tg_op = 'UPDATE' then
    if old.kind = 'bug' and old.status <> 'done' then oldp := old.bug_priority; end if;
  end if;
  if new.kind = 'bug' and new.status <> 'done' then newp := new.bug_priority; end if;
  if new.kind <> 'bug' or new.status = 'done' then new.bug_priority := null; end if;
  if oldp is not distinct from newp then return new; end if;
  if oldp is not null then
    update public.backlog_items set bug_priority = bug_priority - 1
      where project_id = new.project_id and id <> new.id and kind = 'bug' and status <> 'done' and bug_priority > oldp;
  end if;
  if newp is not null then
    select count(*) into n from public.backlog_items
      where project_id = new.project_id and id <> new.id and kind = 'bug' and status <> 'done' and bug_priority is not null;
    if newp > n + 1 then newp := n + 1; new.bug_priority := newp; end if; -- sem buracos na fila
    update public.backlog_items set bug_priority = bug_priority + 1
      where project_id = new.project_id and id <> new.id and kind = 'bug' and status <> 'done' and bug_priority >= newp;
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists bug_priority_queue on public.backlog_items;
create trigger bug_priority_queue before insert or update on public.backlog_items
  for each row execute function public.bug_priority_queue();

create or replace function public.bug_priority_gap() returns trigger as $$
begin
  if pg_trigger_depth() > 1 then return old; end if;
  if old.kind = 'bug' and old.status <> 'done' and old.bug_priority is not null then
    update public.backlog_items set bug_priority = bug_priority - 1
      where project_id = old.project_id and kind = 'bug' and status <> 'done' and bug_priority > old.bug_priority;
  end if;
  return old;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists bug_priority_gap on public.backlog_items;
create trigger bug_priority_gap after delete on public.backlog_items
  for each row execute function public.bug_priority_gap();
