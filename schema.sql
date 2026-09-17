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
