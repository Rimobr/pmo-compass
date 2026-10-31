-- Módulo ágil: itens do backlog (histórias, bugs, tarefas) e sprints.
-- O quadro Kanban é uma visão dos itens (coluna = status). O limite de trabalho em andamento (WIP) fica nas
-- configurações do projeto (project_settings, chave "agileConfig"), igual ao perfil de PMO e à metodologia.
create table if not exists public.backlog_items (
  project_id text not null references public.projects(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 60),
  title text not null check (char_length(title) between 2 and 200),
  description text check (description is null or char_length(description) <= 2000),
  kind text not null default 'historia' check (kind in ('historia','bug','tarefa')),
  status text not null default 'todo' check (status in ('todo','doing','review','done')),
  points integer check (points is null or points between 0 and 100),
  assignee text check (assignee is null or char_length(assignee) <= 80),
  sprint_id text,
  rank integer not null default 0,
  created_on date not null default current_date,
  done_on date,
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

create table if not exists public.sprints (
  project_id text not null references public.projects(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 60),
  name text not null check (char_length(name) between 2 and 80),
  goal text check (goal is null or char_length(goal) <= 300),
  start_on date not null,
  end_on date not null,
  capacity integer check (capacity is null or capacity between 0 and 1000),
  state text not null default 'planejada' check (state in ('planejada','ativa','encerrada')),
  closed_on date,
  updated_at timestamptz not null default now(),
  primary key (project_id, id),
  check (end_on >= start_on)
);

create index if not exists backlog_items_project_idx on public.backlog_items(project_id, status);
create index if not exists sprints_project_idx on public.sprints(project_id, start_on);

alter table public.backlog_items enable row level security;
alter table public.sprints enable row level security;

create policy "backlog_items_read" on public.backlog_items for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id));
create policy "backlog_items_write" on public.backlog_items for all
  using (public.current_role() in ('admin','gerente') and public.has_project_access(project_id))
  with check (public.current_role() in ('admin','gerente') and public.has_project_access(project_id));

create policy "sprints_read" on public.sprints for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id));
create policy "sprints_write" on public.sprints for all
  using (public.current_role() in ('admin','gerente') and public.has_project_access(project_id))
  with check (public.current_role() in ('admin','gerente') and public.has_project_access(project_id));

grant select, insert, update, delete on public.backlog_items to authenticated;
grant select, insert, update, delete on public.sprints to authenticated;
revoke all on public.backlog_items from anon;
revoke all on public.sprints from anon;
