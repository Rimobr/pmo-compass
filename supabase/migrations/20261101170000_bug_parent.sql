-- Todo BUG precisa estar ligado ao item (entrega) em que foi encontrado: o bug é "filho" desse item.
-- Regra só para bugs novos ou alterados (os já existentes continuam podendo mudar de coluna sem a ligação).
alter table public.backlog_items add column if not exists parent_id text check (parent_id is null or char_length(parent_id) between 1 and 60);
create index if not exists backlog_items_parent_idx on public.backlog_items(project_id, parent_id) where parent_id is not null;

create or replace function public.guard_bug_parent() returns trigger as $$
declare p public.backlog_items;
begin
  if new.kind <> 'bug' then new.parent_id := null; return new; end if;
  if tg_op = 'UPDATE' and old.kind = 'bug' and new.parent_id is not distinct from old.parent_id then return new; end if;
  if new.parent_id is null then raise exception 'Todo bug precisa estar ligado ao item (entrega) em que foi encontrado.'; end if;
  if new.parent_id = new.id then raise exception 'Um bug não pode ser filho dele mesmo.'; end if;
  select * into p from public.backlog_items where project_id = new.project_id and id = new.parent_id;
  if not found then raise exception 'O item pai % não existe neste projeto.', new.parent_id; end if;
  if p.kind = 'bug' then raise exception 'Um bug não pode ser filho de outro bug — ligue ao item de entrega.'; end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists guard_bug_parent on public.backlog_items;
create trigger guard_bug_parent before insert or update on public.backlog_items
  for each row execute function public.guard_bug_parent();
