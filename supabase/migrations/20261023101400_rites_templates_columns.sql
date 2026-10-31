-- 1) Quadro Kanban personalizável: a coluna do item deixa de ser uma lista fixa de 4 valores.
--    O nome técnico da coluna (ex.: "todo", "doing", "x1") é livre (até 30 caracteres); "done" continua sendo a coluna de concluído.
alter table public.backlog_items drop constraint if exists backlog_items_status_check;
alter table public.backlog_items add constraint backlog_items_status_check check (char_length(status) between 1 and 30);

-- 2) Ritos da sprint (planejamento, daily, revisão, retrospectiva, refinamento): um registro por rito e por sprint.
--    "data" guarda o conteúdo estruturado de cada rito (cartões da retrospectiva, feedback da revisão etc.).
create table if not exists public.sprint_rites (
  project_id text not null references public.projects(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 60),
  sprint_id text not null check (char_length(sprint_id) between 1 and 60),
  kind text not null check (kind in ('planejamento','daily','revisao','retrospectiva','refinamento')),
  held_on date,
  attendees text check (attendees is null or char_length(attendees) <= 500),
  notes text check (notes is null or char_length(notes) <= 4000),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 200000),
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

-- 3) Impedimentos (o que trava o time), tratados na reunião diária.
create table if not exists public.impediments (
  project_id text not null references public.projects(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 60),
  title text not null check (char_length(title) between 2 and 200),
  owner_name text check (owner_name is null or char_length(owner_name) <= 80),
  sprint_id text,
  status text not null default 'aberto' check (status in ('aberto','resolvido')),
  note text check (note is null or char_length(note) <= 1000),
  created_on date not null default current_date,
  resolved_on date,
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

-- 4) Modelos de documentos de projeto (5W2H, SWOT, plano de comunicação, cutover, handover).
create table if not exists public.project_docs (
  project_id text not null references public.projects(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 60),
  kind text not null check (kind in ('5w2h','swot','comunicacao','cutover','handover')),
  title text not null check (char_length(title) between 2 and 120),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 400000),
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

create index if not exists sprint_rites_project_idx on public.sprint_rites(project_id, sprint_id);
create index if not exists impediments_project_idx on public.impediments(project_id, status);
create index if not exists project_docs_project_idx on public.project_docs(project_id, kind);

alter table public.sprint_rites enable row level security;
alter table public.impediments enable row level security;
alter table public.project_docs enable row level security;

create policy "sprint_rites_read" on public.sprint_rites for select using (auth.role() = 'authenticated' and public.has_project_access(project_id));
create policy "sprint_rites_write" on public.sprint_rites for all
  using (public.current_role() in ('admin','gerente') and public.has_project_access(project_id))
  with check (public.current_role() in ('admin','gerente') and public.has_project_access(project_id));

create policy "impediments_read" on public.impediments for select using (auth.role() = 'authenticated' and public.has_project_access(project_id));
create policy "impediments_write" on public.impediments for all
  using (public.current_role() in ('admin','gerente') and public.has_project_access(project_id))
  with check (public.current_role() in ('admin','gerente') and public.has_project_access(project_id));

create policy "project_docs_read" on public.project_docs for select using (auth.role() = 'authenticated' and public.has_project_access(project_id));
create policy "project_docs_write" on public.project_docs for all
  using (public.current_role() in ('admin','gerente') and public.has_project_access(project_id))
  with check (public.current_role() in ('admin','gerente') and public.has_project_access(project_id));

grant select, insert, update, delete on public.sprint_rites to authenticated;
grant select, insert, update, delete on public.impediments to authenticated;
grant select, insert, update, delete on public.project_docs to authenticated;
revoke all on public.sprint_rites from anon;
revoke all on public.impediments from anon;
revoke all on public.project_docs from anon;
