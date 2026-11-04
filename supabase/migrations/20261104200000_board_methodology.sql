-- Quadro de tarefas (sem projeto): um espaço só de cartões, criado como um projeto do tipo "quadro".
-- Reaproveita permissões, equipe, autonomia do quadro e limpezas do projeto; o menu mostra só Quadro, Backlog, Meu Trabalho, Arquivos e Colaboradores.
alter table public.projects drop constraint if exists projects_methodology_check;
alter table public.projects add constraint projects_methodology_check
  check (methodology is null or methodology in ('agil','cascata','hibrido','quadro'));
