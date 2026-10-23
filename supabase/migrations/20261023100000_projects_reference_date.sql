-- Data de referência por projeto — só para os projetos de DEMONSTRAÇÃO.
-- Até aqui o "hoje" do app era 20/06/2026 fixo no código (herança da demo), o que distorcia atraso,
-- previsão de entrega e SPI de qualquer projeto real. Agora o "hoje" é o dia real; um projeto só
-- usa data fixa se tiver reference_date preenchida (os de demonstração, pra não parecerem atrasados).
-- O servidor (assistente de status) usa a MESMA regra: reference_date ?? hoje em America/Sao_Paulo.
alter table public.projects add column if not exists reference_date date;

update public.projects
   set reference_date = date '2026-06-20'
 where id in ('nexus','valdori','beltrano') and reference_date is null;
