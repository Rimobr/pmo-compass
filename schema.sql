-- =========================================================================
-- PMO Compass — esquema completo (GERADO por scripts/build-schema.mjs — não edite à mão)
-- Fonte: supabase/migrations/ (44 arquivos). Para instalação do zero, rode este arquivo inteiro
-- no SQL Editor; para um banco que já existe, use `node scripts/db-apply.mjs` (aplica só o que falta).
-- =========================================================================

-- ▼▼▼ 20260101000000_baseline.sql ▼▼▼
-- =========================================================================
-- PMO Compass — Schema Supabase (Postgres) + Row Level Security
-- Rode este arquivo inteiro em: Supabase → SQL Editor → New query → Run
-- =========================================================================

-- 1) PERFIS ---------------------------------------------------------------
-- Estende auth.users com nome + perfil de acesso (admin/gerente/consulta/manutencao)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  name text not null default '',
  role text not null default 'consulta' check (role in ('admin','gerente','consulta','manutencao')),
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Função auxiliar: qual o perfil do usuário autenticado agora (definida ANTES das policies que a usam)
create or replace function public.current_role()
returns text as $$
  select role from public.profiles where id = auth.uid();
$$ language sql stable security definer;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

-- Necessário para o UPDATE abaixo funcionar: um admin só consegue alterar uma linha
-- que ele também consegue "enxergar" via SELECT — sem esta policy, o Postgres nunca
-- encontra o perfil de outra pessoa para atualizar, mesmo com a policy de UPDATE liberada.
create policy "profiles_admin_select_all" on public.profiles
  for select using (public.current_role() = 'admin');

create policy "profiles_update_own_name" on public.profiles
  for update using (auth.uid() = id);

-- Só admins podem editar o perfil de OUTRAS pessoas (promover/rebaixar alguém)
create policy "profiles_admin_update_any" on public.profiles
  for update using (public.current_role() = 'admin');

-- Cria o perfil automaticamente no cadastro, sempre como "consulta" por padrão
-- (mais seguro: promover a admin/gerente/manutenção é feito manualmente depois)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), 'consulta');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Trava anti-escalonamento: ninguém consegue trocar o PRÓPRIO perfil sozinho,
-- só um admin pode mudar o perfil de alguém (inclusive o próprio, se quiser).
create or replace function public.prevent_role_self_escalation()
returns trigger as $$
begin
  if new.role <> old.role and public.current_role() <> 'admin' then
    new.role := old.role; -- ignora silenciosamente a tentativa de auto-promoção
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists before_profile_role_change on public.profiles;
create trigger before_profile_role_change
  before update on public.profiles
  for each row execute procedure public.prevent_role_self_escalation();

-- 2) WBS — ENTREGAS E SUBTAREFAS ------------------------------------------
create table if not exists public.wbs_modules (
  id text primary key,
  label text not null,
  status text not null default 'neu' check (status in ('grn','amb','red','neu')),
  pct int not null default 0 check (pct between 0 and 100),
  start_date date,
  end_date date,
  critical boolean not null default false,
  predecessors jsonb not null default '[]', -- ids de outras entregas/subtarefas — usado no cálculo real de caminho crítico (CPM)
  updated_at timestamptz default now()
);

create table if not exists public.wbs_tasks (
  id text primary key,
  module_id text not null references public.wbs_modules(id) on delete cascade,
  label text not null,
  status text not null default 'neu' check (status in ('grn','amb','red','neu')),
  start_date date,
  end_date date,
  predecessors jsonb not null default '[]',
  updated_at timestamptz default now()
);

-- 3) DECISÕES --------------------------------------------------------------
create table if not exists public.decisions (
  id text primary key,
  severity text not null default 'medio' check (severity in ('crit','alto','medio')),
  pct int not null default 100,
  title text not null,
  body text,
  sources jsonb not null default '[]',
  status text not null default 'pending' check (status in ('pending','accepted','postponed','rejected')),
  actions jsonb not null default '["accept"]',
  created_at timestamptz default now(),
  resolved_at timestamptz
);

-- 4) REPOSITÓRIO DE DOCUMENTOS ----------------------------------------------
create table if not exists public.documents (
  id text primary key,
  name text not null,
  ext text,
  meta text,
  added_at date default current_date,
  tags jsonb not null default '[]',
  index_pct int not null default 100,
  content text not null default '' -- texto extraído (PDF/DOCX) já anonimizado (LGPD), usado como contexto real da IA
);

-- 5) ORÇAMENTO E CUSTOS -----------------------------------------------------
create table if not exists public.budget_lines (
  id text primary key,
  label text not null,
  planned_value numeric not null default 0,
  wbs_module_id text references public.wbs_modules(id) on delete set null,
  is_reserve boolean not null default false, -- linha de reserva de contingência, não entra no BAC
  updated_at timestamptz default now()
);

create table if not exists public.cost_actuals (
  id text primary key,
  label text not null,
  amount numeric not null default 0,
  entry_date date default current_date,
  budget_line_id text references public.budget_lines(id) on delete set null,
  kind text not null default 'real' check (kind in ('real','comprometido')),
  updated_at timestamptz default now()
);

-- 6) CHAVES DE IA VINCULADAS AO USUÁRIO -------------------------------------
-- Cada pessoa continua usando (e pagando) a própria chave de IA — mas em vez de
-- ficar só no localStorage do navegador, fica guardada aqui, amarrada à conta.
-- Nunca é lida de volta pelo navegador: só a Edge Function (ai-proxy), que roda
-- no servidor com a service_role key, consegue ler o valor de fato. O cliente só
-- consegue inserir/atualizar/apagar a própria linha — não há policy de SELECT.
create table if not exists public.user_ai_keys (
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null check (provider in ('anthropic','openai','google')),
  api_key text not null,
  updated_at timestamptz default now(),
  primary key (user_id, provider)
);

alter table public.user_ai_keys enable row level security;

create policy "user_ai_keys_insert_own" on public.user_ai_keys
  for insert with check (auth.uid() = user_id);
create policy "user_ai_keys_update_own" on public.user_ai_keys
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_ai_keys_delete_own" on public.user_ai_keys
  for delete using (auth.uid() = user_id);
-- Sem policy de SELECT para authenticated/anon — de propósito. Só a Edge Function
-- (com a service_role key, que ignora RLS) consegue ler o valor da chave.

-- O app grava/apaga a própria chave via estas duas funções RPC (SECURITY DEFINER),
-- não com INSERT/DELETE direto na tabela. Motivo: em pelo menos um projeto Supabase
-- de produção, um INSERT direto contra user_ai_keys foi rejeitado pela RLS mesmo com
-- auth.uid() confirmado correto (via uma função de diagnóstico chamada no mesmo
-- instante) — uma inconsistência da infraestrutura do Supabase (suspeita: pooler de
-- conexão), não do schema. Uma função RPC com o mesmo auth.uid() funciona normalmente,
-- então o app passou a usar esse caminho. Se você nunca teve esse problema, este
-- caminho funciona do mesmo jeito — não tem downside em usá-lo por padrão.
create or replace function public.save_own_ai_key(p_provider text, p_api_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_provider not in ('anthropic','openai','google') then
    raise exception 'invalid provider';
  end if;
  insert into public.user_ai_keys (user_id, provider, api_key, updated_at)
  values (auth.uid(), p_provider, p_api_key, now())
  on conflict (user_id, provider) do update set api_key = excluded.api_key, updated_at = now();
end;
$$;
grant execute on function public.save_own_ai_key(text, text) to authenticated;

create or replace function public.delete_own_ai_key(p_provider text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from public.user_ai_keys where user_id = auth.uid() and provider = p_provider;
end;
$$;
grant execute on function public.delete_own_ai_key(text) to authenticated;

-- 7) ROW LEVEL SECURITY — espelha os 4 perfis já usados no app -------------
alter table public.wbs_modules  enable row level security;
alter table public.wbs_tasks    enable row level security;
alter table public.decisions    enable row level security;
alter table public.documents    enable row level security;
alter table public.budget_lines enable row level security;
alter table public.cost_actuals enable row level security;

-- Leitura: qualquer usuário autenticado vê tudo (todos os 4 perfis leem)
create policy "wbs_modules_read"  on public.wbs_modules  for select using (auth.role() = 'authenticated');
create policy "wbs_tasks_read"    on public.wbs_tasks    for select using (auth.role() = 'authenticated');
create policy "decisions_read"    on public.decisions    for select using (auth.role() = 'authenticated');
create policy "documents_read"    on public.documents    for select using (auth.role() = 'authenticated');
create policy "budget_lines_read" on public.budget_lines for select using (auth.role() = 'authenticated');
create policy "cost_actuals_read" on public.cost_actuals for select using (auth.role() = 'authenticated');

-- Escrita (INSERT/UPDATE/DELETE): só admin e gerente — equivalente ao data-perm="business" do app
create policy "wbs_modules_write" on public.wbs_modules for all
  using (public.current_role() in ('admin','gerente'))
  with check (public.current_role() in ('admin','gerente'));

create policy "wbs_tasks_write" on public.wbs_tasks for all
  using (public.current_role() in ('admin','gerente'))
  with check (public.current_role() in ('admin','gerente'));

create policy "decisions_write" on public.decisions for all
  using (public.current_role() in ('admin','gerente'))
  with check (public.current_role() in ('admin','gerente'));

create policy "documents_write" on public.documents for all
  using (public.current_role() in ('admin','gerente'))
  with check (public.current_role() in ('admin','gerente'));

create policy "budget_lines_write" on public.budget_lines for all
  using (public.current_role() in ('admin','gerente'))
  with check (public.current_role() in ('admin','gerente'));

create policy "cost_actuals_write" on public.cost_actuals for all
  using (public.current_role() in ('admin','gerente'))
  with check (public.current_role() in ('admin','gerente'));

-- 8) ISOLAMENTO POR PROJETO ---------------------------------------------------
-- Até aqui, wbs_modules/wbs_tasks/decisions/documents/budget_lines/cost_actuals
-- eram um pool único por conta — todo mundo logado via a mesma organização
-- compartilhava as MESMAS linhas, não importa qual "projeto" (Portal Nexus,
-- Valdori, etc.) estivesse ativo no seletor do app. Isso não é um problema de
-- segurança entre contas diferentes (RLS acima já cobre isso por role), mas
-- impedia usar o produto como ferramenta de portfólio: WBS de um projeto
-- aparecia junto com a de outro, e "Limpar dados" de um projeto não conseguia
-- alcançar o que estava salvo na nuvem daquele projeto especificamente.
--
-- project_id é só uma coluna de partição de dado (o id local do projeto no
-- seletor do app, ex.: 'nexus', 'valdori') — não cria usuário novo nem exige
-- policy nova, porque a leitura/escrita continua controlada por role, igual
-- antes. O cliente passa a sempre gravar e filtrar por este valor.
alter table public.wbs_modules  add column if not exists project_id text not null default 'nexus';
alter table public.wbs_tasks    add column if not exists project_id text not null default 'nexus';
alter table public.decisions    add column if not exists project_id text not null default 'nexus';
alter table public.documents    add column if not exists project_id text not null default 'nexus';
alter table public.budget_lines add column if not exists project_id text not null default 'nexus';
alter table public.cost_actuals add column if not exists project_id text not null default 'nexus';

create index if not exists wbs_modules_project_id_idx  on public.wbs_modules(project_id);
create index if not exists wbs_tasks_project_id_idx    on public.wbs_tasks(project_id);
create index if not exists decisions_project_id_idx    on public.decisions(project_id);
create index if not exists documents_project_id_idx    on public.documents(project_id);
create index if not exists budget_lines_project_id_idx on public.budget_lines(project_id);
create index if not exists cost_actuals_project_id_idx on public.cost_actuals(project_id);

-- IMPORTANTE (rodar só uma vez, depois do ALTER acima): toda linha já existente
-- na nuvem recebeu o padrão 'nexus', mesmo a que foi criada com outro projeto
-- ativo no seletor — o banco nunca soube disso antes de existir esta coluna.
-- Se você tinha dado real em outro projeto (ex.: 'valdori'), rode manualmente:
--   update public.wbs_modules  set project_id = 'valdori' where project_id = 'nexus';
--   update public.wbs_tasks    set project_id = 'valdori' where project_id = 'nexus';
--   update public.decisions    set project_id = 'valdori' where project_id = 'nexus';
--   update public.documents    set project_id = 'valdori' where project_id = 'nexus';
--   update public.budget_lines set project_id = 'valdori' where project_id = 'nexus';
--   update public.cost_actuals set project_id = 'valdori' where project_id = 'nexus';
-- (troque 'valdori' pelo id do projeto certo — veja em DB.listProjects() no console)

-- 9) LOG DE AUDITORIA (append-only) ------------------------------------------
-- Diferente da Trilha do app (Trail.log — um mural de eventos "bonito" para o time,
-- limitado a 200 itens, só local, editável de fato porque é só localStorage), este é
-- o registro pensado pra revisão de segurança/compliance de um cliente: quem fez o
-- quê, quando, e a partir de qual papel — coisas sensíveis (login, promoção de perfil,
-- exportação de backup, reset de dados compartilhados, tentativa bloqueada por falta
-- de permissão), não o volume inteiro de eventos operacionais.
--
-- Append-only de verdade: a política abaixo só concede INSERT (da própria linha,
-- auth.uid() = actor_id — ninguém grava em nome de outra pessoa) e SELECT (só admin).
-- Não existe NENHUMA policy de UPDATE ou DELETE para nenhum papel — logo, mesmo um
-- Administrador autenticado normalmente não consegue alterar ou apagar uma linha via
-- API. Só alguém com acesso direto ao Postgres (fora do app) poderia.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  project_id text not null,
  actor_id uuid references auth.users(id),
  actor_email text,
  actor_role text,
  action text not null,        -- código curto e estável, ex: 'login', 'role_change', 'backup_export'
  description text not null,   -- texto legível do que aconteceu
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

create policy "audit_log_insert_own" on public.audit_log
  for insert with check (auth.uid() = actor_id);

create policy "audit_log_admin_select" on public.audit_log
  for select using (public.current_role() = 'admin');

create index if not exists audit_log_project_id_idx  on public.audit_log(project_id);
create index if not exists audit_log_created_at_idx  on public.audit_log(created_at desc);

-- 10) HISTÓRICO DE SNAPSHOTS (fundação do P5 — tendência e previsão) --------------
-- Diferente de tudo até aqui, isso não é um dado de negócio que alguém edita — é uma série
-- temporal: toda vez que o app computa saúde/orçamento/prazo de um projeto (ao abrir o
-- Dashboard, ou ao confirmar um Raio-X), grava UM PONTO aqui. Sem isso não existe "tendência"
-- nem "previsão" possível — seria a IA inventando uma trajetória que não pode calcular.
-- Captura é melhor-esforço e throttled no cliente (core/db, computePortfolioAllocation vizinho):
-- não é um job de servidor ainda, então só ganha ponto novo quem abre o app ou roda um Raio-X —
-- ver nota de limitação no código (services/snapshots).
create table if not exists public.project_snapshots (
  id bigint generated always as identity primary key,
  project_id text not null,
  captured_at timestamptz not null default now(),
  source text not null default 'app_load' check (source in ('app_load','raiox','manual')),
  health_score int,
  health_status text,
  budget_bac numeric,
  budget_ac numeric,
  budget_ev numeric,
  budget_cpi numeric,
  budget_eac numeric,
  budget_consumo_pct numeric,
  priority_index numeric,
  critical_decisions_pending int,
  team_overallocated_count int,
  dims jsonb not null default '{}', -- as 6 dimensões do HealthScore (schedule/budget/team/quality/learning/scope)
  captured_by uuid references auth.users(id)
);

alter table public.project_snapshots enable row level security;

-- Leitura: qualquer autenticado (mesmo padrão de WBS/decisões/orçamento). Escrita: qualquer
-- autenticado pode INSERIR (é telemetria computada a partir do que a pessoa já pode ver, não
-- dado de negócio sensível — não faz sentido restringir a admin/gerente só a captura do ponto).
-- Sem policy de UPDATE/DELETE de propósito: é série histórica, só cresce.
create policy "project_snapshots_read"  on public.project_snapshots for select using (auth.role() = 'authenticated');
create policy "project_snapshots_write" on public.project_snapshots for insert with check (auth.role() = 'authenticated');

create index if not exists project_snapshots_project_id_idx  on public.project_snapshots(project_id);
create index if not exists project_snapshots_captured_at_idx on public.project_snapshots(captured_at desc);

-- 11) PROVENIÊNCIA DO DADO (IA vs. manual) --------------------------------------
-- Até aqui, um item criado a partir do Raio-X do Projeto (extração de documento por IA) ficava
-- indistinguível de um item cadastrado manualmente assim que virava registro — só sobrava um
-- log na Trilha, que rola pra fora da vista. Pra uso como ferramenta de auditoria/governança,
-- precisa dar pra ver PERMANENTEMENTE, no próprio item, que ele veio de IA. origin é nullable
-- (item manual não tem valor aqui) e só grava 'ia' quando o commitProposal() do Raio-X cria o item.
alter table public.wbs_modules  add column if not exists origin text;
alter table public.decisions    add column if not exists origin text;
alter table public.budget_lines add column if not exists origin text;

-- 12) RESPONSÁVEL + DATAS REAIS NA WBS (planejado vs. real) -----------------------
-- Até aqui a WBS só tinha UMA data de início/fim por item (start_date/end_date) — usada tanto
-- como "planejado" quanto, implicitamente, como a única referência de prazo. Sem uma data REAL
-- separada, não dá pra calcular atraso de verdade (só "prazo vencido, não concluída" via % e
-- data de hoje) nem comparar o que foi planejado contra o que realmente aconteceu. start_date/
-- end_date passam a significar explicitamente "planejado"; start_actual/end_actual guardam
-- quando a entrega realmente começou/terminou (nulo até acontecer). responsavel é texto livre
-- (não é uma FK pra um cadastro de pessoa — a WBS não tem esse conceito ainda).
alter table public.wbs_modules add column if not exists responsavel text;
alter table public.wbs_modules add column if not exists start_actual date;
alter table public.wbs_modules add column if not exists end_actual date;
alter table public.wbs_tasks   add column if not exists responsavel text;
alter table public.wbs_tasks   add column if not exists start_actual date;
alter table public.wbs_tasks   add column if not exists end_actual date;

-- 13) RASTREIO DE AJUSTE POR CAMPO NA WBS -----------------------------------------
-- A nova visão em Tabela da WBS edita campo a campo, direto na célula — sem isso, "quem
-- ajustou o quê e quando" só dava pra reconstruir vasculhando a Trilha inteira do projeto.
-- last_edited_by/at guardam SÓ o último ajuste de cada linha (não um histórico completo —
-- o histórico completo continua sendo a Trilha, que já registra cada alteração de campo com
-- valor antigo → novo); isso aqui é o resumo rápido pra mostrar na própria célula da tabela.
alter table public.wbs_modules add column if not exists last_edited_by text;
alter table public.wbs_modules add column if not exists last_edited_at timestamptz;
alter table public.wbs_tasks   add column if not exists last_edited_by text;
alter table public.wbs_tasks   add column if not exists last_edited_at timestamptz;

