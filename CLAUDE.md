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

## Sprint simples no Quadro (pedido do dono, 06/11/2026)
- O Quadro **tem sprint**, só como **janela de tempo** (por padrão **2 semanas**, de 1 a 4) para controlar quando cada entrega precisa estar pronta, e o **transbordo** do que não terminou (passar para a próxima sprint, estender ou devolver ao backlog: `Agile.openDue`). Nada mais do ágil: sem Planejar sprint por pontos, sem meta, sem capacidade, sem previsão, e a página Sprints fica fora do menu do quadro.
- A faixa do Quadro Kanban (`boardBar`) mostra a sprint ativa, os dias que faltam, os cards concluídos e os botões Editar, Encerrar e Decidir o que Sobrou e Nova Sprint. Cada card mostra "até dd/mm" e fica vermelho ("atrasado") se o prazo passou. O Kanban mostra **todos os cards** por padrão; a sprint é filtro.
- Card novo nasce na sprint ativa; sem responsável cadastrado ele fica fora dela (a regra do responsável vale para entrar em sprint).

## Menu em três níveis (pedido do dono, 04/11/2026)
- Topo: "Meu Dia" (Meu Trabalho, Meus Indicadores); "Visão Geral" (grupo com Raio-X, Painel da Diretoria, Visão Executiva, Visão do PMO); "Indicadores"; "Quadros / Kanban"; "Gestão do Projeto"; "Sistema".
- Um só seletor de projeto e de quadro: o chip do topo (com Novo Projeto, Novo Quadro e Mudar Metodologia). O seletor do menu lateral está oculto.
- Em "Artefatos do Projeto" ficam à vista só os itens do dia a dia (`FLAT`: Dashboard, Quadro Kanban, Backlog, WBS, Riscos, Decisões, Colaboradores — a metodologia esconde o que não vale); o resto está em "Mais Telas" (`.sb-more-group`), que abre sozinho se a tela aberta é uma delas. Tela nova do projeto: decidir se é do dia a dia (solta) ou "Mais Telas".

## Nuvem por padrão e sincronização de projetos (pedido do dono, 04/11/2026)
- O app já nasce **conectado à nuvem** (`DEFAULT_CLOUD` no módulo Cloud: URL e chave **anon**, que é pública por desenho; a de serviço nunca entra no app — há teste). Quem quiser usar só o navegador desmarca "Salvar na nuvem" em Configurações → Nuvem & dados (`cfg.localOnly` em `pmo_cloud_v1`); marcar de novo volta ao padrão. Os testes de navegador (smoke e a11y) rodam em modo local de propósito.
- **A nuvem é a verdade**: `syncProjects` só sobe um projeto que não está na nuvem se foi criado neste navegador e ainda não confirmado (`unsynced`) (dados locais já não são exceção desde a 2.64.2). Projeto vazio apagado na nuvem sai da lista local, não é recriado. Apagar direto na base só vale se os navegadores também limparem (ou use "Excluir o projeto" no sistema).

## Janela de confirmação do sistema (pedido do dono, 05/11/2026)
- Excluir projeto, apagar os dados do projeto e apagar toda a base usam `Dlg.ask({...})` (módulo `ui/confirm-dialog`), não `confirm`/`prompt` do navegador: janela acessível (`alertdialog`, foco em Cancelar, Esc cancela, Tab preso), **botão vermelho** no que não tem volta e, só em "Apagar toda a base", uma caixa de ciência a marcar (`check`). Nunca se pede para digitar o nome do projeto nem a palavra APAGAR.
- Confirmação nova de ação destrutiva usa `Dlg.ask`; a janela está na varredura `test:a11y`. Ainda usam o confirm do navegador outras telas menores (ver `grep "confirm("`).

