# Mapa de dados do PMO Compass

> Gerado por `node scripts/build-data-map.mjs` a partir de `docs/mapa-de-dados.json` (classificação) e `schema.sql` (campos reais). **Não edite à mão**: altere o JSON e gere de novo.

Para que serve: saber, sem procurar no código, **o que o sistema guarda, onde, de quem é e o que cada limpeza faz com isso**. Toda tabela, campo, chave do navegador, pasta de arquivos ou função nova entra aqui na mesma entrega (os testes falham se faltar).

## Como ler as limpezas

- **Apagar dados do projeto** (Configurações → Nuvem & dados → Apagar dados → Dados do projeto): apaga tudo que tem `project_id` do projeto ativo (lista central `PROJECT_DATA_TABLES` + `PROJECT_EXTRA_TABLES`) e deixa o projeto em branco; o projeto, as pessoas e as configurações continuam
- **Excluir o projeto** (Configurações → Nuvem & dados → Apagar dados → Projeto inteiro): apaga os dados do projeto, o próprio projeto e o acesso das pessoas a ele (cascata)
- **Apagar toda a base** (Configurações → Nuvem & dados → Apagar dados → Toda a base (digitar APAGAR)): apaga todos os projetos e seus dados, os destinatários e o histórico de mensagens e deixa a lista de projetos vazia (quem entrar cria o primeiro; não existe projeto de enchimento); **preserva** contas, perfis de acesso, configurações e o log de auditoria
- **Sair da conta** (menu lateral → Sistema → Sair / Trocar Usuário): envia o que estava pendente, encerra a sessão e apaga do navegador tudo que começa com `pmo_` e a sessão `sb-…` (ficam só a conexão e o tema); recarrega
- **Entrar outra pessoa** (automático no login): se o navegador guarda dados de outra pessoa (`pmo_cache_owner_v1`), apaga-os antes de sincronizar

## Tabelas na nuvem (Supabase)

### Pessoas e acesso

| Tabela | Para que serve | Escopo | Dado pessoal | Apagar dados do projeto | Apagar toda a base | Campos |
|---|---|---|---|---|---|---|
| `profiles` | Uma linha por conta: nome, perfil de acesso, ativo/inativo. | pessoa | sim | não se aplica | preserva (as contas continuam) | `id`, `name`, `role`, `created_at`, `active`, `deactivated_at` |
| `access_profiles` | Perfis de acesso (8 prontos + personalizados) e suas permissões. | sistema | não | não se aplica | preserva | `id`, `name`, `description`, `family`, `is_system`, `perms`, `created_at` |
| `profile_details` | Cadastro complementar: departamento, conhecimentos e ferramentas com nível, WhatsApp com consentimento (LGPD) e a marca de que a pessoa já viu a tela de boas-vindas (onboarded_at). | pessoa | sim | não se aplica | preserva (acompanha a conta) | `user_id`, `department`, `phone`, `whatsapp_consent`, `whatsapp_consent_at`, `completed_at`, `updated_at`, `skills`, `onboarded_at` |

### Plano

| Tabela | Para que serve | Escopo | Dado pessoal | Apagar dados do projeto | Apagar toda a base | Campos |
|---|---|---|---|---|---|---|
| `wbs_modules` | Entregas do cronograma (WBS). | projeto | não | apaga | apaga | `id`, `label`, `status`, `pct`, `start_date`, `end_date`, `critical`, `predecessors`, `updated_at`, `project_id`, `origin`, `responsavel`, `start_actual`, `end_actual`, `last_edited_by`, `last_edited_at` |
| `wbs_tasks` | Subtarefas do cronograma. | projeto | não | apaga | apaga | `id`, `module_id`, `label`, `status`, `start_date`, `end_date`, `predecessors`, `updated_at`, `project_id`, `responsavel`, `start_actual`, `end_actual`, `last_edited_by`, `last_edited_at` |
| `scope_changes` | Mudanças de escopo e seu impacto. | projeto | não | apaga | apaga | `project_id`, `id`, `title`, `body`, `status`, `impact_days`, `impact_cost`, `risk_note`, `created_on`, `updated_at` |
| `risks` | Registro de riscos e matriz. | projeto | não | apaga | apaga | `project_id`, `id`, `title`, `description`, `category`, `probability`, `impact`, `score`, `status`, `response`, `mitigation`, `contingency`, `owner_name`, `review_on`, `identified_on`, `closed_on`, `created_by`, `updated_at` |
| `baselines` | Linhas de base (fotografia do plano). | projeto | não | apaga | apaga | `project_id`, `id`, `name`, `note`, `created_on`, `created_by`, `snapshot` |
| `raci_entries` | Matriz RACI. | projeto | não | apaga | apaga | `project_id`, `id`, `label`, `assignments`, `updated_at` |

