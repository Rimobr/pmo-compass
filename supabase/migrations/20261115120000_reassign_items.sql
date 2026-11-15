-- Transferir atividades escolhidas de uma pessoa para outra (ex.: do profissional sobrecarregado para um do mesmo cargo com folga).
-- Diferente de reassign_work (que passa TUDO o que está pendente), aqui a gestão escolhe os cards.
-- Quem pode: Administrador ou gerente responsável pelo projeto. O destino precisa ser pessoa ativa da equipe do projeto, com acesso a ele.
-- Cada card ganha o registro "Responsável: de X para Y" no histórico (o histórico só recebe linhas novas; a trava de comentários continua valendo).
create or replace function public.reassign_items(pid text, ids text[], to_person text, why text default '')
returns jsonb as $$
declare dest text := nullif(btrim(coalesce(to_person, '')), ''); n int := 0; r record; who text; note text := nullif(btrim(coalesce(why, '')), '');
begin
  if not (coalesce(public.current_role(), '') = 'admin' or coalesce(public.is_project_manager(pid), false)) then
    raise exception 'Só o Administrador ou o gerente responsável pelo projeto.';
  end if;
  if dest is null then raise exception 'Escolha para quem as atividades vão.'; end if;
  if ids is null or coalesce(array_length(ids, 1), 0) = 0 then raise exception 'Escolha ao menos um card.'; end if;
  if array_length(ids, 1) > 200 then raise exception 'Máximo de 200 cards por vez.'; end if;
  if not exists (
    select 1 from public.team_members tm join public.profiles p on p.id = tm.user_id and p.active
    where tm.project_id = pid and lower(btrim(tm.name)) = lower(dest)
      and (p.role = 'admin' or exists (select 1 from public.project_access pa where pa.project_id = tm.project_id and pa.user_id = tm.user_id))
  ) then
    raise exception '% não é uma pessoa com acesso ao sistema neste projeto.', dest;
  end if;
  select coalesce(nullif(btrim(name), ''), 'Gestão') into who from public.profiles where id = auth.uid();
  for r in select id, assignee, history from public.backlog_items
           where project_id = pid and id = any(ids) and status <> 'done' and kind <> 'epico' and lower(btrim(coalesce(assignee, ''))) <> lower(dest)
           for update loop
    update public.backlog_items
       set assignee = dest, updated_at = now(),
           history = coalesce(r.history, '[]'::jsonb)
             || jsonb_build_array(jsonb_build_object('at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'by', coalesce(who, 'Gestão'), 'field', 'Responsável', 'from', coalesce(r.assignee, ''), 'to', dest))
             || case when note is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'by', coalesce(who, 'Gestão'), 'field', '', 'from', '', 'to', 'Comentário: ' || left(note, 300))) end
     where project_id = pid and id = r.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('backlog', n);
end;
$$ language plpgsql security definer set search_path = public;
revoke all on function public.reassign_items(text, text[], text, text) from public;
grant execute on function public.reassign_items(text, text[], text, text) to authenticated;