## Responsável do cartão (pedido do dono, 06/11/2026)
- Quem tem permissão (Administrador ou gerente do projeto) recebe a janela "Responsável Fora da Equipe": diz por que pode resolver, pergunta se **inclui a pessoa na equipe** (abre Pessoas e Acesso já filtrado pelo nome) ou **passa para outro profissional**; "Incluir na Equipe" já inclui sozinho se achar uma única conta com esse nome (dá o acesso ao projeto), senão abre Pessoas e Acesso; quem não pode vê o administrador e o gerente com e-mail.
- O responsável é uma **pessoa cadastrada em Pessoas e Acesso (conta ativa) com acesso ao projeto**: dar acesso ao projeto já cria o colaborador ligado à conta (`ensure_team_member`) e é ele que aparece na lista. Só o administrador liga uma conta a um colaborador (Colaboradores → Adicionar Colaborador). Sem nuvem (só neste navegador) não há contas: vale a equipe toda. O banco impõe a mesma regra (`guard_item_assignee`, migração `20261106140000`).
- Na **primeira coluna** do quadro o cartão pode ficar sem responsável; **da segunda coluna em diante** o responsável é obrigatório e vem de **lista suspensa** (`AgileCalc.assigneeError`). Vale ao salvar o cartão, ao mover por botão ou arrasto (a gestão cai no cartão com o campo em foco) e nas automações de coluna. Quem perdeu o acesso aparece como "(não cadastrado)" até ser trocado.
- **Entrar numa sprint** também exige esse responsável cadastrado: o campo Sprint do cartão fica travado ("Escolha o responsável primeiro") até escolher a pessoa; vale também em Backlog, Planejamento assistido e Importação (item de planilha sem responsável cadastrado entra em "A fazer", sem sprint). O banco impõe só na entrada na sprint (migração `20261106160000`). Quadro (sem sprint): a primeira coluna continua livre.

- Janelas de cadastro longas (como o cartão do item) trazem **Excluir, Cancelar e Salvar no cabeçalho fixo**, para não rolar a tela depois de mudar o primeiro grupo de campos.

## Resumo de entrada — Meus Cards (pedido do dono, 06/11/2026)
- Ao entrar, a pessoa vê uma janela: "Você tem N cards em aberto" (por situação e por projeto, os 5 primeiros), com o botão "Abrir Meu Trabalho" (módulo `ui/my-digest`, `MyDigest`). Só os cards em que o nome dela é o responsável, nos projetos que ela acessa (o banco filtra); nada é gravado, só `pmo_digest_v1` no navegador.
- É **aviso de ciência**: só o botão "OK, Li e Entendi" (`Dlg.ask({ onlyOk: true })`, sem Cancelar e sem Esc) e o **OK vai para a auditoria de cada projeto** (`digest_ack`: quem, quando, quantos cards e quais). Aparece assim que o login termina, sem espera.
- **Gestão** (quem tem `manage_backlog`: gerente, Scrum Master, PO, administrador) recebe também "Cards Sem Responsável Cadastrado" (sem nome, ou nome que não é de pessoa ligada a conta), no mesmo molde, com OK em `digest_ack_unassigned`. O **sino** soma avisos não lidos + cards pendentes e a janela do sino traz esse painel no topo.
- **Parâmetro da organização** `entryDigest` (tabela `org_settings`, só o administrador grava) em Configurações → Resumo de Entrada: `diario` (padrão, já gravado: uma vez por dia e de novo se chegar card novo), `login` (a cada login) ou `off`. Sem valor gravado vale `diario`.

## Quatro temas (regra do dono, 06/11/2026; vale para todas as aplicações)
- **Branco** (`light`), **Cinza** (`gray`), **Preto** (`dark`, sem atributo; é o padrão) e **Verde** (`green`, identidade Vigilae: fundo claro, marca verde-petróleo e barra lateral verde escura com realce âmbar). Módulo `core/theme` (`Theme.set`, `Theme.next`); o botão da barra superior passa ao tema seguinte e Configurações lista os quatro. Aplicado por script no `<head>` antes da primeira pintura; `<meta theme-color>` acompanha. Chave `pmo_theme_v1` (fica ao sair da conta).
- `npm run test:a11y` roda o axe e o teste de 375 px nos **quatro** temas; tela ou janela nova passa nos quatro. Cores só por token (`var(--...)`); o Verde redefine os tokens da barra lateral só dentro dela.

