# PMO Compass — regras do projeto

Skills: usar `boas-praticas-desenvolvimento` (e `padrao-telas` quando houver tela) em todo trabalho de desenvolvimento; avisar no início e dizer no fim o que foi verificado e o que ficou pendente.

## Mapa de tudo que o sistema cria (regra do dono, 01/11/2026)
- Tudo que o sistema cria (tabelas e campos, chaves do navegador, pastas de arquivos, funções de borda, logs, configurações fora do banco) está em `docs/mapa-de-dados.json`; o documento legível é `docs/MAPA_DE_DADOS.md`, **gerado** (nunca editar à mão): `node scripts/build-data-map.mjs`.
- **Na mesma entrega** de qualquer coisa que crie dado: atualizar o JSON, gerar o documento e rodar `npm run test:unit` (testes `datamap`) e `npm run test:smoke` (varredura de projeto vazio). Os testes falham se algo existir sem estar no mapa ou se uma limpeza esquecer uma tabela.
- Limpezas: "Apagar dados do projeto" (`PROJECT_DATA_TABLES` + `PROJECT_EXTRA_TABLES`), "Excluir o projeto", "Apagar toda a base" (`resetForNewUsers`, inclui `RESET_MESSAGE_TABLES`), "Sair da conta" (`wipeLocalData`). Toda tabela de dados do projeto tem `project_id` (a limpeza filtra por ele).
- **Base nova nasce vazia**: nenhum dado de demonstração em projeto real (tela ou nuvem); a demonstração (Portal Nexus, Valdori, Beltrano) só existe sem conta e nunca sobe. A memória do app pertence ao projeto ativo (`cacheOwner`).
- **Sem dado = "sem dados"**: nunca verde, vermelho ou 100. `HealthScore.calculate` ignora dimensões nulas e devolve `null` sem nenhuma.
- Sair da conta apaga o navegador (só ficam `pmo_cloud_v1` e `pmo_theme_v1`); sem login a tela de entrada cobre o app.

## Autonomia do time e telas que respeitam o perfil (regra do dono, 03/11/2026)
- O time ágil responde pelas suas atividades: a gestão (gerente, Scrum Master, PO, administrador) parametriza em "Personalizar quadro → Autonomia do time" quem move os cartões, quais colunas são só da gestão e quais exigem comentário; o servidor impõe (migração `team_autonomy`, chave `teamPolicy`).
- Se o perfil não pode, o link, botão, clique ou arrasto **não aparece**; a mensagem de recusa é só rede de segurança. Redirecionamento automático (entrada, troca de projeto) é silencioso.
- Rótulos com duas ou mais palavras (botões, menus, abas, títulos): inicial maiúscula em cada palavra principal ("Sair / Trocar Usuário"); quando quebra em duas linhas, a linha maior fica em cima.

## Bússola de Negócios (pedido do dono, 03/11/2026)
- Botão na barra superior (ícone de bússola), só para perfis com a permissão `ask_compass` (padrão: Administrador, Gerente de Projeto e Patrocinador; o administrador escolhe em Perfis de acesso). Pergunta sobre todos os projetos liberados: maior desvio com sugestões para retomar, horas por pessoa, atrasos, riscos, decisões, sobrecarga, orçamento e panorama.
- Os números vêm da função `compass_digest()` do banco (recusa quem não tem a permissão; custos só com `view_costs`; horas das pessoas só com `view_all_hours`). Perguntas conhecidas são respondidas por regras explicadas na tela; perguntas livres vão para a IA do próprio usuário só com os fatos (sem R$). Nada novo é gravado, só o evento `compass_question` no log de auditoria.

## Rascunho dos modelos de documentos pela IA (pedido do dono, 03/11/2026)
- Em Modelos de Documentos: "Criar com Rascunho da IA" e, em cada documento, "Rascunho com a IA". A IA recebe só os fatos do projeto (equipe, entregas, riscos, decisões, escopo, impedimentos, partes interessadas), **nunca valores em R$**, e devolve um JSON validado pelo modelo; nada vem como feito; responsável só de quem está na equipe ou nas partes interessadas.
- A pessoa revê numa janela e só então "Adicionar ao Documento": o rascunho entra no fim, sem repetir nem apagar o que já foi escrito. Nada é gravado antes disso.

## Quadros — tarefas sem projeto (pedido do dono, 04/11/2026)
- "Quadros / Kanban" é um grupo próprio do menu, acima de "Gestão do projeto": quadro de tarefas avulsas (como Jira, Trello, Monday), fora de qualquer projeto. "Novo Quadro" pede só o nome.
- Tecnicamente é um projeto do tipo `quadro` (`projects.methodology = 'quadro'`, migração `20261104200000`): reaproveita permissões, equipe, autonomia do time e limpezas. Fica fora de `Methodology.ORDER` (comparações) e o menu mostra só Quadro Kanban, Backlog, Meu Trabalho, Arquivos e Colaboradores (`Methodology.BOARD_OK`); nasce em modo Kanban (sem sprints).
- A lista "Selecione o Projeto" não mostra quadros; "Quadros" não mostra projetos.

## Entrega
- Versão em 4 lugares: `version.json`, `BRAND.version` (PMO_Compass_v2.html), `package.json`, `sw.js` (`CACHE_NAME`).
- Testes: `node tests/run.js` e `npm run test:unit` (inclui `datamap`), `npm run test:smoke`; migrações: `node scripts/db-apply.mjs --dry-run` antes de aplicar, depois `node scripts/build-schema.mjs`.
- Ambiente atual = teste/demonstração/desenvolvimento (não produção); em produção/cliente o log de auditoria nunca é apagado.
- Antes de publicar: `npm run check:all` (lint ESLint, versão nos 4 lugares, segredos, SQL, esquema, testes, smoke e `test:a11y`: axe nos três temas e 375 px das telas e janelas novas; tela ou janela nova entra na lista `SCENES` de `tests/smoke/screens-a11y.mjs`). O CI roda o mesmo e ainda `npm audit` das dependências de produção; o CI também falha se o app mudar sem a versão subir. Ao subir uma versão: `npm run changelog` (gera o CHANGELOG.md do Git; os commits terminam com `(x.y.z)`).
- O arquivo principal usa CRLF: edições de várias linhas por script Node (normalizar para LF e devolver CRLF).
- Ler os bugs de um projeto para corrigir outro sistema: `node scripts/read-bugs.mjs "<nome do projeto>"` (somente leitura; gera `bugs-export/<projeto>/bugs.md` com anexos). Não corrigir o código de outro projeto a partir desta sessão: entregar a pasta para a sessão daquele projeto. Está explícito no sistema: Configurações → Inteligência artificial → "Ler os bugs com uma IA" (comando e instrução prontos para copiar) e na Ajuda.
