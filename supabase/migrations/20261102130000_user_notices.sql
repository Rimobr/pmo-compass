-- Avisos na tela (depois do login): as automações do quadro e os alertas de data deixam um recado para uma pessoa, um perfil, o gerente ou o time.
-- Quem lê vê só os próprios avisos; quem cria passa por notify_project (confere o acesso ao projeto e resolve os destinatários no servidor).
create table if not exists public.user_notices (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  detail text check (detail is null or char_length(detail) <= 500),
  page text check (page is null or char_length(page) <= 40),
  source text check (source is null or char_length(source) <= 120),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists user_notices_user_idx on public.user_notices(user_id, created_at desc);
create index if not exists user_notices_project_idx on public.user_notices(project_id);
alter table public.user_notices enable row level security;
create policy "notices_read_own" on public.user_notices for select using (user_id = auth.uid());
create policy "notices_update_own" on public.user_notices for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notices_delete_own" on public.user_notices for delete using (user_id = auth.uid());
create policy "notices_admin_delete" on public.user_notices for delete using (coalesce(public.current_role() = 'admin', false));

-- target: 'member' (nome na equipe do projeto) | 'user' (id da conta) | 'manager' (gerente responsável) | 'role' (perfil, entre quem tem acesso ao projeto) | 'all' (todos com acesso)
create or replace function public.notify_project(pid text, target text, who text, p_title text, p_detail text, p_page text, p_source text)
returns int as $$
declare ids uuid[] := '{}'; n int := 0; u uuid;
begin
  if not coalesce(public.has_project_access(pid), false) then raise exception 'Sem acesso a este projeto.'; end if;
  if coalesce(char_length(btrim(p_title)), 0) = 0 then raise exception 'Aviso sem título.'; end if;
  if target = 'member' then
    select coalesce(array_agg(distinct t.user_id), '{}') into ids from public.team_members t where t.project_id = pid and t.user_id is not null and lower(t.name) = lower(btrim(coalesce(who, '')));
  elsif target = 'user' then
    select coalesce(array_agg(a.user_id), '{}') into ids from (
      select p.id as user_id from public.profiles p where p.id::text = coalesce(who, '')
        and (coalesce(p.role = 'admin', false) or exists (select 1 from public.project_access x where x.project_id = pid and x.user_id = p.id))) a;
  elsif target = 'manager' then
    select coalesce(array_agg(manager_id), '{}') into ids from public.projects where id = pid and manager_id is not null;
  elsif target = 'role' then
    select coalesce(array_agg(distinct p.id), '{}') into ids from public.profiles p
      where p.role = coalesce(who, '') and coalesce(p.active, true)
        and exists (select 1 from public.project_access x where x.project_id = pid and x.user_id = p.id);
  elsif target = 'all' then
    select coalesce(array_agg(distinct x.user_id), '{}') into ids from public.project_access x where x.project_id = pid;
  else raise exception 'Destino de aviso inválido.'; end if;
  foreach u in array ids loop
    if u is distinct from auth.uid()
       and not exists (select 1 from public.user_notices e where e.user_id = u and e.project_id = pid and e.title = left(btrim(p_title), 160) and e.created_at > now() - interval '20 hours') then
      insert into public.user_notices(project_id, user_id, title, detail, page, source)
        values (pid, u, left(btrim(p_title), 160), left(p_detail, 500), left(p_page, 40), left(p_source, 120));
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$ language plpgsql security definer set search_path = public;
grant execute on function public.notify_project(text, text, text, text, text, text, text) to authenticated;
