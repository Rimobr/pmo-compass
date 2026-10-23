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
