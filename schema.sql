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

-- =========================================================================
-- PRONTO. Depois de rodar este script:
-- 1. Vá em Authentication → Users e crie seu primeiro usuário (ou cadastre pelo
--    próprio app, uma vez que a tela de login estiver conectada).
-- 2. Esse primeiro usuário nasce com role='consulta'. Promova-o a admin rodando:
--      update public.profiles set role = 'admin' where id = 'COLE_O_UUID_AQUI';
--    (o UUID aparece em Authentication → Users, ao lado do e-mail)
-- =========================================================================