## Pessoa única (pedido do dono, 06/11/2026)
- A pessoa é a **conta** (Pessoas e Acesso). "Quem sou eu" (`MyWork.names`) é, nesta ordem: o colaborador ligado à minha conta, o colaborador com o meu nome, ou o **nome do meu cadastro** (administrador ainda fora da equipe); é o mesmo que o card aceita como responsável e que o resumo de entrada conta. Meu Trabalho e Meus Indicadores avisam quando a pessoa aparece só pelo nome e oferecem **Entrar na Equipe Deste Projeto** (`Cloud.joinTeam`: dá o acesso ao projeto, o que já cria o colaborador ligado; administrador, ou gerente do projeto se o banco permitir).
- O card guarda o **nome**: ao renomear um colaborador, `Agile.renamePerson` leva os cards dele para o nome novo (depois de gravar o colaborador).

## O que aparece no cartão (pedido do dono, 07/11/2026)
- Em Personalizar quadro → "Informações Que Aparecem no Cartão" (só quem tem `manage_backlog`: gerente do projeto, Scrum Master, PO e administrador) a gestão liga ou desliga: Código, Tipo, Pontos, Responsável, Sprint, **Prazo (até quando)**, **Bugs ligados**, **Anexos** e **Tarefas do cartão**. Padrão: tudo aparece. O título sempre aparece e os dados continuam salvos no item.

## Bússola como porta única da IA (pedido do dono, 07/11/2026)
- O botão da Bússola (barra superior) aparece para **quem tem qualquer ferramenta de IA** (`Compass.paint`), não só para quem tem `ask_compass`. A janela lista só as ferramentas que a pessoa pode usar (`Compass.tools`): **Perguntar sobre os projetos** (`ask_compass`), **Perguntar aos documentos** (responde dentro da Bússola, citando a fonte), **Diagnosticar documentos (Raio-X)**, **Estimar pontos do backlog** (`manage_backlog`), **Rascunhar um documento** (`run_rites`) e **Simular um cenário (What-If)**.
- Ferramenta de IA nova entra na lista `TOOLS` do módulo `ui/compass` com a sua permissão. Trocar de modo começa conversa nova. Os pedidos ficam no log de auditoria como `compass_question`. A consulta rápida dos Arquivos passa pela Bússola (`Compass.askDocsFrom`).

## Diagnóstico PMO — Dr. PMO (pedido do dono, 07/11/2026)
- Função própria (tela `drpmo`, menu Visão Geral, ferramenta da Bússola, convite na base vazia): a pessoa aponta os arquivos que já tem (planilhas, termos, atas…) e recebe o **veredito** (Quadro de tarefas ou Projeto; se projeto, ágil, cascata ou híbrido, com os motivos), os **riscos que já aparecem**, os **buracos**, a cobertura de documentos e a fala do Dr. PMO (o que está errado e por que usar o Compass). Vale antes de existir projeto (`view_management`).
- **Nada é gravado**: a leitura é `FileIntake.readOnly` (descaracteriza LGPD e devolve o texto; não indexa no Repositório) e o resultado só existe na tela. Criar o quadro ou projeto é decisão da pessoa (`Wizard.open(formato)`). A IA (opcional) recebe só trechos descaracterizados, sem valores em R$, e devolve JSON validado (`DrPmoCore.parse`); sem IA vale a análise por regras (`DrPmoCore.analyze`).
- Quadro não é cobrado por termo, escopo ou orçamento: o foco é dono, prazo e informação solta. Módulos `services/dr-pmo` e `pages/drpmo-js`; tela nova entra no `SCENES` do a11y e no mapa de visões.

## Destaque dos blocos de trabalho no menu (pedido do dono, 07/11/2026)
- "Gestão do Projeto" (`.sb-proj-area`) e "Quadros / Kanban" (`#sbg-quadros`) têm **fundo mais escuro** que o resto do menu (`color-mix` do `--s1` com preto, `--sb-dark`: 70%; no tema Branco 93%, para não perder contraste) e borda, para separar visualmente os dois blocos onde a pessoa trabalha. Vale nos quatro temas.

