-- Histórico por card: quem mudou o quê e quando, sempre "de → para" (título, tipo, pontos, responsável, descrição, situação, sprint, prioridade).
-- Lista [{ at, by, field, from, to }] guardada no próprio item (até 300 registros; os mais antigos saem primeiro).
alter table public.backlog_items add column if not exists history jsonb not null default '[]'::jsonb
  check (jsonb_typeof(history) = 'array' and jsonb_array_length(history) <= 300);
