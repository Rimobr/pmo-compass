-- Endurecimento do banco (defesa em profundidade; a RLS continua valendo)
-- 1) Funções SECURITY DEFINER com caminho de busca fixo: sem isso, um objeto criado em outro esquema poderia ser executado no lugar do esperado
-- 2) O papel anônimo (quem não está logado) não executa funções nem toca tabelas: o cadastro é fechado e todo o app exige login

alter function public."current_role"() set search_path = public;
alter function public.handle_new_user() set search_path = public;
alter function public.prevent_role_self_escalation() set search_path = public;
alter function public.has_perm(text) set search_path = public;
alter function public.is_my_member(text, text) set search_path = public;
alter function public.guard_member_link() set search_path = public;
alter function public.is_project_manager(text) set search_path = public;
alter function public.is_any_project_manager() set search_path = public;
alter function public.has_project_access(text) set search_path = public;

-- funções: ninguém executa por padrão; quem está logado e o servidor (funções de borda) continuam executando
revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

-- tabelas e sequências: nenhum privilégio para o anônimo
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- o que for criado depois já nasce assim
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
