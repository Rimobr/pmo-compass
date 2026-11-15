-- Pessoa única: só entra na equipe de um projeto quem tem nome e conta ativa no sistema (nada de nome digitado solto).
-- Vale para quem está logado (a manutenção direta no banco, sem sessão, segue livre). Linhas antigas sem conta foram unificadas antes desta trava.
create or replace function public.guard_team_member_account()
returns trigger as $$
begin
  if auth.uid() is null then return new; end if;
  if coalesce(btrim(new.name), '') = '' then
    raise exception 'O colaborador precisa ter nome.';
  end if;
  if new.user_id is null and tg_op = 'INSERT' and exists (select 1 from public.team_members t where t.id = new.id and t.user_id is not null) then
    return new; -- regravação (upsert) de quem já tem conta: a conta é mantida
  end if;
  if new.user_id is null then
    raise exception 'Só entra na equipe quem tem conta no sistema. Cadastre a pessoa em Pessoas e Acesso e dê acesso ao projeto: ela entra na equipe sozinha, com a conta ligada.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = new.user_id and p.active) then
    raise exception 'A conta ligada a este colaborador não existe ou está inativa.';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists team_member_needs_account on public.team_members;
create trigger team_member_needs_account before insert or update on public.team_members
  for each row execute function public.guard_team_member_account();
