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