-- 14) CONFIGURAÇÕES POR PROJETO NA NUVEM (priorização, perfil de PMO, valor entregue) --------
-- pmoProfile e prioritization sempre foram "um objeto só por projeto" (não uma lista) — ficavam
-- só no localStorage do navegador. Funcionava, mas sumia ao trocar de navegador/aparelho — e a
-- Priorização (que sustenta a classificação de projeto por benefício/diretoria) e o novo Valor
-- Entregue (validação de valor com foco em VMO) precisam sobreviver a isso pra o produto ser
-- confiável em portfólio. Uma tabela genérica (chave/valor em JSON, por projeto) resolve os três
-- de uma vez, sem precisar de uma tabela nova pra cada "objeto único" que o app tem ou vier a ter.
create table if not exists public.project_settings (
  project_id text not null,
  key text not null, -- 'prioritization' | 'pmoProfile' | 'valueRealization'
  value jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (project_id, key)
);

alter table public.project_settings enable row level security;

create policy "project_settings_read" on public.project_settings for select using (auth.role() = 'authenticated');
create policy "project_settings_write" on public.project_settings for all
  using (public.current_role() in ('admin','gerente'))
  with check (public.current_role() in ('admin','gerente'));

-- 15) PAINEL DA DIRETORIA — sugestão de IA + decisão registrada + avaliação posterior ----------
-- Diferente de project_settings (um objeto único por projeto/chave), isto é uma lista que só
-- cresce — cada linha é UM ciclo de "IA sugeriu → diretoria decidiu → resultado avaliado depois".
-- Guardar isso de verdade (não só na tela) é o que permite, futuramente, alimentar a próxima
-- sugestão da IA com o histórico real de acerto — sem essa tabela não há como avaliar se uma
-- sugestão passada foi uma boa decisão, nem aprender nada com isso.
create table if not exists public.board_decisions (
  id text primary key,
  project_id text not null,
  ai_suggestion text,          -- 'continuar' | 'pausar' | 'escalar'
  ai_reasoning text,
  ai_generated_at timestamptz,
  board_decision text,         -- 'continuar' | 'pausar' | 'cancelar' | 'replanejar'
  board_comment text,
  decided_by text,
  decided_at timestamptz,
  outcome_rating text,         -- 'boa' | 'ruim' | 'neutra'
  outcome_comment text,
  outcome_rated_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.board_decisions enable row level security;

create policy "board_decisions_read" on public.board_decisions for select using (auth.role() = 'authenticated');
create policy "board_decisions_write" on public.board_decisions for all
  using (public.current_role() in ('admin','gerente'))
  with check (public.current_role() in ('admin','gerente'));

create index if not exists board_decisions_project_id_idx on public.board_decisions(project_id);

-- 16) RBAC POR PROJETO — quem pode ver qual projeto ------------------------------------------
-- Até aqui, dentro de uma mesma instância, qualquer pessoa autenticada lia os dados de TODOS os
-- projetos — a RLS restringia por PAPEL (admin/gerente escrevem, todo mundo lê), nunca por
-- PROJETO. "projects" é o registro real do portfólio (antes só existia em localStorage, cada
-- navegador com sua própria lista — sem isso, dar acesso a alguém não adiantava, o seletor de
-- projeto dessa pessoa nem ia listar o projeto liberado). "project_access" é quem pode ver o quê.
-- admin sempre vê tudo (é o papel de visão de portfólio inteiro); os outros 3 papéis só veem
-- projeto onde têm uma linha aqui.
create table if not exists public.projects (
  id text primary key,
  name text not null,
  client text,
  icon text default 'compass',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.project_access (
  project_id text not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table public.projects enable row level security;
alter table public.project_access enable row level security;

-- Função auxiliar reaproveitada em toda policy abaixo (evita repetir a mesma subquery em 9
-- tabelas) — security definer pra poder ler project_access/profiles independente da RLS de quem
-- está chamando, mesmo padrão já usado em current_role().
create or replace function public.has_project_access(pid text)
returns boolean as $$
  select public.current_role() = 'admin'
    or exists (select 1 from public.project_access where project_id = pid and user_id = auth.uid());
$$ language sql stable security definer;

-- Leitura de "projects": só quem tem acesso àquele projeto específico (reaproveita a mesma
-- função, com o id da própria tabela). Escrita: admin/gerente.
create policy "projects_read" on public.projects for select using (public.has_project_access(id));
create policy "projects_write" on public.projects for all
  using (public.current_role() in ('admin','gerente'))
  with check (public.current_role() in ('admin','gerente'));

-- project_access: cada um vê as próprias concessões (pra saber quais projetos tem acesso);
-- admin vê e edita tudo (é quem concede/revoga acesso de outras pessoas).
create policy "project_access_read_own" on public.project_access for select using (user_id = auth.uid());
create policy "project_access_admin_all" on public.project_access for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- Quem cria um projeto (admin/gerente, mesma permissão de escrever em "projects") precisa
-- conseguir se auto-conceder acesso a ele na hora — senão ficaria sem ver o próprio projeto que
-- acabou de criar, já que só admin tem a policy "all" acima. Restrito a conceder só PRA SI MESMO
-- (user_id = auth.uid()), nunca pra outra pessoa — isso continua exigindo um admin.
create policy "project_access_self_grant" on public.project_access for insert
  with check (user_id = auth.uid() and public.current_role() in ('admin','gerente'));

-- NOTA IMPORTANTE — como ativar de verdade (deliberadamente NÃO automático neste script):
-- Só criar as tabelas acima não muda nada ainda — as 9 tabelas com project_id continuam com a
-- policy antiga (`auth.role() = 'authenticated'`, sem checar projeto) até você rodar, NESTA
-- ORDEM, depois de confirmar que "projects" já tem uma linha por projeto real (o app sincroniza
-- isso sozinho no primeiro load depois de conectado — ver Cloud.pushProject):
--
-- 1) Backfill de acesso — todo usuário existente mantém acesso a todo projeto já existente:
--      insert into public.project_access (project_id, user_id)
--      select p.id, u.id from public.projects p cross join public.profiles u
--      on conflict do nothing;
--
-- 2) Só depois do passo 1, trocar a policy de leitura em cada uma destas tabelas —
--    wbs_modules, wbs_tasks, decisions, documents, budget_lines, cost_actuals,
--    project_settings, board_decisions, project_snapshots — de:
--      auth.role() = 'authenticated'
--    para:
--      auth.role() = 'authenticated' and public.has_project_access(project_id)
--    e na policy de ESCRITA de cada uma, acrescentar "and public.has_project_access(project_id)"
--    à condição que já existia (current_role() in ('admin','gerente')).

-- 17) EQUIPE / CAPACIDADE (team_members) — sincroniza com a nuvem -------------------------------
-- Até aqui, "quem está na equipe de cada projeto" só existia em localStorage — cada navegador com
-- sua própria cópia, nunca sincronizada. Isso quebrava silenciosamente a visão de "Alocação real
-- entre projetos" (Resources / DB.computePortfolioAllocation): só enxergava sobrealocação de uma
-- pessoa se TODOS os projetos onde ela está tivessem sido abertos NESTE MESMO navegador. Criada já
-- com RBAC por projeto desde o início (has_project_access já existe — seção 16), sem o rollout em
-- duas fases que as tabelas mais antigas exigiram.
create table if not exists public.team_members (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  name text not null,
  role text,
  allocation_pct int,
  workload_pct int,
  signals jsonb default '[]'::jsonb,
  recommendation text,
  action_page text,
  created_at timestamptz not null default now()
);

alter table public.team_members enable row level security;

create policy "team_members_read" on public.team_members for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id));
create policy "team_members_write" on public.team_members for all
  using (public.current_role() in ('admin','gerente') and public.has_project_access(project_id))
  with check (public.current_role() in ('admin','gerente') and public.has_project_access(project_id));

create index if not exists team_members_project_id_idx on public.team_members(project_id);

-- =========================================================================
-- PRONTO. Depois de rodar este script:
-- 1. Vá em Authentication → Users e crie seu primeiro usuário (ou cadastre pelo
--    próprio app, uma vez que a tela de login estiver conectada).
-- 2. Esse primeiro usuário nasce com role='consulta'. Promova-o a admin rodando:
--      update public.profiles set role = 'admin' where id = 'COLE_O_UUID_AQUI';
--    (o UUID aparece em Authentication → Users, ao lado do e-mail)
-- =========================================================================

-- ▼▼▼ 20261023100000_projects_reference_date.sql ▼▼▼
-- Data de referência por projeto — só para os projetos de DEMONSTRAÇÃO.
-- Até aqui o "hoje" do app era 20/06/2026 fixo no código (herança da demo), o que distorcia atraso,
-- previsão de entrega e SPI de qualquer projeto real. Agora o "hoje" é o dia real; um projeto só
-- usa data fixa se tiver reference_date preenchida (os de demonstração, pra não parecerem atrasados).
-- O servidor (assistente de status) usa a MESMA regra: reference_date ?? hoje em America/Sao_Paulo.
alter table public.projects add column if not exists reference_date date;

update public.projects
   set reference_date = date '2026-06-20'
 where id in ('nexus','valdori','beltrano') and reference_date is null;

-- ▼▼▼ 20261023100100_scope_changes.sql ▼▼▼
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

-- ▼▼▼ 20261023100200_risks.sql ▼▼▼
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

-- ▼▼▼ 20261023100300_time_entries.sql ▼▼▼
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

-- ▼▼▼ 20261023100400_messaging.sql ▼▼▼
-- Mensagens para diretoria e stakeholders (WhatsApp e e-mail) + assistente de status por IA.
--
-- Desenho (resumo):
--  * message_recipients: QUEM recebe/pergunta (pessoa externa, sem login no app). Dado pessoal de terceiro
--    (telefone, e-mail) — por isso só o administrador lê e escreve, e o consentimento é evidência obrigatória.
--  * message_recipient_projects: de QUAIS projetos a pessoa pode receber alertas e fazer perguntas. É a
--    fronteira de autorização do assistente: a IA só recebe os fatos desses projetos, nunca os outros.
--  * notification_outbox: fila de envio (alertas/resumo). Preenchida por gatilhos do banco e pelas funções.
--  * message_log: trilha das mensagens (texto já com dados pessoais redigidos), retenção de 90 dias.
--  * messaging_settings: chaves gerais, limites e a conta cuja chave de IA responde as perguntas.
-- Escrita no banco pelos fluxos automáticos (webhook, despacho) é sempre com a chave de serviço, nunca pelo navegador.

create table if not exists public.messaging_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  whatsapp_enabled boolean not null default false,
  email_enabled boolean not null default false,
  ai_owner_user_id uuid references auth.users(id) on delete set null,
  ai_provider text check (ai_provider in ('anthropic','openai','google')),
  daily_question_limit int not null default 30 check (daily_question_limit between 1 and 500),
  digest_weekday int not null default 1 check (digest_weekday between 0 and 6),
  digest_hour int not null default 8 check (digest_hour between 0 and 23),
  quiet_start int not null default 21 check (quiet_start between 0 and 23),
  quiet_end int not null default 7 check (quiet_end between 0 and 23),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.messaging_settings (id) values (1) on conflict do nothing;

create table if not exists public.message_recipients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  role_label text check (role_label is null or char_length(role_label) <= 80),
  whatsapp text check (whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{9,14}$'),
  email text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  events text[] not null default '{decisao_critica,farol_vermelho,resumo_semanal}'
    check (events <@ array['decisao_critica','farol_vermelho','risco_alto','resumo_semanal']::text[]),
  can_see_financials boolean not null default false,
  owner_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  consent_basis text check (consent_basis is null or char_length(consent_basis) <= 300),
  consent_recorded_at timestamptz,
  consent_recorded_by uuid references auth.users(id) on delete set null,
  whatsapp_status text not null default 'sem_whatsapp'
    check (whatsapp_status in ('sem_whatsapp','aguardando_confirmacao','ativo','descadastrado')),
  whatsapp_confirmed_at timestamptz,
  email_status text not null default 'sem_email' check (email_status in ('sem_email','ativo','descadastrado')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipients_has_channel check (whatsapp is not null or email is not null),
  -- sem evidência de consentimento, nenhum canal fica ativo nem aguardando confirmação
  constraint recipients_consent_required check (
    (whatsapp_status in ('sem_whatsapp','descadastrado') or consent_recorded_at is not null)
    and (email_status in ('sem_email','descadastrado') or consent_recorded_at is not null)
  )
);
create unique index if not exists message_recipients_whatsapp_uq on public.message_recipients(whatsapp) where whatsapp is not null;
create unique index if not exists message_recipients_email_uq on public.message_recipients(lower(email)) where email is not null;

create table if not exists public.message_recipient_projects (
  recipient_id uuid not null references public.message_recipients(id) on delete cascade,
  project_id text not null references public.projects(id) on delete cascade,
  primary key (recipient_id, project_id)
);
create index if not exists message_recipient_projects_project_idx on public.message_recipient_projects(project_id);

create table if not exists public.notification_outbox (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.message_recipients(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','email')),
  event_type text not null,
  project_id text references public.projects(id) on delete set null,
  title text not null,
  detail text,
  dedupe_key text not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  attempts int not null default 0,
  last_error text,
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_id, channel, dedupe_key)
);
create index if not exists notification_outbox_pending_idx on public.notification_outbox(scheduled_at) where status in ('pending','failed');

create table if not exists public.message_log (
  id bigint generated always as identity primary key,
  recipient_id uuid references public.message_recipients(id) on delete set null,
  channel text not null check (channel in ('whatsapp','email','app')),
  direction text not null check (direction in ('in','out')),
  kind text not null,
  external_id text,
  body_redacted text,
  project_ids text[] not null default '{}',
  ai_provider text,
  ai_ms int,
  error text,
  created_at timestamptz not null default now()
);
-- idempotência: o WhatsApp reentrega a mesma mensagem se a resposta demorar — uma só vez entra
create unique index if not exists message_log_inbound_uq on public.message_log(channel, external_id)
  where direction = 'in' and external_id is not null;
create index if not exists message_log_recipient_idx on public.message_log(recipient_id, created_at desc);
create index if not exists message_log_created_idx on public.message_log(created_at desc);

-- RLS: tudo só do administrador; fila e trilha são somente leitura (quem escreve é a função com chave de serviço).
alter table public.messaging_settings enable row level security;
alter table public.message_recipients enable row level security;
alter table public.message_recipient_projects enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.message_log enable row level security;

create policy "messaging_settings_admin" on public.messaging_settings for all
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
create policy "message_recipients_admin" on public.message_recipients for all
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
create policy "message_recipient_projects_admin" on public.message_recipient_projects for all
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
create policy "notification_outbox_admin_read" on public.notification_outbox for select
  using (public.current_role() = 'admin');
create policy "message_log_admin_read" on public.message_log for select
  using (public.current_role() = 'admin');

grant select, insert, update, delete on public.messaging_settings, public.message_recipients, public.message_recipient_projects to authenticated;
grant select on public.notification_outbox, public.message_log to authenticated;
revoke all on public.messaging_settings, public.message_recipients, public.message_recipient_projects,
  public.notification_outbox, public.message_log from anon;

-- Guarda de status: o WhatsApp só vira "ativo" quando a PESSOA responde SIM (função com chave de serviço) —
-- nem o administrador consegue marcar como ativo pela tela/API. Trocar o número exige confirmar de novo.
create or replace function public.trg_recipient_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if auth.role() = 'authenticated' then
    if tg_op = 'INSERT' then
      new.whatsapp_status := case when new.whatsapp is null then 'sem_whatsapp' else 'aguardando_confirmacao' end;
      new.whatsapp_confirmed_at := null;
      new.owner_user_id := auth.uid();
    else
      if new.whatsapp is distinct from old.whatsapp then
        new.whatsapp_status := case when new.whatsapp is null then 'sem_whatsapp' else 'aguardando_confirmacao' end;
        new.whatsapp_confirmed_at := null;
      elsif new.whatsapp_status = 'ativo' and old.whatsapp_status is distinct from 'ativo' then
        raise exception 'O WhatsApp só fica ativo quando a própria pessoa confirma respondendo SIM.' using errcode = '42501';
      elsif new.whatsapp_status = 'aguardando_confirmacao' and old.whatsapp_status = 'ativo' then
        new.whatsapp_status := 'ativo'; -- reenviar confirmação não derruba quem já confirmou
      end if;
    end if;
    if new.whatsapp is null then new.whatsapp_status := 'sem_whatsapp'; end if;
    if new.email is null then new.email_status := 'sem_email'; end if;
  end if;
  return new;
end $$;
drop trigger if exists recipient_guard on public.message_recipients;
create trigger recipient_guard before insert or update on public.message_recipients
  for each row execute function public.trg_recipient_guard();

-- Auditoria no servidor: toda mudança de destinatário/canal fica no audit_log mesmo se vier direto pela API.
create or replace function public.trg_recipient_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare d text; who text;
begin
  select email into who from auth.users where id = auth.uid();
  if tg_op = 'DELETE' then
    d := 'Destinatário removido: ' || old.name;
  elsif tg_op = 'INSERT' then
    d := 'Destinatário criado: ' || new.name || ' (canais: ' || concat_ws(', ',
         case when new.whatsapp is not null then 'WhatsApp ***' || right(new.whatsapp, 4) end,
         case when new.email is not null then 'e-mail' end) || ')';
  else
    if new.whatsapp_status is distinct from old.whatsapp_status then
      d := 'WhatsApp de ' || new.name || ': ' || old.whatsapp_status || ' → ' || new.whatsapp_status;
    elsif new.email_status is distinct from old.email_status then
      d := 'E-mail de ' || new.name || ': ' || old.email_status || ' → ' || new.email_status;
    elsif new.can_see_financials is distinct from old.can_see_financials then
      d := 'Acesso a valores financeiros de ' || new.name || ': ' || old.can_see_financials || ' → ' || new.can_see_financials;
    elsif new.active is distinct from old.active then
      d := 'Destinatário ' || new.name || (case when new.active then ' reativado' else ' desativado' end);
    else
      d := 'Destinatário atualizado: ' || new.name;
    end if;
  end if;
  insert into public.audit_log (project_id, actor_id, actor_email, actor_role, action, description, metadata)
  values ('_global', auth.uid(), coalesce(who, 'sistema (WhatsApp/e-mail)'), public.current_role(),
          'recipient_change', d, '{}'::jsonb);
  return null; -- gatilho AFTER: o retorno é ignorado
end $$;
drop trigger if exists recipient_audit on public.message_recipients;
create trigger recipient_audit after insert or update or delete on public.message_recipients
  for each row execute function public.trg_recipient_audit();

revoke all on function public.trg_recipient_guard() from public, anon, authenticated;
revoke all on function public.trg_recipient_audit() from public, anon, authenticated;

-- ▼▼▼ 20261023100500_messaging_triggers.sql ▼▼▼
-- Eventos que geram notificação: decisão crítica pendente, projeto que entra "Em risco" e risco crítico.
-- Os gatilhos só ENFILEIRAM (notification_outbox); quem envia é a função notify-dispatch, que também
-- aplica horário de silêncio e remove valores em R$ de quem não pode ver finanças.
-- Duplicata é impossível: (recipient_id, channel, dedupe_key) é único.

create or replace function public.enqueue_notification(
  p_event text, p_project text, p_title text, p_detail text, p_key text
) returns int
language plpgsql security definer set search_path = public as $$
declare s public.messaging_settings; r public.message_recipients; n int := 0;
begin
  select * into s from public.messaging_settings where id = 1;
  if s.id is null or not s.enabled then return 0; end if;
  for r in
    select mr.* from public.message_recipients mr
      join public.message_recipient_projects mp on mp.recipient_id = mr.id and mp.project_id = p_project
     where mr.active and p_event = any(mr.events)
  loop
    if s.whatsapp_enabled and r.whatsapp is not null and r.whatsapp_status = 'ativo' then
      insert into public.notification_outbox (recipient_id, channel, event_type, project_id, title, detail, dedupe_key)
      values (r.id, 'whatsapp', p_event, p_project, p_title, p_detail, p_key) on conflict do nothing;
      if found then n := n + 1; end if;
    end if;
    if s.email_enabled and r.email is not null and r.email_status = 'ativo' then
      insert into public.notification_outbox (recipient_id, channel, event_type, project_id, title, detail, dedupe_key)
      values (r.id, 'email', p_event, p_project, p_title, p_detail, p_key) on conflict do nothing;
      if found then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.enqueue_notification(text, text, text, text, text) from public, anon, authenticated;

-- 1) Decisão crítica pendente (nova, ou que passou a ser crítica/pendente)
create or replace function public.trg_decisions_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' and new.severity = 'crit'
     and (tg_op = 'INSERT' or old.status is distinct from 'pending' or old.severity is distinct from 'crit') then
    perform public.enqueue_notification('decisao_critica', new.project_id, 'Decisão crítica pendente',
      left(new.title, 160), 'dec:' || new.id);
  end if;
  return null;
