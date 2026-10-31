-- Disponibilidade por pessoa em cada sprint (folgas, férias, ausências), usada no planejamento da capacidade.
-- Formato: {"Nome da pessoa": {"daysOff": 3}} — dias úteis em que a pessoa não trabalha na sprint.
alter table public.sprints add column if not exists availability jsonb not null default '{}'::jsonb
  check (jsonb_typeof(availability) = 'object' and pg_column_size(availability) < 20000);
