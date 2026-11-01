-- Catálogo comum de conhecimentos e ferramentas: a pessoa escolhe da lista; se não achar, digita e o item é CRIADO e passa a aparecer para todos.
-- Reduz divergência de escrita ("SAP FI", "sap fi", "S.A.P. FI"): o servidor reconhece o mesmo nome (sem caixa, acento nem espaço repetido) e devolve o item que já existe.
-- Preparado para uma futura ferramenta de unificação: `merged_into` aponta o item "oficial" e o administrador pode renomear/juntar.

create table if not exists public.skill_catalog (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('conhecimento', 'ferramenta')),
  name text not null check (char_length(name) between 2 and 60),
  name_key text not null,
  merged_into uuid references public.skill_catalog(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists skill_catalog_key_uidx on public.skill_catalog(kind, name_key);
alter table public.skill_catalog enable row level security;
create policy "skill_catalog_read" on public.skill_catalog for select using (auth.role() = 'authenticated');
create policy "skill_catalog_admin_write" on public.skill_catalog for all
  using (coalesce(public.current_role(), '') = 'admin') with check (coalesce(public.current_role(), '') = 'admin');

-- Mesmo nome, sem diferenças de caixa, acento, pontuação solta ou espaços
create or replace function public.skill_key(t text) returns text as $$
  select btrim(regexp_replace(regexp_replace(
    translate(lower(coalesce(t, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9+#.]+', ' ', 'g'), '\s+', ' ', 'g'));
$$ language sql immutable;

-- Recebe [{kind, name}] e devolve [{kind, skill_id, name}]: reaproveita o que já existe e cria o que falta (máx. 20 novos por pessoa por dia)
create or replace function public.resolve_skills(items jsonb) returns jsonb as $$
declare it jsonb; k text; nm text; nk text; row public.skill_catalog; out jsonb := '[]'::jsonb; created_today int;
begin
  if auth.uid() is null or public.current_role() is null then raise exception 'Entre na sua conta para cadastrar.'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 40 then raise exception 'Lista inválida.'; end if;
  for it in select * from jsonb_array_elements(items) loop
    k := it->>'kind'; nm := btrim(regexp_replace(coalesce(it->>'name', ''), '\s+', ' ', 'g'));
    if k not in ('conhecimento', 'ferramenta') then raise exception 'Tipo inválido.'; end if;
    if char_length(nm) < 2 or char_length(nm) > 60 then raise exception 'O nome precisa ter de 2 a 60 caracteres: %', left(nm, 30); end if;
    nk := public.skill_key(nm);
    if nk = '' then raise exception 'Nome inválido: %', left(nm, 30); end if;
    select * into row from public.skill_catalog where kind = k and name_key = nk;
    if not found then
      select count(*) into created_today from public.skill_catalog where created_by = auth.uid() and created_at > now() - interval '1 day';
      if created_today >= 20 then raise exception 'Limite de 20 itens novos por dia — escolha na lista ou peça ao administrador.'; end if;
      insert into public.skill_catalog(kind, name, name_key, created_by) values (k, nm, nk, auth.uid()) returning * into row;
    end if;
    while row.merged_into is not null loop select * into row from public.skill_catalog where id = row.merged_into; end loop;
    out := out || jsonb_build_object('kind', row.kind, 'skill_id', row.id, 'name', row.name);
  end loop;
  return out;
end;
$$ language plpgsql security definer set search_path = public;
grant execute on function public.resolve_skills(jsonb) to authenticated;

-- Itens iniciais comuns, para a lista não nascer vazia e a escrita já nascer padronizada
insert into public.skill_catalog(kind, name, name_key) select v.kind, v.name, public.skill_key(v.name) from (values
  ('conhecimento','Gestão de projetos'),('conhecimento','Metodologias ágeis'),('conhecimento','Scrum'),('conhecimento','Análise de requisitos'),
  ('conhecimento','Testes e qualidade (QA)'),('conhecimento','Desenvolvimento web'),('conhecimento','Banco de dados'),('conhecimento','UX/UI'),
  ('conhecimento','Segurança da informação'),('conhecimento','SAP FI'),('conhecimento','SAP MM'),('conhecimento','Gestão de riscos'),
  ('ferramenta','Excel'),('ferramenta','Power BI'),('ferramenta','Jira'),('ferramenta','SQL'),('ferramenta','Python'),('ferramenta','MS Project'),
  ('ferramenta','Azure DevOps'),('ferramenta','Confluence'),('ferramenta','Trello'),('ferramenta','Figma'),('ferramenta','Git')
) as v(kind, name) on conflict (kind, name_key) do nothing;

-- A lista de habilidades de cada pessoa precisa ser do formato certo (e, quando traz o item do catálogo, o tipo tem de bater)
create or replace function public.guard_profile_details() returns trigger as $$
declare s jsonb; c public.skill_catalog;
begin
  new.updated_at := now();
  if jsonb_array_length(new.skills) > 40 then raise exception 'Muitas habilidades (máximo 40).'; end if;
  for s in select * from jsonb_array_elements(new.skills) loop
    if jsonb_typeof(s) <> 'object' or (s->>'kind') not in ('conhecimento', 'ferramenta') or (s->>'level') not in ('junior', 'pleno', 'senior')
       or char_length(btrim(coalesce(s->>'name', ''))) not between 2 and 60 then
      raise exception 'Habilidade inválida: informe nome, tipo e nível (júnior, pleno ou sênior).';
    end if;
    if s ? 'skill_id' then
      select * into c from public.skill_catalog where id = (s->>'skill_id')::uuid;
      if not found or c.kind <> s->>'kind' then raise exception 'Item do catálogo inválido.'; end if;
    end if;
  end loop;
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
