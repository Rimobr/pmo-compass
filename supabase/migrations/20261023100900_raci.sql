-- Matriz RACI por entrega: quem é Responsável (R), Aprovador (A), Consultado (C) e Informado (I) em cada entrega.
-- Uma linha por entrega do projeto (id = código da entrega na WBS ou um código próprio "RC-001").
-- "assignments" guarda {nome do colaborador: "R"|"A"|"C"|"I"}; a regra "um único A por entrega" é conferida na tela (aviso),
-- não travada no banco, para permitir importar planos incompletos.
create table if not exists public.raci_entries (
  project_id text not null references public.projects(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 60),
  label text not null check (char_length(label) between 1 and 200),
  assignments jsonb not null default '{}'::jsonb check (jsonb_typeof(assignments) = 'object' and pg_column_size(assignments) < 20000),
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

create index if not exists raci_entries_project_idx on public.raci_entries(project_id);

alter table public.raci_entries enable row level security;

create policy "raci_read" on public.raci_entries for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id));
create policy "raci_insert" on public.raci_entries for insert
  with check (public.current_role() in ('admin','gerente') and public.has_project_access(project_id));
create policy "raci_update" on public.raci_entries for update
  using (public.current_role() in ('admin','gerente') and public.has_project_access(project_id))
  with check (public.current_role() in ('admin','gerente') and public.has_project_access(project_id));
create policy "raci_delete" on public.raci_entries for delete
  using (public.current_role() in ('admin','gerente') and public.has_project_access(project_id));

grant select, insert, update, delete on public.raci_entries to authenticated;
revoke all on public.raci_entries from anon;
