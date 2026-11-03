# Avaliação do código-fonte — boas práticas de desenvolvimento

Visão de arquiteto de soluções e desenvolvedor sênior sobre o PMO Compass (versão 2.46.0, 03/11/2026). Medições feitas no próprio repositório e no banco; nada foi alterado para produzir este documento.

## Análise X Sugestão/Ação

| Análise (o que encontrei) | Sugestão / Ação |
|---|---|
| **Forças reais:** segurança no servidor (RLS em 36 de 36 tabelas, 100 políticas, regras de dinheiro/horas/acesso em gatilhos), migrações versionadas com ensaio, mapa de dados com testes que impedem tabela esquecida, 64 + 211 testes, 6 testes ponta a ponta (RLS, XSS, acessibilidade), CSP, 0 vulnerabilidades em dependências. | Preservar. Isso é o que menos se vê em produtos desse porte e já está de pé. |
| **Fraqueza estrutural:** um arquivo de 1,55 MB e 20.295 linhas com 113 módulos, sem etapa de build, sem lint, sem tipagem. Tudo conversa por variáveis globais (336 checagens `typeof X !== 'undefined'`). | Migrar aos poucos para módulos ES com build (Vite). É a decisão de maior retorno e a mais cara; fazer por fatias, sem parar a entrega. |
| **Processo:** 178 commits de uma pessoa, todos direto na `main`; CI roda só sintaxe SQL, esquema e testes unitários; não roda a varredura de projeto vazio, os testes ponta a ponta nem a acessibilidade. | Revisão por pull request com CI obrigatório, e incluir smoke, axe e `npm audit` no CI. |
| **Segurança a endurecer:** 9 funções `SECURITY DEFINER` sem `search_path` fixo; a função anônima do banco (`anon`) tem permissão de execução em 29 funções e privilégios totais em 19 tabelas (a RLS protege, mas é defesa única); CSP com `unsafe-inline` por causa de 822 manipuladores `onclick` no HTML. | Uma migração de endurecimento (primeira ação, barata e de alto valor) e, no médio prazo, trocar manipuladores inline por delegação de eventos para retirar o `unsafe-inline`. |

## Resultado por prática

Legenda: **Atende**, **Parcial**, **Não atende**.

### 1. Princípios de codificação e design

| Prática | Situação | Evidência | O que fazer |
|---|---|---|---|
| Clean Code | **Parcial** | Nomes em português claros e comentários que explicam o porquê. Mas há 1.300 funções, 36 com mais de 60 linhas e 10 com mais de 100 (`seed` 157, `build` 151, `commitProposal` 129); 372 montagens de HTML por texto (`innerHTML`) e 822 `onclick` inline misturam marcação, estado e regra. | Quebrar as funções acima de 100 linhas; separar "calcular" de "desenhar" (já feito em `HoursRules`, `BoardRules`, `AgileCalc`: replicar o padrão). |
| KISS | **Parcial** | Arquivo único e sem build deixam o deploy simples e a prova rápida. O custo aparece em outro lugar: edição por script de regex, quebras de linha CRLF que se perdem (aconteceu 3 vezes nesta sessão), nada minificado (1,55 MB servido inteiro). | Manter a simplicidade de deploy, mas ganhar um passo de build que gere o arquivo final a partir de módulos. |
| DRY | **Não atende** | A função de escapar HTML está definida **60 vezes**; 309 marcadores de plural `(s)` espalhados (agora corrigidos na exibição por `Msg.fix`, mas ainda escritos assim); cartões de indicador e linhas de lista repetem o mesmo HTML. | Um módulo `core/util` único (escape, formatação, datas, plural) e trocar os `(s)` pela contagem correta na origem. |
| YAGNI | **Parcial** | A maior parte nasceu de pedido concreto. Pontos de dúvida: botão de SSO/SAML sem plano que o sustente, Burnout/What-If/RACI em paralelo ao novo controle de horas. | Marcar o que está sem uso real e escondê-lo por configuração; remover o que ninguém abriu em 90 dias. |
| SOLID | **Parcial** | Cada módulo é um objeto com responsabilidade razoável, e a tabela de mapeamento de dados (`ROW`) é aberta para extensão. Mas `core/cloud` (1.036 linhas) e `core/db` (693) acumulam sessão, sincronização, mapeamento, anexos, avisos e chamam a interface (`T.show`). Não há inversão de dependência: tudo é global. | Dividir `core/cloud` em autenticação, sincronização, arquivos e avisos; trocar chamadas diretas à tela por eventos. |

### 2. Qualidade e testes

| Prática | Situação | Evidência | O que fazer |
|---|---|---|---|
| Testes automatizados | **Parcial** | 64 testes do app e 211 unitários (com prova de paridade entre cliente e servidor), varredura de projeto vazio e 6 arquivos ponta a ponta com RLS, XSS e axe. **Pontos fracos:** boa parte dos testes de tela só confere se um texto existe no HTML; módulos são extraídos por expressão regular e `new Function` (frágil); não há medição de cobertura; os testes ponta a ponta e o smoke **não rodam no CI**. | Transformar em teste mantido os cenários que hoje faço só como roteiro avulso (horas, raias, avisos); medir cobertura; rodar smoke + axe no CI. |
| Code review | **Não atende** | 178 commits, um autor, todos na `main`; o fluxo de PR existe no CI mas não é usado. A revisão real é você olhando a tela (validação de aceite, útil e rápida, mas não pega erro de código). | Pull request obrigatório com CI verde; usar a skill de revisão de código no PR. |
| Refatoração contínua | **Parcial** | Há correções recorrentes (limpeza de dados, quebras de linha, concordância) mas os "módulos grandes" não diminuíram. | Reservar uma fatia fixa por entrega para quebrar um módulo grande, com testes verdes antes e depois. |
| Lint, formatação, tipos | **Não atende** | Sem ESLint, Prettier, EditorConfig, `tsconfig` ou verificação de tipos; as funções de borda em TypeScript só são checadas no deploy. | ESLint (com plugin para HTML) + EditorConfig (fixar CRLF) + `// @ts-check`/JSDoc nos módulos puros. |

