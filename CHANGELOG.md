# Histórico de versões

Gerado do Git por `node scripts/build-changelog.mjs` (nunca editar à mão). Cada linha é um commit publicado; a data é a do commit.

## 2.50.0 — 2026-11-03
- Meus Indicadores (em Indicadores): atrasadas, vencem nos proximos N dias, parado, velocidade de entrega, tempo ate concluir, horas, impedimentos e orientacao do dia; filtros; meus projetos

## 2.49.2 — 2026-11-03
- Boas praticas: CI com lint, segredos, npm audit de producao, trava de versao e varredura de projeto vazio; ESLint nos erros graves (2 achados corrigidos); EditorConfig; CHANGELOG gerado do Git; npm run check:all

## 2.49.1 — 2026-11-03
- Quadro: o botao de impedimentos abre a lista dos impedimentos abertos (resolver, ir aos ritos ou registrar na Sprint atual) em vez de levar a outra tela

## 2.49.0 — 2026-11-03
- Lista de tarefas no cartao e regras de passagem do quadro por projeto (sair de uma coluna exige tarefas concluidas; gestao move com motivo); tarefas padrao dos cartoes novos; regra imposta pelo servidor

## 2.48.2 — 2026-11-03
- Quadro refeito depois que as configuracoes do projeto chegam: colunas criadas pela gestao (ex.: Em testes de QA) nao somem para quem entra

## 2.48.1 — 2026-11-03
- Boas-vindas so na primeira vez de cada conta (marca no servidor; qualquer fechamento conta como visto); teste da autonomia corrigido

## 2.48.0 — 2026-11-03
- Gestao move o cartao de outra pessoa em caso excepcional informando o motivo (historico); parametrizavel

## 2.47.2 — 2026-11-03
- Barra superior mostra o nome da pessoa (e-mail na dica)

## 2.47.1 — 2026-11-03
- Cartao: janela com rolagem e altura maxima; comentario e evidencias lado a lado

## 2.47.0 — 2026-11-03
- Autonomia do time no quadro: a gestao define quem move os cartoes, colunas so da gestao e colunas que exigem comentario; o time comenta e anexa evidencias no cartao; regra imposta pelo servidor; sem permissao nao ha link, clique nem arrasto; aviso de tela fora do perfil so quando a pessoa escolhe a tela

## 2.46.1 — 2026-11-03
- Banco: endurecimento (search_path fixo nas funcoes definer; anonimo sem execucao nem privilegios) com verificador; correcao da aprovacao de horas que nao gravava no servidor (inserir-ou-atualizar); indicadores de horas atualizam na hora

## 2.46.0 — 2026-11-03
- Horas: orcamento do projeto (faixas de aviso e critica parametrizaveis, bloqueio opcional ao chegar em 100%), alerta de urgencia maxima ao gerente pelo servidor, medidor em Horas e grupo Horas do projeto nos indicadores

## 2.45.0 — 2026-11-03
- Avisos: botao abre o proprio registro (lancamento, item) ou nao existe; mensagens com concordancia certa (Msg: n, agree, sentence, fix); historico de cada lancamento de horas escrito pelo servidor e Trilha do projeto

## 2.44.2 — 2026-11-03
- Sair / trocar de usuario: fora dos menus, no fim da barra lateral, em destaque vermelho

## 2.44.1 — 2026-11-03
- Ler os bugs com uma IA: explicito em Configuracoes (comando e instrucao prontos para copiar) e na Ajuda

## 2.44.0 — 2026-11-03
- Horas: cada pessoa lanca as proprias; o gerente so por outra pessoa em caso extremo, com justificativa registrada (tela e servidor)

## 2.43.2 — 2026-11-03
- Equipe: ao ligar a conta ao projeto (troca de perfil ou acesso), a lista de colaboradores e o Burnout Radar se atualizam na hora

## 2.43.1 — 2026-11-03
- Lista de projetos da pessoa: rodape sem quebra de texto

## 2.43.0 — 2026-11-03
- Horas: entrega obrigatoria, hora extra com motivo e liberacao do gerente, aprovacao (aprovar/reprovar/pedir ajuste), regras parametrizaveis (prazo em dias uteis, ate o N-esimo dia util do mes seguinte, entrega encerrada) e fechamento de periodo; travas no servidor; botao de limpar nos campos com sugestoes

## 2.42.3 — 2026-11-02
- Excecao de calendario: auditoria com a justificativa inteira e o dia da semana; lista mostra o dia da semana

