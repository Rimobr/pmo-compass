# PMO Compass — Documento de Contexto para Continuidade

*Gerado em 25/07/2026. Leia isto antes de pedir qualquer alteração — evita retrabalho e regressões.*

---

## 1. O que é

PMO Compass é um sistema de apoio à decisão para gerentes de projetos, com IA integrada, construído como **um único arquivo HTML autocontido** (`PMO_Compass_v2.html`, ~5.500 linhas, 40 módulos JS embutidos). Roda 100% no navegador — sem build, sem servidor obrigatório. Um backend Supabase opcional existe para sincronização em nuvem.

**Como abrir:** basta abrir o `.html` direto no navegador. Para instalar como app (PWA) ou usar o backend em nuvem, é preciso hospedar os arquivos (ver seção 6).

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
| `services/repo` | Repositório de documentos |
| `services/file-intake` | Upload + leitura real de PDF/DOCX + anonimização LGPD |
| `pages/wbs-js` | WBS (árvore + Gantt) |
| `pages/decisions-js` | Decisões IA |
| `pages/stakeholders-js`, `pages/lessons-js`, `pages/scope-js`, `pages/burnout-js`, `pages/meetings-js`, `pages/estimates-js`, `pages/resources-js` | CRUD de cada módulo de negócio |
| `pages/dashboard-js`, `pages/report-js`, `pages/loop-js`, `pages/portfolio-js` | Agregadores — computam a partir dos dados reais, não têm dados próprios |
| `ui/sidebar-nav` (`Nav`) | Menu lateral em grupos expansíveis, dropdown de projeto, breadcrumb |
| `ui/cmdk` (`CmdK`) | Busca rápida Ctrl/Cmd+K |
| `ui/onboarding` (`Onboarding`) | Tour de boas-vindas (uma vez só) |
| `ui/icon-fallback` | Ícones com fallback em emoji se o CDN de ícones falhar |

**Padrão usado em quase todo módulo de página:** `let data = null` (cache local) → `ensureLoaded()` lê de `DB.get(tabela)` → `persist()` grava com `DB.set(tabela, data)` → `render()` desenha o HTML → `resetCache()` limpa o cache local (chamado por `DB.switchProject` ao trocar de projeto).

**Se for adicionar um módulo de dados novo:** siga esse padrão, adicione a tabela em `DB.seedEmpty()` e `DB.loadCacheFor()` (migração), e registre `resetCache` no array dentro de `DB.switchProject()`.

## 4. Tabelas de dados existentes

`wbs`, `decisions`, `repository`, `stakeholders`, `trail`, `lessons`, `scopeChanges`, `team`, `meetings`, `estimateHistory`, `scenarios` — todas arrays de objetos, todas por projeto.

## 5. Backend Supabase — o que já foi validado

- `schema.sql` (neste pacote) foi **testado com Postgres real** (RLS, gatilhos anti-escalonamento de perfil, políticas de leitura/escrita por perfil) — não é teórico, rodei e testei cada cenário de permissão.
- O módulo `Cloud` foi testado com um **servidor Supabase simulado** (mock local em Node, usando o SDK real `@supabase/supabase-js` baixado via npm e injetado no navegador via interceptação de rede do Playwright, contornando o bloqueio de CDN do sandbox). Cadastro, login, leitura de perfil com role correto (`consulta` por padrão) e sincronização de dados foram confirmados funcionando com o SDK real.
- **O que falta:** testar com um projeto Supabase real (não simulado) — não tenho como fazer isso sem as credenciais do usuário. Ver `SETUP.md` para o passo a passo de configuração.

## 6. PWA (instalável)

Arquivos: `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`. Precisam estar **na mesma pasta** que o HTML. O botão de instalar só aparece quando hospedado via http/https — não funciona abrindo o arquivo local. Testado com servidor HTTP real neste ambiente.

## 7. Pendências conhecidas (não são "esquecimento" — são decisões conscientes de escopo)

**P0 — segurança/infra, dependem de decisão e credenciais do usuário:**
1. Chave de IA ainda fica no navegador — o ideal para produção é uma função de servidor (ex: Supabase Edge Function) fazendo a chamada e escondendo a chave.
2. Testar Supabase com projeto real (schema já validado, cliente já validado contra simulação — falta o real).
3. Promover o primeiro Administrador hoje exige rodar SQL manual no painel do Supabase — não tem interface própria ainda.

**P1 — módulos que ainda são ilustrativos:**
4. Orçamento/custos (Dashboard e Portfólio) — não existe modelo de dados real de custos.

A página **Ajuda** dentro do próprio app (`R.go('help')`) tem a lista completa e atualizada do que está "Pronto" vs "Em desenvolvimento" — **sempre confira essa página no app antes de assumir o que falta**, porque ela é mantida atualizada a cada rodada de mudanças.

## 8. Como eu testo cada mudança (siga o mesmo padrão)

1. Após qualquer edição no HTML: validar sintaxe JS extraindo todos os `<script>` e rodando `node --check`.
2. Validar balanceamento de tags HTML com `html.parser.HTMLParser`.
3. Testar de verdade em navegador headless (Playwright), não só assumir que funciona — isso pegou bugs reais várias vezes (ex: `window.ModuloX` não existe para `const` no escopo global; classe `.hidden` sem CSS genérica; cache local de módulo não resetado ao trocar de projeto).
4. Rodar uma regressão navegando por todas as ~19 páginas + verificando Gantt, perfis de acesso, multi-projeto — antes de considerar qualquer mudança "pronta".

## 9. Arquivos deste pacote

- `PMO_Compass_v2.html` — a aplicação completa
- `manifest.json`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` — PWA
- `schema.sql` — schema Supabase (testado)
- `SETUP.md` — passo a passo de configuração do Supabase
- `PMO_Compass_Validacao_Competitiva.md` — análise de mercado/concorrência feita anteriormente
- `CONTEXTO_PROJETO.md` — este arquivo

## 10. Como retomar numa conversa nova

Cole este arquivo (`CONTEXTO_PROJETO.md`) e o `PMO_Compass_v2.html` no início da conversa nova. Isso já dá contexto suficiente para o Claude continuar sem precisar re-explorar o app do zero. Depois, é só pedir a próxima mudança normalmente.