## Entrega
- Versão em 4 lugares: `version.json`, `BRAND.version` (PMO_Compass_v2.html), `package.json`, `sw.js` (`CACHE_NAME`).
- Testes: `node tests/run.js` e `npm run test:unit` (inclui `datamap`), `npm run test:smoke`; migrações: `node scripts/db-apply.mjs --dry-run` antes de aplicar, depois `node scripts/build-schema.mjs`.
- Ambiente atual = teste/demonstração/desenvolvimento (não produção); em produção/cliente o log de auditoria nunca é apagado.
- Antes de publicar: `npm run check:all` (lint ESLint, versão nos 4 lugares, segredos, SQL, esquema, testes, smoke e `test:a11y`: axe nos três temas e 375 px das telas e janelas novas; tela ou janela nova entra na lista `SCENES` de `tests/smoke/screens-a11y.mjs`). O CI roda o mesmo e ainda `npm audit` das dependências de produção; o CI também falha se o app mudar sem a versão subir. Ao subir uma versão: `npm run changelog` (gera o CHANGELOG.md do Git; os commits terminam com `(x.y.z)`).
- O arquivo principal usa CRLF: edições de várias linhas por script Node (normalizar para LF e devolver CRLF).
- Ler os bugs de um projeto para corrigir outro sistema: `node scripts/read-bugs.mjs "<nome do projeto>"` (somente leitura; gera `bugs-export/<projeto>/bugs.md` com anexos). Não corrigir o código de outro projeto a partir desta sessão: entregar a pasta para a sessão daquele projeto. Está explícito no sistema: Configurações → Inteligência artificial → "Ler os bugs com uma IA" (comando e instrução prontos para copiar) e na Ajuda.

## Diagnóstico PMO em PDF (pedido do dono, 07/11/2026)
- Na tela do Dr. PMO, "Salvar em PDF / Imprimir" (`DrPmo.pdf`) monta um **documento próprio** (iframe oculto, não imprime o app) com veredito, motivos, riscos, buracos, cobertura e a fala do Dr. PMO, para mostrar ao cliente. Nada é gravado.
- **Quadro** não mostra a cobertura de documentos de projeto (termo, escopo, orçamento…), nem na tela nem no PDF.

## Seleção no menu (pedido do dono, 08/11/2026)
- O projeto ou quadro selecionado nas listas do menu (`.si.proj-active`) aparece em **destaque**: fonte maior (14px), negrito, cor da marca, fundo tingido, barra à esquerda e um ponto à direita. Vale nos quatro temas.

## Celular enxuto (pedido do dono, 08/11/2026)
- Até 600 px a tela mostra **só o que apoia ou pede decisão**: o cabeçalho cabe inteiro (menu, projeto, Bússola, avisos, bug e conta; marca e busca saem), sem trilha de navegação, sem texto explicativo, sem "?" de ajuda e sem aviso de metodologia. Backlog mantém Novo Item e Planejar sprint e os 2 primeiros números; o Kanban **mostra** Automações e Personalizar quadro também no celular (pedido do dono, 09/11/2026: antes ficavam escondidos; só a gestão os vê).
- Tela nova: pensar primeiro no celular (o que a pessoa decide ali?) e esconder o resto por CSS no bloco `@media(max-width:600px)`. `test:a11y` confere que nenhum botão do cabeçalho fica fora da tela em 375 px.
- Dashboard no celular: abre só com "Prazo e cronograma" aberto (farol e decisões críticas); os demais grupos de números ficam recolhidos, cada um com o seu farol no cabeçalho (`KG.compactForPhone`, uma vez por carga; o que a pessoa abrir depois é respeitado).
- Decisão prioritária no celular: sobe para logo abaixo do título do Dashboard, com o título, 3 linhas do texto (ninguém aceita sem ler) e os botões Aceitar e Registrar / Ver todas as decisões.
- Meu Trabalho no celular: primeiro o que é meu (números e entregas); "Onde estou" e "Meu time" saem. Riscos: a lista vem antes da matriz, sem importar, exportar e legenda. Decisões: só aceitar, adiar e discordar (sem exportar nem excluir). Colaboradores: a equipe primeiro e a alocação entre projetos depois; barras de alocação e de entrega ficam abaixo do nome, em largura total.
- Meu Trabalho no celular: "Minhas Entregas" vira **cartões** (nome, prazo, falta, avanço e situação; a chance de estourar sai) em vez de tabela com rolagem lateral (`.mw-tbl`, `data-l`).