## 2.42.2 — 2026-11-02
- Item: a Situacao lista as colunas do quadro (inclui as criadas) e nunca grava vazio

## 2.41.1 — 2026-11-02
- Raias: Tipo, Responsavel e Estimativa lado a lado, rotulo em cima

## 2.42.0 — 2026-11-02
- Historico por card (de -> para, com pesquisa) e linha de base nao cobrada de projeto Agil

## 2.41.0 — 2026-11-02
- Automacoes do quadro (gatilho: coluna, criacao, responsavel, fim da sprint; acoes: atribuir, alterar dado, mover, avisar) e avisos na tela apos o login; raias com listas de selecao em vez de caixas

## 2.40.0 — 2026-11-02
- Quadro: raias filtradas (tipo, responsavel, estimativa) abaixo da raia geral, recolhiveis; colunas arrastaveis; Sprint atual com numeros em linha; sem historico do navegador no campo Responsavel; base dos avisos na tela

## 2.39.0 — 2026-11-01
- schema.sql: coluna extensions da sprint
- Fim da sprint: ponto de validacao (estender 1 semana, passar o que sobrou para a proxima sprint ou devolver ao backlog), aviso nas telas da sprint, extensao registrada

## 2.38.3 — 2026-11-01
- UX: cartoes de numeros em duas colunas no celular (Riscos, Horas, Backlog, Portfolio, Painel)

## 2.38.2 — 2026-11-01
- Projetos da pessoa: marcar varios e salvar de uma vez (rascunho, Salvar/Cancelar, fecha e atualiza a linha)

## 2.38.1 — 2026-11-01
- Login: Enter nos campos de e-mail, senha e SSO entra

## 2.38.0 — 2026-11-01
- UX: Kanban legivel no celular (rolagem lateral so do quadro, colunas com largura minima); barra do topo sem corte (Ver como so no computador)

## 2.37.0 — 2026-11-01
- Calendario: seletor de 12 anos com setas para qualquer ano; vale para qualquer ano

## 2.36.0 — 2026-11-01
- Calendario enxuto (resumo do ano, meses em abas, feriado que repete todo ano); secoes recolhiveis com tom por funcao nas Configuracoes; regra na skill

## 2.35.0 — 2026-11-01
- Calendario de trabalho: fim de semana e feriados nao recebem datas do plano; excecao so do gerente, com justificativa; feriados nacionais calculados e feriados do projeto; capacidade da sprint em dias uteis

## 2.34.0 — 2026-11-01
- Sprint atual para o time (Sprints e Ritos so para quem conduz); base vazia sem projeto de enchimento: depois de zerar, quem entra cria o primeiro projeto

## 2.33.0 — 2026-11-01
- Ver como outro perfil (Administrador, so visualizacao); incluir pessoa no projeto cria e liga o colaborador; Minha conta acompanha o login; Meu projeto vazio vira espaco local que nao sobe para a nuvem

## 2.31.0 — 2026-11-01
- Cada perfil ve so o que precisa: visoes de portfolio, gestao e carga do time (menu, abertura direta e banco); Meu trabalho com entregas, prazo e chance de estourar, time e o que o projeto deve entregar; Minha conta; uma unica entrada de conta no topo

## 2.30.0 — 2026-11-01
- Raiz dos dados de demonstracao em projeto real: memoria pertence ao projeto ativo, demo nunca sobe para a nuvem; varredura de projeto vazio; mapa de dados e documento; reset inclui mensagens

## 2.29.0 — 2026-11-01
- Sem login: tela de entrada cobre o app (nada do projeto anterior aparece), avatar e Comece aqui deixam de aparecer

## 2.28.0 — 2026-11-01
- Sair limpa o navegador (dados, sessao e cache) e outra pessoa que entra nao ve os dados da anterior; sem login nao mostra Administrador; indicadores sem dado nao mostram verde

## 2.27.0 — 2026-11-01
- Barra de rolagem larga (16 px) e colorida, com trilha e destaque ao passar o mouse

## 2.26.0 — 2026-11-01
- Relatar um bug cria o item Bug filho de uma entrega, com orientacao de preenchimento e anexos no proprio item; remove o canal separado de problemas reportados

## 2.25.0 — 2026-11-01
- Itens entram pelo Backlog e pela sprint (Scrum) com opcao de Kanban continuo; item urgente na sprint com motivo; Sair/trocar de usuario no menu

## 2.24.0 — 2026-11-01
- Relato de problemas com anexos; bug como filho de uma entrega; Kanban com colunas sempre visiveis e importacao; sprints com historia e troca sem engessar; planilhas modelo e planilha do ciclo; saude sem dados nao e mais 100

