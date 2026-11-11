-- O bug se liga à ENTREGA em que foi achado (história ou tarefa), nunca a um épico (agrupador).
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
  if p.kind = 'epico' then raise exception 'Um bug não pode ser filho de um épico — ligue à história ou tarefa em que foi encontrado.'; end if;
  return new;
end;
$$ language plpgsql set search_path = public;
