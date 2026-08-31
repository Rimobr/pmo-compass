# PMO Compass — Documento de Contexto para Continuidade

*Gerado em 25/07/2026. Atualizado em 28/08/2026 após uma rodada de auditoria (PMO/PM/auditoria financeira/documental) e implementação de 7 melhorias estruturais. Leia isto antes de pedir qualquer alteração — evita retrabalho e regressões.*

---

## 1. O que é

PMO Compass é um sistema de apoio à decisão para gerentes de projetos, com IA integrada, construído como **um único arquivo HTML autocontido** (`PMO_Compass_v2.html`, ~6.300 linhas, 43 módulos JS embutidos). Roda 100% no navegador — sem build, sem servidor obrigatório. Um backend Supabase opcional existe para sincronização em nuvem, e o app está publicado em produção.

**Como abrir:** basta abrir o `.html` direto no navegador. Para instalar como app (PWA) ou usar o backend em nuvem, é preciso hospedar os arquivos (ver seção 6).

**Onde as coisas estão:**
- Repositório: https://github.com/Rimobr/pmo-compass (branch `main`)
- Produção (Vercel, auto-deploy a cada push em `main`): https://pmo-compass.vercel.app/
- Supabase: projeto `PMO_Compass` — schema real conectado e testado (ver seção 5)

## 2. Arquitetura

- **Frontend:** HTML+CSS+JS vanilla, sem framework, sem bundler. Cada "módulo" é um bloco `<script data-module="nome">` autoexecutável (IIFE) que expõe funções via `return { ... }`.
- **"Banco de dados":** `localStorage` do navegador, gerenciado pelo módulo `DB` (`core/db`). Cada projeto tem sua própria chave de armazenamento — ver seção 4.
- **IA:** chamadas diretas do navegador para Claude/OpenAI/Gemini (módulo `AI`, `services/ai`), com a chave escolhida pelo usuário em Configurações. **A chave fica no navegador — isso é uma dívida técnica conhecida, não um acidente** (ver seção 7, P0).
- **Perfis de acesso:** 4 perfis (Administrador, Gerente, Consulta, Manutenção) via módulo `Auth` (`core/auth`), reforçados tanto na interface (`data-perm` + CSS) quanto em cada função de mutação (`Auth.guard('business'|'settings')`).
- **Multi-projeto:** cada projeto (Portal Nexus, Valdori Dist., Grupo Beltrano, ou qualquer criado pelo usuário) tem sua própria base de dados isolada em `localStorage`, trocada via `DB.switchProject(id)`.
- **Backend opcional (Supabase):** módulo `Cloud` (`core/cloud`) sincroniza WBS/Decisões/Repositório com um projeto Supabase real, se configurado. Ver seção 5.

## 3. Mapa de módulos (para navegar o arquivo rápido)

| Módulo JS | O que faz |
|---|---|
| `core/auth` | 4 perfis de acesso, permissões |
| `core/db` | localStorage multi-projeto, backup/restaurar/limpar |
| `core/cloud` | Sincronização opcional com Supabase |
| `core/store` | Chaves de API de IA (Claude/GPT/Gemini) |
| `services/ai` | Chamadas às APIs de IA |
| `services/trail` | Log de auditoria automático (todas as outras páginas escrevem nele) |
| `services/repo` | Repositório de documentos — CRUD, persistência de conteúdo extraído e busca por texto (`Repo.search`) |
| `services/file-intake` | Upload + leitura real de PDF/DOCX + anonimização LGPD; persiste até 20k chars de conteúdo por documento |
| `services/context-builder` (`ContextBuilder`) | Monta o contexto real do projeto ativo (WBS, decisões, equipe, escopo, atas, trechos de documentos) para a IA — substituiu um contexto fixo/fictício que existia antes |
| `services/cpm` (`CPM`) | Método do Caminho Crítico real (forward/backward pass, folga, detecção de ciclo) a partir de dependências cadastradas na WBS |
| `services/health-score` (`HealthScore`) | Fórmula única de saúde do projeto (6 dimensões ponderadas), usada por Dashboard e Relatório — antes havia 3 fórmulas divergentes |
| `pages/wbs-js` | WBS (árvore + Gantt) — módulos e subtarefas podem ter `predecessors` (ids), usados pelo `CPM` para calcular o caminho crítico real |
| `pages/budget-js` (`Budget`) | Orçamento e Custos — linhas de orçamento (BAC) + lançamentos de custo real/comprometido; `Budget.computeMetrics()` calcula CPI/EAC/Consumo/Reserva reais, reaproveitado por Dashboard e Portfólio |
| `pages/decisions-js` | Decisões IA — `sources` pode ter `repoId` apontando pra um documento real do Repositório (chip vira link clicável) |
| `pages/stakeholders-js`, `pages/lessons-js`, `pages/scope-js`, `pages/burnout-js`, `pages/meetings-js`, `pages/estimates-js`, `pages/resources-js` | CRUD de cada módulo de negócio |
| `pages/dashboard-js`, `pages/report-js`, `pages/loop-js`, `pages/portfolio-js` | Agregadores — computam a partir dos dados reais, não têm dados próprios |
| `ui/sidebar-nav` (`Nav`) | Menu lateral em grupos expansíveis, dropdown de projeto, breadcrumb |
| `ui/cmdk` (`CmdK`) | Busca rápida Ctrl/Cmd+K |
| `ui/onboarding` (`Onboarding`) | Tour de boas-vindas (uma vez só) |
| `ui/icon-fallback` | Ícones com fallback em emoji se o CDN de ícones falhar |