end $$;
drop trigger if exists decisions_notify on public.decisions;
create trigger decisions_notify after insert or update of status, severity on public.decisions
  for each row execute function public.trg_decisions_notify();

-- 2) Projeto que ENTRA em "Em risco" (leitura anterior era outra) — no máximo 1 aviso por dia por projeto
create or replace function public.trg_snapshot_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare prev text;
begin
  if new.health_status = 'Em risco' then
    select health_status into prev from public.project_snapshots
     where project_id = new.project_id and captured_at < new.captured_at
     order by captured_at desc limit 1;
    if prev is distinct from 'Em risco' then
      perform public.enqueue_notification('farol_vermelho', new.project_id, 'Projeto entrou em risco',
        'Saúde geral ' || coalesce(new.health_score::text, '?') || '/100',
        'farol:' || new.project_id || ':' || to_char(new.captured_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists snapshot_notify on public.project_snapshots;
create trigger snapshot_notify after insert on public.project_snapshots
  for each row execute function public.trg_snapshot_notify();

-- 3) Risco que chega à faixa crítica (score >= 15) e está em aberto
create or replace function public.trg_risks_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.score >= 15 and new.status in ('aberto','mitigando')
     and (tg_op = 'INSERT' or old.score < 15 or old.status not in ('aberto','mitigando')) then
    perform public.enqueue_notification('risco_alto', new.project_id, 'Risco crítico no projeto',
      left(new.title, 160) || ' (probabilidade ' || new.probability || ' × impacto ' || new.impact || ')', 'risk:' || new.project_id || ':' || new.id);
  end if;
  return null;
end $$;
drop trigger if exists risks_notify on public.risks;
create trigger risks_notify after insert or update of probability, impact, status on public.risks
  for each row execute function public.trg_risks_notify();

revoke all on function public.trg_decisions_notify() from public, anon, authenticated;
revoke all on function public.trg_snapshot_notify() from public, anon, authenticated;
revoke all on function public.trg_risks_notify() from public, anon, authenticated;

-- ▼▼▼ 20261023100600_messaging_cron.sql ▼▼▼
-- Agendamento do envio (pg_cron + pg_net). Os segredos NÃO moram aqui: a URL das funções e o segredo do
-- agendador ficam em private.cron_config (esquema "private" não é exposto pela API), preenchidos por
-- scripts/db-apply.mjs --setup-cron a partir do .env.deploy.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.cron_config (
  key text primary key,
  value text not null
);
revoke all on private.cron_config from public, anon, authenticated;

create or replace function private.call_function(p_name text) returns void
language plpgsql security definer set search_path = private, extensions, public as $$
declare base text; secret text;
begin
  select value into base from private.cron_config where key = 'functions_url';
  select value into secret from private.cron_config where key = 'cron_secret';
  if base is null or secret is null then return; end if; -- ainda não configurado: não faz nada
  perform net.http_post(
    url := base || '/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{}'::jsonb
  );
end $$;
revoke all on function private.call_function(text) from public, anon, authenticated;

-- Retenção (LGPD, minimização): trilha de mensagens 90 dias; fila já enviada 30 dias.
create or replace function private.purge_messaging() returns void
language sql security definer set search_path = public as $$
  delete from public.message_log where created_at < now() - interval '90 days';
  delete from public.notification_outbox where status in ('sent','skipped') and created_at < now() - interval '30 days';
$$;
revoke all on function private.purge_messaging() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('pmo-dispatch', 'pmo-digest', 'pmo-purge');
select cron.schedule('pmo-dispatch', '*/2 * * * *', $$select private.call_function('notify-dispatch')$$);
select cron.schedule('pmo-digest',   '5 * * * *',   $$select private.call_function('notify-digest')$$);
select cron.schedule('pmo-purge',    '30 6 * * *',  $$select private.purge_messaging()$$);

-- ▼▼▼ 20261023100700_baselines.sql ▼▼▼
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

-- ▼▼▼ 20261023100800_projects_area.sql ▼▼▼
-- Área / departamento do projeto (TI, Engenharia, Marketing...). Permite agrupar os indicadores do portfólio por área
-- e é o que um PMO Departamental precisa para filtrar a sua visão. Texto livre curto, opcional.
alter table public.projects add column if not exists area text
  check (area is null or char_length(area) <= 80);

-- ▼▼▼ 20261023100900_raci.sql ▼▼▼
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

-- ▼▼▼ 20261023101000_agile.sql ▼▼▼
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

-- ▼▼▼ 20261023101100_org_settings.sql ▼▼▼
-- Configurações da ORGANIZAÇÃO (valem para todos os projetos): hoje, o Perfil de PMO.
-- O tipo de PMO (Suporte, Controle, Diretivo, Estratégico, Ágil, Departamental) descreve a organização, não um projeto;
-- antes ele era gravado por projeto (project_settings, chave "pmoProfile"), o que permitia dois projetos da mesma empresa
-- terem "PMOs" diferentes. Essas linhas antigas continuam existindo e só servem de reserva se a organização não definir o seu.
-- Leitura: qualquer pessoa logada. Escrita: só administrador.
create table if not exists public.org_settings (
  key text primary key check (char_length(key) between 1 and 60),
  value jsonb not null default '{}'::jsonb check (pg_column_size(value) < 20000),
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.org_settings enable row level security;

create policy "org_settings_read" on public.org_settings for select
  using (auth.role() = 'authenticated');
create policy "org_settings_write" on public.org_settings for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

grant select, insert, update, delete on public.org_settings to authenticated;
revoke all on public.org_settings from anon;

-- ▼▼▼ 20261023101200_projects_methodology.sql ▼▼▼
-- Metodologia do projeto (agil, cascata ou hibrido), guardada no próprio cadastro do projeto.
-- Assim a lista de projetos (menu, busca, portfólio) mostra o método de TODOS os projetos de uma vez,
-- sem precisar abrir cada um. Nulo = projeto antigo, tratado como híbrido (todas as telas).
alter table public.projects add column if not exists methodology text
  check (methodology is null or methodology in ('agil','cascata','hibrido'));

-- ▼▼▼ 20261023101300_sprint_availability.sql ▼▼▼
-- Disponibilidade por pessoa em cada sprint (folgas, férias, ausências), usada no planejamento da capacidade.
-- Formato: {"Nome da pessoa": {"daysOff": 3}} — dias úteis em que a pessoa não trabalha na sprint.
alter table public.sprints add column if not exists availability jsonb not null default '{}'::jsonb
  check (jsonb_typeof(availability) = 'object' and pg_column_size(availability) < 20000);

-- ▼▼▼ 20261023101400_rites_templates_columns.sql ▼▼▼
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

-- ▼▼▼ 20261023101500_access_profiles.sql ▼▼▼
-- Perfis de acesso por PERMISSÃO (em vez de 4 papéis fixos) + perfis prontos do PMI e do Ágil + perfis personalizados.
--  * profiles.role passa a guardar o ID de um perfil de acesso (access_profiles.id). Os 4 papéis antigos continuam existindo
--    com o mesmo id e o mesmo poder (admin, gerente, consulta, manutencao), exceto: "consulta" deixa de ver custos e orçamento.
--  * has_perm('permissão') diz se a pessoa logada tem aquela permissão (administrador sempre tem todas).
--  * O time (Dev, QA, analista) atualiza SÓ o que é dele: itens e tarefas em que ele é o responsável e as próprias horas.
--    Para o banco saber quem é quem, a conta é vinculada ao colaborador (team_members.user_id), só o administrador vincula.

-- 1) Perfis de acesso -------------------------------------------------------------------------------------------------------
create table if not exists public.access_profiles (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  name text not null check (char_length(name) between 2 and 60),
  description text check (description is null or char_length(description) <= 300),
  family text not null default 'personalizado' check (family in ('geral','pmi','agil','personalizado')),
  is_system boolean not null default false,
  perms jsonb not null default '{}'::jsonb check (jsonb_typeof(perms) = 'object' and pg_column_size(perms) < 4000),
  created_at timestamptz not null default now()
);

insert into public.access_profiles (id, name, description, family, is_system, perms) values
  ('admin', 'Administrador', 'Tudo: acessos, perfis, configurações, limpeza e mensageria. Vê todos os projetos.', 'geral', true,
    '{"view_costs":true,"edit_plan":true,"edit_costs":true,"manage_backlog":true,"run_rites":true,"update_own":true,"log_hours":true,"view_all_hours":true,"approve_decisions":true,"create_projects":true,"manage_settings":true}'),
  ('gerente', 'Gerente de Projeto', 'Conduz plano, custos e equipe dos projetos liberados e cria projetos.', 'pmi', true,
    '{"view_costs":true,"edit_plan":true,"edit_costs":true,"manage_backlog":true,"run_rites":true,"update_own":true,"log_hours":true,"view_all_hours":true,"approve_decisions":true,"create_projects":true}'),
  ('patrocinador', 'Patrocinador / Diretoria', 'Acompanha tudo do projeto, inclusive custos, e aprova decisões. Não edita o plano.', 'pmi', true,
    '{"view_costs":true,"view_all_hours":true,"approve_decisions":true}'),
  ('po', 'Product Owner', 'Prioriza e estima o backlog, conduz a revisão e aceita as entregas.', 'agil', true,
    '{"manage_backlog":true,"run_rites":true,"update_own":true}'),
  ('sm', 'Scrum Master', 'Conduz sprints, ritos, impedimentos e o quadro.', 'agil', true,
    '{"manage_backlog":true,"run_rites":true,"update_own":true,"log_hours":true,"view_all_hours":true}'),
  ('time', 'Membro do time (Dev, QA, analista)', 'Atualiza as próprias atividades, aponta as próprias horas e registra impedimentos. Não vê custos.', 'geral', true,
    '{"update_own":true,"log_hours":true}'),
  ('consulta', 'Consulta (stakeholder)', 'Somente leitura, sem custos.', 'geral', true, '{}'),
  ('manutencao', 'TI / Suporte', 'Configurações do sistema (chaves de IA, integrações, backup). Lê como consulta.', 'geral', true, '{"manage_settings":true}')
on conflict (id) do nothing;

alter table public.access_profiles enable row level security;
create policy "access_profiles_read" on public.access_profiles for select using (auth.role() = 'authenticated');
create policy "access_profiles_insert" on public.access_profiles for insert
  with check (public.current_role() = 'admin' and is_system = false);
create policy "access_profiles_update" on public.access_profiles for update
  using (public.current_role() = 'admin' and id <> 'admin') with check (public.current_role() = 'admin' and id <> 'admin');
create policy "access_profiles_delete" on public.access_profiles for delete
  using (public.current_role() = 'admin' and is_system = false);
grant select, insert, update, delete on public.access_profiles to authenticated;
revoke all on public.access_profiles from anon;

-- 2) profiles.role passa a apontar para um perfil de acesso -----------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_fk foreign key (role) references public.access_profiles(id) on update cascade on delete restrict;

-- 3) Funções de permissão ---------------------------------------------------------------------------------------------------
create or replace function public.has_perm(p text)
returns boolean as $$
  select public.current_role() = 'admin'
    or coalesce((select (ap.perms ->> p) = 'true' from public.access_profiles ap where ap.id = public.current_role()), false);
$$ language sql stable security definer;

-- 4) Vínculo da conta com o colaborador (só administrador vincula) ---------------------------------------------------------
alter table public.team_members add column if not exists user_id uuid references auth.users(id) on delete set null;
create unique index if not exists team_members_user_uidx on public.team_members(project_id, user_id) where user_id is not null;

create or replace function public.is_my_member(pid text, nm text)
returns boolean as $$
  select nm is not null and exists (select 1 from public.team_members tm where tm.project_id = pid and tm.user_id = auth.uid() and tm.name = nm);
$$ language sql stable security definer;

create or replace function public.guard_member_link()
returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.user_id is not null) or (tg_op = 'UPDATE' and new.user_id is distinct from old.user_id) then
    if public.current_role() <> 'admin' then
      raise exception 'Só o administrador pode vincular uma conta a um colaborador';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;
drop trigger if exists team_members_guard_link on public.team_members;
create trigger team_members_guard_link before insert or update on public.team_members for each row execute procedure public.guard_member_link();

-- 5) Regras de escrita por permissão (o que cada perfil pode gravar) ---------------------------------------------------------
-- Plano: WBS, mudanças de escopo, riscos, RACI, documentos, equipe, linha de base
drop policy if exists "wbs_modules_write" on public.wbs_modules;
create policy "wbs_modules_write" on public.wbs_modules for all
  using (public.has_perm('edit_plan') and public.has_project_access(project_id)) with check (public.has_perm('edit_plan') and public.has_project_access(project_id));

drop policy if exists "wbs_tasks_write" on public.wbs_tasks;
create policy "wbs_tasks_insert" on public.wbs_tasks for insert
  with check (public.has_project_access(project_id) and (public.has_perm('edit_plan') or (public.has_perm('update_own') and public.is_my_member(project_id, responsavel))));
create policy "wbs_tasks_update" on public.wbs_tasks for update
  using (public.has_project_access(project_id) and (public.has_perm('edit_plan') or (public.has_perm('update_own') and public.is_my_member(project_id, responsavel))))
  with check (public.has_project_access(project_id) and (public.has_perm('edit_plan') or (public.has_perm('update_own') and public.is_my_member(project_id, responsavel))));
create policy "wbs_tasks_delete" on public.wbs_tasks for delete
  using (public.has_perm('edit_plan') and public.has_project_access(project_id));

drop policy if exists "decisions_write" on public.decisions;
create policy "decisions_write" on public.decisions for all
  using ((public.has_perm('edit_plan') or public.has_perm('approve_decisions')) and public.has_project_access(project_id))
  with check ((public.has_perm('edit_plan') or public.has_perm('approve_decisions')) and public.has_project_access(project_id));

drop policy if exists "documents_write" on public.documents;
create policy "documents_write" on public.documents for all
  using (public.has_perm('edit_plan') and public.has_project_access(project_id)) with check (public.has_perm('edit_plan') and public.has_project_access(project_id));

drop policy if exists "scope_changes_write" on public.scope_changes;
create policy "scope_changes_write" on public.scope_changes for all
  using (public.has_perm('edit_plan') and public.has_project_access(project_id)) with check (public.has_perm('edit_plan') and public.has_project_access(project_id));

drop policy if exists "risks_write" on public.risks;
create policy "risks_write" on public.risks for all
  using (public.has_perm('edit_plan') and public.has_project_access(project_id)) with check (public.has_perm('edit_plan') and public.has_project_access(project_id));

drop policy if exists "baselines_insert" on public.baselines;
create policy "baselines_insert" on public.baselines for insert
  with check (public.has_perm('edit_plan') and public.has_project_access(project_id));

drop policy if exists "raci_insert" on public.raci_entries;
drop policy if exists "raci_update" on public.raci_entries;
drop policy if exists "raci_delete" on public.raci_entries;
create policy "raci_insert" on public.raci_entries for insert with check (public.has_perm('edit_plan') and public.has_project_access(project_id));
create policy "raci_update" on public.raci_entries for update
  using (public.has_perm('edit_plan') and public.has_project_access(project_id)) with check (public.has_perm('edit_plan') and public.has_project_access(project_id));
create policy "raci_delete" on public.raci_entries for delete using (public.has_perm('edit_plan') and public.has_project_access(project_id));

drop policy if exists "team_members_write" on public.team_members;
create policy "team_members_write" on public.team_members for all
  using (public.has_perm('edit_plan') and public.has_project_access(project_id)) with check (public.has_perm('edit_plan') and public.has_project_access(project_id));

-- Custos e orçamento: só quem tem a permissão enxerga e edita (o time e a consulta não veem)
drop policy if exists "budget_lines_read" on public.budget_lines;
drop policy if exists "budget_lines_write" on public.budget_lines;
create policy "budget_lines_read" on public.budget_lines for select using (public.has_project_access(project_id) and public.has_perm('view_costs'));
create policy "budget_lines_write" on public.budget_lines for all
  using (public.has_perm('edit_costs') and public.has_project_access(project_id)) with check (public.has_perm('edit_costs') and public.has_project_access(project_id));
drop policy if exists "cost_actuals_read" on public.cost_actuals;
drop policy if exists "cost_actuals_write" on public.cost_actuals;
create policy "cost_actuals_read" on public.cost_actuals for select using (public.has_project_access(project_id) and public.has_perm('view_costs'));
create policy "cost_actuals_write" on public.cost_actuals for all
  using (public.has_perm('edit_costs') and public.has_project_access(project_id)) with check (public.has_perm('edit_costs') and public.has_project_access(project_id));

