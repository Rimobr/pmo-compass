-- Horas só para si mesmo: o executor lança as próprias horas; o gerente pode lançar por outra pessoa só em caso excepcional, com justificativa que fica registrada
alter table public.time_entries add column if not exists posted_by text check (posted_by is null or char_length(posted_by) <= 120);
alter table public.time_entries add column if not exists behalf_reason text check (behalf_reason is null or char_length(behalf_reason) <= 300);

create or replace function public.time_entries_guard()
returns trigger as $$
declare
  pid text := coalesce(new.project_id, old.project_id);
  rules jsonb;
  mgr boolean := coalesce(public.has_perm('edit_plan'), false) and coalesce(public.has_project_access(pid), false);
  d date := coalesce(new.work_date, old.work_date);
  per text := to_char(d, 'YYYY-MM');
  others numeric; normal numeric; mode text; changed boolean;
  myname text; mine boolean; person_changed boolean;
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
  -- de quem são as horas: o executor só lança para si; o gerente por outra pessoa só com justificativa
  select name into myname from public.profiles where id = auth.uid();
  mine := lower(btrim(new.person_name)) = lower(btrim(coalesce(myname, '')))
    or exists (select 1 from public.team_members t where t.project_id = pid and t.user_id = auth.uid() and lower(btrim(t.name)) = lower(btrim(new.person_name)));
  person_changed := tg_op = 'INSERT' or old.person_name is distinct from new.person_name;
  if not mine then
    if not mgr then
      if person_changed or old.hours is distinct from new.hours or old.work_date is distinct from new.work_date or old.wbs_ref is distinct from new.wbs_ref or old.note is distinct from new.note then
        raise exception 'Você só lança horas para você mesmo. Peça ao gerente do projeto.';
      end if;
    elsif person_changed then
      if coalesce(char_length(btrim(new.behalf_reason)), 0) < 10 then
        raise exception 'Lançar horas por outra pessoa exige a justificativa (mínimo 10 letras).';
      end if;
      new.posted_by := coalesce(myname, '');
    end if;
  elsif person_changed then
    new.posted_by := null; new.behalf_reason := null;
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
