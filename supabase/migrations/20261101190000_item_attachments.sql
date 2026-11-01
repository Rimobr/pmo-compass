-- Anexos nos itens do backlog (prints e arquivos de exemplo de um BUG) e fim do canal separado "problemas reportados":
-- o relato de um bug agora é o próprio item Bug, filho de uma entrega, com os anexos junto.

-- 1) Anexos: lista [{ path, name, size, type }] no item (até 6)
alter table public.backlog_items add column if not exists attachments jsonb not null default '[]'::jsonb
  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 6);

-- 2) Pasta privada de arquivos dos itens: o caminho começa pelo id do projeto, e só quem tem acesso ao projeto lê e envia
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-files', 'item-files', false, 5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

create policy "item_files_select" on storage.objects for select to authenticated
  using (bucket_id = 'item-files' and public.has_project_access((storage.foldername(name))[1]));
create policy "item_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'item-files' and public.has_project_access((storage.foldername(name))[1]) and public.has_perm('manage_backlog'));
create policy "item_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'item-files' and public.has_project_access((storage.foldername(name))[1]) and public.has_perm('manage_backlog'));

-- 3) Remove o canal antigo (nunca recebeu relato): tabela, arquivos e regras
drop policy if exists "bug_reports_files_insert" on storage.objects;
drop policy if exists "bug_reports_files_select" on storage.objects;
drop policy if exists "bug_reports_files_delete" on storage.objects;
-- (o bucket vazio 'bug-reports' fica sem nenhuma regra de acesso: o Supabase não deixa apagar bucket por SQL)
drop table if exists public.bug_reports;
drop function if exists public.touch_bug_report();
