# Anexo de Tratamento de Dados (DPA) — PMO Compass

> **MINUTA DE TRABALHO — NÃO É UM DOCUMENTO JURÍDICO PRONTO.** Este arquivo é um ponto de
> partida técnico, escrito a partir da arquitetura real do PMO Compass (não é um modelo
> genérico da internet) para acelerar o trabalho de quem for revisar — precisa passar por
> advogado antes de virar anexo de contrato, e precisa ser preenchido com os dados específicos
> de cada cliente (razão social, DPO, endereço, etc.) antes de assinar com qualquer um.
>
> Este texto reflete o comportamento do sistema em **[DATA]** — se o código mudar (novo
> subprocessador, nova categoria de dado tratado), este documento precisa ser atualizado junto,
> senão ele descreve um sistema que não existe mais.

## 1. Partes e papéis

- **Controlador dos dados pessoais tratados no uso cotidiano do sistema** (equipe, stakeholders,
  decisões, documentos do projeto): **[NOME DO CLIENTE]**, CNPJ **[●]** — é o cliente quem decide
  quais dados entram no sistema, quem tem acesso, e para qual finalidade de projeto.
- **Operador** (processa os dados em nome do Controlador, conforme instruções deste anexo e do
  contrato principal): **[NOME DA CONTRATADA / RIMOBR]**, responsável por provisionar, hospedar
  e manter a instância do PMO Compass usada pelo Controlador.
- Cada instância do PMO Compass é **isolada por cliente** (projeto Supabase próprio, deploy
  próprio) — não há dado compartilhado entre clientes diferentes em nenhuma camada.

## 2. Dados pessoais tratados

O sistema foi desenhado para gestão de projetos, não para dados sensíveis como finalidade
central — mas trata, sim, dados pessoais reais no curso normal de uso:

| Categoria | Onde aparece no sistema | Sensibilidade |
|---|---|---|
| Nome, e-mail, cargo | Perfis de usuário, Stakeholders, Equipe | Dado pessoal comum |
| Indicadores de engajamento/burnout | Tela Equipe/Burnout | Pode ser considerado dado sensível dependendo do contexto (saúde/bem-estar) — recomenda-se tratamento como tal |
| Conteúdo de documentos anexados | Repositório, Raio-X do Projeto | Variável — depende do que o cliente sobe; o sistema mascara automaticamente CPF/CNPJ/e-mail/telefone/CEP/RG antes de qualquer processamento por IA (ver `services/file-intake`, função `anonymize()`), mas **não há garantia de que 100% dos formatos possíveis de PII sejam capturados** — não trate essa máscara como uma DPO/DPIA completa |
| Texto de decisões e riscos | Módulo Decisões | Pode conter nomes/contexto pessoal em texto livre, a critério de quem escreve |
| Chave de API de provedor de IA | `user_ai_keys` (Supabase) | Credencial, não dado pessoal — mas sensível; nunca é lida de volta pelo navegador depois de salva |
| Sessão de autenticação | `localStorage` do navegador (token JWT do Supabase) | Ver nota de segurança na Seção 6 |

## 3. Finalidade do tratamento

Gestão de portfólio e projetos: acompanhamento de cronograma (WBS/CPM), orçamento (EVM),
decisões, riscos, stakeholders, equipe, lições aprendidas, e apoio à decisão por IA sobre esses
mesmos dados — nunca para finalidade distinta (ex.: marketing, scoring de crédito, vigilância).

## 4. Subprocessadores

| Subprocessador | Função | Dado que recebe |
|---|---|---|
| **Supabase** (banco de dados + autenticação) | Hospeda todos os dados de negócio e as contas de usuário desta instância | Todos os dados da Seção 2, em repouso |
| **Vercel** | Hospeda os arquivos estáticos do aplicativo (HTML/JS) | Nenhum dado de negócio — serve só o código; conexão ao Supabase acontece direto do navegador do usuário |
| **Anthropic / OpenAI / Google** (conforme o provedor de IA escolhido por cada usuário em Configurações) | Processa o texto enviado ao Chat e à análise de documentos | Texto de prompts e documentos **já mascarado** (Seção 2) quando vem do Raio-X; o Chat livre não passa pela mesma máscara — o usuário pode digitar qualquer coisa nele |