## Corrigir os bugs do Kanban em outro sistema, quase automático (pedido do dono, 09/11/2026)
- Na sessão do **outro projeto** basta escrever **"Analise PMO Compass"**: a habilidade global `analise-pmo-compass` (`~/.claude/skills`, cópia em `D:\Claude\Skill`) roda `scripts/read-bugs.mjs`, lê `bugs.md` e os prints, corrige o código **daquele** projeto, roda os testes e dá a baixa.
- Nome que não bate (ou bate com vários): o script sai com código 3 e lista **todos os projetos e quadros** (`--list`: id, tipo, nome, bugs em aberto); a habilidade pergunta qual é e roda de novo com `--id`.
- Baixa: `--id <id> --mark US-1,US-2 --note "..."` leva o bug para **Em revisão** e acrescenta no fim do campo **Descrição e critérios de aceite** (o texto original fica) um bloco entre linhas de 36 asteriscos com "<o que foi feito> — Auto Corrigido!" (a nota tem **até 100 caracteres** (sem contar "Auto Corrigido!", que é somado no fim) e nunca é cortada com reticências: se passar, o script recusa e a IA reescreve mais curta). Nunca vai para Concluído sozinho; é a única gravação do script.
- Configurações → Inteligência artificial → "Ler os bugs com uma IA" traz o **pedido pronto** ("Analise PMO Compass: <projeto>") com botão Copiar Pedido, e o comando manual.

## Regra 1 — Apresentar antes de criar, só no fluxo da skill Analise PMO Compass (regra do dono, 09/11/2026)
- Vale **somente** quando o trabalho nasce da skill `analise-pmo-compass` ("Analise PMO Compass"): se, ao ler os bugs, for preciso **criar algo novo** (tela, função, tabela, arquivo, botão), **apresentar ao dono o que será criado e esperar a decisão** antes de iniciar. Correção do que o bug descreve segue sem apresentação.
- Fora desse fluxo (pedidos normais do dono) **não** há apresentação prévia: fazer.


- Cabeçalho: o selo **"Ver. x.y.z"** (versão do sistema, `#tb-ver`) fica ao lado do avatar, no mesmo estilo do selo de perfil; some no celular (pedido do dono, 09/11/2026).

- Bug sempre tem **Item pai obrigatório** (projeto e quadro; o banco também exige): sem ele o aviso é "Campo obrigatório não preenchido: Item pai". Se o banco recusar uma regra (erro P0001), o app mostra a mensagem da regra e não "Falha ao sincronizar" (reservado a rede) (09/11/2026).

- Correção: o comentário da baixa **não** vai para o histórico; vai para o campo **Descrição e critérios de aceite**, no fim, preservando o texto original, entre duas linhas de 36 asteriscos (limite de 2000 caracteres da descrição) (09/11/2026).

## Fila de prioridade dos bugs (pedido do dono, 09/11/2026)
- Todo card do tipo **Bug** pode ter uma **posição na fila de prioridade** (1 = primeiro a corrigir; `backlog_items.bug_priority`, migração `20261109120000`). Cada posição vale para um bug só, entre os bugs **em aberto** do projeto/quadro; sem posição = fora da fila.
- Campo "Prioridade do bug na fila" no cartão do bug e no formulário de novo bug (só quem tem `manage_backlog`): a lista mostra as posições já usadas ("Posição 2 — hoje é US-007 · título (ele e os de baixo descem)") e a fila de hoje logo abaixo. Escolher uma posição ocupada **encaixa** o bug ali e os de baixo descem; concluir, excluir ou mudar o tipo tira o bug da fila e os de baixo sobem.
- A regra mora no banco (gatilho `bug_priority_queue`/`bug_priority_gap`, sem buracos e sem repetição) e a tela só espelha (`AgileCalc.placeBug`/`compactQueue`). O cartão mostra "P1", "P2"…; "Bugs deste item" vem na ordem da fila.
- Bug novo (formulário "Relatar um Bug") já vem com a **última posição da fila** escolhida; dá para trocar a posição ou escolher "Sem prioridade". `scripts/read-bugs.mjs` lista os bugs por prioridade (P1 primeiro, sem prioridade por último) e a skill `analise-pmo-compass` corrige nessa ordem.

