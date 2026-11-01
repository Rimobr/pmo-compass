-- "Ver cadastro" de uma pessoa: o Administrador vê tudo; o gerente responsável vê o cadastro das pessoas dos SEUS projetos,
-- sem o telefone (dado pessoal usado só para as mensagens do sistema); cada pessoa vê o próprio. Conta inativa não consulta.
create or replace function public.person_details(uid uuid) returns jsonb as $$
declare
  is_admin boolean := coalesce(public.current_role(), '') = 'admin';
  allowed boolean;
  r jsonb;
begin
  allowed := is_admin or uid = auth.uid() or exists (
    select 1 from public.projects pr
    where coalesce(public.is_project_manager(pr.id), false)
      and (exists (select 1 from public.project_access pa where pa.project_id = pr.id and pa.user_id = uid)
        or exists (select 1 from public.team_members tm where tm.project_id = pr.id and tm.user_id = uid)));
  if not allowed then raise exception 'Sem permissão para ver este cadastro.'; end if;
  select jsonb_build_object(
      'id', p.id, 'name', p.name, 'role', p.role, 'active', p.active, 'email', u.email,
      'has_details', d.user_id is not null,
      'department', d.department, 'knowledge', d.knowledge, 'tools', d.tools,
      'completed_at', d.completed_at,
      'whatsapp_consent', coalesce(d.whatsapp_consent, false), 'whatsapp_consent_at', d.whatsapp_consent_at,
      'phone', case when is_admin or uid = auth.uid() then d.phone end)
    into r
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.profile_details d on d.user_id = p.id
    where p.id = uid;
  return r;
end;
$$ language plpgsql stable security definer set search_path = public;

grant execute on function public.person_details(uuid) to authenticated;