### 3. Arquitetura e operação

| Prática | Situação | Evidência | O que fazer |
|---|---|---|---|
| 12 fatores (resumo) | **Parcial** | **Atende:** código em um repositório; dependências travadas (`package-lock`); configuração e segredos fora do código (`.env.deploy` ignorado e segredos do GitHub); serviços de apoio como recurso anexo (Supabase); funções de borda sem estado; tarefas administrativas em `scripts/`. **Não atende:** paridade entre ambientes (um único projeto Supabase serve de teste e de "produção"); logs só em `console.warn` (32 pontos) e auditoria no banco, sem coleta de erros do navegador; o estado fica primeiro no navegador (`localStorage`) e é sincronizado, e configurações gravadas inteiras (`hoursRules`, `workCalendar`) são "última gravação vence". | Ambiente de homologação separado; coleta de erros (por exemplo Sentry); controle de versão otimista (`updated_at`) nas configurações. |
| Controle de versão | **Parcial** | Git com mensagens claras e migrações versionadas. Falhas: sem tags nem `CHANGELOG`; houve colisão de número de versão (2.42.0 duplicada), o que escondeu a faixa de atualização; arquivos temporários chegaram a ficar na raiz (removidos agora). | Tag por versão, `CHANGELOG` gerado do histórico e trava no CI que falha se a versão não mudar quando o HTML muda. |
| Segurança "shift left" | **Parcial (forte)** | **Atende:** RLS em todas as tabelas, regras no servidor, testes de RLS/XSS no CI manual, CSP, `X-Content-Type-Options`, DPA/LGPD documentada, 0 vulnerabilidades (`npm audit`), 0 uso de `eval`. A busca por texto livre sem escape achou só rótulos de enumeração e constantes (nada vindo do usuário). **A corrigir:** 9 funções definer sem `search_path` (`current_role`, `has_perm`, `has_project_access`, `is_project_manager`, `is_any_project_manager`, `is_my_member`, `guard_member_link`, `prevent_role_self_escalation`, `handle_new_user`); `anon` com execução e privilégios em excesso; `unsafe-inline`; 43 `confirm()` e 8 `prompt()` nativos para decisões (pouco acessíveis); sem varredura de segredos nem de dependências no CI. | Migração de endurecimento (primeira ação), `gitleaks` e `npm audit` no CI. |

## Plano priorizado

**P0 — primeiros dias (baixo custo, alto valor)**
1. Migração de endurecimento: fixar `search_path = public` nas 9 funções; retirar de `anon` o `EXECUTE` das funções internas e os privilégios das tabelas; teste de RLS para provar que anônimo continua sem acesso.
2. CI: incluir varredura de projeto vazio, axe, `npm audit` e varredura de segredos; falhar se o HTML mudar sem mudar a versão.
3. Proteger a `main` (PR + CI obrigatório) e criar tag e `CHANGELOG` por versão.
4. EditorConfig e ESLint no HTML (começando só pelos erros graves).

**P1 — 1 a 2 semanas**
5. Módulo único de utilidades (acabar com as 60 cópias de escape) e troca dos `(s)` pela contagem correta na origem.
6. Dividir `core/cloud` e `core/db`; trocar `T.show` direto por eventos; reduzir os `typeof` com um registro de módulos.
7. Virar teste mantido os roteiros de horas, raias, automações e avisos; medir cobertura.
8. Substituir `confirm`/`prompt` nativos por caixas acessíveis.

**P2 — estratégico (projeto próprio)**
9. Etapa de build (Vite) com módulos ES: testes importam o código real em vez de extraí-lo por regex, `unsafe-inline` sai da CSP (com delegação de eventos no lugar dos 822 `onclick`), arquivo minificado e dividido por tela.
10. Ambiente de homologação, coleta de erros e controle de concorrência nas configurações.

## Limites desta avaliação

- Não executei análise estática de segurança (SAST), teste de carga nem teste de penetração.
- A busca por falta de escape é uma heurística; o teste ponta a ponta de XSS do projeto é a prova mais forte e deve entrar no CI.
- A contagem de tamanho de funções ignora algumas funções escritas em uma só linha (os guias do tour, por exemplo).
- O ambiente atual é de teste/demonstração; o que está acima de P0 pesa mais ao ir para clientes.

## Andamento do plano (03/11/2026)

| Item | Situação |
|---|---|
| 1. Endurecimento do banco | **Feito** (2.46.1): caminho fixo nas funções, anônimo sem execução nem privilégios, verificador `npm run check:db` no deploy. |
| 2. CI com verificações | **Feito** (2.49.2): lint, varredura de segredos, `npm audit` de produção, versão obrigatória quando o app muda, esquema, testes e varredura de projeto vazio. Falta o axe no CI (precisa de contas de teste). |
| 3. Proteção da `main`, tags e CHANGELOG | **Parcial**: CHANGELOG gerado do Git (`npm run changelog`). Falta proteger a `main` (configuração do GitHub, a cargo do dono) e criar as tags. |
| 4. EditorConfig e ESLint | **Feito**: `.editorconfig` e ESLint nos erros graves (achou e corrigiu 2 problemas). Novas regras entram aos poucos. |
| 5 a 10 | Aguardam decisão (P1 e P2). |