### Decisões

| Tabela | Para que serve | Escopo | Dado pessoal | Apagar dados do projeto | Apagar toda a base | Campos |
|---|---|---|---|---|---|---|
| `decisions` | Decisões e alertas gerados pela IA. | projeto | não | apaga | apaga | `id`, `severity`, `pct`, `title`, `body`, `sources`, `status`, `actions`, `created_at`, `resolved_at`, `project_id`, `origin` |
| `board_decisions` | Decisões da diretoria sobre o projeto e o resultado depois. | projeto | não | apaga | apaga | `id`, `project_id`, `ai_suggestion`, `ai_reasoning`, `ai_generated_at`, `board_decision`, `board_comment`, `decided_by`, `decided_at`, `outcome_rating`, `outcome_comment`, `outcome_rated_at`, `updated_at` |
| `user_notices` | Avisos na tela de cada pessoa (recados das automações do quadro e alertas de data); cada um lê só os seus. | projeto | sim | apaga | apaga | `id`, `project_id`, `user_id`, `title`, `detail`, `page`, `source`, `created_by`, `created_at`, `read_at`, `severity` |

### Conhecimento

| Tabela | Para que serve | Escopo | Dado pessoal | Apagar dados do projeto | Apagar toda a base | Campos |
|---|---|---|---|---|---|---|
| `documents` | Documentos do repositório (texto lido). | projeto | não | apaga | apaga | `id`, `name`, `ext`, `meta`, `added_at`, `tags`, `index_pct`, `content`, `project_id` |
| `project_docs` | Modelos de documento (5W2H, SWOT, cutover, handover, comunicação). | projeto | não | apaga | apaga | `project_id`, `id`, `kind`, `title`, `data`, `updated_at` |

### Orçamento

| Tabela | Para que serve | Escopo | Dado pessoal | Apagar dados do projeto | Apagar toda a base | Campos |
|---|---|---|---|---|---|---|
| `budget_lines` | Linhas do orçamento planejado. | projeto | não | apaga | apaga | `id`, `label`, `planned_value`, `wbs_module_id`, `is_reserve`, `updated_at`, `project_id`, `origin` |
| `cost_actuals` | Custos lançados (real e comprometido). | projeto | não | apaga | apaga | `id`, `label`, `amount`, `entry_date`, `budget_line_id`, `kind`, `updated_at`, `project_id` |

### Segredos

| Tabela | Para que serve | Escopo | Dado pessoal | Apagar dados do projeto | Apagar toda a base | Campos |
|---|---|---|---|---|---|---|
| `user_ai_keys` | Chave de IA de cada pessoa (nunca volta ao navegador). | pessoa | sim | não se aplica | preserva | `user_id`, `provider`, `api_key`, `updated_at` |

### Registros

| Tabela | Para que serve | Escopo | Dado pessoal | Apagar dados do projeto | Apagar toda a base | Campos |
|---|---|---|---|---|---|---|
| `audit_log` | Trilha de auditoria: só inclusão, ninguém edita nem apaga pela tela. | sistema | sim | não se aplica | preserva (permanente) | `id`, `project_id`, `actor_id`, `actor_email`, `actor_role`, `action`, `description`, `metadata`, `created_at` |

### Projetos

