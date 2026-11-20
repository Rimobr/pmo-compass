-- Funções de gatilho do schema public não precisam de EXECUTE para ninguém: o PostgreSQL só confere esse direito quando o gatilho é CRIADO
-- (por quem cria), nunca quando ele dispara. Hoje seis delas estavam executáveis por "public" (inclui quem não tem login):
-- guard_comment_audit, bug_priority_queue, bug_priority_gap, guard_epic, epic_unlink e guard_team_member_account.
-- Retira de public, anon e authenticated TODAS as funções de gatilho do schema public (as atuais e, por ser um laço, qualquer outra que exista).
-- Os gatilhos continuam funcionando. Reversão: grant execute on function <nome>() to public;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;
