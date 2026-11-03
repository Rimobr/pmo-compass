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