| Tabela | Para que serve | Escopo | Dado pessoal | Apagar dados do projeto | Apagar toda a base | Campos |
|---|---|---|---|---|---|---|
| `project_snapshots` | Fotografias diárias da saúde do projeto (tendência). | projeto | não | apaga (só Administrador) | apaga | `id`, `project_id`, `captured_at`, `source`, `health_score`, `health_status`, `budget_bac`, `budget_ac`, `budget_ev`, `budget_cpi`, `budget_eac`, `budget_consumo_pct`, `priority_index`, `critical_decisions_pending`, `team_overallocated_count`, `dims`, `captured_by` |
| `project_settings` | Configurações por projeto, uma linha por chave: `methodology` (método), `agileConfig` (quadro e entrada de itens), `boardLanes` (raias filtradas do quadro Kanban), `boardRules` (automações do quadro: gatilho e ações), `teamPolicy` (autonomia do time e regras do quadro: quem move os cartões, colunas só da gestão, colunas que exigem comentário, regras de passagem por tarefas concluídas e tarefas padrão dos cartões novos), `hoursRules` (regras de lançamento de horas: horas normais, aprovação, prazos, períodos fechados e orçamento de horas com faixas de alerta), `hoursAlertState` (última faixa do orçamento de horas já avisada, escrita pelo servidor), `workCalendar` (calendário de trabalho: feriados do projeto, exceções autorizadas pelo gerente com justificativa), priorização e perfil de PMO. | projeto | não | apaga | apaga | `project_id`, `key`, `value`, `updated_at`, `updated_by` |
| `projects` | Cadastro do projeto (nome, cliente, método, gerente responsável). | projeto | não | preserva | apaga | `id`, `name`, `client`, `icon`, `created_by`, `created_at`, `reference_date`, `area`, `methodology`, `manager_id` |
| `project_access` | Quem pode abrir cada projeto. | projeto | não | preserva | apaga (cascata) | `project_id`, `user_id`, `granted_by`, `granted_at` |

### Equipe

| Tabela | Para que serve | Escopo | Dado pessoal | Apagar dados do projeto | Apagar toda a base | Campos |
|---|---|---|---|---|---|---|
| `team_members` | Colaboradores do projeto, carga, sinais de burnout e vínculo com a conta (a tabela inteira só é lida por quem tem "ver a carga e os sinais"; cada pessoa lê a própria linha; o time sem carga vem da função `project_team`). | projeto | sim | apaga | apaga | `id`, `project_id`, `name`, `role`, `allocation_pct`, `workload_pct`, `signals`, `recommendation`, `action_page`, `created_at`, `user_id` |
| `time_entries` | Horas apontadas por pessoa e atividade. | projeto | sim | apaga | apaga | `project_id`, `id`, `person_name`, `member_id`, `work_date`, `hours`, `wbs_ref`, `note`, `created_by`, `updated_at`, `status`, `extra_hours`, `extra_reason`, `review_by`, `review_at`, `review_note`, `posted_by`, `behalf_reason`, `history` |
| `person_reviews` | Autoavaliação e avaliação do gerente por pessoa e projeto. | projeto | sim | apaga | apaga | `project_id`, `person_id`, `kind`, `reviewer_id`, `scores`, `would_work_again`, `comment`, `created_at`, `updated_at` |

### Mensagens

| Tabela | Para que serve | Escopo | Dado pessoal | Apagar dados do projeto | Apagar toda a base | Campos |
|---|---|---|---|---|---|---|
| `messaging_settings` | Liga/desliga WhatsApp e e-mail, limites, horários, IA que responde. | sistema | não | não se aplica | preserva | `id`, `enabled`, `whatsapp_enabled`, `email_enabled`, `ai_owner_user_id`, `ai_provider`, `daily_question_limit`, `digest_weekday`, `digest_hour`, `quiet_start`, `quiet_end`, `updated_at`, `updated_by` |
| `message_recipients` | Quem recebe e pergunta (telefone, e-mail, consentimento). | pessoa | sim | não se aplica | apaga | `id`, `name`, `role_label`, `whatsapp`, `email`, `events`, `can_see_financials`, `owner_user_id`, `consent_basis`, `consent_recorded_at`, `consent_recorded_by`, `whatsapp_status`, `whatsapp_confirmed_at`, `email_status`, `active`, `created_at`, `updated_at` |
| `message_recipient_projects` | Em quais projetos cada destinatário tem acesso. | pessoa | não | não se aplica | apaga | `recipient_id`, `project_id` |
| `notification_outbox` | Fila de avisos a enviar. | sistema | não | não se aplica | apaga | `id`, `recipient_id`, `channel`, `event_type`, `project_id`, `title`, `detail`, `dedupe_key`, `status`, `attempts`, `last_error`, `scheduled_at`, `sent_at`, `created_at` |
| `message_log` | Histórico do que foi enviado e perguntado (texto sem dados pessoais). | sistema | sim | não se aplica | apaga | `id`, `recipient_id`, `channel`, `direction`, `kind`, `external_id`, `body_redacted`, `project_ids`, `ai_provider`, `ai_ms`, `error`, `created_at` |

### Execução ágil

