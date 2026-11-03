-- Meus Indicadores: o que é meu em todos os projetos a que tenho acesso (só leitura, só do usuário logado)
-- Une a conta ao colaborador (team_members.user_id) e conta os itens do quadro pelo nome dele; o prazo do item é o fim da sprint.
create or replace function public.my_workload()
returns jsonb as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]'::jsonb) from (
    select tm.project_id as id, p.name, p.client, max(tm.role) as role,
      count(b.id) filter (where b.status <> 'done') as open,
      count(b.id) filter (where b.status <> 'done' and s.end_on < current_date) as late,
      count(b.id) filter (where b.status <> 'done' and s.end_on >= current_date and s.end_on <= current_date + 7) as soon,
      count(b.id) filter (where b.status not in ('todo', 'done')) as doing,
      count(b.id) filter (where b.status = 'done' and b.done_on >= current_date - 27) as done28
    from public.team_members tm
    join public.projects p on p.id = tm.project_id
    left join public.backlog_items b on b.project_id = tm.project_id and lower(btrim(b.assignee)) = lower(btrim(tm.name))
    left join public.sprints s on s.project_id = b.project_id and s.id = b.sprint_id
    where tm.user_id = auth.uid() and coalesce(public.has_project_access(tm.project_id), false)
    group by tm.project_id, p.name, p.client
  ) x;
$$ language sql stable security definer set search_path = public;

revoke all on function public.my_workload() from public, anon;
grant execute on function public.my_workload() to authenticated, service_role;
