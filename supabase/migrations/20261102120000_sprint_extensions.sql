-- Extensão da sprint: cada vez que o fim é estendido (de/para, quem, quando, motivo) fica registrado na própria sprint
alter table public.sprints add column if not exists extensions jsonb not null default '[]'::jsonb
  check (jsonb_typeof(extensions) = 'array' and jsonb_array_length(extensions) <= 50);