| Tabela | Para que serve | Escopo | Dado pessoal | Apagar dados do projeto | Apagar toda a base | Campos |
|---|---|---|---|---|---|---|
| `backlog_items` | Itens do backlog e do quadro (história, tarefa, bug filho com anexos e posição na fila de prioridade dos bugs, lista de tarefas do cartão e histórico). | projeto | não | apaga | apaga | `project_id`, `id`, `title`, `description`, `kind`, `status`, `points`, `assignee`, `sprint_id`, `rank`, `created_on`, `done_on`, `updated_at`, `parent_id`, `attachments`, `history`, `checklist`, `bug_priority` |
| `sprints` | Sprints, capacidade e o que voltou ao backlog. | projeto | não | apaga | apaga | `project_id`, `id`, `name`, `goal`, `start_on`, `end_on`, `capacity`, `state`, `closed_on`, `updated_at`, `availability`, `carried`, `extensions` |
| `sprint_rites` | Ritos da sprint (planejamento, revisão, retrospectiva). | projeto | não | apaga | apaga | `project_id`, `id`, `sprint_id`, `kind`, `held_on`, `attendees`, `notes`, `data`, `updated_at` |
| `impediments` | Impedimentos da sprint. | projeto | não | apaga | apaga | `project_id`, `id`, `title`, `owner_name`, `sprint_id`, `status`, `note`, `created_on`, `resolved_on`, `updated_at` |

### Configurações

| Tabela | Para que serve | Escopo | Dado pessoal | Apagar dados do projeto | Apagar toda a base | Campos |
|---|---|---|---|---|---|---|
| `org_settings` | Configurações da organização (perfil de PMO, frequência do resumo de entrada, atualização automática dos dados e tempo máximo de sessão). | sistema | não | não se aplica | preserva | `key`, `value`, `updated_at`, `updated_by` |

### Catálogos

| Tabela | Para que serve | Escopo | Dado pessoal | Apagar dados do projeto | Apagar toda a base | Campos |
|---|---|---|---|---|---|---|
| `skill_catalog` | Lista comum de conhecimentos e ferramentas (padroniza a escrita). | sistema | não | não se aplica | preserva | `id`, `kind`, `name`, `name_key`, `merged_into`, `created_by`, `created_at` |

## Dados no navegador (localStorage)

| Chave | O que guarda | Tipo | Ao sair da conta | Ao apagar o projeto |
|---|---|---|---|---|
| `pmo_db_v1` | Dados do projeto Portal Nexus (demonstração) neste navegador. | projeto | apaga | apaga |
| `pmo_db_v1__` | Dados de cada outro projeto (a chave leva o id: `pmo_db_v1__<id>`). | projeto | apaga | apaga |
| `pmo_projects_v1` | Lista de projetos conhecida pelo navegador. | projeto | apaga | ajusta |
| `pmo_active_project_v1` | Projeto aberto agora. | projeto | apaga | ajusta |
| `pmo_board_decisions_v1` | Decisões da diretoria (cópia local). | projeto | apaga | nao |
| `pmo_priority_config_v1` | Pesos da priorização do portfólio. | projeto | apaga | nao |
| `pmo_snapshot_throttle_v1` | Controle para não gravar a foto de saúde mais de uma vez por dia. | projeto | apaga | nao |
| `pmo_auth_v1` | Perfil local escolhido neste navegador (modo sem conta). | sessão | apaga | nao |
| `pmo_cache_owner_v1` | Quem é o dono dos dados guardados aqui (para limpar quando outra pessoa entra). | sessão | apaga | nao |
| `pmo_v1` | Provedor de IA e chaves de IA do modo local. | segredo | apaga | nao |
| `pmo_prefs_v1` | Preferências de uso. | preferência | apaga | nao |
| `pmo_org_v1` | Configurações da organização (cópia local). | preferência | apaga | nao |
| `pmo_onboarded_v1` | Se o "Comece aqui" já foi dispensado. | preferência | apaga | nao |
| `pmo_columns_v1` | Ordem e largura das colunas das tabelas. | preferência | apaga | nao |
| `pmo_gantt_lbl_v1` | Largura da coluna de nomes do Gantt. | preferência | apaga | nao |
| `pmo_report_scope_v1` | Escopo escolhido no relatório. | preferência | apaga | nao |
| `pmo_sb_area_v1` | Se a área de projeto do menu está recolhida. | preferência | apaga | nao |
| `pmo_digest_v1` | Resumo de entrada (Meus Cards): data do último aviso e quantos cards havia, para mostrar uma vez por dia. | preferência | apaga | nao |
| `pmo_menu_v2_seen` | Dica do menu reorganizado já mostrada (aparece uma vez). | preferência | apaga | nao |
| `pmo_show_all_screens` | Mostrar todas as telas, mesmo as que o método esconde. | preferência | apaga | nao |
| `pmo_sidebar_collapsed_v1` | Menu lateral recolhido. | preferência | apaga | nao |
| `pmo_sidebar_w_v1` | Largura do menu lateral. | preferência | apaga | nao |
| `pmo_split_` | Posição das divisões de tela (`pmo_split_<tela>`). | preferência | apaga | nao |
| `pmo_view_type_v1` | Visão escolhida (lista/quadro). | preferência | apaga | nao |
| `pmo_theme_v1` | Tema escolhido: light (Branco), gray (Cinza), dark (Preto) ou green (Verde, identidade Vigilae). | preferência | preserva | nao |
| `pmo_cloud_v1` | Escolha da nuvem: só quando a pessoa usa outro projeto Supabase ou escolhe usar só este navegador (localOnly). O padrão é a nuvem, sem gravar nada aqui. | conexão | preserva | nao |
| `pmo_after_wipe` | Aviso mostrado uma vez depois de sair (fica na sessão da aba). | sessão | apaga | nao |
| `pmo_sec_` | Quais seções recolhíveis estão abertas ou fechadas (`pmo_sec_<seção>`). | preferência | apaga | nao |