## 2.23.0 — 2026-11-01
- Cadastro com conhecimentos e ferramentas em nivel (junior/pleno/senior) e catalogo comum; avaliacao da pessoa e do gerente por projeto; perfis dispensados do cadastro complementar

## 2.22.0 — 2026-11-01
- Ver cadastro de cada pessoa: administrador ve tudo, gerente responsavel ve as pessoas dos seus projetos sem o telefone

## 2.21.0 — 2026-11-01
- Usuarios: inativar, reativar e excluir (varios de uma vez), trocar responsavel das atividades pendentes (admin e gerente responsavel), chave de IA salva visivel no campo, botao Novo usuario

## 2.20.1 — 2026-11-01
- Testar conexao da IA: botao por provedor faz uma pergunta minima e explica chave recusada, saldo ou rede

## 2.20.0 — 2026-11-01
- Cadastro fechado: so o administrador cria contas (nome + e-mail), senha temporaria por e-mail, troca obrigatoria no primeiro acesso, cadastro complementar com consentimento LGPD do WhatsApp

## 2.19.3 — 2026-10-31
- Comece aqui: passo da IA so fica feito quando existe chave de verdade (consulta o servidor quando conectado a nuvem)

## 2.19.2 — 2026-10-31
- Apagar tudo de verdade: reset da base leva projetos, equipe e configuracoes da nuvem; limpar projeto de exemplo nao recria os dados; telas sem texto de exemplo fixo

## 2.19.1 — 2026-10-31
- Apagar dados num so lugar: dados do projeto, projeto inteiro ou toda a base, com resumo do que sera apagado e confirmacao digitada

## 2.19.0 — 2026-10-31
- Gerente responsavel por projeto: so ele (e o administrador) inclui pessoas; lista de projetos com caixas de selecao e Todos os projetos

## 2.18.6 — 2026-10-31
- Pessoas e acesso: perfil e projetos de cada pessoa na mesma lista, com busca e filtro por projeto; remove o cartao Membros deste projeto que nao acompanhava o projeto ativo

## 2.18.5 — 2026-10-31
- Menu: titulo Gestao do projeto centralizado, seta sem sobrepor o texto

## 2.18.4 — 2026-10-31
- Menu: area Gestao do projeto recolhe tudo de uma vez, lembra a escolha e abre sozinha ao navegar para uma tela dela

## 2.18.3 — 2026-10-31
- Configuracoes reorganizadas por afinidade: Projeto e organizacao, Pessoas e acesso, IA, Comunicacao, Nuvem e dados

## 2.18.2 — 2026-10-31
- Vincular conta ja ao criar colaborador; botao fechar do modal de colaborador com nome acessivel; telas novas conferidas em 3 temas e 375/1280 px

## 2.18.1 — 2026-10-31
- Time atualiza status e datas reais das proprias tarefas do cronograma; corrige erro ao abrir a tabela do WBS para quem so consulta

## 2.18.0 — 2026-10-31
- Perfis de acesso por permissao (PMI, Agil e personalizados), Meu trabalho, vinculo conta-colaborador, Excluir projeto e Limpar dados completo

## 2.17.0 — 2026-10-31
- UX: Dashboard passa para a area do projeto; nota Ritmo da sprint no agil; metodologia facil de achar; projeto agil novo abre no Backlog; Atualizado ha contado pela data de referencia

## 2.16.0 — 2026-10-31
- Etapa "Ritos da sprint" (planejamento, reuniao diaria com impedimentos, revisao, retrospectiva com acoes, refinamento); Modelos (5W2H, SWOT, comunicacao, cutover, handover); Kanban com colunas, limites e campos do cartao personalizaveis

## 2.15.3 — 2026-10-31
- Acessibilidade e toque: cartao do Kanban sem botao dentro de botao, titulos de tela como titulos reais, alvos de toque maiores, contraste do ? e dos contadores

## 2.15.2 — 2026-10-31
- Menu: area de gestao do projeto com fundo levemente diferenciado

## 2.15.1 — 2026-10-31
- Menu: divisor "Gestao do projeto" separa os paineis e indicadores da area do gerente de projeto e da equipe

## 2.15.0 — 2026-10-31
- Capacidade por pessoa (ritmo real, folgas e alocacao) no planejamento da sprint; IA estima pontos e sugere dividir itens grandes calibrada pelo historico do time

