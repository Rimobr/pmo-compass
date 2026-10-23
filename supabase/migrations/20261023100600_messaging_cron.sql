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
