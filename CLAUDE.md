# PMO Compass — regras do projeto

Skills: usar `boas-praticas-desenvolvimento` (e `padrao-telas` quando houver tela) em todo trabalho de desenvolvimento; avisar no início e dizer no fim o que foi verificado e o que ficou pendente.

## Mapa de tudo que o sistema cria (regra do dono, 01/11/2026)
- Tudo que o sistema cria (tabelas e campos, chaves do navegador, pastas de arquivos, funções de borda, logs, configurações fora do banco) está em `docs/mapa-de-dados.json`; o documento legível é `docs/MAPA_DE_DADOS.md`, **gerado** (nunca editar à mão): `node scripts/build-data-map.mjs`.
- **Na mesma entrega** de qualquer coisa que crie dado: atualizar o JSON, gerar o documento e rodar `npm run test:unit` (testes `datamap`) e `npm run test:smoke` (varredura de projeto vazio). Os testes falham se algo existir sem estar no mapa ou se uma limpeza esquecer uma tabela.
- Limpezas: "Apagar dados do projeto" (`PROJECT_DATA_TABLES` + `PROJECT_EXTRA_TABLES`), "Excluir o projeto", "Apagar toda a base" (`resetForNewUsers`, inclui `RESET_MESSAGE_TABLES`), "Sair da conta" (`wipeLocalData`). Toda tabela de dados do projeto tem `project_id` (a limpeza filtra por ele).
- **Base nova nasce vazia**: nenhum dado de demonstração em projeto real (tela ou nuvem); a demonstração (Portal Nexus, Valdori, Beltrano) só existe sem conta e nunca sobe. A memória do app pertence ao projeto ativo (`cacheOwner`).
- **Sem dado = "sem dados"**: nunca verde, vermelho ou 100. `HealthScore.calculate` ignora dimensões nulas e devolve `null` sem nenhuma.
- Sair da conta apaga o navegador (só ficam `pmo_cloud_v1` e `pmo_theme_v1`); sem login a tela de entrada cobre o app.

## Entrega
- Versão em 4 lugares: `version.json`, `BRAND.version` (PMO_Compass_v2.html), `package.json`, `sw.js` (`CACHE_NAME`).
- Testes: `node tests/run.js` e `npm run test:unit` (inclui `datamap`), `npm run test:smoke`; migrações: `node scripts/db-apply.mjs --dry-run` antes de aplicar, depois `node scripts/build-schema.mjs`.
- Ambiente atual = teste/demonstração/desenvolvimento (não produção); em produção/cliente o log de auditoria nunca é apagado.
- O arquivo principal usa CRLF: edições de várias linhas por script Node (normalizar para LF e devolver CRLF).
