-- Linha de base (baseline): "foto" congelada do plano aprovado (entregas, datas, orçamento) para comparar com o plano atual.
-- Até aqui o plano original se perdia a cada replanejamento. Regras:
--  * Imutável: só existe INSERT e DELETE. Não há política de UPDATE, então nem o administrador consegue "ajustar" uma linha de
--    base depois de salva (corrigir = salvar outra e, se preciso, excluir a errada).
--  * Quem salva: administrador e gerente com acesso ao projeto. Quem exclui: só o administrador.
--  * O conteúdo fica em "snapshot" (json), com tamanho limitado.
create table if not exists public.baselines (
  project_id text not null references public.projects(id) on delete cascade,
  id text not null,
  name text not null check (char_length(name) between 2 and 80),
  note text check (note is null or char_length(note) <= 500),
  created_on date not null default current_date,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  snapshot jsonb not null check (pg_column_size(snapshot) < 2000000),
  primary key (project_id, id)
);

create index if not exists baselines_project_idx on public.baselines(project_id, created_on);

alter table public.baselines enable row level security;

create policy "baselines_read" on public.baselines for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id));
create policy "baselines_insert" on public.baselines for insert
  with check (public.current_role() in ('admin','gerente') and public.has_project_access(project_id));
create policy "baselines_delete" on public.baselines for delete
  using (public.current_role() = 'admin' and public.has_project_access(project_id));

grant select, insert, delete on public.baselines to authenticated;
revoke all on public.baselines from anon;