**Padrão usado em quase todo módulo de página:** `let data = null` (cache local) → `ensureLoaded()` lê de `DB.get(tabela)` → `persist()` grava com `DB.set(tabela, data)` → `render()` desenha o HTML → `resetCache()` limpa o cache local (chamado por `DB.switchProject` ao trocar de projeto).

**Se for adicionar um módulo de dados novo:** siga esse padrão, adicione a tabela em `DB.seedEmpty()` e `DB.loadCacheFor()` (migração), e registre `resetCache` no array dentro de `DB.switchProject()`.

## 4. Tabelas de dados existentes

`wbs`, `decisions`, `repository`, `stakeholders`, `trail`, `lessons`, `scopeChanges`, `team`, `meetings`, `estimateHistory`, `scenarios`, `budgetLines`, `costActuals` — todas arrays de objetos, todas por projeto.

## 5. Backend Supabase — o que já foi validado

- **Conectado a um projeto Supabase real** (não é mais só teórico/simulado) — projeto `PMO_Compass`, schema completo rodado, RLS testada em produção via API.
- `schema.sql` cobre: perfis (`profiles`), WBS (`wbs_modules`/`wbs_tasks`, com `predecessors`), `decisions`, `documents` (com `content`, o texto extraído), `budget_lines`, `cost_actuals` — todas com RLS (leitura para todo autenticado, escrita só admin/gerente).
- **Importante para quem for mexer no schema:** `create table if not exists` no `schema.sql` **não** adiciona colunas a tabelas que já existem no Supabase do usuário. Toda vez que uma coluna nova for adicionada a uma tabela existente, é preciso dar ao usuário o `alter table ... add column if not exists ...` correspondente, rodado manualmente por ele no SQL Editor — já aconteceu 2 vezes nesta sessão (`documents.content`, `wbs_*.predecessors`).
- **O que falta:** promover o primeiro Administrador ainda exige rodar SQL manual (ver seção 7).

## 6. PWA (instalável)

Arquivos: `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`. Precisam estar **na mesma pasta** que o HTML. O botão de instalar só aparece quando hospedado via http/https — não funciona abrindo o arquivo local. Já está hospedado (ver seção 1), então isso funciona em produção.

## 7. Identidade — perfil local vs login Supabase, unificados em 28/08/2026

O app tem dois sistemas de identidade com naturezas diferentes, que **hoje compartilham um único ponto de entrada** na UI:

1. **Perfil de acesso local** (`core/auth`, módulo `Auth`) — nome + papel (Administrador/Gerente/Consulta/Manutenção) salvos em `localStorage`, **sem senha, sem sessão real**. Existe pra evitar cliques acidentais em modo local (sem backend), não substitui autenticação.
2. **Login Supabase real** (`core/cloud`, módulo `Cloud`) — e-mail/senha reais, papel vindo do banco (`profiles.role`) via `Auth.setFromCloud()`.

**Como fica agora:** clicar no avatar/badge no topo da tela (`Auth.openModal()`) abre **um único modal** que se adapta ao estado real — mostra "Conectado como {email}" + botão "Sair da conta" quando há sessão Supabase real; mostra um formulário de entrar/criar conta quando o projeto está conectado mas ninguém logou ainda; ou mostra o seletor local (com atalho pra conectar Supabase) quando não há backend configurado. Um badge (`tb-cloud-badge`) sempre visível na barra superior mostra qual desses 3 estados está ativo, mesmo sem abrir o modal. A tela de Configurações → Nuvem & Automação manteve só a parte técnica (URL/chave do projeto, sincronizar, desconectar) — login/logout não vivem mais lá.

## 8. Pendências conhecidas (não são "esquecimento" — são decisões conscientes de escopo)

Os 2 itens P0 que restavam foram resolvidos em 31/08/2026:

- **Chave de IA no navegador** → cada pessoa continua usando (e pagando) a própria chave de IA, mas agora fica vinculada à conta no Supabase (tabela `user_ai_keys`, sem policy de SELECT — nem o próprio navegador consegue reler depois de salva). A chamada real à IA passa pela Edge Function `ai-proxy` (`supabase/functions/ai-proxy/index.ts`), que busca a chave da pessoa autenticada e fala com Anthropic/OpenAI/Google a partir do servidor. **Já publicada e testada em produção** (`npx supabase functions deploy ai-proxy`, confirmado respondendo). Modo local (sem login) continua funcionando exatamente como antes, sem essa proteção — é inerente a não ter conta vinculada.
- **Promover Administrador exigia SQL manual** → tela "Usuários" em Configurações → Nuvem, visível só pra quem já é Administrador logado de verdade. O primeiríssimo Administrador de cada projeto Supabase novo ainda precisa do UPDATE manual (SETUP.md) — inerente ao modelo (precisa já ser admin pra promover alguém pela interface).

Não há mais pendências P0 conhecidas nesta rodada.

**Resolvidos em 28-31/08/2026** (não confiar em versões antigas de outras conversas que digam o contrário):
- ~~Orçamento/custos ilustrativo~~ → módulo `Budget` real, CPI/EAC/Consumo/Reserva calculados.
- ~~Contexto da IA fixo/fictício~~ → `ContextBuilder` monta contexto real do projeto ativo.
- ~~Texto de documentos descartado após upload~~ → persistido em `repository[].content`.
- ~~Caminho crítico era frase fixa~~ → `CPM` calcula de verdade a partir de `predecessors`.
- ~~3 fórmulas de saúde divergentes~~ → unificadas em `HealthScore`.
- ~~Fontes de decisões eram texto livre~~ → `sources[].repoId` linka pro documento real.
- ~~"Busca semântica ativa" sem busca nenhuma~~ → busca por texto real (`Repo.search`).
- ~~Login local e login Supabase sem relação visível, sem indicador de sessão~~ → modal único + badge na barra superior (ver seção 7).
- ~~Chave de IA exposta no navegador~~ → vinculada à conta, nunca relida pelo cliente (ver acima).
- ~~Promoção de admin via SQL manual~~ → tela "Usuários" em Configurações → Nuvem (ver acima).

A página **Ajuda** dentro do próprio app (`R.go('help')`) tem a lista completa do que está "Pronto" vs "Em desenvolvimento", mas **pode estar desatualizada** em relação aos itens resolvidos acima — ainda não foi revisada após esta rodada. Vale atualizar antes de confiar nela cegamente.

## 9. Como eu testo cada mudança (siga o mesmo padrão)

1. Após qualquer edição no HTML: validar sintaxe JS extraindo todos os `<script data-module="...">` com regex e rodando `node --check` em cada bloco (script pronto usado nesta sessão, ver histórico do git).
2. Testar de verdade num navegador (Claude Browser pane / Playwright), não só assumir que funciona. Sempre `localStorage.clear()` antes de recarregar quando a mudança afeta dados de seed — senão o teste roda em cima de estado antigo salvo de sessões anteriores e os números não batem com o esperado.
3. Rodar uma regressão navegando por todas as ~20 páginas (`R.go(id)` para cada uma) + checar console sem erros — antes de considerar qualquer mudança "pronta".
4. Cada commit vai com uma mensagem descrevendo o antes/depois e como foi validado — ver `git log` para o histórico completo desta rodada de mudanças.

## 10. Arquivos deste projeto

- `PMO_Compass_v2.html` — a aplicação completa
- `manifest.json`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` — PWA
- `schema.sql` — schema Supabase (testado com projeto real)
- `supabase/functions/ai-proxy/index.ts` — Edge Function que protege as chaves de IA (já publicada — `npx supabase functions deploy ai-proxy`, projeto vinculado via `npx supabase link --project-ref cjvpnavjrzbdnxtahnin`). Se reescrever esse arquivo, precisa rodar o deploy de novo.
- `SETUP.md` — passo a passo de configuração do Supabase
- `PMO_Compass_Validacao_Competitiva.md` — análise de mercado/concorrência feita anteriormente
- `CONTEXTO_PROJETO.md` — este arquivo
- `.claude/launch.json` — configuração pra rodar um servidor local (`npx serve`) e testar no Browser pane

## 11. Como retomar numa conversa nova

O projeto agora vive num repositório git com deploy automático — **não precisa mais colar os arquivos**, é só apontar para o repositório (https://github.com/Rimobr/pmo-compass) ou abrir a pasta local. Este arquivo mais o `git log` já dão contexto suficiente para continuar sem re-explorar o app do zero.