-- Configurações do projeto e decisões da diretoria
drop policy if exists "project_settings_write" on public.project_settings;
create policy "project_settings_write" on public.project_settings for all
  using ((public.has_perm('edit_plan') or public.has_perm('manage_backlog') or public.has_perm('run_rites')) and public.has_project_access(project_id))
  with check ((public.has_perm('edit_plan') or public.has_perm('manage_backlog') or public.has_perm('run_rites')) and public.has_project_access(project_id));
drop policy if exists "board_decisions_write" on public.board_decisions;
create policy "board_decisions_write" on public.board_decisions for all
  using ((public.has_perm('approve_decisions') or public.has_perm('edit_plan')) and public.has_project_access(project_id))
  with check ((public.has_perm('approve_decisions') or public.has_perm('edit_plan')) and public.has_project_access(project_id));
drop policy if exists "project_docs_write" on public.project_docs;
create policy "project_docs_write" on public.project_docs for all
  using ((public.has_perm('edit_plan') or public.has_perm('run_rites')) and public.has_project_access(project_id))
  with check ((public.has_perm('edit_plan') or public.has_perm('run_rites')) and public.has_project_access(project_id));

-- Ágil: backlog (o time mexe só no que é dele), sprints, ritos e impedimentos
drop policy if exists "backlog_items_write" on public.backlog_items;
create policy "backlog_items_insert" on public.backlog_items for insert
  with check (public.has_project_access(project_id) and (public.has_perm('manage_backlog') or (public.has_perm('update_own') and public.is_my_member(project_id, assignee))));
create policy "backlog_items_update" on public.backlog_items for update
  using (public.has_project_access(project_id) and (public.has_perm('manage_backlog') or (public.has_perm('update_own') and public.is_my_member(project_id, assignee))))
  with check (public.has_project_access(project_id) and (public.has_perm('manage_backlog') or (public.has_perm('update_own') and public.is_my_member(project_id, assignee))));
create policy "backlog_items_delete" on public.backlog_items for delete
  using (public.has_perm('manage_backlog') and public.has_project_access(project_id));

drop policy if exists "sprints_write" on public.sprints;
create policy "sprints_write" on public.sprints for all
  using ((public.has_perm('manage_backlog') or public.has_perm('run_rites')) and public.has_project_access(project_id))
  with check ((public.has_perm('manage_backlog') or public.has_perm('run_rites')) and public.has_project_access(project_id));
drop policy if exists "sprint_rites_write" on public.sprint_rites;
create policy "sprint_rites_write" on public.sprint_rites for all
  using (public.has_perm('run_rites') and public.has_project_access(project_id)) with check (public.has_perm('run_rites') and public.has_project_access(project_id));

drop policy if exists "impediments_write" on public.impediments;
create policy "impediments_insert" on public.impediments for insert
  with check ((public.has_perm('run_rites') or public.has_perm('update_own')) and public.has_project_access(project_id));
create policy "impediments_update" on public.impediments for update
  using ((public.has_perm('run_rites') or public.has_perm('update_own')) and public.has_project_access(project_id))
  with check ((public.has_perm('run_rites') or public.has_perm('update_own')) and public.has_project_access(project_id));
create policy "impediments_delete" on public.impediments for delete
  using (public.has_perm('run_rites') and public.has_project_access(project_id));

-- Horas: cada pessoa lança e vê as próprias; quem tem "ver horas de todos" vê tudo; quem edita o plano corrige as de qualquer um
drop policy if exists "time_entries_read" on public.time_entries;
drop policy if exists "time_entries_write" on public.time_entries;
create policy "time_entries_read" on public.time_entries for select
  using (public.has_project_access(project_id) and (public.has_perm('view_all_hours') or created_by = auth.uid()));
create policy "time_entries_insert" on public.time_entries for insert
  with check (public.has_project_access(project_id) and (public.has_perm('log_hours') or public.has_perm('edit_plan')) and created_by = auth.uid());
create policy "time_entries_update" on public.time_entries for update
  using (public.has_project_access(project_id) and ((created_by = auth.uid() and public.has_perm('log_hours')) or public.has_perm('edit_plan')))
  with check (public.has_project_access(project_id) and ((created_by = auth.uid() and public.has_perm('log_hours')) or public.has_perm('edit_plan')));
create policy "time_entries_delete" on public.time_entries for delete
  using (public.has_project_access(project_id) and ((created_by = auth.uid() and public.has_perm('log_hours')) or public.has_perm('edit_plan')));

-- Projetos: quem cria, quem edita e quem exclui
drop policy if exists "projects_write" on public.projects;
create policy "projects_insert" on public.projects for insert with check (public.has_perm('create_projects'));
create policy "projects_update" on public.projects for update
  using (public.has_perm('edit_plan') and public.has_project_access(id)) with check (public.has_perm('edit_plan') and public.has_project_access(id));
create policy "projects_delete" on public.projects for delete using (public.current_role() = 'admin');

drop policy if exists "project_access_self_grant" on public.project_access;
create policy "project_access_self_grant" on public.project_access for insert
  with check (user_id = auth.uid() and public.has_perm('create_projects'));

-- Excluir um projeto inteiro (administrador) precisa apagar também o histórico de fotos de saúde
create policy "project_snapshots_admin_delete" on public.project_snapshots for delete using (public.current_role() = 'admin');

-- ▼▼▼ 20261023101600_project_manager.sql ▼▼▼
-- Gerente responsável pelo projeto: além do Administrador, só ele inclui ou tira pessoas do projeto.
-- Sem gerente definido, só o Administrador mexe no acesso (nada é concedido por acidente a quem já existia).

alter table public.projects add column if not exists manager_id uuid references auth.users(id) on delete set null;

-- É o gerente responsável por este projeto? (precisa continuar com permissão de editar o plano)
create or replace function public.is_project_manager(pid text) returns boolean as $$
  select public.has_perm('edit_plan')
    and exists (select 1 from public.projects where id = pid and manager_id = auth.uid());
$$ language sql stable security definer;

-- É o gerente responsável por algum projeto? (libera ver a lista de contas para escolher quem incluir)
create or replace function public.is_any_project_manager() returns boolean as $$
  select public.has_perm('edit_plan') and exists (select 1 from public.projects where manager_id = auth.uid());
$$ language sql stable security definer;

-- Quem cria o projeto sendo gerente já nasce como responsável; trocar o responsável é só do Administrador.
create or replace function public.guard_project_manager() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    if new.manager_id is null and public.current_role() = 'gerente' then new.manager_id := auth.uid(); end if;
    if new.manager_id is not null and auth.uid() is not null and public.current_role() <> 'admin' and new.manager_id <> auth.uid() then
      raise exception 'Só o Administrador define outra pessoa como gerente responsável.';
    end if;
  elsif new.manager_id is distinct from old.manager_id and auth.uid() is not null and coalesce(public.current_role(), '') <> 'admin' then
    raise exception 'Só o Administrador troca o gerente responsável pelo projeto.';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists guard_project_manager on public.projects;
create trigger guard_project_manager before insert or update on public.projects
  for each row execute function public.guard_project_manager();

-- O gerente responsável vê, inclui e remove pessoas SÓ dos projetos dele (nunca remove a si mesmo)
create policy "project_access_manager_read" on public.project_access for select using (public.is_project_manager(project_id));
create policy "project_access_manager_insert" on public.project_access for insert
  with check (public.is_project_manager(project_id) and granted_by = auth.uid());
create policy "project_access_manager_update" on public.project_access for update
  using (public.is_project_manager(project_id)) with check (public.is_project_manager(project_id) and granted_by = auth.uid());
create policy "project_access_manager_delete" on public.project_access for delete
  using (public.is_project_manager(project_id) and user_id <> auth.uid());

-- Para escolher quem incluir, o gerente responsável precisa enxergar as contas (nome e perfil); só leitura
create policy "profiles_manager_select" on public.profiles for select using (public.is_any_project_manager());

-- ▼▼▼ 20261101100000_profile_details.sql ▼▼▼
-- Complemento do cadastro de cada pessoa (preenchido no primeiro acesso): departamento, conhecimentos,
-- ferramentas e o WhatsApp para as mensagens do sistema. O telefone é dado pessoal (LGPD): só é gravado
-- com o "sim" explícito da própria pessoa; o servidor carimba a data do consentimento e apaga o número
-- se o consentimento for retirado. Lê: a própria pessoa e o administrador. Escreve: só a própria pessoa.

create table if not exists public.profile_details (
  user_id uuid primary key references auth.users(id) on delete cascade,
  department text not null default '' check (char_length(department) <= 80),
  knowledge text not null default '' check (char_length(knowledge) <= 600),
  tools text not null default '' check (char_length(tools) <= 400),
  phone text check (phone is null or phone ~ '^[0-9]{10,15}$'),
  whatsapp_consent boolean not null default false,
  whatsapp_consent_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint profile_phone_needs_consent check (phone is null or (whatsapp_consent and whatsapp_consent_at is not null))
);

alter table public.profile_details enable row level security;

create policy "profile_details_select" on public.profile_details
  for select using (user_id = auth.uid() or public.current_role() = 'admin');
create policy "profile_details_insert_own" on public.profile_details
  for insert with check (user_id = auth.uid());
create policy "profile_details_update_own" on public.profile_details
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "profile_details_delete_own" on public.profile_details
  for delete using (user_id = auth.uid());

-- O servidor decide o consentimento: sem "sim" não há telefone; com "sim" a data é a do servidor
create or replace function public.guard_profile_details() returns trigger as $$
begin
  new.updated_at := now();
  if not new.whatsapp_consent then
    new.phone := null; new.whatsapp_consent_at := null;
  elsif tg_op = 'INSERT' or not old.whatsapp_consent or new.whatsapp_consent_at is null then
    new.whatsapp_consent_at := now();
  else
    new.whatsapp_consent_at := old.whatsapp_consent_at;
  end if;
  if new.completed_at is null and char_length(btrim(new.department)) > 0
     and char_length(btrim(new.knowledge)) > 0 and char_length(btrim(new.tools)) > 0 then
    new.completed_at := now();
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists guard_profile_details on public.profile_details;
create trigger guard_profile_details before insert or update on public.profile_details
  for each row execute function public.guard_profile_details();

-- ▼▼▼ 20261101110000_user_lifecycle.sql ▼▼▼
-- Ciclo de vida do usuário: inativar (reversível, mantém o histórico) e trocar o responsável das atividades pendentes.
--  * Conta inativa: não entra mais (a função de borda também bloqueia o login no Auth) e perde, na hora, o perfil de acesso
--    (current_role() passa a devolver nulo), mesmo que o token ainda não tenha vencido.
--  * Trocar responsável: o Administrador, ou o gerente responsável pelo projeto, passa as atividades NÃO concluídas
--    (itens do backlog e tarefas/módulos do cronograma) de uma pessoa para outra — ou para "sem responsável".

alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles add column if not exists deactivated_at timestamptz;

-- Só o Administrador (ou o servidor) liga/desliga a conta; ninguém reativa a si mesmo
create or replace function public.guard_profile_active() returns trigger as $$
begin
  if new.active is distinct from old.active and auth.uid() is not null and coalesce(public.current_role(), '') <> 'admin' then
    new.active := old.active;
  end if;
  if new.active is distinct from old.active then
    new.deactivated_at := case when new.active then null else now() end;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists guard_profile_active on public.profiles;
create trigger guard_profile_active before update on public.profiles
  for each row execute function public.guard_profile_active();

-- Conta inativa não tem perfil: todas as regras que dependem do perfil passam a negar
create or replace function public.current_role()
returns text as $$
  select role from public.profiles where id = auth.uid() and active;
$$ language sql stable security definer;

-- Quantas atividades pendentes uma pessoa tem no projeto (para mostrar antes de trocar)
create or replace function public.pending_work(pid text, person text) returns jsonb as $$
declare b int; w int;
begin
  if not (public.current_role() = 'admin' or public.is_project_manager(pid)) then
    raise exception 'Só o Administrador ou o gerente responsável pelo projeto.';
  end if;
  select count(*) into b from public.backlog_items where project_id = pid and status <> 'done' and lower(btrim(assignee)) = lower(btrim(person));
  select (select count(*) from public.wbs_modules where project_id = pid and status <> 'grn' and lower(btrim(responsavel)) = lower(btrim(person)))
       + (select count(*) from public.wbs_tasks where project_id = pid and status <> 'grn' and lower(btrim(responsavel)) = lower(btrim(person))) into w;
  return jsonb_build_object('backlog', b, 'cronograma', w);
end;
$$ language plpgsql stable security definer set search_path = public;

-- Passa as atividades NÃO concluídas de uma pessoa para outra (to_person vazio = sem responsável). Concluídas não mudam.
create or replace function public.reassign_work(pid text, from_person text, to_person text) returns jsonb as $$
declare b int; m int; t int; dest text := nullif(btrim(coalesce(to_person, '')), '');
begin
  if not (public.current_role() = 'admin' or public.is_project_manager(pid)) then
    raise exception 'Só o Administrador ou o gerente responsável pelo projeto.';
  end if;
  if nullif(btrim(coalesce(from_person, '')), '') is null then raise exception 'Informe de quem as atividades serão tiradas.'; end if;
  if dest is not null and lower(dest) = lower(btrim(from_person)) then raise exception 'A pessoa de origem e a de destino são a mesma.'; end if;
  update public.backlog_items set assignee = dest, updated_at = now()
    where project_id = pid and status <> 'done' and lower(btrim(assignee)) = lower(btrim(from_person));
  get diagnostics b = row_count;
  update public.wbs_modules set responsavel = dest, updated_at = now()
    where project_id = pid and status <> 'grn' and lower(btrim(responsavel)) = lower(btrim(from_person));
  get diagnostics m = row_count;
  update public.wbs_tasks set responsavel = dest, updated_at = now()
    where project_id = pid and status <> 'grn' and lower(btrim(responsavel)) = lower(btrim(from_person));
  get diagnostics t = row_count;
  return jsonb_build_object('backlog', b, 'cronograma', m + t);
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.pending_work(text, text) to authenticated;
grant execute on function public.reassign_work(text, text, text) to authenticated;

-- ▼▼▼ 20261101110100_user_lifecycle_fix.sql ▼▼▼
-- Correção: conta inativa (perfil nulo) passava na checagem "admin ou gerente responsável" porque `null = 'admin'` é nulo, não falso.
create or replace function public.pending_work(pid text, person text) returns jsonb as $$
declare b int; w int;
begin
  if not (coalesce(public.current_role(), '') = 'admin' or coalesce(public.is_project_manager(pid), false)) then
    raise exception 'Só o Administrador ou o gerente responsável pelo projeto.';
  end if;
  select count(*) into b from public.backlog_items where project_id = pid and status <> 'done' and lower(btrim(assignee)) = lower(btrim(person));
  select (select count(*) from public.wbs_modules where project_id = pid and status <> 'grn' and lower(btrim(responsavel)) = lower(btrim(person)))
       + (select count(*) from public.wbs_tasks where project_id = pid and status <> 'grn' and lower(btrim(responsavel)) = lower(btrim(person))) into w;
  return jsonb_build_object('backlog', b, 'cronograma', w);
end;
$$ language plpgsql stable security definer set search_path = public;

create or replace function public.reassign_work(pid text, from_person text, to_person text) returns jsonb as $$
declare b int; m int; t int; dest text := nullif(btrim(coalesce(to_person, '')), '');
begin
  if not (coalesce(public.current_role(), '') = 'admin' or coalesce(public.is_project_manager(pid), false)) then
    raise exception 'Só o Administrador ou o gerente responsável pelo projeto.';
  end if;
  if nullif(btrim(coalesce(from_person, '')), '') is null then raise exception 'Informe de quem as atividades serão tiradas.'; end if;
  if dest is not null and lower(dest) = lower(btrim(from_person)) then raise exception 'A pessoa de origem e a de destino são a mesma.'; end if;
  update public.backlog_items set assignee = dest, updated_at = now()
    where project_id = pid and status <> 'done' and lower(btrim(assignee)) = lower(btrim(from_person));
  get diagnostics b = row_count;
  update public.wbs_modules set responsavel = dest, updated_at = now()
    where project_id = pid and status <> 'grn' and lower(btrim(responsavel)) = lower(btrim(from_person));
  get diagnostics m = row_count;
  update public.wbs_tasks set responsavel = dest, updated_at = now()
    where project_id = pid and status <> 'grn' and lower(btrim(responsavel)) = lower(btrim(from_person));
  get diagnostics t = row_count;
  return jsonb_build_object('backlog', b, 'cronograma', m + t);
end;
$$ language plpgsql security definer set search_path = public;

-- ▼▼▼ 20261101120000_person_details.sql ▼▼▼
-- "Ver cadastro" de uma pessoa: o Administrador vê tudo; o gerente responsável vê o cadastro das pessoas dos SEUS projetos,
-- sem o telefone (dado pessoal usado só para as mensagens do sistema); cada pessoa vê o próprio. Conta inativa não consulta.
create or replace function public.person_details(uid uuid) returns jsonb as $$
declare
  is_admin boolean := coalesce(public.current_role(), '') = 'admin';
  allowed boolean;
  r jsonb;
begin
  allowed := is_admin or uid = auth.uid() or exists (
    select 1 from public.projects pr
    where coalesce(public.is_project_manager(pr.id), false)
      and (exists (select 1 from public.project_access pa where pa.project_id = pr.id and pa.user_id = uid)
        or exists (select 1 from public.team_members tm where tm.project_id = pr.id and tm.user_id = uid)));
  if not allowed then raise exception 'Sem permissão para ver este cadastro.'; end if;
  select jsonb_build_object(
      'id', p.id, 'name', p.name, 'role', p.role, 'active', p.active, 'email', u.email,
      'has_details', d.user_id is not null,
      'department', d.department, 'knowledge', d.knowledge, 'tools', d.tools,
      'completed_at', d.completed_at,
      'whatsapp_consent', coalesce(d.whatsapp_consent, false), 'whatsapp_consent_at', d.whatsapp_consent_at,
      'phone', case when is_admin or uid = auth.uid() then d.phone end)
    into r
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.profile_details d on d.user_id = p.id
    where p.id = uid;
  return r;
end;
$$ language plpgsql stable security definer set search_path = public;

grant execute on function public.person_details(uuid) to authenticated;

-- ▼▼▼ 20261101130000_skills_reviews.sql ▼▼▼
-- 1) Conhecimentos e ferramentas com nível (júnior/pleno/sênior), pesquisáveis pelo gerente de projetos.
--    Substitui os dois campos de texto livre por uma lista: [{ "kind": "conhecimento"|"ferramenta", "name": "SAP FI", "level": "junior"|"pleno"|"senior" }]
-- 2) Avaliações do profissional por projeto: a própria pessoa (autoavaliação) e o gerente responsável.

