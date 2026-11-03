-- Correção: aprovar, reprovar ou pedir ajuste (gravados pelo app como "inserir ou atualizar") falhava no servidor.
-- O gatilho de inserção tratava o lançamento existente como novo (e exigia justificativa de lançamento em nome de outra pessoa).
-- Agora, quando o lançamento já existe, a decisão fica com o gatilho de atualização, que vem em seguida.

create or replace function public.time_entries_guard()
returns trigger as $$
declare
  pid text := coalesce(new.project_id, old.project_id);
  rules jsonb;
  mgr boolean := coalesce(public.has_perm('edit_plan'), false) and coalesce(public.has_project_access(pid), false);
  d date := coalesce(new.work_date, old.work_date);
  per text := to_char(d, 'YYYY-MM');
  others numeric; normal numeric; mode text; changed boolean;
  myname text; mine boolean; person_changed boolean; ev text := ''; h jsonb; lbl jsonb := '{"pendente":"aguardando aprovação","aprovado":"aprovada","reprovado":"reprovada","ajuste":"ajuste pedido"}';
begin
  -- O app grava com "inserir ou atualizar": o gatilho de inserção dispara mesmo quando o lançamento já existe. Nesse caso quem decide é o gatilho de atualização (que vem em seguida).
  if tg_op = 'INSERT' and exists (select 1 from public.time_entries where project_id = new.project_id and id = new.id) then return new; end if;
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
  -- histórico: o servidor escreve (quem fez, quando e o que mudou)
  if tg_op = 'INSERT' then
    ev := case when new.posted_by is not null then 'Lançado em nome de ' || new.person_name || ': ' || new.hours || ' h em ' || to_char(new.work_date, 'DD/MM/YYYY') || '. Justificativa: ' || coalesce(new.behalf_reason, '')
               else 'Lançado: ' || new.hours || ' h em ' || to_char(new.work_date, 'DD/MM/YYYY') end;
    if new.extra_hours > 0 then ev := ev || ' (inclui ' || new.extra_hours || ' h de hora extra: ' || coalesce(new.extra_reason, '') || ')'; end if;
    h := '[]'::jsonb;
  else
    h := coalesce(old.history, '[]'::jsonb);
    if old.hours is distinct from new.hours then ev := ev || 'horas de ' || old.hours || ' para ' || new.hours || '; '; end if;
    if old.work_date is distinct from new.work_date then ev := ev || 'data de ' || to_char(old.work_date, 'DD/MM/YYYY') || ' para ' || to_char(new.work_date, 'DD/MM/YYYY') || '; '; end if;
    if old.wbs_ref is distinct from new.wbs_ref then ev := ev || 'entrega de ' || coalesce(old.wbs_ref, 'nenhuma') || ' para ' || coalesce(new.wbs_ref, 'nenhuma') || '; '; end if;
    if old.note is distinct from new.note then ev := ev || 'observação alterada; '; end if;
    if old.extra_reason is distinct from new.extra_reason then ev := ev || 'motivo da hora extra alterado; '; end if;
    if ev <> '' then ev := 'Alterado: ' || rtrim(ev, '; ') || '.'; end if;
    if old.status is distinct from new.status then
      ev := trim(ev || ' Situação: ' || (lbl ->> old.status) || ' → ' || (lbl ->> new.status) || '.' || case when coalesce(new.review_note, '') <> '' then ' Comentário: ' || new.review_note else '' end);
    end if;
  end if;
  if ev <> '' then
    h := h || jsonb_build_array(jsonb_build_object('at', now(), 'by', coalesce(myname, ''), 'text', ev));
    if jsonb_array_length(h) > 200 then h := h - 0; end if;
    new.history := h;
  elsif tg_op = 'UPDATE' then
    new.history := old.history;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.time_entries_budget_block()
returns trigger as $$
declare
  rules jsonb; b jsonb; tot numeric; others numeric; newc numeric; oldc numeric;
begin
  -- O app grava com "inserir ou atualizar": o gatilho de inserção dispara mesmo quando o lançamento já existe. Nesse caso quem decide é o gatilho de atualização (que vem em seguida).
  if tg_op = 'INSERT' and exists (select 1 from public.time_entries where project_id = new.project_id and id = new.id) then return new; end if;
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