Nenhum subprocessador adicional (analytics, e-mail transacional, etc.) está integrado ao sistema
nesta versão.

## 5. Base legal

A definir com o Controlador conforme a natureza dos dados de cada categoria — tipicamente
**execução de contrato** (LGPD Art. 7º, V) para dados de equipe/stakeholders necessários à
gestão do projeto, e **legítimo interesse** (Art. 7º, IX) para logs técnicos/de auditoria.
Indicadores de engajamento/burnout, se tratados como dado sensível, podem exigir consentimento
específico (Art. 11) — avaliar com jurídico antes de habilitar essa tela para dados reais.

## 6. Medidas de segurança

- **Controle de acesso por papel (RBAC)**, aplicado tanto na interface quanto no banco de dados
  via Row Level Security do Postgres — um perfil "Consulta" que tenta editar é bloqueado pelo
  próprio banco, não só pela tela.
- **Log de auditoria append-only** (`audit_log`) para eventos sensíveis (login, promoção de
  perfil, exportação/restauração de backup, reset de dados, tentativa bloqueada por permissão) —
  nem um Administrador consegue alterar ou apagar uma linha via API depois de gravada.
- **Mascaramento automático de PII** antes de qualquer envio a provedor de IA via Raio-X do
  Projeto (CPF, CNPJ, e-mail, telefone, CEP, RG).
- **Chaves de API de IA** nunca retornam ao navegador depois de salvas (sem policy de leitura no
  banco; só uma função de servidor com privilégio elevado consegue usá-las).
- **CSP (Content Security Policy)** restringindo de quais domínios o navegador pode carregar
  script/conectar rede, mitigando XSS.
- **Limitação conhecida**: por não haver um servidor de aplicação próprio por trás do login, o
  token de sessão do usuário fica no `localStorage` do navegador, não num cookie `httpOnly`. É
  uma limitação técnica aceita e mitigada (token de curta duração, CSP, nenhum ponto conhecido de
  injeção de script) — descrita em detalhe no modal "Privacidade & dados" dentro do próprio app.
  Orientar o cliente a não deixar sessões abertas em computadores compartilhados.
- **Backup**: a exportação de backup (JSON) pode ser protegida por senha (criptografia) na hora
  do download — a interface pergunta e recomenda isso sempre que o backup contém dado de equipe
  ou stakeholder.

## 7. Direitos dos titulares

O Controlador é responsável por atender solicitações de titulares (acesso, correção, eliminação,
portabilidade — LGPD Art. 18). O Operador se compromete a:
- Fornecer os dados de um titular específico mediante solicitação do Controlador, em formato
  estruturado (o backup JSON já exportável pela interface cobre isso tecnicamente).
- Executar eliminação de dados de um titular específico mediante instrução do Controlador — hoje
  isso é uma operação manual (edição/exclusão direto nas telas correspondentes ou via SQL), não
  há um botão único de "esquecer esta pessoa" no sistema.

## 8. Retenção e eliminação

Sem política de retenção automática nesta versão — os dados permanecem até serem apagados
manualmente pelo Controlador ou até o encerramento do contrato. Ao final do contrato: **[definir
prazo e procedimento — ex.: exportação final + eliminação em N dias]**.

## 9. Notificação de incidentes

O Operador se compromete a notificar o Controlador em até **[definir prazo — ex.: 48h]** após
tomar conhecimento de um incidente de segurança que afete dados pessoais tratados nesta
instância, incluindo natureza do incidente, dados afetados e medidas tomadas.

## 10. Vigência

Este anexo acompanha o contrato principal firmado entre as partes e vigora enquanto este estiver
em vigor, ou até ser substituído por uma nova versão assinada por ambas as partes.

---

**Assinaturas — [NOME DO CLIENTE] e [NOME DA CONTRATADA]**
