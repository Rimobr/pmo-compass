-- Relato de problemas (bugs) dentro do sistema: quem usa descreve o caminho, o passo a passo e anexa prints; o Administrador acompanha.
-- Os anexos ficam num bucket PRIVADO (cada pessoa envia só para a própria pasta; só o autor e o Administrador leem).

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reporter_name text check (reporter_name is null or char_length(reporter_name) <= 120),
  title text not null check (char_length(title) between 5 and 160),
  severity text not null default 'atrapalha' check (severity in ('impede', 'atrapalha', 'detalhe')),
  path text not null check (char_length(path) between 2 and 300),
  steps text not null check (char_length(steps) between 10 and 4000),
  expected text check (expected is null or char_length(expected) <= 2000),
  actual text not null check (char_length(actual) between 3 and 2000),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object' and pg_column_size(context) < 20000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 6),
  status text not null default 'aberto' check (status in ('aberto', 'em_analise', 'resolvido')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bug_reports_status_idx on public.bug_reports(status, created_at desc);
alter table public.bug_reports enable row level security;

create policy "bug_reports_insert_own" on public.bug_reports for insert
  with check (reporter_id = auth.uid() and public.current_role() is not null and status = 'aberto');
create policy "bug_reports_select" on public.bug_reports for select
  using (reporter_id = auth.uid() or coalesce(public.current_role(), '') = 'admin');
create policy "bug_reports_admin_update" on public.bug_reports for update
  using (coalesce(public.current_role(), '') = 'admin') with check (coalesce(public.current_role(), '') = 'admin');
create policy "bug_reports_admin_delete" on public.bug_reports for delete
  using (coalesce(public.current_role(), '') = 'admin');

create or replace function public.touch_bug_report() returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql set search_path = public;
drop trigger if exists touch_bug_report on public.bug_reports;
create trigger touch_bug_report before update on public.bug_reports for each row execute function public.touch_bug_report();

-- Anexos: bucket privado, só imagens, PDF e planilhas/textos pequenos, até 5 MB cada
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bug-reports', 'bug-reports', false, 5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

create policy "bug_reports_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'bug-reports' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "bug_reports_files_select" on storage.objects for select to authenticated
  using (bucket_id = 'bug-reports' and ((storage.foldername(name))[1] = auth.uid()::text or coalesce(public.current_role(), '') = 'admin'));
create policy "bug_reports_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'bug-reports' and coalesce(public.current_role(), '') = 'admin');