## Atualização automática a cada 10 minutos (regra do dono, 09/11/2026; vale para todo sistema)
- Todo sistema aberto **relê os dados sozinho a cada 10 minutos** (módulo `ui/auto-refresh`, `AutoRefresh`): com a nuvem conectada, `Cloud.pullAll()` e `renderAllModules()`, para que o que outra pessoa mudou apareça sem recarregar a página. Também confere ao voltar para a aba ou quando a rede volta.
- **Nunca interrompe**: não atualiza com janela aberta, campo em digitação, aba oculta ou sem rede (tenta de novo no ciclo seguinte, a cada 30 s). Não recarrega a página, não grava nada e não perde o que está pendente (o `pullAll` espera as gravações em andamento).

## Em revisão devolve o card a quem o abriu (pedido do dono, 09/11/2026)
- Na baixa da skill `analise-pmo-compass` (`read-bugs.mjs --mark`), além de **Em revisão** e do bloco na descrição, o **responsável do card passa a ser quem o abriu** (nome do primeiro registro do histórico casado com um colaborador da equipe ligado a uma conta; sem um único candidato o responsável não muda). O histórico recebe a linha "Responsável: de X para Y".

## Atualização e sessão parametrizáveis, cronômetro e renovação (pedido do dono, 09/11/2026)
- Configurações → "Atualização e Sessão" (só o administrador grava; `org_settings`, chave `sessionPolicy` = `{refreshMin, sessionMin}`; módulo `ui/session-guard`, `SessionGuard`): **atualizar os dados a cada** 1, 2, 5, **10 (padrão)**, 15, 30 ou 60 min (`AutoRefresh` usa o valor) e **tempo máximo logado** de 30 min a 12 h, **8 h (padrão)** ou sem limite.
- Com limite, um **cronômetro** (`#tb-ses`) fica ao lado do avatar (some no celular; **muda de cor**: âmbar nos últimos 5 min, vermelho nos últimos 30 s, em negrito, valendo também para o administrador; clicar nele abre a renovação, que tem o botão Fechar e o Esc enquanto faltar mais de 30 s). **Faltando 30 s** abre a janela "Sua Sessão Vai Terminar" (`modal-session`): conta com senha digita a senha (`Cloud.renewSession` confere com `signInWithPassword`, **sem recarregar a página**: nada do que está aberto se perde); conta SSO só clica em Renovar. Sem renovar, `Cloud.signOut` sai da conta. Se a página abre já vencida, pede a senha em vez de sair de surpresa. A renovação fica na auditoria (`session_renew`).
- O tempo conta do último login (`user.last_sign_in_at`) ou da última renovação. Janela nova passa por `SCENES` do `test:a11y`.

## Gráfico da sprint no Kanban (pedido do dono, 09/11/2026)
- Ocupa o **espaço livre à direita** do cabeçalho do Kanban (abaixo dos botões do topo, até a linha do seletor de sprint): `#kb-burn`, `burnChart`, dentro de `.kb-top`. Não acrescenta altura à tela.
- **Tela larga (≥ 1180 px) sem o aviso de metodologia** (caso do Quadro): o gráfico preenche todo o espaço, com legenda à esquerda ("Cards concluídos por dia", total, tendência), barras com o número no topo e os dias no eixo; é desenhado pelo tamanho medido e redesenha ao redimensionar. **Tela estreita ou com o aviso**: vira um mini gráfico (36 px) na linha do seletor. **Celular**: não aparece.
- Conteúdo: **barras translúcidas** (uma cor, a da marca) de cards concluídos por dia (zero não leva número), **linha de tendência** (reta de mínimos quadrados, só a partir do 3º dia e só até hoje), sem grade nem eixo vertical, dica ao passar o mouse e resumo para leitores de tela (`aria-label`). Dias de folga só entram se houve conclusão. Regras puras em `AgileCalc.doneByDay` e `trendLine`.

## Histórico com criação sempre e cabeçalho da coluna fixo (pedido do dono, 09/11/2026)
- O histórico de todo card **sempre tem um único registro "Card criado", e é o primeiro** (`track` em `Agile`): card novo recebe na hora da gravação; card antigo sem o registro ganha com a data de criação e o nome de quem aparece primeiro; o corte de 300 linhas nunca o remove. É nele que a baixa da skill se apoia para devolver o card a quem o abriu.
- No Kanban o cabeçalho de cada coluna (nome e contagem, `.kb-hdr`) fica **fixo no topo ao rolar a tela**, para a pessoa saber em que coluna está o card (no celular o quadro rola de lado e o cabeçalho acompanha a rolagem do próprio quadro).

