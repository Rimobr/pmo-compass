-- Bússola: a lista de horas por pessoa traz só quem lançou horas nos últimos 28 dias ou faz parte de uma equipe liberada (sobras antigas de pessoas que não estão em equipe nenhuma não entram),
-- e informa desde quando a pessoa lançou na janela, para a média por semana não ficar subestimada em projeto novo.

create or replace function public.compass_digest()
returns jsonb as $$
declare costs boolean; allh boolean; res jsonb;
begin
  if not coalesce(public.has_perm('ask_compass'), false) then
    raise exception 'Seu perfil não tem acesso à Bússola de Negócios.';
  end if;
  costs := coalesce(public.has_perm('view_costs'), false);
  allh := coalesce(public.has_perm('view_all_hours'), false);

  select jsonb_build_object(
    'today', current_date, 'canSeeCosts', costs, 'canSeeHours', allh,
    'projects', coalesce((select jsonb_agg(x.j order by x.j->>'name') from (
      select jsonb_build_object(
        'id', p.id, 'name', p.name, 'client', p.client,
        'modules', (select jsonb_build_object(
            'count', count(*), 'avgPct', coalesce(round(avg(m.pct)), 0),
            'lateCount', count(*) filter (where m.status <> 'grn' and m.end_date < current_date),
            'maxLate', coalesce(max(current_date - m.end_date) filter (where m.status <> 'grn' and m.end_date < current_date), 0),
            'worst', coalesce((select jsonb_agg(jsonb_build_object('label', w.label, 'daysLate', current_date - w.end_date))
                      from (select label, end_date from public.wbs_modules where project_id = p.id and status <> 'grn' and end_date < current_date order by end_date limit 3) w), '[]'::jsonb))
          from public.wbs_modules m where m.project_id = p.id),
        'sprint', (select jsonb_build_object('name', s.name, 'endOn', s.end_on, 'daysLeft', s.end_on - current_date,
            'items', (select count(*) from public.backlog_items b where b.project_id = p.id and b.sprint_id = s.id),
            'done', (select count(*) from public.backlog_items b where b.project_id = p.id and b.sprint_id = s.id and b.status = 'done'))
          from public.sprints s where s.project_id = p.id and s.state = 'ativa' order by s.start_on desc limit 1),
        'risks', (select jsonb_build_object('open', count(*) filter (where r.status in ('aberto', 'mitigando')),
            'critical', count(*) filter (where r.status in ('aberto', 'mitigando') and r.score >= 15),
            'top', coalesce((select jsonb_agg(jsonb_build_object('title', t.title, 'score', t.score)) from (select title, score from public.risks where project_id = p.id and status in ('aberto', 'mitigando') order by score desc limit 3) t), '[]'::jsonb))
          from public.risks r where r.project_id = p.id),
        'decisions', (select jsonb_build_object('pending', count(*) filter (where d.status = 'pending'), 'critical', count(*) filter (where d.status = 'pending' and d.severity = 'crit'))
          from public.decisions d where d.project_id = p.id),
        'scope', (select jsonb_build_object('pending', count(*) filter (where c.status in ('pending', 'analysis')), 'impactDays', coalesce(sum(c.impact_days) filter (where c.status in ('pending', 'analysis')), 0))
          from public.scope_changes c where c.project_id = p.id),
        'impediments', (select count(*) from public.impediments i where i.project_id = p.id and i.status = 'aberto'),
        'hours', (select jsonb_build_object('consumed', coalesce(sum(h.hours) filter (where h.status <> 'reprovado'), 0),
            'last28', coalesce(sum(h.hours) filter (where h.status <> 'reprovado' and h.work_date >= current_date - 27), 0),
            'pending', coalesce(sum(h.hours) filter (where h.status in ('pendente', 'ajuste')), 0),
            'budget', (select case when coalesce((ps.value->'budget'->>'on')::boolean, false) then ps.value->'budget'->'total' end from public.project_settings ps where ps.project_id = p.id and ps.key = 'hoursRules'))
          from public.time_entries h where h.project_id = p.id),
        'team', (select count(*) from public.team_members tm where tm.project_id = p.id),
        'cost', case when costs then (select jsonb_build_object(
            'bac', coalesce(sum(l.planned_value) filter (where not l.is_reserve), 0),
            'ac', (select coalesce(sum(a.amount), 0) from public.cost_actuals a where a.project_id = p.id and a.kind = 'real'))
          from public.budget_lines l where l.project_id = p.id) end
      ) as j
      from public.projects p where coalesce(public.has_project_access(p.id), false)
    ) x), '[]'::jsonb),
    'people', case when allh then coalesce((select jsonb_agg(z) from (
        select jsonb_build_object('name', min(h.person_name),
            'hours28', coalesce(sum(h.hours) filter (where h.work_date >= current_date - 27), 0),
            'hoursTotal', sum(h.hours), 'projects', count(distinct h.project_id),
            'since', min(h.work_date) filter (where h.work_date >= current_date - 27)) as z
        from public.time_entries h where h.status <> 'reprovado' and coalesce(public.has_project_access(h.project_id), false)
        group by lower(btrim(h.person_name))
        having coalesce(sum(h.hours) filter (where h.work_date >= current_date - 27), 0) > 0
            or exists (select 1 from public.team_members tm where lower(btrim(tm.name)) = lower(btrim(min(h.person_name))) and coalesce(public.has_project_access(tm.project_id), false))
        order by coalesce(sum(h.hours) filter (where h.work_date >= current_date - 27), 0) desc, sum(h.hours) desc limit 40) q), '[]'::jsonb) else null end,
    'overallocated', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'pct', pct)) from (
        select min(tm.name) as n, sum(coalesce(tm.allocation_pct, 100)) as pct from public.team_members tm
        where coalesce(public.has_project_access(tm.project_id), false) group by lower(btrim(tm.name)) having sum(coalesce(tm.allocation_pct, 100)) > 100 order by 2 desc limit 20) o), '[]'::jsonb)
  ) into res;
  return res;
end;
$$ language plpgsql stable security definer set search_path = public;

revoke all on function public.compass_digest() from public, anon;
grant execute on function public.compass_digest() to authenticated, service_role;
