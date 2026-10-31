-- Metodologia do projeto (agil, cascata ou hibrido), guardada no próprio cadastro do projeto.
-- Assim a lista de projetos (menu, busca, portfólio) mostra o método de TODOS os projetos de uma vez,
-- sem precisar abrir cada um. Nulo = projeto antigo, tratado como híbrido (todas as telas).
alter table public.projects add column if not exists methodology text
  check (methodology is null or methodology in ('agil','cascata','hibrido'));
