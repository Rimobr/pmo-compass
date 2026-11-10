-- Comentários do card são SÓ DE INCLUSÃO (auditoria): quem altera o histórico não pode mudar nem apagar um comentário já gravado.
-- Comentário = registro do histórico sem campo e com texto "Comentário: …". Acrescentar comentário novo e qualquer outro registro continua livre.
-- (Excluir o card inteiro é outra ação, protegida pela permissão de gestão do backlog.)
create or replace function public.guard_comment_audit() returns trigger as $$
declare lost int;
begin
  if tg_op <> 'UPDATE' or old.history is null then return new; end if;
  if new.history is not distinct from old.history then return new; end if;
  select count(*) into lost from jsonb_array_elements(old.history) h
    where h->>'to' like 'Comentário: %' and coalesce(h->>'field', '') = ''
      and not exists (select 1 from jsonb_array_elements(coalesce(new.history, '[]'::jsonb)) n where n = h);
  if lost > 0 then
    raise exception 'Os comentários do card são só de inclusão: não podem ser alterados nem apagados (auditoria).';
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists guard_comment_audit on public.backlog_items;
create trigger guard_comment_audit before update on public.backlog_items
  for each row execute function public.guard_comment_audit();
