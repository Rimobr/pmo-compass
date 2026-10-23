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