## 2.14.0 — 2026-10-31
- Backlog: importar itens por planilha (Jira/Excel) e planejar sprint com sugestao do sistema (pontos x capacidade, reserva e comparacao com a velocidade do time)

## 2.13.0 — 2026-10-31
- Relatorio executivo mostra a metodologia de cada projeto (coluna e rotulo dos graficos); corrige teste do relatorio
- Comparativo por metodologia (situacao e evolucao) no Painel da Diretoria; metodologia visivel em todas as listas de projeto e nas exportacoes

## 2.12.1 — 2026-10-31
- Icone da metodologia antes do nome do projeto (menu, busca, lista do topo) com legenda; metodologia gravada no cadastro do projeto

## 2.12.0 — 2026-10-31
- Perfil de PMO passa a ser da organizacao (vale para todos os projetos; so administrador altera); nova tabela org_settings

## 2.11.0 — 2026-10-31
- Modulo agil (Quadro Kanban com limite WIP, Backlog, Sprints com burndown e velocidade), Dashboard por metodologia, codigos SC-nnn sequenciais, projeto troca limpa cache da RACI

## 2.10.0 — 2026-10-31
- Metodologia do projeto (Agil, Cascata, Hibrido) molda o menu; novos dados de demonstracao, um por metodologia; recarregar demonstracao

## 2.9.3 — 2026-10-30
- Botoes que fingiam funcionar: Perguntar a IA (Repositorio), Redigir mensagem (stakeholder), Copiar acoes da ata agora sao reais; Congelar e Agendar lembrete marcados Em breve

## 2.9.2 — 2026-10-30
- Scope Changes: Analise IA e Relatorio scope creep funcionam de verdade (antes eram so uma mensagem)

## 2.9.1 — 2026-10-30
- Sugestão de subtarefas da IA (e subtarefa manual) abre a entrega e aparece na hora, inclusive no Gantt

## 2.9.0 — 2026-10-30
- Ajustes de UX/UI: menu em gaveta no celular, painéis do menu em um só visual, nome do projeto sem repetição, textos a partir de 11 px, farol da Diretoria em palavras, RACI compacta no celular, boas-vindas em passos e nomes acessíveis em Configurações

## 2.8.1 — 2026-10-30
- Indicador de progresso para processos longos (etapas reais, tempo, cancelar, erro claro) e atalho para as sugestões do Painel da Diretoria

## 2.8.0 — 2026-10-26
- Matriz RACI por entrega e exportação em Excel (WBS, Riscos, Horas, Indicadores, RACI)

## 2.7.1 — 2026-10-24
- Relatório Executivo (decisões em destaque, gráficos, seletor de projeto, PDF) e menu com Projeto > Ações do projeto e Sistema separado

## 2.6.2 — 2026-10-24
- Menu: Painéis sempre abertos; Indicadores, Ações e Sistema recolhidos e abertos só com item selecionado

## 2.6.1 — 2026-10-24
- Menu em 3 blocos (Indicadores Gerenciais, Ações do Gerente de Projeto, Sistema) e teste do assistente com orientação quando não há destinatário

## 2.5.2 — 2026-10-24
- Visão do PMO abaixo da Visão Executiva; guia dos tipos de PMO em popup junto ao seletor

## 2.5.1 — 2026-10-24
- Visão do PMO: guia 'o que cada visão oferece' dentro do sistema

## 2.5.0 — 2026-10-24
- Visão do PMO: indicadores por tipo de PMO

## 2.4.0 — 2026-10-23
- Indicadores do Portfólio e área/departamento do projeto

## 2.3.0 — 2026-10-23
- Linha de base: salvar o plano aprovado e comparar com o plano atual

## 2.2.0 — 2026-10-23
- Mensagem de status pronta para copiar/colar no WhatsApp e e-mail

## 2.1.8 — 2026-10-23
- Acessibilidade dos divisores e do botão de recolher o menu

## 2.1.7 — 2026-10-23
- Ícones (?) com 'o que é e como usar' nas telas novas; Gantt legível com coluna de nomes larga

## 2.1.5 — 2026-10-23
- Terminologia de RH: pessoas são 'colaboradores' (Recursos/membro só para ferramentas e acesso)

## 2.1.4 — 2026-10-23
- Aviso de versão imediato quando o service worker ativa

## 2.1.3 — 2026-10-23
- Menu recolhível em ícones e divisores arrastáveis em Riscos e Horas

## 2.1.2 — 2026-10-23
- Menu lateral com largura ajustável

## 2.1.1 — 2026-10-23
- Aviso de nova versão na tela com botão Atualizar agora