## Evoluções de 09/11/2026 (Backlog, celular, renovação SSO)
- **Backlog**: os bugs com prioridade vêm **primeiro, na ordem da fila** (selo "P1", "P2"… no lugar das setas ▲▼; a posição se muda no cartão do bug); depois vem o resto na ordem de sempre.
- **Celular**: Automações e Personalizar quadro voltam a aparecer no Kanban. O cabeçalho fixo das colunas funciona no computador; no celular o quadro rola de lado dentro da própria caixa e por isso o cabeçalho acompanha só essa caixa (sem rolagem aninhada).
- **Renovação da sessão** fica guardada em `pmo_session_renew_v1` (hora e conta), então quem renovou (SSO ou senha) e recarrega a página não volta ao login original.
- **Menu de projetos**: a lista de projetos não aparece no menu (o seletor é só o chip do topo); só os Quadros têm a caixa "Quadro Aberto".

## Comentário dentro do campo, só de inclusão, e motivo ao devolver o card (pedido do dono, 10/11/2026)
- No cartão, **"Descrição e critérios de aceite" e "Comentário da atividade" ficam um abaixo do outro, do mesmo tamanho** (150 px, `.ai-same`), **com o canto para arrastar e expandir na vertical** quando a leitura pedir mais espaço. Os comentários ficam **dentro do próprio campo**: no alto, todos os comentários do card (autor, data, hora e texto; do mais antigo ao mais novo; só leitura, `#ai-lastnotes`) e, embaixo, a caixa do comentário novo (`#ai-note`). As **Evidências** viram o **ícone do clipe** na linha do título do campo (com a contagem de arquivos; colar o print com Ctrl+V continua valendo). A lista de tarefas vem depois. Ao salvar, o aviso diz "Comentário registrado no histórico".
- **Comentário é só de inclusão (auditoria)**: não há como editar nem apagar um comentário já gravado. O banco impõe (`guard_comment_audit`, migração `20261110120000`: recusa alterar o histórico se algum registro "Comentário: …" sumir ou mudar), o corte de 300 linhas do histórico nunca remove comentário nem o registro "Card criado" (app e `read-bugs.mjs`). Manutenção direta no banco que precise mexer em comentário exige desligar o gatilho de propósito.
- **Devolver o card** (levá-lo para uma coluna **anterior**, inclusive sair de Concluído; `AgileCalc.isBackward`) abre uma **janela simples e direta** (`modal-return`, `Agile.askReturn`) que só pede o **motivo** (obrigatório, mínimo 5 letras, até 300): vale pelo botão ◀, pelo arrasto e ao trocar a Situação no cartão e salvar (se já houver comentário digitado no campo, ele serve). O motivo entra no histórico como "Comentário: …" junto da mudança de Situação. Cancelar não move. Quando a gestão move o card **de outra pessoa**, continua valendo a janela "Mover em nome de outra pessoa", que já pede o motivo.

## De quem é a entrega: quem levou a correção definitiva (pedido do dono, 10/11/2026)
- Em Meus Indicadores ("Concluídas em 28 dias", velocidade, tempo até concluir e a lista), um card **concluído** é entrega de **quem o levou a "Em revisão" pela ÚLTIMA vez** (a correção definitiva), olhando só os registros de Situação **para frente** no histórico: devolver o card não conta, a baixa automática e o sistema não contam como pessoa, e quem apenas validou ou concluiu não ganha a entrega. Cada card concluído conta **uma vez só**.
- Sem passagem pela revisão vale quem o pegou por último em "Em andamento"; sem nenhum dos dois, o responsável atual. Card aberto continua sendo de quem é o responsável. Exemplo: Ana leva à revisão, o revisor devolve (responsável vira João), João leva de novo e o Leandro conclui → a entrega é do João. Regra em `MyInd.rows` (`executor`).
- A mesma regra vale em **todos** os indicadores de Meus Indicadores: "Concluídas em 28 dias", **gráfico de velocidade por semana** e **tempo até concluir** (função única `ownership` no módulo `services/my-indicators`). A velocidade usa **pontos só quando todos os cards entregues nas 6 semanas têm ponto**; senão conta itens (uma semana de cards sem ponto não aparece como zero).