alter table public.profile_details add column if not exists skills jsonb not null default '[]'::jsonb
  check (jsonb_typeof(skills) = 'array' and pg_column_size(skills) < 8000);
alter table public.profile_details drop column if exists knowledge;
alter table public.profile_details drop column if exists tools;
create index if not exists profile_details_skills_idx on public.profile_details using gin (skills jsonb_path_ops);

-- Cadastro completo = departamento + ao menos 1 conhecimento + ao menos 1 ferramenta
create or replace function public.guard_profile_details() returns trigger as $$
begin
  new.updated_at := now();
  if not new.whatsapp_consent then
    new.phone := null; new.whatsapp_consent_at := null;
  elsif tg_op = 'INSERT' or not old.whatsapp_consent or new.whatsapp_consent_at is null then
    new.whatsapp_consent_at := now();
  else
    new.whatsapp_consent_at := old.whatsapp_consent_at;
  end if;
  if char_length(btrim(new.department)) > 0
     and jsonb_path_exists(new.skills, '$[*] ? (@.kind == "conhecimento")')
     and jsonb_path_exists(new.skills, '$[*] ? (@.kind == "ferramenta")') then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.person_details(uid uuid) returns jsonb as $$
declare
  is_admin boolean := coalesce(public.current_role(), '') = 'admin';
  allowed boolean;
  r jsonb;
begin
  allowed := is_admin or uid = auth.uid() or exists (
    select 1 from public.projects pr
    where coalesce(public.is_project_manager(pr.id), false)
      and (exists (select 1 from public.project_access pa where pa.project_id = pr.id and pa.user_id = uid)
        or exists (select 1 from public.team_members tm where tm.project_id = pr.id and tm.user_id = uid)));
  if not allowed then raise exception 'Sem permissão para ver este cadastro.'; end if;
  select jsonb_build_object(
      'id', p.id, 'name', p.name, 'role', p.role, 'active', p.active, 'email', u.email,
      'has_details', d.user_id is not null,
      'department', d.department, 'skills', coalesce(d.skills, '[]'::jsonb),
      'completed_at', d.completed_at,
      'whatsapp_consent', coalesce(d.whatsapp_consent, false), 'whatsapp_consent_at', d.whatsapp_consent_at,
      'phone', case when is_admin or uid = auth.uid() then d.phone end)
    into r
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.profile_details d on d.user_id = p.id
    where p.id = uid;
  return r;
end;
$$ language plpgsql stable security definer set search_path = public;

-- Quem tem tal conhecimento/ferramenta em tal nível (para o gerente escolher um profissional). Nome parcial, sem acento/caixa.
-- Só devolve nome, departamento e a habilidade — nunca e-mail nem telefone — e só para Administrador e gerentes de projeto.
create or replace function public.find_people(term text, min_level text default null) returns jsonb as $$
declare rank_min int := case min_level when 'senior' then 3 when 'pleno' then 2 when 'junior' then 1 else 0 end;
begin
  if not (coalesce(public.current_role(), '') = 'admin' or public.is_any_project_manager()) then
    raise exception 'Só o Administrador ou o gerente de projetos pode pesquisar profissionais.';
  end if;
  if char_length(btrim(coalesce(term, ''))) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'department', d.department, 'skill', s.value->>'name', 'kind', s.value->>'kind', 'level', s.value->>'level') order by p.name)
    from public.profile_details d
    join public.profiles p on p.id = d.user_id and p.active
    cross join lateral jsonb_array_elements(d.skills) s(value)
    where lower(s.value->>'name') like '%' || lower(replace(replace(btrim(term), '%', ''), '_', '')) || '%'
      and (case s.value->>'level' when 'senior' then 3 when 'pleno' then 2 when 'junior' then 1 else 0 end) >= rank_min
    limit 100), '[]'::jsonb);
end;
$$ language plpgsql stable security definer set search_path = public;
grant execute on function public.find_people(text, text) to authenticated;

-- Avaliações por projeto: "self" = a pessoa se avalia; "manager" = o gerente responsável avalia
create table if not exists public.person_reviews (
  project_id text not null references public.projects(id) on delete cascade,
  person_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('self', 'manager')),
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  scores jsonb not null,
  would_work_again boolean,
  comment text check (comment is null or char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, person_id, kind)
);
alter table public.person_reviews enable row level security;

-- Cada critério de 1 a 5 (qualidade, prazos, comunicação, colaboração, autonomia); nada além disso
create or replace function public.guard_person_review() returns trigger as $$
declare k text;
begin
  if jsonb_typeof(new.scores) <> 'object' then raise exception 'Notas inválidas.'; end if;
  for k in select unnest(array['qualidade','prazos','comunicacao','colaboracao','autonomia']) loop
    if not (new.scores ? k) or jsonb_typeof(new.scores->k) <> 'number' or (new.scores->>k)::numeric not between 1 and 5 or (new.scores->>k)::numeric <> trunc((new.scores->>k)::numeric) then
      raise exception 'Dê uma nota de 1 a 5 em cada critério.';
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(new.scores)) <> 5 then raise exception 'Notas inválidas.'; end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;
drop trigger if exists guard_person_review on public.person_reviews;
create trigger guard_person_review before insert or update on public.person_reviews
  for each row execute function public.guard_person_review();

-- Lê: o Administrador, a própria pessoa e o gerente responsável do projeto
create policy "person_reviews_select" on public.person_reviews for select using (
  coalesce(public.current_role(), '') = 'admin' or person_id = auth.uid() or coalesce(public.is_project_manager(project_id), false));
-- Escreve: a pessoa só a própria autoavaliação (em projeto onde está); o gerente responsável, a de quem está no projeto dele
create policy "person_reviews_write_self" on public.person_reviews for insert with check (
  kind = 'self' and person_id = auth.uid() and reviewer_id = auth.uid() and public.current_role() is not null
  and exists (select 1 from public.project_access pa where pa.project_id = person_reviews.project_id and pa.user_id = auth.uid()));
create policy "person_reviews_update_self" on public.person_reviews for update
  using (kind = 'self' and person_id = auth.uid() and public.current_role() is not null)
  with check (kind = 'self' and person_id = auth.uid() and reviewer_id = auth.uid());
create policy "person_reviews_write_manager" on public.person_reviews for insert with check (
  kind = 'manager' and reviewer_id = auth.uid() and person_id <> auth.uid() and coalesce(public.is_project_manager(project_id), false)
  and exists (select 1 from public.project_access pa where pa.project_id = person_reviews.project_id and pa.user_id = person_reviews.person_id));
create policy "person_reviews_update_manager" on public.person_reviews for update
  using (kind = 'manager' and coalesce(public.is_project_manager(project_id), false))
  with check (kind = 'manager' and reviewer_id = auth.uid() and person_id <> auth.uid() and coalesce(public.is_project_manager(project_id), false));

-- ▼▼▼ 20261101140000_skill_catalog.sql ▼▼▼
-- Catálogo comum de conhecimentos e ferramentas: a pessoa escolhe da lista; se não achar, digita e o item é CRIADO e passa a aparecer para todos.
-- Reduz divergência de escrita ("SAP FI", "sap fi", "S.A.P. FI"): o servidor reconhece o mesmo nome (sem caixa, acento nem espaço repetido) e devolve o item que já existe.
-- Preparado para uma futura ferramenta de unificação: `merged_into` aponta o item "oficial" e o administrador pode renomear/juntar.

create table if not exists public.skill_catalog (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('conhecimento', 'ferramenta')),
  name text not null check (char_length(name) between 2 and 60),
  name_key text not null,
  merged_into uuid references public.skill_catalog(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists skill_catalog_key_uidx on public.skill_catalog(kind, name_key);
alter table public.skill_catalog enable row level security;
create policy "skill_catalog_read" on public.skill_catalog for select using (auth.role() = 'authenticated');
create policy "skill_catalog_admin_write" on public.skill_catalog for all
  using (coalesce(public.current_role(), '') = 'admin') with check (coalesce(public.current_role(), '') = 'admin');

-- Mesmo nome, sem diferenças de caixa, acento, pontuação solta ou espaços
create or replace function public.skill_key(t text) returns text as $$
  select btrim(regexp_replace(regexp_replace(
    translate(lower(coalesce(t, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9+#.]+', ' ', 'g'), '\s+', ' ', 'g'));
$$ language sql immutable;

-- Recebe [{kind, name}] e devolve [{kind, skill_id, name}]: reaproveita o que já existe e cria o que falta (máx. 20 novos por pessoa por dia)
create or replace function public.resolve_skills(items jsonb) returns jsonb as $$
declare it jsonb; k text; nm text; nk text; row public.skill_catalog; out jsonb := '[]'::jsonb; created_today int;
begin
  if auth.uid() is null or public.current_role() is null then raise exception 'Entre na sua conta para cadastrar.'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 40 then raise exception 'Lista inválida.'; end if;
  for it in select * from jsonb_array_elements(items) loop
    k := it->>'kind'; nm := btrim(regexp_replace(coalesce(it->>'name', ''), '\s+', ' ', 'g'));
    if k not in ('conhecimento', 'ferramenta') then raise exception 'Tipo inválido.'; end if;
    if char_length(nm) < 2 or char_length(nm) > 60 then raise exception 'O nome precisa ter de 2 a 60 caracteres: %', left(nm, 30); end if;
    nk := public.skill_key(nm);
    if nk = '' then raise exception 'Nome inválido: %', left(nm, 30); end if;
    select * into row from public.skill_catalog where kind = k and name_key = nk;
    if not found then
      select count(*) into created_today from public.skill_catalog where created_by = auth.uid() and created_at > now() - interval '1 day';
      if created_today >= 20 then raise exception 'Limite de 20 itens novos por dia — escolha na lista ou peça ao administrador.'; end if;
      insert into public.skill_catalog(kind, name, name_key, created_by) values (k, nm, nk, auth.uid()) returning * into row;
    end if;
    while row.merged_into is not null loop select * into row from public.skill_catalog where id = row.merged_into; end loop;
    out := out || jsonb_build_object('kind', row.kind, 'skill_id', row.id, 'name', row.name);
  end loop;
  return out;
end;
$$ language plpgsql security definer set search_path = public;
grant execute on function public.resolve_skills(jsonb) to authenticated;

-- Itens iniciais comuns, para a lista não nascer vazia e a escrita já nascer padronizada
insert into public.skill_catalog(kind, name, name_key) select v.kind, v.name, public.skill_key(v.name) from (values
  ('conhecimento','Gestão de projetos'),('conhecimento','Metodologias ágeis'),('conhecimento','Scrum'),('conhecimento','Análise de requisitos'),
  ('conhecimento','Testes e qualidade (QA)'),('conhecimento','Desenvolvimento web'),('conhecimento','Banco de dados'),('conhecimento','UX/UI'),
  ('conhecimento','Segurança da informação'),('conhecimento','SAP FI'),('conhecimento','SAP MM'),('conhecimento','Gestão de riscos'),
  ('ferramenta','Excel'),('ferramenta','Power BI'),('ferramenta','Jira'),('ferramenta','SQL'),('ferramenta','Python'),('ferramenta','MS Project'),
  ('ferramenta','Azure DevOps'),('ferramenta','Confluence'),('ferramenta','Trello'),('ferramenta','Figma'),('ferramenta','Git')
) as v(kind, name) on conflict (kind, name_key) do nothing;

-- A lista de habilidades de cada pessoa precisa ser do formato certo (e, quando traz o item do catálogo, o tipo tem de bater)
create or replace function public.guard_profile_details() returns trigger as $$
declare s jsonb; c public.skill_catalog;
begin
  new.updated_at := now();
  if jsonb_array_length(new.skills) > 40 then raise exception 'Muitas habilidades (máximo 40).'; end if;
  for s in select * from jsonb_array_elements(new.skills) loop
    if jsonb_typeof(s) <> 'object' or (s->>'kind') not in ('conhecimento', 'ferramenta') or (s->>'level') not in ('junior', 'pleno', 'senior')
       or char_length(btrim(coalesce(s->>'name', ''))) not between 2 and 60 then
      raise exception 'Habilidade inválida: informe nome, tipo e nível (júnior, pleno ou sênior).';
    end if;
    if s ? 'skill_id' then
      select * into c from public.skill_catalog where id = (s->>'skill_id')::uuid;
      if not found or c.kind <> s->>'kind' then raise exception 'Item do catálogo inválido.'; end if;
    end if;
  end loop;
  if not new.whatsapp_consent then
    new.phone := null; new.whatsapp_consent_at := null;
  elsif tg_op = 'INSERT' or not old.whatsapp_consent or new.whatsapp_consent_at is null then
    new.whatsapp_consent_at := now();
  else
    new.whatsapp_consent_at := old.whatsapp_consent_at;
  end if;
  if char_length(btrim(new.department)) > 0
     and jsonb_path_exists(new.skills, '$[*] ? (@.kind == "conhecimento")')
     and jsonb_path_exists(new.skills, '$[*] ? (@.kind == "ferramenta")') then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ▼▼▼ 20261101150000_reviews_admin_delete.sql ▼▼▼
-- O Administrador pode apagar avaliações de um projeto (usado por "Apagar dados" do projeto e da base inteira)
create policy "person_reviews_admin_delete" on public.person_reviews for delete using (coalesce(public.current_role(), '') = 'admin');

-- ▼▼▼ 20261101160000_bug_reports.sql ▼▼▼
-- Relato de problemas (bugs) dentro do sistema: quem usa descreve o caminho, o passo a passo e anexa prints; o Administrador acompanha.
-- Os anexos ficam num bucket PRIVADO (cada pessoa envia só para a própria pasta; só o autor e o Administrador leem).

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reporter_name text check (reporter_name is null or char_length(reporter_name) <= 120),
  title text not null check (char_length(title) between 5 and 160),
  severity text not null default 'atrapalha' check (severity in ('impede', 'atrapalha', 'detalhe')),
  path text not null check (char_length(path) between 2 and 300),
  steps text not null check (char_length(steps) between 10 and 4000),
  expected text check (expected is null or char_length(expected) <= 2000),
  actual text not null check (char_length(actual) between 3 and 2000),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object' and pg_column_size(context) < 20000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 6),
  status text not null default 'aberto' check (status in ('aberto', 'em_analise', 'resolvido')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bug_reports_status_idx on public.bug_reports(status, created_at desc);
alter table public.bug_reports enable row level security;

create policy "bug_reports_insert_own" on public.bug_reports for insert
  with check (reporter_id = auth.uid() and public.current_role() is not null and status = 'aberto');
create policy "bug_reports_select" on public.bug_reports for select
  using (reporter_id = auth.uid() or coalesce(public.current_role(), '') = 'admin');
create policy "bug_reports_admin_update" on public.bug_reports for update
  using (coalesce(public.current_role(), '') = 'admin') with check (coalesce(public.current_role(), '') = 'admin');
create policy "bug_reports_admin_delete" on public.bug_reports for delete
  using (coalesce(public.current_role(), '') = 'admin');

create or replace function public.touch_bug_report() returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql set search_path = public;
drop trigger if exists touch_bug_report on public.bug_reports;
create trigger touch_bug_report before update on public.bug_reports for each row execute function public.touch_bug_report();

-- Anexos: bucket privado, só imagens, PDF e planilhas/textos pequenos, até 5 MB cada
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bug-reports', 'bug-reports', false, 5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

create policy "bug_reports_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'bug-reports' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "bug_reports_files_select" on storage.objects for select to authenticated
  using (bucket_id = 'bug-reports' and ((storage.foldername(name))[1] = auth.uid()::text or coalesce(public.current_role(), '') = 'admin'));
create policy "bug_reports_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'bug-reports' and coalesce(public.current_role(), '') = 'admin');

-- ▼▼▼ 20261101170000_bug_parent.sql ▼▼▼
-- Todo BUG precisa estar ligado ao item (entrega) em que foi encontrado: o bug é "filho" desse item.
-- Regra só para bugs novos ou alterados (os já existentes continuam podendo mudar de coluna sem a ligação).
alter table public.backlog_items add column if not exists parent_id text check (parent_id is null or char_length(parent_id) between 1 and 60);
create index if not exists backlog_items_parent_idx on public.backlog_items(project_id, parent_id) where parent_id is not null;

create or replace function public.guard_bug_parent() returns trigger as $$
declare p public.backlog_items;
begin
  if new.kind <> 'bug' then new.parent_id := null; return new; end if;
  if tg_op = 'UPDATE' and old.kind = 'bug' and new.parent_id is not distinct from old.parent_id then return new; end if;
  if new.parent_id is null then raise exception 'Todo bug precisa estar ligado ao item (entrega) em que foi encontrado.'; end if;
  if new.parent_id = new.id then raise exception 'Um bug não pode ser filho dele mesmo.'; end if;
  select * into p from public.backlog_items where project_id = new.project_id and id = new.parent_id;
  if not found then raise exception 'O item pai % não existe neste projeto.', new.parent_id; end if;
  if p.kind = 'bug' then raise exception 'Um bug não pode ser filho de outro bug — ligue ao item de entrega.'; end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists guard_bug_parent on public.backlog_items;
create trigger guard_bug_parent before insert or update on public.backlog_items
  for each row execute function public.guard_bug_parent();

-- ▼▼▼ 20261101180000_sprint_history.sql ▼▼▼
-- Histórico da sprint: o que foi devolvido ao backlog quando ela terminou (o que foi entregue já fica nos itens concluídos da sprint)
alter table public.sprints add column if not exists carried jsonb not null default '[]'::jsonb
  check (jsonb_typeof(carried) = 'array' and jsonb_array_length(carried) <= 500);

-- ▼▼▼ 20261101190000_item_attachments.sql ▼▼▼
-- Anexos nos itens do backlog (prints e arquivos de exemplo de um BUG) e fim do canal separado "problemas reportados":
-- o relato de um bug agora é o próprio item Bug, filho de uma entrega, com os anexos junto.

-- 1) Anexos: lista [{ path, name, size, type }] no item (até 6)
alter table public.backlog_items add column if not exists attachments jsonb not null default '[]'::jsonb
  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 6);

-- 2) Pasta privada de arquivos dos itens: o caminho começa pelo id do projeto, e só quem tem acesso ao projeto lê e envia
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-files', 'item-files', false, 5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

create policy "item_files_select" on storage.objects for select to authenticated
  using (bucket_id = 'item-files' and public.has_project_access((storage.foldername(name))[1]));
create policy "item_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'item-files' and public.has_project_access((storage.foldername(name))[1]) and public.has_perm('manage_backlog'));
create policy "item_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'item-files' and public.has_project_access((storage.foldername(name))[1]) and public.has_perm('manage_backlog'));

-- 3) Remove o canal antigo (nunca recebeu relato): tabela, arquivos e regras
drop policy if exists "bug_reports_files_insert" on storage.objects;
drop policy if exists "bug_reports_files_select" on storage.objects;
drop policy if exists "bug_reports_files_delete" on storage.objects;
-- (o bucket vazio 'bug-reports' fica sem nenhuma regra de acesso: o Supabase não deixa apagar bucket por SQL)
drop table if exists public.bug_reports;
drop function if exists public.touch_bug_report();

-- ▼▼▼ 20261102100000_view_permissions.sql ▼▼▼
-- Cada perfil vê o que precisa para o seu trabalho (e só isso). Três permissões novas de VISÃO:
--   view_portfolio   painéis de portfólio e diretoria (Painel da Diretoria, Visão Executiva, Visão do PMO, Indicadores, Portfólio, Priorização)
--   view_management  gestão do projeto (saúde, decisões da IA e da diretoria, riscos, escopo, linha de base, atas, repositório, chat com contexto completo)
--   view_team_load   carga de trabalho e sinais de burnout dos colegas (dado sensível das pessoas)
-- O menu esconde, MAS o banco também nega: quem não tem a permissão não lê essas tabelas nem pela API.

-- 1) Perfis prontos (os personalizados já existentes ficam sem as visões: menor privilégio; o Administrador marca o que quiser em Perfis de acesso)
update public.access_profiles set perms = perms || '{"view_portfolio":true,"view_management":true,"view_team_load":true}'::jsonb where id = 'gerente';
update public.access_profiles set perms = perms || '{"view_portfolio":true,"view_management":true}'::jsonb where id = 'patrocinador';
update public.access_profiles set perms = perms || '{"view_management":true}'::jsonb where id = 'po';
update public.access_profiles set perms = perms || '{"view_management":true,"view_team_load":true}'::jsonb where id = 'sm';
update public.access_profiles set perms = perms || '{"view_portfolio":true}'::jsonb where id = 'consulta';
update public.access_profiles set perms = perms || '{"view_portfolio":true,"view_management":true,"view_team_load":true}'::jsonb where id = 'admin';
update public.access_profiles set description = 'Atualiza as próprias atividades, aponta as próprias horas e registra impedimentos. Vê só o que é do seu trabalho: as suas entregas, o seu time e o que o projeto deve entregar. Não vê custos, painéis de gestão nem dados dos colegas.' where id = 'time';
update public.access_profiles set description = 'Somente leitura dos painéis executivos e do plano, sem custos nem dados das pessoas.' where id = 'consulta';

-- 2) O banco nega a leitura do que é gestão a quem não tem a visão
drop policy if exists "board_decisions_read" on public.board_decisions;
create policy "board_decisions_read" on public.board_decisions for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id) and public.has_perm('view_management'));
drop policy if exists "decisions_read" on public.decisions;
create policy "decisions_read" on public.decisions for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id) and public.has_perm('view_management'));
drop policy if exists "documents_read" on public.documents;
create policy "documents_read" on public.documents for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id) and public.has_perm('view_management'));
drop policy if exists "scope_changes_read" on public.scope_changes;
create policy "scope_changes_read" on public.scope_changes for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id) and public.has_perm('view_management'));
drop policy if exists "baselines_read" on public.baselines;
create policy "baselines_read" on public.baselines for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id) and public.has_perm('view_management'));
drop policy if exists "risks_read" on public.risks;
create policy "risks_read" on public.risks for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id) and public.has_perm('view_management'));
drop policy if exists "project_snapshots_read" on public.project_snapshots;
create policy "project_snapshots_read" on public.project_snapshots for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id) and public.has_perm('view_management'));

