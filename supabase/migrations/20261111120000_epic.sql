-- Épico: nível acima da História (Épico → História → Tarefa/Bug). Agrupa histórias e tarefas; não vai para o quadro, não tem responsável, pontos nem sprint.
-- A história/tarefa guarda o épico em epic_id (o bug continua ligado à entrega em parent_id). O progresso do épico é calculado das histórias ligadas.
alter table public.backlog_items drop constraint if exists backlog_items_kind_check;
alter table public.backlog_items add constraint backlog_items_kind_check check (kind in ('historia','bug','tarefa','epico'));
alter table public.backlog_items add column if not exists epic_id text check (epic_id is null or char_length(epic_id) between 1 and 60);
create index if not exists backlog_items_epic_idx on public.backlog_items(project_id, epic_id) where epic_id is not null;

create or replace function public.guard_epic() returns trigger as $$
declare k text;
begin
  if new.kind = 'epico' then
    new.epic_id := null; new.parent_id := null; new.sprint_id := null; new.assignee := null; new.points := null; new.status := 'todo';
    return new;
  end if;
  if new.kind = 'bug' then new.epic_id := null; return new; end if;
  if new.epic_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.epic_id is not distinct from new.epic_id then return new; end if;
  select kind into k from public.backlog_items where project_id = new.project_id and id = new.epic_id;
  if not found or k <> 'epico' then raise exception 'O épico % não existe neste projeto.', new.epic_id; end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists guard_epic on public.backlog_items;
create trigger guard_epic before insert or update on public.backlog_items
  for each row execute function public.guard_epic();

-- Ao excluir um épico, as histórias dele ficam sem épico (não são apagadas)
create or replace function public.epic_unlink() returns trigger as $$
begin
  if old.kind = 'epico' then
    update public.backlog_items set epic_id = null where project_id = old.project_id and epic_id = old.id;
  end if;
  return old;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists epic_unlink on public.backlog_items;
create trigger epic_unlink after delete on public.backlog_items
  for each row execute function public.epic_unlink();
