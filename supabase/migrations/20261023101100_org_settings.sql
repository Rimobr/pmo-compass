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