-- 3) Carga e sinais de burnout são dados das PESSOAS: só quem tem view_team_load lê a tabela inteira; cada um lê a própria linha
drop policy if exists "team_members_read" on public.team_members;
create policy "team_members_read" on public.team_members for select
  using (auth.role() = 'authenticated' and public.has_project_access(project_id)
    and (public.has_perm('view_team_load') or user_id = auth.uid()));

-- 4) "Quem é o meu time": nome, função e alocação de quem está no projeto — sem carga, sem sinais, sem recomendação
create or replace function public.project_team(pid text)
returns table (id text, name text, role text, allocation_pct int) as $$
begin
  if not public.has_project_access(pid) then raise exception 'Sem acesso a este projeto.'; end if;
  return query select t.id, t.name, t.role, t.allocation_pct from public.team_members t where t.project_id = pid order by t.name;
end;
$$ language plpgsql stable security definer set search_path = public;
grant execute on function public.project_team(text) to authenticated;

-- ▼▼▼ 20261102100100_access_null_safe.sql ▼▼▼
-- Correção: com perfil nulo (conta desconhecida ou inativa) `current_role() = 'admin'` é NULO, e "nulo ou falso" é nulo — dentro de uma função
-- `if not <nulo>` não barrava. Agora o acesso ao projeto devolve sempre verdadeiro ou falso.
create or replace function public.has_project_access(pid text)
returns boolean as $$
  select coalesce(public.current_role() = 'admin', false)
    or exists (select 1 from public.project_access where project_id = pid and user_id = auth.uid());
$$ language sql stable security definer;

create or replace function public.project_team(pid text)
returns table (id text, name text, role text, allocation_pct int) as $$
begin
  if not coalesce(public.has_project_access(pid), false) then raise exception 'Sem acesso a este projeto.'; end if;
  return query select t.id, t.name, t.role, t.allocation_pct from public.team_members t where t.project_id = pid order by t.name;
end;
$$ language plpgsql stable security definer set search_path = public;

-- ▼▼▼ 20261102110000_team_link.sql ▼▼▼
-- Incluir uma pessoa de execução (time, Scrum Master, PO, gerente) em um projeto cria, ou reaproveita, o colaborador dela na equipe
-- e liga a conta a ele. Sem essa ligação o "Meu trabalho" não sabe quem é a pessoa. Quem só acompanha (patrocinador, consulta,
-- TI/suporte) não entra na equipe. O administrador e o gerente responsável pelo projeto fazem a ligação.

-- 1) Quem pode ligar uma conta a um colaborador: o administrador ou o gerente responsável (e falha FECHADO com perfil nulo)
create or replace function public.guard_member_link()
returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.user_id is not null) or (tg_op = 'UPDATE' and new.user_id is distinct from old.user_id) then
    if auth.uid() is not null and not (coalesce(public.current_role(), '') = 'admin' or coalesce(public.is_project_manager(new.project_id), false)) then
      raise exception 'Só o administrador ou o gerente responsável pelo projeto liga uma conta a um colaborador';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- 2) Cria/reaproveita o colaborador e liga a conta (uso interno; não é chamável pelo app)
create or replace function public._link_team_member(pid text, uid uuid) returns text as $$
declare nm text; tid text;
begin
  select p.name into nm from public.profiles p
    join public.access_profiles ap on ap.id = p.role
    where p.id = uid and (ap.perms ->> 'update_own' = 'true' or ap.perms ->> 'log_hours' = 'true' or p.role = 'admin') and p.role <> 'admin';
  if nm is null then return null; end if; -- perfil que só acompanha: não é da equipe
  select id into tid from public.team_members where project_id = pid and user_id = uid limit 1;
  if tid is not null then return tid; end if;
  select id into tid from public.team_members where project_id = pid and user_id is null and lower(btrim(name)) = lower(btrim(nm)) limit 1;
  if tid is not null then update public.team_members set user_id = uid where id = tid; return tid; end if;
  tid := 'tm-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into public.team_members(id, project_id, name, role, allocation_pct, workload_pct, signals) values (tid, pid, nm, null, null, null, '[]'::jsonb);
  return tid;
end;
$$ language plpgsql security definer set search_path = public;
revoke all on function public._link_team_member(text, uuid) from public, anon, authenticated;

-- 3) O que o app chama
create or replace function public.ensure_team_member(pid text, uid uuid) returns text as $$
begin
  if not (coalesce(public.current_role() = 'admin', false) or coalesce(public.is_project_manager(pid), false)) then
    raise exception 'Só o administrador ou o gerente responsável pelo projeto.';
  end if;
  if not exists (select 1 from public.project_access where project_id = pid and user_id = uid) then
    raise exception 'A pessoa não tem acesso a este projeto.';
  end if;
  return public._link_team_member(pid, uid);
end;
$$ language plpgsql security definer set search_path = public;
grant execute on function public.ensure_team_member(text, uuid) to authenticated;

-- 4) Quem já estava em projetos sem a ligação passa a ter
do $$
declare r record;
begin
  for r in select project_id, user_id from public.project_access loop
    perform public._link_team_member(r.project_id, r.user_id);
  end loop;
end $$;

-- ▼▼▼ 20261102110100_team_link_fix.sql ▼▼▼
-- Correção: o colaborador criado automaticamente precisa nascer ligado à conta (user_id).
create or replace function public._link_team_member(pid text, uid uuid) returns text as $$
declare nm text; tid text;
begin
  select p.name into nm from public.profiles p
    join public.access_profiles ap on ap.id = p.role
    where p.id = uid and p.role <> 'admin' and (ap.perms ->> 'update_own' = 'true' or ap.perms ->> 'log_hours' = 'true');
  if nm is null then return null; end if; -- perfil que só acompanha: não é da equipe
  select id into tid from public.team_members where project_id = pid and user_id = uid limit 1;
  if tid is not null then return tid; end if;
  select id into tid from public.team_members where project_id = pid and user_id is null and lower(btrim(name)) = lower(btrim(nm)) limit 1;
  if tid is not null then update public.team_members set user_id = uid where id = tid; return tid; end if;
  tid := 'tm-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into public.team_members(id, project_id, name, role, allocation_pct, workload_pct, signals, user_id) values (tid, pid, nm, null, null, null, '[]'::jsonb, uid);
  return tid;
end;
$$ language plpgsql security definer set search_path = public;
revoke all on function public._link_team_member(text, uuid) from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select project_id, user_id from public.project_access loop
    perform public._link_team_member(r.project_id, r.user_id);
  end loop;
end $$;

-- ▼▼▼ 20261102120000_sprint_extensions.sql ▼▼▼
-- Extensão da sprint: cada vez que o fim é estendido (de/para, quem, quando, motivo) fica registrado na própria sprint
alter table public.sprints add column if not exists extensions jsonb not null default '[]'::jsonb
  check (jsonb_typeof(extensions) = 'array' and jsonb_array_length(extensions) <= 50);

-- ▼▼▼ 20261102130000_user_notices.sql ▼▼▼
-- Avisos na tela (depois do login): as automações do quadro e os alertas de data deixam um recado para uma pessoa, um perfil, o gerente ou o time.
-- Quem lê vê só os próprios avisos; quem cria passa por notify_project (confere o acesso ao projeto e resolve os destinatários no servidor).
create table if not exists public.user_notices (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  detail text check (detail is null or char_length(detail) <= 500),
  page text check (page is null or char_length(page) <= 40),
  source text check (source is null or char_length(source) <= 120),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists user_notices_user_idx on public.user_notices(user_id, created_at desc);
create index if not exists user_notices_project_idx on public.user_notices(project_id);
alter table public.user_notices enable row level security;
create policy "notices_read_own" on public.user_notices for select using (user_id = auth.uid());
create policy "notices_update_own" on public.user_notices for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notices_delete_own" on public.user_notices for delete using (user_id = auth.uid());
create policy "notices_admin_delete" on public.user_notices for delete using (coalesce(public.current_role() = 'admin', false));

-- target: 'member' (nome na equipe do projeto) | 'user' (id da conta) | 'manager' (gerente responsável) | 'role' (perfil, entre quem tem acesso ao projeto) | 'all' (todos com acesso)
create or replace function public.notify_project(pid text, target text, who text, p_title text, p_detail text, p_page text, p_source text)
returns int as $$
declare ids uuid[] := '{}'; n int := 0; u uuid;
begin
  if not coalesce(public.has_project_access(pid), false) then raise exception 'Sem acesso a este projeto.'; end if;
  if coalesce(char_length(btrim(p_title)), 0) = 0 then raise exception 'Aviso sem título.'; end if;
  if target = 'member' then
    select coalesce(array_agg(distinct t.user_id), '{}') into ids from public.team_members t where t.project_id = pid and t.user_id is not null and lower(t.name) = lower(btrim(coalesce(who, '')));
  elsif target = 'user' then
    select coalesce(array_agg(a.user_id), '{}') into ids from (
      select p.id as user_id from public.profiles p where p.id::text = coalesce(who, '')
        and (coalesce(p.role = 'admin', false) or exists (select 1 from public.project_access x where x.project_id = pid and x.user_id = p.id))) a;
  elsif target = 'manager' then
    select coalesce(array_agg(manager_id), '{}') into ids from public.projects where id = pid and manager_id is not null;
  elsif target = 'role' then
    select coalesce(array_agg(distinct p.id), '{}') into ids from public.profiles p
      where p.role = coalesce(who, '') and coalesce(p.active, true)
        and exists (select 1 from public.project_access x where x.project_id = pid and x.user_id = p.id);
  elsif target = 'all' then
    select coalesce(array_agg(distinct x.user_id), '{}') into ids from public.project_access x where x.project_id = pid;
  else raise exception 'Destino de aviso inválido.'; end if;
  foreach u in array ids loop
    if u is distinct from auth.uid()
       and not exists (select 1 from public.user_notices e where e.user_id = u and e.project_id = pid and e.title = left(btrim(p_title), 160) and e.created_at > now() - interval '20 hours') then
      insert into public.user_notices(project_id, user_id, title, detail, page, source)
        values (pid, u, left(btrim(p_title), 160), left(p_detail, 500), left(p_page, 40), left(p_source, 120));
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$ language plpgsql security definer set search_path = public;
grant execute on function public.notify_project(text, text, text, text, text, text, text) to authenticated;

-- ▼▼▼ 20261102140000_item_history.sql ▼▼▼
-- Histórico por card: quem mudou o quê e quando, sempre "de → para" (título, tipo, pontos, responsável, descrição, situação, sprint, prioridade).
-- Lista [{ at, by, field, from, to }] guardada no próprio item (até 300 registros; os mais antigos saem primeiro).
alter table public.backlog_items add column if not exists history jsonb not null default '[]'::jsonb
  check (jsonb_typeof(history) = 'array' and jsonb_array_length(history) <= 300);

-- ▼▼▼ 20261103100000_hours_control.sql ▼▼▼
-- Controle de horas: entrega obrigatória, hora extra com motivo, aprovação do gerente e fechamento de período.
-- As regras do projeto ficam em project_settings (chave hoursRules): horas normais por dia, quem passa por aprovação, períodos fechados.
-- O servidor garante o que não pode depender da tela: entrega informada, hora extra recalculada, só o gerente aprova e período fechado não recebe lançamento.
alter table public.time_entries add column if not exists status text not null default 'aprovado'
  check (status in ('pendente','aprovado','reprovado','ajuste'));
alter table public.time_entries add column if not exists extra_hours numeric(5,2) not null default 0 check (extra_hours >= 0 and extra_hours <= 24);
alter table public.time_entries add column if not exists extra_reason text check (extra_reason is null or char_length(extra_reason) <= 300);
alter table public.time_entries add column if not exists review_by text check (review_by is null or char_length(review_by) <= 120);
alter table public.time_entries add column if not exists review_at timestamptz;
alter table public.time_entries add column if not exists review_note text check (review_note is null or char_length(review_note) <= 300);
create index if not exists time_entries_status_idx on public.time_entries(project_id, status);

create or replace function public.time_entries_guard()
returns trigger as $$
declare
  pid text := coalesce(new.project_id, old.project_id);
  rules jsonb;
  mgr boolean := coalesce(public.has_perm('edit_plan'), false) and coalesce(public.has_project_access(pid), false);
  d date := coalesce(new.work_date, old.work_date);
  per text := to_char(d, 'YYYY-MM');
  others numeric; normal numeric; mode text; changed boolean;
begin
  select value into rules from public.project_settings where project_id = pid and key = 'hoursRules';
  rules := coalesce(rules, '{}'::jsonb);
  -- Exclusão em cascata (projeto apagado) e limpeza feita pelo administrador não são lançamento: passam
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(rules->'closedPeriods') = 'array' then rules->'closedPeriods' else '[]'::jsonb end) p where p->>'period' = per)
     and not (tg_op = 'DELETE' and (coalesce(public.current_role() = 'admin', false) or not exists (select 1 from public.projects where id = pid))) then
    raise exception 'O período % está fechado para lançamento de horas.', per;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and to_char(old.work_date, 'YYYY-MM') <> per and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(rules->'closedPeriods') = 'array' then rules->'closedPeriods' else '[]'::jsonb end) p where p->>'period' = to_char(old.work_date, 'YYYY-MM')) then
    raise exception 'O período % está fechado para lançamento de horas.', to_char(old.work_date, 'YYYY-MM');
  end if;
  -- entrega obrigatória nos lançamentos novos e quando o conteúdo muda (aprovar um lançamento antigo sem entrega continua possível)
  if coalesce((rules->>'requireDelivery')::boolean, true) and coalesce(btrim(new.wbs_ref), '') = ''
     and (tg_op = 'INSERT' or old.hours is distinct from new.hours or old.work_date is distinct from new.work_date or old.person_name is distinct from new.person_name or old.note is distinct from new.note or old.wbs_ref is distinct from new.wbs_ref) then
    raise exception 'Informe a entrega em que as horas foram gastas.';
  end if;
  -- hora extra: o servidor recalcula (o que passar das horas normais do dia, somando os outros apontamentos da pessoa nesse dia)
  normal := coalesce(nullif(rules->>'dailyNormal', '')::numeric, 8);
  select coalesce(sum(hours), 0) into others from public.time_entries
    where project_id = pid and lower(person_name) = lower(new.person_name) and work_date = new.work_date and id <> new.id and status <> 'reprovado';
  new.extra_hours := greatest(0, least(new.hours, others + new.hours - normal));
  if new.extra_hours > 0 and not mgr and coalesce(btrim(new.extra_reason), '') = '' then
    raise exception 'Hora extra precisa do motivo.';
  end if;
  if new.extra_hours = 0 then new.extra_reason := null; end if;
  if mgr then
    if tg_op = 'INSERT' and new.status = 'pendente' then new.status := 'pendente'; end if;
    if new.status in ('aprovado','reprovado','ajuste') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      new.review_by := coalesce(new.review_by, ''); new.review_at := coalesce(new.review_at, now());
    end if;
  else
    mode := coalesce(rules->>'approval', 'all');
    changed := tg_op = 'INSERT' or old.hours is distinct from new.hours or old.work_date is distinct from new.work_date
      or old.wbs_ref is distinct from new.wbs_ref or old.person_name is distinct from new.person_name or old.note is distinct from new.note
      or old.extra_reason is distinct from new.extra_reason;
    if changed then
      new.status := case when mode = 'none' then 'aprovado' when mode = 'extra' and new.extra_hours = 0 then 'aprovado' else 'pendente' end;
      new.review_by := null; new.review_at := null; new.review_note := null;
    else
      new.status := old.status; new.review_by := old.review_by; new.review_at := old.review_at; new.review_note := old.review_note;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists time_entries_guard_trg on public.time_entries;
