-- 1) Conhecimentos e ferramentas com nível (júnior/pleno/sênior), pesquisáveis pelo gerente de projetos.
--    Substitui os dois campos de texto livre por uma lista: [{ "kind": "conhecimento"|"ferramenta", "name": "SAP FI", "level": "junior"|"pleno"|"senior" }]
-- 2) Avaliações do profissional por projeto: a própria pessoa (autoavaliação) e o gerente responsável.

alter table public.profile_details add column if not exists skills jsonb not null default '[]'::jsonb
  check (jsonb_typeof(skills) = 'array' and pg_column_size(skills) < 8000);
alter table public.profile_details drop column if exists knowledge;
alter table public.profile_details drop column if exists tools;
create index if not exists profile_details_skills_idx on public.profile_details using gin (skills jsonb_path_ops);

-- Cadastro completo = departamento + ao menos 1 conhecimento + ao menos 1 ferramenta
create or replace function public.guard_profile_details() returns trigger as $$
begin
  new.updated_at := now();
  if not new.whatsapp_consent then
    new.phone := null; new.whatsapp_consent_at := null;
  elsif tg_op = 'INSERT' or not old.whatsapp_consent or new.whatsapp_consent_at is null then
    new.whatsapp_consent_at := now();
  else
    new.whatsapp_consent_at := old.whatsapp_consent_at;
  end if;
  if char_length(btrim(new.department)) > 0
     and jsonb_path_exists(new.skills, '$[*] ? (@.kind == "conhecimento")')
     and jsonb_path_exists(new.skills, '$[*] ? (@.kind == "ferramenta")') then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

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
      'department', d.department, 'skills', coalesce(d.skills, '[]'::jsonb),
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

-- Quem tem tal conhecimento/ferramenta em tal nível (para o gerente escolher um profissional). Nome parcial, sem acento/caixa.
-- Só devolve nome, departamento e a habilidade — nunca e-mail nem telefone — e só para Administrador e gerentes de projeto.
create or replace function public.find_people(term text, min_level text default null) returns jsonb as $$
declare rank_min int := case min_level when 'senior' then 3 when 'pleno' then 2 when 'junior' then 1 else 0 end;
begin
  if not (coalesce(public.current_role(), '') = 'admin' or public.is_any_project_manager()) then
    raise exception 'Só o Administrador ou o gerente de projetos pode pesquisar profissionais.';
  end if;
  if char_length(btrim(coalesce(term, ''))) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'department', d.department, 'skill', s.value->>'name', 'kind', s.value->>'kind', 'level', s.value->>'level') order by p.name)
    from public.profile_details d
    join public.profiles p on p.id = d.user_id and p.active
    cross join lateral jsonb_array_elements(d.skills) s(value)
    where lower(s.value->>'name') like '%' || lower(replace(replace(btrim(term), '%', ''), '_', '')) || '%'
      and (case s.value->>'level' when 'senior' then 3 when 'pleno' then 2 when 'junior' then 1 else 0 end) >= rank_min
    limit 100), '[]'::jsonb);
end;
$$ language plpgsql stable security definer set search_path = public;
grant execute on function public.find_people(text, text) to authenticated;

-- Avaliações por projeto: "self" = a pessoa se avalia; "manager" = o gerente responsável avalia
create table if not exists public.person_reviews (
  project_id text not null references public.projects(id) on delete cascade,
  person_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('self', 'manager')),
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  scores jsonb not null,
  would_work_again boolean,
  comment text check (comment is null or char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, person_id, kind)
);
alter table public.person_reviews enable row level security;

-- Cada critério de 1 a 5 (qualidade, prazos, comunicação, colaboração, autonomia); nada além disso
create or replace function public.guard_person_review() returns trigger as $$
declare k text;
begin
  if jsonb_typeof(new.scores) <> 'object' then raise exception 'Notas inválidas.'; end if;
  for k in select unnest(array['qualidade','prazos','comunicacao','colaboracao','autonomia']) loop
    if not (new.scores ? k) or jsonb_typeof(new.scores->k) <> 'number' or (new.scores->>k)::numeric not between 1 and 5 or (new.scores->>k)::numeric <> trunc((new.scores->>k)::numeric) then
      raise exception 'Dê uma nota de 1 a 5 em cada critério.';
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(new.scores)) <> 5 then raise exception 'Notas inválidas.'; end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;
drop trigger if exists guard_person_review on public.person_reviews;
create trigger guard_person_review before insert or update on public.person_reviews
  for each row execute function public.guard_person_review();

-- Lê: o Administrador, a própria pessoa e o gerente responsável do projeto
create policy "person_reviews_select" on public.person_reviews for select using (
  coalesce(public.current_role(), '') = 'admin' or person_id = auth.uid() or coalesce(public.is_project_manager(project_id), false));
-- Escreve: a pessoa só a própria autoavaliação (em projeto onde está); o gerente responsável, a de quem está no projeto dele
create policy "person_reviews_write_self" on public.person_reviews for insert with check (
  kind = 'self' and person_id = auth.uid() and reviewer_id = auth.uid() and public.current_role() is not null
  and exists (select 1 from public.project_access pa where pa.project_id = person_reviews.project_id and pa.user_id = auth.uid()));
create policy "person_reviews_update_self" on public.person_reviews for update
  using (kind = 'self' and person_id = auth.uid() and public.current_role() is not null)
  with check (kind = 'self' and person_id = auth.uid() and reviewer_id = auth.uid());
create policy "person_reviews_write_manager" on public.person_reviews for insert with check (
  kind = 'manager' and reviewer_id = auth.uid() and person_id <> auth.uid() and coalesce(public.is_project_manager(project_id), false)
  and exists (select 1 from public.project_access pa where pa.project_id = person_reviews.project_id and pa.user_id = person_reviews.person_id));
create policy "person_reviews_update_manager" on public.person_reviews for update
  using (kind = 'manager' and coalesce(public.is_project_manager(project_id), false))
  with check (kind = 'manager' and reviewer_id = auth.uid() and person_id <> auth.uid() and coalesce(public.is_project_manager(project_id), false));
