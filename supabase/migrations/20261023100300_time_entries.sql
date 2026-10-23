-- Apontamento de horas (leve): quem trabalhou quanto, em qual projeto, em qual dia.
-- Alimenta a capacidade com dado MEDIDO (hoje a carga de cada pessoa é digitada à mão).
-- Escrita: administrador e gerente (apontam pela equipe) — o perfil "Consulta" é somente leitura.
create table if not exists public.time_entries (
  project_id text not null references public.projects(id) on delete cascade,
  id text not null,
  person_name text not null check (char_length(person_name) between 2 and 120),
  member_id text,
  work_date date not null,
  hours numeric(5,2) not null check (hours > 0 and hours <= 24),
  wbs_ref text,
  note text check (note is null or char_length(note) <= 500),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

create index if not exists time_entries_project_date_idx on public.time_entries(project_id, work_date);
create index if not exists time_entries_person_date_idx on public.time_entries(lower(person_name), work_date);

alter table public.time_entries enable row level security;

create policy "time_entries_read" on public.time_entries for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id));
create policy "time_entries_write" on public.time_entries for all
  using (public.current_role() in ('admin','gerente') and public.has_project_access(project_id))
  with check (public.current_role() in ('admin','gerente') and public.has_project_access(project_id));

grant select, insert, update, delete on public.time_entries to authenticated;
revoke all on public.time_entries from anon;