## Pastas de arquivos (Storage)

| Pasta | Para que serve | Quem lê | Situação |
|---|---|---|---|
| `item-files` | Prints e arquivos de exemplo anexados a um bug (caminho `projeto/item/arquivo`). | quem tem acesso ao projeto | ativa |
| `bug-reports` | Canal antigo de relatos de problema (nunca recebeu arquivo). | ninguém (sem regras de acesso) | retirada — o Supabase não deixa apagar pasta por SQL |

## Funções de borda (servidor)

| Função | Para que serve | Segredos que usa | Quem chama |
|---|---|---|---|
| `ai-proxy` | Chama o provedor de IA com a chave guardada da pessoa. | chaves de IA por pessoa (tabela `user_ai_keys`) | o app, logado |
| `messaging-admin` | Ações do Administrador em Mensagens (status, confirmação de WhatsApp, teste de pergunta). | WA_*, RESEND_API_KEY | o app, Administrador |
| `notify-dispatch` | Envia os avisos da fila. | WA_*, RESEND_API_KEY, CRON_SECRET | agendador |
| `notify-digest` | Monta o resumo semanal. | CRON_SECRET | agendador |
| `notify-unsub` | Descadastro com um clique. | chave de assinatura do link | quem clica no e-mail |
| `wa-webhook` | Recebe as respostas do WhatsApp. | WA_APP_SECRET, WA_VERIFY_TOKEN | Meta (WhatsApp) |
| `users-admin` | Criar usuário, nova senha, inativar, reativar e excluir contas. | chave de serviço do Supabase, RESEND_API_KEY, EMAIL_FROM | o app, Administrador |

## Registros (logs) e rastros

| Onde | O que registra | Pode ser apagado? |
|---|---|---|
| `audit_log` (nuvem) | Logins, mudanças de perfil, contas criadas/inativadas, trocas de responsável, consentimentos, reset de dados. | não pela tela; em base de TESTE pode ser limpo por script de administração (nunca em produção) |
| `message_log` e `notification_outbox` (nuvem) | O que foi enviado e perguntado por WhatsApp/e-mail. | sim, no "Apagar toda a base" |
| Trilha do projeto (`trail`, navegador) | Linha do tempo de ações do projeto (só no navegador, dentro de `pmo_db_v1…`). | sim, junto com os dados do projeto |
| Logs do Supabase (painel) | Auth, banco e funções de borda. | gerenciado pelo Supabase |

## Configurações fora do banco

| Onde | O que é | Como mudar |
|---|---|---|
| Cadastro público do Auth | Desligado: só o Administrador cria contas. | `node scripts/auth-lock.mjs` (ou `--open`) |
| Segredos das funções | WA_*, RESEND_API_KEY, EMAIL_FROM, CRON_SECRET, APP_URL. | `.env.deploy` + `node scripts/deploy-functions.mjs --secrets` |
| Conta inativa | A conta é bloqueada no Auth (ban) e perde o perfil no banco. | Pessoas & acesso → Inativar / Reativar |
| Exportação de bugs para quem corrige | Pasta local `bugs-export/<projeto>/` (bugs.md + anexos), gerada só para leitura; não é publicada nem versionada. | `node scripts/read-bugs.mjs "<nome do projeto>"` (`--all` inclui os concluídos) |

