-- Área / departamento do projeto (TI, Engenharia, Marketing...). Permite agrupar os indicadores do portfólio por área
-- e é o que um PMO Departamental precisa para filtrar a sua visão. Texto livre curto, opcional.
alter table public.projects add column if not exists area text
  check (area is null or char_length(area) <= 80);
