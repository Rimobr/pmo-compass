-- Lista de tarefas no cartão e regras de passagem do quadro (por projeto).
-- O cartão guarda [{ text, done }]; a regra "para sair de A (para B) conclua todas as tarefas" fica em project_settings.teamPolicy.gates: [{ from, to }].
-- O servidor impõe para o time: o texto das tarefas é da gestão, e a coluna de origem de uma regra só libera o cartão com todas as tarefas concluídas.
-- A gestão (gerente, Scrum Master, PO, administrador) pode mover mesmo assim; a tela exige o motivo e o grava no histórico.

alter table public.backlog_items add column if not exists checklist jsonb not null default '[]'::jsonb
  check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 20);

create or replace function public.backlog_items_member_guard()
returns trigger as $$
declare pol jsonb; locked jsonb; gates jsonb;
begin
  if auth.uid() is null or coalesce(public.has_perm('manage_backlog'), false) then return new; end if;
  if new.title is distinct from old.title or new.description is distinct from old.description or new.kind is distinct from old.kind
     or new.points is distinct from old.points or new.assignee is distinct from old.assignee or new.sprint_id is distinct from old.sprint_id
     or new.rank is distinct from old.rank or new.parent_id is distinct from old.parent_id
     or (select coalesce(jsonb_agg(c->'text'), '[]'::jsonb) from jsonb_array_elements(new.checklist) c)
        is distinct from (select coalesce(jsonb_agg(c->'text'), '[]'::jsonb) from jsonb_array_elements(old.checklist) c) then
    raise exception 'O time muda a situação do cartão, marca as tarefas, comenta e anexa evidências; título, estimativa, responsável, sprint e a lista de tarefas são da gestão.';
  end if;
  if new.status is distinct from old.status then
    pol := public.team_policy(new.project_id);
    locked := case when jsonb_typeof(pol->'lockedCols') = 'array' then pol->'lockedCols' else '[]'::jsonb end;
    if locked ? new.status then
      raise exception 'A coluna "%" é reservada à gestão do projeto (gerente, Scrum Master, PO ou administrador).', new.status;
    end if;
    if coalesce(pol->>'move', 'team') = 'managers' then
      raise exception 'Neste projeto só a gestão move os cartões.';
    end if;
    gates := case when jsonb_typeof(pol->'gates') = 'array' then pol->'gates' else '[]'::jsonb end;
    if exists (select 1 from jsonb_array_elements(gates) g where g->>'from' = old.status and coalesce(nullif(g->>'to', ''), new.status) = new.status)
       and exists (select 1 from jsonb_array_elements(new.checklist) c where coalesce((c->>'done')::boolean, false) = false) then
      raise exception 'Conclua todas as tarefas do cartão antes de sair de "%".', old.status;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
