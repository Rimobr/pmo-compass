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
