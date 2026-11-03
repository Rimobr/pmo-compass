-- Autonomia do time no quadro: o gerente / Scrum Master / PO / administrador define, por projeto, quem pode mover os cartões.
-- A política fica em project_settings (chave teamPolicy): { move: 'team' | 'own' | 'managers', lockedCols: [colunas só da gestão], noteCols: [colunas que exigem comentário (tela)] }.
-- Sem política gravada vale 'team' (todo o time com a permissão "Atualizar as próprias atividades" move qualquer cartão do projeto).
-- O servidor impõe: quem não gere o backlog só muda situação, histórico e anexos do cartão; coluna reservada à gestão recusa o movimento.

create or replace function public.team_policy(pid text)
returns jsonb as $$
  select coalesce((select value from public.project_settings where project_id = pid and key = 'teamPolicy'), '{}'::jsonb);
$$ language sql stable security definer set search_path = public;

-- Pode mexer neste cartão (mover, comentar, anexar)?
create or replace function public.team_can_touch_item(pid text, nm text)
returns boolean as $$
  select coalesce(public.has_project_access(pid), false) and (
    coalesce(public.has_perm('manage_backlog'), false)
    or (coalesce(public.has_perm('update_own'), false) and (
         coalesce(public.team_policy(pid)->>'move', 'team') = 'team'
         or (coalesce(public.team_policy(pid)->>'move', 'team') = 'own' and coalesce(public.is_my_member(pid, nm), false))
       ))
  );
$$ language sql stable security definer set search_path = public;

-- O cartão já existe? (o app grava com "inserir ou atualizar": a checagem de inserção precisa deixar passar o que já existe)
create or replace function public.team_item_exists(pid text, iid text)
returns boolean as $$
  select exists (select 1 from public.backlog_items where project_id = pid and id = iid);
$$ language sql stable security definer set search_path = public;

drop policy if exists "backlog_items_insert" on public.backlog_items;
create policy "backlog_items_insert" on public.backlog_items for insert
  with check (public.has_project_access(project_id) and (
    public.has_perm('manage_backlog')
    or (public.has_perm('update_own') and public.is_my_member(project_id, assignee))
    or (public.team_item_exists(project_id, id) and public.team_can_touch_item(project_id, assignee))
  ));
drop policy if exists "backlog_items_update" on public.backlog_items;
create policy "backlog_items_update" on public.backlog_items for update
  using (public.team_can_touch_item(project_id, assignee))
  with check (public.has_project_access(project_id) and (public.has_perm('manage_backlog') or public.has_perm('update_own')));

-- Quem não gere o backlog muda só situação, conclusão, histórico e anexos; coluna reservada à gestão recusa o movimento
create or replace function public.backlog_items_member_guard()
returns trigger as $$
declare pol jsonb; locked jsonb;
begin
  if auth.uid() is null or coalesce(public.has_perm('manage_backlog'), false) then return new; end if;
  if new.title is distinct from old.title or new.description is distinct from old.description or new.kind is distinct from old.kind
     or new.points is distinct from old.points or new.assignee is distinct from old.assignee or new.sprint_id is distinct from old.sprint_id
     or new.rank is distinct from old.rank or new.parent_id is distinct from old.parent_id then
    raise exception 'O time muda a situação do cartão, comenta e anexa evidências; título, estimativa, responsável e sprint são da gestão.';
  end if;
  if new.status is distinct from old.status then
    pol := public.team_policy(new.project_id);
    locked := case when jsonb_typeof(pol->'lockedCols') = 'array' then pol->'lockedCols' else '[]'::jsonb end;
    if locked ? new.status then
      raise exception 'A coluna "%" é reservada à gestão do projeto (gerente, Scrum Master, PO ou administrador).', new.status;
    end if;
    if coalesce(pol->>'move', 'team') = 'managers' then
      raise exception 'Neste projeto só a gestão move os cartões.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists backlog_items_member_guard on public.backlog_items;
create trigger backlog_items_member_guard before update on public.backlog_items
  for each row execute function public.backlog_items_member_guard();

-- Evidências: o time anexa nos cartões que pode mexer; remover continua sendo da gestão
drop policy if exists "item_files_insert" on storage.objects;
create policy "item_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'item-files' and public.has_project_access((storage.foldername(name))[1]) and (
    public.has_perm('manage_backlog')
    or (public.has_perm('update_own') and coalesce(public.team_policy((storage.foldername(name))[1])->>'move', 'team') <> 'managers')
  ));

grant execute on function public.team_policy(text), public.team_can_touch_item(text, text), public.team_item_exists(text, text) to authenticated, service_role;