create trigger time_entries_guard_trg before insert or update or delete on public.time_entries
  for each row execute function public.time_entries_guard();

-- Só quem edita o plano (gerente) muda as regras e o fechamento de período das horas
create or replace function public.guard_hours_rules()
returns trigger as $$
begin
  if coalesce(new.key, old.key) = 'hoursRules' and not (coalesce(public.has_perm('edit_plan'), false) and coalesce(public.has_project_access(coalesce(new.project_id, old.project_id)), false)) then
    raise exception 'Só o gerente do projeto altera as regras e o fechamento de período das horas.';
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql security definer set search_path = public;
drop trigger if exists guard_hours_rules_trg on public.project_settings;
create trigger guard_hours_rules_trg before insert or update or delete on public.project_settings
  for each row execute function public.guard_hours_rules();

-- ▼▼▼ 20261103110000_hours_self.sql ▼▼▼
-- Horas só para si mesmo: o executor lança as próprias horas; o gerente pode lançar por outra pessoa só em caso excepcional, com justificativa que fica registrada
alter table public.time_entries add column if not exists posted_by text check (posted_by is null or char_length(posted_by) <= 120);
alter table public.time_entries add column if not exists behalf_reason text check (behalf_reason is null or char_length(behalf_reason) <= 300);

create or replace function public.time_entries_guard()
returns trigger as $$
declare
  pid text := coalesce(new.project_id, old.project_id);
  rules jsonb;
  mgr boolean := coalesce(public.has_perm('edit_plan'), false) and coalesce(public.has_project_access(pid), false);
  d date := coalesce(new.work_date, old.work_date);
  per text := to_char(d, 'YYYY-MM');
  others numeric; normal numeric; mode text; changed boolean;
  myname text; mine boolean; person_changed boolean;
begin
  select value into rules from public.project_settings where project_id = pid and key = 'hoursRules';
  rules := coalesce(rules, '{}'::jsonb);
  -- Exclusão em cascata (projeto apagado) e limpeza feita pelo administrador não são lançamento: passam
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(rules->'closedPeriods') = 'array' then rules->'closedPeriods' else '[]'::jsonb end) p where p->>'period' = per)
     and not (tg_op = 'DELETE' and (coalesce(public.current_role() = 'admin', false) or not exists (select 1 from public.projects where id = pid))) then
    raise exception 'O período % está fechado para lançamento de horas.', per;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and to_char(old.work_date, 'YYYY-MM') <> per and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(rules->'closedPeriods') = 'array' then rules->'closedPeriods' else '[]'::jsonb end) p where p->>'period' = to_char(old.work_date, 'YYYY-MM')) then
    raise exception 'O período % está fechado para lançamento de horas.', to_char(old.work_date, 'YYYY-MM');
  end if;
  -- entrega obrigatória nos lançamentos novos e quando o conteúdo muda (aprovar um lançamento antigo sem entrega continua possível)
  if coalesce((rules->>'requireDelivery')::boolean, true) and coalesce(btrim(new.wbs_ref), '') = ''
     and (tg_op = 'INSERT' or old.hours is distinct from new.hours or old.work_date is distinct from new.work_date or old.person_name is distinct from new.person_name or old.note is distinct from new.note or old.wbs_ref is distinct from new.wbs_ref) then
    raise exception 'Informe a entrega em que as horas foram gastas.';
  end if;
  -- de quem são as horas: o executor só lança para si; o gerente por outra pessoa só com justificativa
  select name into myname from public.profiles where id = auth.uid();
  mine := lower(btrim(new.person_name)) = lower(btrim(coalesce(myname, '')))
    or exists (select 1 from public.team_members t where t.project_id = pid and t.user_id = auth.uid() and lower(btrim(t.name)) = lower(btrim(new.person_name)));
  person_changed := tg_op = 'INSERT' or old.person_name is distinct from new.person_name;
  if not mine then
    if not mgr then
      if person_changed or old.hours is distinct from new.hours or old.work_date is distinct from new.work_date or old.wbs_ref is distinct from new.wbs_ref or old.note is distinct from new.note then
        raise exception 'Você só lança horas para você mesmo. Peça ao gerente do projeto.';
      end if;
    elsif person_changed then
      if coalesce(char_length(btrim(new.behalf_reason)), 0) < 10 then
        raise exception 'Lançar horas por outra pessoa exige a justificativa (mínimo 10 letras).';
      end if;
      new.posted_by := coalesce(myname, '');
    end if;
  elsif person_changed then
    new.posted_by := null; new.behalf_reason := null;
  end if;
  -- hora extra: o servidor recalcula (o que passar das horas normais do dia, somando os outros apontamentos da pessoa nesse dia)
  normal := coalesce(nullif(rules->>'dailyNormal', '')::numeric, 8);
  select coalesce(sum(hours), 0) into others from public.time_entries
    where project_id = pid and lower(person_name) = lower(new.person_name) and work_date = new.work_date and id <> new.id and status <> 'reprovado';
  new.extra_hours := greatest(0, least(new.hours, others + new.hours - normal));
  if new.extra_hours > 0 and not mgr and coalesce(btrim(new.extra_reason), '') = '' then
    raise exception 'Hora extra precisa do motivo.';
  end if;
  if new.extra_hours = 0 then new.extra_reason := null; end if;
  if mgr then
    if new.status in ('aprovado','reprovado','ajuste') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      new.review_by := coalesce(new.review_by, ''); new.review_at := coalesce(new.review_at, now());
    end if;
  else
    mode := coalesce(rules->>'approval', 'all');
    changed := tg_op = 'INSERT' or old.hours is distinct from new.hours or old.work_date is distinct from new.work_date
      or old.wbs_ref is distinct from new.wbs_ref or old.person_name is distinct from new.person_name or old.note is distinct from new.note
      or old.extra_reason is distinct from new.extra_reason;
    if changed then
      new.status := case when mode = 'none' then 'aprovado' when mode = 'extra' and new.extra_hours = 0 then 'aprovado' else 'pendente' end;
      new.review_by := null; new.review_at := null; new.review_note := null;
    else
      new.status := old.status; new.review_by := old.review_by; new.review_at := old.review_at; new.review_note := old.review_note;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ▼▼▼ 20261103120000_hours_history.sql ▼▼▼
-- Histórico de cada lançamento de horas (quem, quando e o quê), escrito pelo servidor: lançado, alterado, aprovado, reprovado, ajuste pedido
alter table public.time_entries add column if not exists history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array' and jsonb_array_length(history) <= 200);

create or replace function public.time_entries_guard()
returns trigger as $$
declare
  pid text := coalesce(new.project_id, old.project_id);
  rules jsonb;
  mgr boolean := coalesce(public.has_perm('edit_plan'), false) and coalesce(public.has_project_access(pid), false);
  d date := coalesce(new.work_date, old.work_date);
  per text := to_char(d, 'YYYY-MM');
  others numeric; normal numeric; mode text; changed boolean;
  myname text; mine boolean; person_changed boolean; ev text := ''; h jsonb; lbl jsonb := '{"pendente":"aguardando aprovação","aprovado":"aprovada","reprovado":"reprovada","ajuste":"ajuste pedido"}';
begin
  select value into rules from public.project_settings where project_id = pid and key = 'hoursRules';
  rules := coalesce(rules, '{}'::jsonb);
  -- Exclusão em cascata (projeto apagado) e limpeza feita pelo administrador não são lançamento: passam
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(rules->'closedPeriods') = 'array' then rules->'closedPeriods' else '[]'::jsonb end) p where p->>'period' = per)
     and not (tg_op = 'DELETE' and (coalesce(public.current_role() = 'admin', false) or not exists (select 1 from public.projects where id = pid))) then
    raise exception 'O período % está fechado para lançamento de horas.', per;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and to_char(old.work_date, 'YYYY-MM') <> per and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(rules->'closedPeriods') = 'array' then rules->'closedPeriods' else '[]'::jsonb end) p where p->>'period' = to_char(old.work_date, 'YYYY-MM')) then
    raise exception 'O período % está fechado para lançamento de horas.', to_char(old.work_date, 'YYYY-MM');
  end if;
  -- entrega obrigatória nos lançamentos novos e quando o conteúdo muda (aprovar um lançamento antigo sem entrega continua possível)
  if coalesce((rules->>'requireDelivery')::boolean, true) and coalesce(btrim(new.wbs_ref), '') = ''
     and (tg_op = 'INSERT' or old.hours is distinct from new.hours or old.work_date is distinct from new.work_date or old.person_name is distinct from new.person_name or old.note is distinct from new.note or old.wbs_ref is distinct from new.wbs_ref) then
    raise exception 'Informe a entrega em que as horas foram gastas.';
  end if;
  -- de quem são as horas: o executor só lança para si; o gerente por outra pessoa só com justificativa
  select name into myname from public.profiles where id = auth.uid();
  mine := lower(btrim(new.person_name)) = lower(btrim(coalesce(myname, '')))
    or exists (select 1 from public.team_members t where t.project_id = pid and t.user_id = auth.uid() and lower(btrim(t.name)) = lower(btrim(new.person_name)));
  person_changed := tg_op = 'INSERT' or old.person_name is distinct from new.person_name;
  if not mine then
    if not mgr then
      if person_changed or old.hours is distinct from new.hours or old.work_date is distinct from new.work_date or old.wbs_ref is distinct from new.wbs_ref or old.note is distinct from new.note then
        raise exception 'Você só lança horas para você mesmo. Peça ao gerente do projeto.';
      end if;
    elsif person_changed then
      if coalesce(char_length(btrim(new.behalf_reason)), 0) < 10 then
        raise exception 'Lançar horas por outra pessoa exige a justificativa (mínimo 10 letras).';
      end if;
      new.posted_by := coalesce(myname, '');
    end if;
  elsif person_changed then
    new.posted_by := null; new.behalf_reason := null;
  end if;
  -- hora extra: o servidor recalcula (o que passar das horas normais do dia, somando os outros apontamentos da pessoa nesse dia)
  normal := coalesce(nullif(rules->>'dailyNormal', '')::numeric, 8);
  select coalesce(sum(hours), 0) into others from public.time_entries
    where project_id = pid and lower(person_name) = lower(new.person_name) and work_date = new.work_date and id <> new.id and status <> 'reprovado';
  new.extra_hours := greatest(0, least(new.hours, others + new.hours - normal));
  if new.extra_hours > 0 and not mgr and coalesce(btrim(new.extra_reason), '') = '' then
    raise exception 'Hora extra precisa do motivo.';
  end if;
  if new.extra_hours = 0 then new.extra_reason := null; end if;
  if mgr then
    if new.status in ('aprovado','reprovado','ajuste') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      new.review_by := coalesce(new.review_by, ''); new.review_at := coalesce(new.review_at, now());
    end if;
  else
    mode := coalesce(rules->>'approval', 'all');
    changed := tg_op = 'INSERT' or old.hours is distinct from new.hours or old.work_date is distinct from new.work_date
      or old.wbs_ref is distinct from new.wbs_ref or old.person_name is distinct from new.person_name or old.note is distinct from new.note
      or old.extra_reason is distinct from new.extra_reason;
    if changed then
      new.status := case when mode = 'none' then 'aprovado' when mode = 'extra' and new.extra_hours = 0 then 'aprovado' else 'pendente' end;
      new.review_by := null; new.review_at := null; new.review_note := null;
    else
      new.status := old.status; new.review_by := old.review_by; new.review_at := old.review_at; new.review_note := old.review_note;
    end if;
  end if;
  -- histórico: o servidor escreve (quem fez, quando e o que mudou)
  if tg_op = 'INSERT' then
    ev := case when new.posted_by is not null then 'Lançado em nome de ' || new.person_name || ': ' || new.hours || ' h em ' || to_char(new.work_date, 'DD/MM/YYYY') || '. Justificativa: ' || coalesce(new.behalf_reason, '')
               else 'Lançado: ' || new.hours || ' h em ' || to_char(new.work_date, 'DD/MM/YYYY') end;
    if new.extra_hours > 0 then ev := ev || ' (inclui ' || new.extra_hours || ' h de hora extra: ' || coalesce(new.extra_reason, '') || ')'; end if;
    h := '[]'::jsonb;
  else
    h := coalesce(old.history, '[]'::jsonb);
    if old.hours is distinct from new.hours then ev := ev || 'horas de ' || old.hours || ' para ' || new.hours || '; '; end if;
    if old.work_date is distinct from new.work_date then ev := ev || 'data de ' || to_char(old.work_date, 'DD/MM/YYYY') || ' para ' || to_char(new.work_date, 'DD/MM/YYYY') || '; '; end if;
    if old.wbs_ref is distinct from new.wbs_ref then ev := ev || 'entrega de ' || coalesce(old.wbs_ref, 'nenhuma') || ' para ' || coalesce(new.wbs_ref, 'nenhuma') || '; '; end if;
    if old.note is distinct from new.note then ev := ev || 'observação alterada; '; end if;
    if old.extra_reason is distinct from new.extra_reason then ev := ev || 'motivo da hora extra alterado; '; end if;
    if ev <> '' then ev := 'Alterado: ' || rtrim(ev, '; ') || '.'; end if;
    if old.status is distinct from new.status then
      ev := trim(ev || ' Situação: ' || (lbl ->> old.status) || ' → ' || (lbl ->> new.status) || '.' || case when coalesce(new.review_note, '') <> '' then ' Comentário: ' || new.review_note else '' end);
    end if;
  end if;
  if ev <> '' then
    h := h || jsonb_build_array(jsonb_build_object('at', now(), 'by', coalesce(myname, ''), 'text', ev));
    if jsonb_array_length(h) > 200 then h := h - 0; end if;
    new.history := h;
  elsif tg_op = 'UPDATE' then
    new.history := old.history;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ▼▼▼ 20261103130000_hours_budget.sql ▼▼▼
-- Orçamento de horas do projeto: acompanhamento, alertas ao gerente por faixa (aviso, crítico, esgotado) e bloqueio opcional ao chegar em 100%.
-- Os limites ficam em project_settings (hoursRules.budget): { on, total, warnPct, critPct, blockAtFull }.
-- O consumo é a soma das horas lançadas que não foram reprovadas (aprovadas, aguardando e com ajuste pedido).

-- Gravidade do aviso na tela
alter table public.user_notices add column if not exists severity text not null default 'info' check (severity in ('info','warning','critical','urgent'));

-- Resumo para os indicadores (qualquer pessoa do projeto vê o total, mesmo sem ver as horas dos outros)
create or replace function public.hours_summary(pid text)
returns jsonb as $$
declare r jsonb;
begin
  if not coalesce(public.has_project_access(pid), false) then raise exception 'Sem acesso a este projeto.'; end if;
  select jsonb_build_object(
    'consumed', coalesce(sum(hours) filter (where status <> 'reprovado'), 0),
    'approved', coalesce(sum(hours) filter (where status = 'aprovado'), 0),
    'pending', coalesce(sum(hours) filter (where status in ('pendente','ajuste')), 0),
    'last28', coalesce(sum(hours) filter (where status <> 'reprovado' and work_date >= current_date - 28), 0),
    'entries', count(*) filter (where status <> 'reprovado')
  ) into r from public.time_entries where project_id = pid;
  return r;
end;
$$ language plpgsql stable security definer set search_path = public;
grant execute on function public.hours_summary(text) to authenticated;

-- Bloqueia o lançamento que passaria do orçamento (quando o gerente escolheu bloquear). Roda depois da guarda principal (ordem alfabética dos gatilhos).
create or replace function public.time_entries_budget_block()
returns trigger as $$
declare
  rules jsonb; b jsonb; tot numeric; others numeric; newc numeric; oldc numeric;
begin
  select value into rules from public.project_settings where project_id = new.project_id and key = 'hoursRules';
  b := coalesce(rules, '{}'::jsonb) -> 'budget';
  if b is null or not coalesce((b ->> 'on')::boolean, false) or not coalesce((b ->> 'blockAtFull')::boolean, true) then return new; end if;
  tot := coalesce(nullif(b ->> 'total', '')::numeric, 0);
  if tot <= 0 then return new; end if;
  newc := case when new.status <> 'reprovado' then new.hours else 0 end;
  oldc := case when tg_op = 'UPDATE' and old.status <> 'reprovado' then old.hours else 0 end;
  if newc > oldc then
    select coalesce(sum(hours), 0) into others from public.time_entries where project_id = new.project_id and id <> new.id and status <> 'reprovado';
    if others + newc > tot then
      raise exception 'O orçamento de horas do projeto está esgotado (% de % h consumidas). Peça ao gerente para ampliar o orçamento.', replace(trim_scale(round(others, 2))::text, '.', ','), replace(trim_scale(tot)::text, '.', ',');
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
drop trigger if exists time_entries_zbudget_block_trg on public.time_entries;
create trigger time_entries_zbudget_block_trg before insert or update on public.time_entries
  for each row execute function public.time_entries_budget_block();

-- Alerta ao gerente quando o consumo sobe de faixa (uma vez por faixa; se o consumo cair ou o orçamento subir, a faixa é reavaliada)
create or replace function public._hours_budget_alert(pid text)
returns void as $$
declare
  rules jsonb; b jsonb; tot numeric; warn numeric; crit numeric; consumed numeric; pct numeric; lvl text; prev text; st jsonb;
  rec uuid[]; u uuid; ttl text; det text; sev text; blk boolean;
  rk jsonb := '{"ok":0,"warn":1,"crit":2,"full":3}';
  fh text;
