-- Mudanças de escopo na nuvem.
-- Antes só existiam em localStorage: a caixa de decisões da Visão Executiva (e o assistente de status)
-- só enxergavam projetos já abertos naquele navegador — o mesmo defeito que a equipe tinha.
-- Chave composta: o id do app ("SC-005") é gerado por projeto e pode se repetir entre projetos.
create table if not exists public.scope_changes (
  project_id text not null references public.projects(id) on delete cascade,
  id text not null,
  title text not null check (char_length(title) between 1 and 300),
  body text,
  status text not null default 'pending' check (status in ('pending','analysis','approved','rejected','phase2')),
  impact_days int not null default 0,
  impact_cost numeric(14,2) not null default 0,
  risk_note text,
  created_on date,
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

alter table public.scope_changes enable row level security;

create policy "scope_changes_read" on public.scope_changes for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id));
create policy "scope_changes_write" on public.scope_changes for all
  using (public.current_role() in ('admin','gerente') and public.has_project_access(project_id))
  with check (public.current_role() in ('admin','gerente') and public.has_project_access(project_id));

grant select, insert, update, delete on public.scope_changes to authenticated;
revoke all on public.scope_changes from anon;
