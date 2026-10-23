-- Registro formal de riscos (padrão PMI): probabilidade × impacto numa matriz 5×5.
-- Até aqui "risco" no app era só decisão marcada como crítica — sem dono, resposta, plano nem nota.
-- Faixas da matriz (score = probabilidade × impacto): 1–4 baixo · 5–9 médio · 10–14 alto · 15–25 crítico.
create table if not exists public.risks (
  project_id text not null references public.projects(id) on delete cascade,
  id text not null,
  title text not null check (char_length(title) between 3 and 200),
  description text,
  category text not null default 'outros'
    check (category in ('prazo','custo','escopo','qualidade','recursos','tecnico','externo','legal','outros')),
  probability smallint not null check (probability between 1 and 5),
  impact smallint not null check (impact between 1 and 5),
  score smallint generated always as (probability * impact) stored,
  status text not null default 'aberto' check (status in ('aberto','mitigando','aceito','ocorrido','encerrado')),
  response text not null default 'mitigar' check (response in ('evitar','mitigar','transferir','aceitar')),
  mitigation text,
  contingency text,
  owner_name text,
  review_on date,
  identified_on date not null default current_date,
  closed_on date,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (project_id, id) -- o código (RK-001...) é por projeto, como em scope_changes
);

create index if not exists risks_project_id_idx on public.risks(project_id);
create index if not exists risks_project_score_idx on public.risks(project_id, score desc);

alter table public.risks enable row level security;

create policy "risks_read" on public.risks for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id));
create policy "risks_write" on public.risks for all
  using (public.current_role() in ('admin','gerente') and public.has_project_access(project_id))
  with check (public.current_role() in ('admin','gerente') and public.has_project_access(project_id));

grant select, insert, update, delete on public.risks to authenticated;
revoke all on public.risks from anon;