## Épico — nível acima da História (pedido do dono, 11/11/2026)
- Hierarquia: **Épico → História → Tarefa / Bug**. Tipo novo **Épico** (`kind = 'epico'`, ids `EP-001`…; migração `20261111120000`): agrupador de histórias, **fora do Quadro** (o Quadro de tarefas não tem Épico), sem responsável, pontos, sprint, situação, comentário nem lista de tarefas. Só se cria novo (botão **Novo Épico** no Backlog ou Tipo = Épico em item novo); não se converte item existente nem se muda o tipo de um épico.
- História e tarefa escolhem o épico no campo **Épico** do cartão (`backlog_items.epic_id`; bug continua ligado à entrega por `parent_id`). O banco confere (`guard_epic`: o épico precisa existir no projeto) e, **ao excluir o épico, as histórias ficam sem épico** (`epic_unlink`; o app avisa antes de excluir).
- **Progresso calculado**, nunca gravado: "N de M histórias concluídas" e barra (`AgileCalc.epicStats`); o épico aparece como concluído quando todas as histórias ligadas estão concluídas.
- **Isolado dos números**: no módulo Agile os épicos ficam numa lista própria (`epics`; `items` não os tem) e voltam juntos ao gravar (`saveItems`), então **não entram** no Kanban, nas sprints, na velocidade, nos pontos nem em Meus Indicadores. O **Backlog** mostra cada épico como cabeçalho com o progresso e as histórias dele agrupadas embaixo ("Sem épico" para o resto; bugs com prioridade continuam no topo; com busca ativa a lista volta a ser plana). O cartão do Kanban e a linha do Backlog mostram o épico da história (ícone de raio e nome); o cartão do épico lista as histórias dele.
- **Ciclo de conflitos entre regras** (rodar a cada entrega que mexe em cards, comentários, fila, épico, entrega ou sessão): `npm run test:ciclo` (navegador, modo local: épico × bug × fila × backlog × indicadores × Quadro × devolver card × entrega × sessão) e `npm run test:ciclo-db` (banco real, com linhas `ZZ-*` descartáveis: gatilhos de épico, fila de bugs, comentário só de inclusão e item pai do bug). O ciclo de 11/11/2026 achou e corrigiu dois conflitos: o épico aparecia como "card sem responsável" no resumo de entrada da gestão (consultas agora filtram `kind <> 'epico'`) e o banco aceitava bug ligado a um épico (migração `20261111130000`).

## Decisões do dono (11/11/2026)
- **Sessão de 8 horas continua o padrão** (`sessionPolicy.sessionMin = 480`); "sem limite" só se o administrador escolher em Configurações → Atualização e Sessão.
- **Cabeçalho fixo das colunas no celular**: fica como está (só vale no computador); sem rolagem aninhada.
- **Ajuda e manuais ficam por último**: só se atualizam **depois de tudo implementado** ou **quando o dono pedir**; não entram em cada entrega.

## Revisão da sprint por pessoa, épico em card concluído e progresso do épico (pedido do dono, 11/11/2026)
- **Revisão da sprint (item "Quem entregou")**: o resumo de entregas mostra, por pessoa e em ordem alfabética ("(sem responsável)" por último), quantos itens e pontos cada uma entregou, e cada linha concluída traz o nome de quem entregou. Usa a **mesma regra de entrega** de Meus Indicadores (`MyInd.ownerOf`, quem levou a correção definitiva à revisão); os totais da sprint não mudam (`AgileRites.reviewSummary(sprint, items, ownerOf)`).
- **Ligar a um épico um card que já está concluído e sem responsável**: permitido quando o épico é a **única mudança** do cartão (`onlyEpic` em `saveItem`; o banco já só cobra responsável na mudança de coluna, de responsável ou na entrada em sprint). Qualquer outra mudança nesse card continua exigindo o responsável.
- **Progresso do épico mais visível**: o cartão do Kanban e a linha do Backlog mostram a etiqueta do épico com o progresso ("Relatórios · 2/3", verde quando todas as histórias estão concluídas, `epicChip`), e o cabeçalho do épico no Backlog traz barra mais grossa, porcentagem e fica verde ao concluir.
- O cartão não mostra mais "undefined" na descrição de um card sem esse campo.
