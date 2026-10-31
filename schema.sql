-- =========================================================================
-- PMO Compass — esquema completo (GERADO por scripts/build-schema.mjs — não edite à mão)
-- Fonte: supabase/migrations/ (12 arquivos). Para instalação do zero, rode este arquivo inteiro
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