begin
  select value into rules from public.project_settings where project_id = pid and key = 'hoursRules';
  b := coalesce(rules, '{}'::jsonb) -> 'budget';
  if b is null or not coalesce((b ->> 'on')::boolean, false) then return; end if;
  tot := coalesce(nullif(b ->> 'total', '')::numeric, 0);
  if tot <= 0 then return; end if;
  warn := coalesce(nullif(b ->> 'warnPct', '')::numeric, 80); crit := coalesce(nullif(b ->> 'critPct', '')::numeric, 95);
  blk := coalesce((b ->> 'blockAtFull')::boolean, true);
  select coalesce(sum(hours), 0) into consumed from public.time_entries where project_id = pid and status <> 'reprovado';
  pct := consumed / tot * 100;
  lvl := case when consumed >= tot then 'full' when pct >= crit then 'crit' when pct >= warn then 'warn' else 'ok' end;
  select value into st from public.project_settings where project_id = pid and key = 'hoursAlertState';
  prev := coalesce(st ->> 'level', 'ok');
  if lvl = prev then return; end if;
  insert into public.project_settings(project_id, key, value) values (pid, 'hoursAlertState', jsonb_build_object('level', lvl, 'at', now()))
    on conflict (project_id, key) do update set value = excluded.value;
  if (rk ->> lvl)::int <= (rk ->> prev)::int then return; end if; -- só avisa quando sobe

  fh := replace(trim_scale(round(consumed, 1))::text, '.', ',');
  if lvl = 'warn' then
    sev := 'warning'; ttl := 'Orçamento de horas em ' || round(pct) || '%';
    det := fh || ' h de ' || replace(trim_scale(tot)::text, '.', ',') || ' h consumidas (' || round(pct) || '%). Restam ' || replace(trim_scale(round(tot - consumed, 1))::text, '.', ',') || ' h. Acompanhe o ritmo do projeto.';
  elsif lvl = 'crit' then
    sev := 'critical'; ttl := 'Orçamento de horas crítico: ' || round(pct) || '%';
    det := fh || ' h de ' || replace(trim_scale(tot)::text, '.', ',') || ' h consumidas (' || round(pct) || '%). Restam só ' || replace(trim_scale(round(tot - consumed, 1))::text, '.', ',') || ' h. Avalie ampliar o orçamento ou reduzir o escopo.';
  else
    sev := 'urgent'; ttl := 'URGENTE: orçamento de horas esgotado';
    det := 'As ' || replace(trim_scale(tot)::text, '.', ',') || ' h previstas foram totalmente consumidas.' ||
      case when blk then ' Novos lançamentos estão bloqueados até você ampliar o orçamento.' else ' Os lançamentos continuam liberados: decida agora o que fazer.' end;
  end if;

  -- destinatários: gerente responsável e quem edita o plano no projeto; no esgotado, os administradores também (e, sem gerente, sempre)
  select coalesce(array_agg(distinct x), '{}') into rec from (
    select manager_id as x from public.projects where id = pid and manager_id is not null
    union select pa.user_id from public.project_access pa join public.profiles p on p.id = pa.user_id join public.access_profiles ap on ap.id = p.role
      where pa.project_id = pid and coalesce(ap.perms ->> 'edit_plan', '') = 'true' and coalesce(p.active, true)
    union select p.id from public.profiles p where p.role = 'admin' and coalesce(p.active, true) and (lvl = 'full' or not exists (select 1 from public.projects where id = pid and manager_id is not null))
  ) t where x is not null;
  foreach u in array rec loop
    insert into public.user_notices(project_id, user_id, title, detail, page, source, severity, created_by)
      values (pid, u, ttl, det, 'hoursb:orcamento', 'Orçamento de horas', sev, null);
  end loop;
end;
$$ language plpgsql security definer set search_path = public;
revoke all on function public._hours_budget_alert(text) from public, anon, authenticated;

create or replace function public.time_entries_budget_alert()
returns trigger as $$
begin
  perform public._hours_budget_alert(coalesce(new.project_id, old.project_id));
  return null;
end;
$$ language plpgsql security definer set search_path = public;
drop trigger if exists time_entries_budget_alert_trg on public.time_entries;
create trigger time_entries_budget_alert_trg after insert or update or delete on public.time_entries
  for each row execute function public.time_entries_budget_alert();

-- Ao salvar as regras (orçamento novo ou ampliado) a faixa é reavaliada na hora
create or replace function public.hours_rules_changed()
returns trigger as $$
begin
  if new.key = 'hoursRules' then perform public._hours_budget_alert(new.project_id); end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;
drop trigger if exists hours_rules_changed_trg on public.project_settings;
create trigger hours_rules_changed_trg after insert or update on public.project_settings
  for each row execute function public.hours_rules_changed();

-- ▼▼▼ 20261103140000_db_hardening.sql ▼▼▼
-- Endurecimento do banco (defesa em profundidade; a RLS continua valendo)
-- 1) Funções SECURITY DEFINER com caminho de busca fixo: sem isso, um objeto criado em outro esquema poderia ser executado no lugar do esperado
-- 2) O papel anônimo (quem não está logado) não executa funções nem toca tabelas: o cadastro é fechado e todo o app exige login

alter function public."current_role"() set search_path = public;
alter function public.handle_new_user() set search_path = public;
alter function public.prevent_role_self_escalation() set search_path = public;
alter function public.has_perm(text) set search_path = public;
alter function public.is_my_member(text, text) set search_path = public;
alter function public.guard_member_link() set search_path = public;
alter function public.is_project_manager(text) set search_path = public;
alter function public.is_any_project_manager() set search_path = public;
alter function public.has_project_access(text) set search_path = public;

-- funções: ninguém executa por padrão; quem está logado e o servidor (funções de borda) continuam executando
revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

-- tabelas e sequências: nenhum privilégio para o anônimo
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- o que for criado depois já nasce assim
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

-- ▼▼▼ 20261103150000_hours_upsert_fix.sql ▼▼▼
-- Correção: aprovar, reprovar ou pedir ajuste (gravados pelo app como "inserir ou atualizar") falhava no servidor.
-- O gatilho de inserção tratava o lançamento existente como novo (e exigia justificativa de lançamento em nome de outra pessoa).
-- Agora, quando o lançamento já existe, a decisão fica com o gatilho de atualização, que vem em seguida.

create or replace function public.time_entries_guard()
returns trigger as $$
declare
  pid text := coalesce(new.project_id, old.project_id);
  rules jsonb;
  mgr boolean := coalesce(public.has_perm('edit_plan'), false) and coalesce(public.has_project_access(pid), false);
  d date := coalesce(new.work_date, old.work_date);
  per text := to_char(d, 'YYYY-MM');
  others numeric; normal numeric; mode text; changed boolean;
  myname text; mine boolean; person_changed boolean; ev text := ''; h jsonb; lbl jsonb := '{"pendente":"aguardando aprovação","aprovado":"aprovada","reprovado":"reprovada","ajuste":"ajuste pedido"}';
begin
  -- O app grava com "inserir ou atualizar": o gatilho de inserção dispara mesmo quando o lançamento já existe. Nesse caso quem decide é o gatilho de atualização (que vem em seguida).
  if tg_op = 'INSERT' and exists (select 1 from public.time_entries where project_id = new.project_id and id = new.id) then return new; end if;
  select value into rules from public.project_settings where project_id = pid and key = 'hoursRules';
  rules := coalesce(rules, '{}'::jsonb);
  -- Exclusão em cascata (projeto apagado) e limpeza feita pelo administrador não são lançamento: passam
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(rules->'closedPeriods') = 'array' then rules->'closedPeriods' else '[]'::jsonb end) p where p->>'period' = per)
     and not (tg_op = 'DELETE' and (coalesce(public.current_role() = 'admin', false) or not exists (select 1 from public.projects where id = pid))) then
    raise exception 'O período % está fechado para lançamento de horas.', per;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and to_char(old.work_date, 'YYYY-MM') <> per and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(rules->'closedPeriods') = 'array' then rules->'closedPeriods' else '[]'::jsonb end) p where p->>'period' = to_char(old.work_date, 'YYYY-MM')) then
    raise exception 'O período % está fechado para lançamento de horas.', to_char(old.work_date, 'YYYY-MM');
  end if;
  -- entrega obrigatória nos lançamentos novos e quando o conteúdo muda (aprovar um lançamento antigo sem entrega continua possível)
  if coalesce((rules->>'requireDelivery')::boolean, true) and coalesce(btrim(new.wbs_ref), '') = ''
     and (tg_op = 'INSERT' or old.hours is distinct from new.hours or old.work_date is distinct from new.work_date or old.person_name is distinct from new.person_name or old.note is distinct from new.note or old.wbs_ref is distinct from new.wbs_ref) then
    raise exception 'Informe a entrega em que as horas foram gastas.';
  end if;
  -- de quem são as horas: o executor só lança para si; o gerente por outra pessoa só com justificativa
  select name into myname from public.profiles where id = auth.uid();
  mine := lower(btrim(new.person_name)) = lower(btrim(coalesce(myname, '')))
    or exists (select 1 from public.team_members t where t.project_id = pid and t.user_id = auth.uid() and lower(btrim(t.name)) = lower(btrim(new.person_name)));
  person_changed := tg_op = 'INSERT' or old.person_name is distinct from new.person_name;
  if not mine then
    if not mgr then
      if person_changed or old.hours is distinct from new.hours or old.work_date is distinct from new.work_date or old.wbs_ref is distinct from new.wbs_ref or old.note is distinct from new.note then
        raise exception 'Você só lança horas para você mesmo. Peça ao gerente do projeto.';
      end if;
    elsif person_changed then
      if coalesce(char_length(btrim(new.behalf_reason)), 0) < 10 then
        raise exception 'Lançar horas por outra pessoa exige a justificativa (mínimo 10 letras).';
      end if;
      new.posted_by := coalesce(myname, '');
    end if;
  elsif person_changed then
    new.posted_by := null; new.behalf_reason := null;
  end if;
  -- hora extra: o servidor recalcula (o que passar das horas normais do dia, somando os outros apontamentos da pessoa nesse dia)
  normal := coalesce(nullif(rules->>'dailyNormal', '')::numeric, 8);
  select coalesce(sum(hours), 0) into others from public.time_entries
    where project_id = pid and lower(person_name) = lower(new.person_name) and work_date = new.work_date and id <> new.id and status <> 'reprovado';
  new.extra_hours := greatest(0, least(new.hours, others + new.hours - normal));
  if new.extra_hours > 0 and not mgr and coalesce(btrim(new.extra_reason), '') = '' then
    raise exception 'Hora extra precisa do motivo.';
  end if;
  if new.extra_hours = 0 then new.extra_reason := null; end if;
  if mgr then
    if new.status in ('aprovado','reprovado','ajuste') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      new.review_by := coalesce(new.review_by, ''); new.review_at := coalesce(new.review_at, now());
    end if;
  else
    mode := coalesce(rules->>'approval', 'all');
    changed := tg_op = 'INSERT' or old.hours is distinct from new.hours or old.work_date is distinct from new.work_date
      or old.wbs_ref is distinct from new.wbs_ref or old.person_name is distinct from new.person_name or old.note is distinct from new.note
      or old.extra_reason is distinct from new.extra_reason;
    if changed then
      new.status := case when mode = 'none' then 'aprovado' when mode = 'extra' and new.extra_hours = 0 then 'aprovado' else 'pendente' end;
      new.review_by := null; new.review_at := null; new.review_note := null;
    else
      new.status := old.status; new.review_by := old.review_by; new.review_at := old.review_at; new.review_note := old.review_note;
    end if;
  end if;
  -- histórico: o servidor escreve (quem fez, quando e o que mudou)
  if tg_op = 'INSERT' then
    ev := case when new.posted_by is not null then 'Lançado em nome de ' || new.person_name || ': ' || new.hours || ' h em ' || to_char(new.work_date, 'DD/MM/YYYY') || '. Justificativa: ' || coalesce(new.behalf_reason, '')
               else 'Lançado: ' || new.hours || ' h em ' || to_char(new.work_date, 'DD/MM/YYYY') end;
    if new.extra_hours > 0 then ev := ev || ' (inclui ' || new.extra_hours || ' h de hora extra: ' || coalesce(new.extra_reason, '') || ')'; end if;
    h := '[]'::jsonb;
  else
    h := coalesce(old.history, '[]'::jsonb);
    if old.hours is distinct from new.hours then ev := ev || 'horas de ' || old.hours || ' para ' || new.hours || '; '; end if;
    if old.work_date is distinct from new.work_date then ev := ev || 'data de ' || to_char(old.work_date, 'DD/MM/YYYY') || ' para ' || to_char(new.work_date, 'DD/MM/YYYY') || '; '; end if;
    if old.wbs_ref is distinct from new.wbs_ref then ev := ev || 'entrega de ' || coalesce(old.wbs_ref, 'nenhuma') || ' para ' || coalesce(new.wbs_ref, 'nenhuma') || '; '; end if;
    if old.note is distinct from new.note then ev := ev || 'observação alterada; '; end if;
    if old.extra_reason is distinct from new.extra_reason then ev := ev || 'motivo da hora extra alterado; '; end if;
    if ev <> '' then ev := 'Alterado: ' || rtrim(ev, '; ') || '.'; end if;
    if old.status is distinct from new.status then
      ev := trim(ev || ' Situação: ' || (lbl ->> old.status) || ' → ' || (lbl ->> new.status) || '.' || case when coalesce(new.review_note, '') <> '' then ' Comentário: ' || new.review_note else '' end);
    end if;
  end if;
  if ev <> '' then
    h := h || jsonb_build_array(jsonb_build_object('at', now(), 'by', coalesce(myname, ''), 'text', ev));
    if jsonb_array_length(h) > 200 then h := h - 0; end if;
    new.history := h;
  elsif tg_op = 'UPDATE' then
    new.history := old.history;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.time_entries_budget_block()
returns trigger as $$
declare
  rules jsonb; b jsonb; tot numeric; others numeric; newc numeric; oldc numeric;
begin
  -- O app grava com "inserir ou atualizar": o gatilho de inserção dispara mesmo quando o lançamento já existe. Nesse caso quem decide é o gatilho de atualização (que vem em seguida).
  if tg_op = 'INSERT' and exists (select 1 from public.time_entries where project_id = new.project_id and id = new.id) then return new; end if;
  select value into rules from public.project_settings where project_id = new.project_id and key = 'hoursRules';
  b := coalesce(rules, '{}'::jsonb) -> 'budget';
  if b is null or not coalesce((b ->> 'on')::boolean, false) or not coalesce((b ->> 'blockAtFull')::boolean, true) then return new; end if;
  tot := coalesce(nullif(b ->> 'total', '')::numeric, 0);
  if tot <= 0 then return new; end if;
  newc := case when new.status <> 'reprovado' then new.hours else 0 end;
  oldc := case when tg_op = 'UPDATE' and old.status <> 'reprovado' then old.hours else 0 end;
  if newc > oldc then
    select coalesce(sum(hours), 0) into others from public.time_entries where project_id = new.project_id and id <> new.id and status <> 'reprovado';
    if others + newc > tot then
      raise exception 'O orçamento de horas do projeto está esgotado (% de % h consumidas). Peça ao gerente para ampliar o orçamento.', replace(trim_scale(round(others, 2))::text, '.', ','), replace(trim_scale(tot)::text, '.', ',');
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ▼▼▼ 20261103160000_team_autonomy.sql ▼▼▼
-- Autonomia do time no quadro: o gerente / Scrum Master / PO / administrador define, por projeto, quem pode mover os cartões.
-- A política fica em project_settings (chave teamPolicy): { move: 'team' | 'own' | 'managers', lockedCols: [colunas só da gestão], noteCols: [colunas que exigem comentário (tela)] }.
-- Sem política gravada vale 'team' (todo o time com a permissão "Atualizar as próprias atividades" move qualquer cartão do projeto).
-- O servidor impõe: quem não gere o backlog só muda situação, histórico e anexos do cartão; coluna reservada à gestão recusa o movimento.

create or replace function public.team_policy(pid text)
returns jsonb as $$
  select coalesce((select value from public.project_settings where project_id = pid and key = 'teamPolicy'), '{}'::jsonb);
$$ language sql stable security definer set search_path = public;

-- Pode mexer neste cartão (mover, comentar, anexar)?
create or replace function public.team_can_touch_item(pid text, nm text)
returns boolean as $$
  select coalesce(public.has_project_access(pid), false) and (
    coalesce(public.has_perm('manage_backlog'), false)
    or (coalesce(public.has_perm('update_own'), false) and (
         coalesce(public.team_policy(pid)->>'move', 'team') = 'team'
         or (coalesce(public.team_policy(pid)->>'move', 'team') = 'own' and coalesce(public.is_my_member(pid, nm), false))
       ))
  );
$$ language sql stable security definer set search_path = public;

-- O cartão já existe? (o app grava com "inserir ou atualizar": a checagem de inserção precisa deixar passar o que já existe)
create or replace function public.team_item_exists(pid text, iid text)
returns boolean as $$
  select exists (select 1 from public.backlog_items where project_id = pid and id = iid);
$$ language sql stable security definer set search_path = public;

drop policy if exists "backlog_items_insert" on public.backlog_items;
create policy "backlog_items_insert" on public.backlog_items for insert
  with check (public.has_project_access(project_id) and (
    public.has_perm('manage_backlog')
    or (public.has_perm('update_own') and public.is_my_member(project_id, assignee))
    or (public.team_item_exists(project_id, id) and public.team_can_touch_item(project_id, assignee))
  ));
drop policy if exists "backlog_items_update" on public.backlog_items;
create policy "backlog_items_update" on public.backlog_items for update
  using (public.team_can_touch_item(project_id, assignee))
  with check (public.has_project_access(project_id) and (public.has_perm('manage_backlog') or public.has_perm('update_own')));

-- Quem não gere o backlog muda só situação, conclusão, histórico e anexos; coluna reservada à gestão recusa o movimento
create or replace function public.backlog_items_member_guard()
returns trigger as $$
declare pol jsonb; locked jsonb;
begin
  if auth.uid() is null or coalesce(public.has_perm('manage_backlog'), false) then return new; end if;
  if new.title is distinct from old.title or new.description is distinct from old.description or new.kind is distinct from old.kind
     or new.points is distinct from old.points or new.assignee is distinct from old.assignee or new.sprint_id is distinct from old.sprint_id
     or new.rank is distinct from old.rank or new.parent_id is distinct from old.parent_id then
    raise exception 'O time muda a situação do cartão, comenta e anexa evidências; título, estimativa, responsável e sprint são da gestão.';
  end if;
  if new.status is distinct from old.status then
    pol := public.team_policy(new.project_id);
    locked := case when jsonb_typeof(pol->'lockedCols') = 'array' then pol->'lockedCols' else '[]'::jsonb end;
    if locked ? new.status then
      raise exception 'A coluna "%" é reservada à gestão do projeto (gerente, Scrum Master, PO ou administrador).', new.status;
    end if;
    if coalesce(pol->>'move', 'team') = 'managers' then
      raise exception 'Neste projeto só a gestão move os cartões.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists backlog_items_member_guard on public.backlog_items;
create trigger backlog_items_member_guard before update on public.backlog_items
  for each row execute function public.backlog_items_member_guard();

-- Evidências: o time anexa nos cartões que pode mexer; remover continua sendo da gestão
drop policy if exists "item_files_insert" on storage.objects;
create policy "item_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'item-files' and public.has_project_access((storage.foldername(name))[1]) and (
    public.has_perm('manage_backlog')
    or (public.has_perm('update_own') and coalesce(public.team_policy((storage.foldername(name))[1])->>'move', 'team') <> 'managers')
  ));

grant execute on function public.team_policy(text), public.team_can_touch_item(text, text), public.team_item_exists(text, text) to authenticated, service_role;

-- ▼▼▼ 20261103170000_team_autonomy_revoke.sql ▼▼▼
-- As funções da autonomia do time não são para quem não está logado (mesma regra do endurecimento do banco)
revoke all on function public.team_policy(text), public.team_can_touch_item(text, text), public.team_item_exists(text, text), public.backlog_items_member_guard() from public, anon;
grant execute on function public.team_policy(text), public.team_can_touch_item(text, text), public.team_item_exists(text, text) to authenticated, service_role;
