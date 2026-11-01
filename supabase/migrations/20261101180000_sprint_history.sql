-- Histórico da sprint: o que foi devolvido ao backlog quando ela terminou (o que foi entregue já fica nos itens concluídos da sprint)
alter table public.sprints add column if not exists carried jsonb not null default '[]'::jsonb
  check (jsonb_typeof(carried) = 'array' and jsonb_array_length(carried) <= 500);
