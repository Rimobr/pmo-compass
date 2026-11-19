-- Correções da auditoria de segurança do banco (18/11/2026).
--
-- 1) Auto-acesso a qualquer projeto: a política project_access_self_grant deixava quem tem a permissão create_projects
--    (Administrador e Gerente de Projeto) inserir uma linha de acesso PARA SI em QUALQUER projeto, bastando conhecer o id.
--    Agora só vale para o projeto que a pessoa criou ou que ainda não tem ninguém com acesso (é o que o assistente de novo
--    projeto precisa: criar e logo se dar acesso). Ceder acesso a outra pessoa continua sendo pelas políticas de gerente/administrador.
--
-- 2) Funções internas chamáveis por qualquer usuário logado: enqueue_notification (fila de WhatsApp e e-mail para diretoria
--    e partes interessadas, sem nenhuma verificação), _link_team_member e _hours_budget_alert. Quem as chama são só funções
--    e gatilhos SECURITY DEFINER (executam como o dono), então o EXECUTE do usuário logado é retirado.
--
-- Reversão: recriar a política antiga e dar `grant execute ... to authenticated` nas três funções.

-- 1) Auto-acesso restrito ----------------------------------------------------------------------------
create or replace function public.can_self_grant(pid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.projects p where p.id = pid and p.created_by = auth.uid())
      or not exists (select 1 from public.project_access a where a.project_id = pid);
$$;

revoke all on function public.can_self_grant(text) from public;
grant execute on function public.can_self_grant(text) to authenticated;

drop policy if exists project_access_self_grant on public.project_access;
create policy project_access_self_grant on public.project_access
  for insert
  with check (user_id = auth.uid() and public.has_perm('create_projects') and public.can_self_grant(project_id));

-- 2) Funções internas: só o dono (e quem elas chamam como DEFINER) executa ---------------------------
revoke all on function public.enqueue_notification(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public._link_team_member(text, uuid) from public, anon, authenticated;
revoke all on function public._hours_budget_alert(text) from public, anon, authenticated;