## Quem vê o quê

O menu esconde, a abertura direta pelo endereço é barrada e o banco nega a leitura dos dados correspondentes.

| Permissão de visão | O que libera |
|---|---|
| `view_portfolio` | Painéis de portfólio e diretoria |
| `view_management` | Gestão do projeto (saúde, decisões, riscos, escopo, linha de base, atas, repositório, chat) |
| `view_team_load` | Carga de trabalho e sinais de burnout dos colegas |
| `view_costs` | Custos e orçamento |
| `manage_backlog` | Gerir backlog e sprints (velocidade, capacidade, planejamento) |
| `run_rites` | Conduzir e registrar os ritos da sprint |

| Tela | Exige |
|---|---|
| Painel da Diretoria | `view_portfolio` |
| Visão Executiva | `view_portfolio` |
| Visão do PMO | `view_portfolio` |
| Indicadores | `view_portfolio` |
| Portfólio | `view_portfolio` |
| Priorização | `view_portfolio` |
| Raio-X do Projeto | `view_management` |
| Diagnóstico PMO | `view_management` |
| Dashboard | `view_management` |
| Relatório | `view_management` |
| Linha de base | `view_management` |
| Estimativas IA | `view_management` |
| What-If | `view_management` |
| Decisões IA | `view_management` |
| Loop de Ação | `view_management` |
| Trilha | `view_management` |
| Mensagem de status | `view_management` |
| Scope Changes | `view_management` |
| Stakeholders | `view_management` |
| Atas e Ações | `view_management` |
| Repositório | `view_management` |
| Chat contextual | `view_management` |
| Modelos | `view_management` |
| Riscos | `view_management` |
| Burnout Radar | `view_team_load` |
| Colaboradores | `view_team_load` |
| Orçamento e Custos | `view_costs` |
| Sprints | `manage_backlog` |
| Ritos da sprint | `run_rites` |

Telas abertas a quem tem acesso ao projeto: `mywork`, `myind`, `kanban`, `backlog`, `wbs`, `hours`, `raci`, `lessons`, `help`, `settings`, `account`, `sprintnow`, `noproject`.

| Perfil pronto | Vê |
|---|---|
| `admin` | tudo |
| `gerente` | portfólio, gestão e carga do time |
| `patrocinador` | portfólio e gestão (com custos) |
| `po` | gestão do produto (sem portfólio nem carga do time) |
| `sm` | gestão e carga do time (sem portfólio) |
| `time` | só o próprio trabalho: Meu trabalho, Sprint atual, quadro, backlog, WBS, horas |
| `consulta` | painéis de portfólio em leitura (sem gestão, custos nem pessoas) |
| `manutencao` | só configurações do sistema |

## Regras de uma base nova

1. Uma base nova nasce VAZIA: nenhum dado de demonstração entra em projeto real, nem na tela nem na nuvem. Os 3 projetos de demonstração (Portal Nexus, Valdori, Beltrano) só existem no navegador sem conta e nunca sobem para a nuvem.
2. Toda tabela com `project_id` entra nas listas de limpeza (`PROJECT_DATA_TABLES` ou `PROJECT_EXTRA_TABLES`); os testes comparam essas listas com este mapa e com o banco.
3. O que está em memória pertence ao projeto ativo: trocar de projeto (inclusive o que o login faz) descarta o anterior, e nada é gravado na chave de outro projeto.
4. Sair da conta apaga os dados do navegador; outra pessoa que entra apaga os da anterior antes de sincronizar.
5. Indicador sem dado mostra "sem dados" — nunca verde, nunca vermelho. A varredura `npm run test:smoke` percorre todas as telas de um projeto vazio.
6. Toda entrega que cria tabela, campo, chave do navegador, pasta de arquivos, função ou registro novo atualiza `docs/mapa-de-dados.json`, gera `docs/MAPA_DE_DADOS.md` e roda `npm run test:unit` e `npm run test:smoke` ANTES de ser entregue.
7. Cada tela exige uma permissão de visão (mapa em `visoes`): o menu esconde e a tela barra a abertura direta; o banco também nega a leitura das tabelas de gestão e dos dados das pessoas a quem não tem a permissão.
8. Datas planejadas (início e fim de sprint, início e fim planejados da WBS) não caem em fim de semana nem feriado; só o gerente do projeto autoriza exceção, com justificativa de 10 letras no mínimo, que fica no calendário do projeto e na auditoria. Datas reais não são travadas.
