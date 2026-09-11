# PMO Compass — Playbook de provisionamento de nova instância

Este documento é o roteiro pra colocar uma **instância nova e isolada** do PMO Compass no ar
para um cliente — modelo "uma instância por cliente": cada empresa tem seu próprio projeto
Supabase (dados 100% isolados por natureza) e seu próprio deploy do app. Siga do início ao fim,
na ordem. Cada passo assume que o anterior já foi concluído.

Tempo esperado: **1 a 2 dias úteis** para alguém que já fez isso antes (a maior parte é espera
de provisionamento automático do Supabase/Vercel, não trabalho manual).

## 0. Pré-requisitos

- Conta no [supabase.com](https://supabase.com) (grátis pra começar; plano pago se o cliente
  precisar de SSO/SAML mais adiante — ver nota no final).
- Conta no [vercel.com](https://vercel.com) com acesso ao repositório `Rimobr/pmo-compass` no
  GitHub (ou um fork dedicado, se o cliente for ter customização própria de código no futuro).
- [Supabase CLI](https://supabase.com/docs/guides/cli) instalado (`npm install -g supabase`, ou
  `scoop install supabase` no Windows) — só é usado no Passo 3.

## 1. Criar o projeto Supabase do cliente

1. **New Project** em supabase.com → escolha nome (ex: `pmo-compass-<nomedocliente>`), uma senha
   de banco (guarde num cofre de senhas, não em texto solto) e a região mais próxima do cliente.
2. Espere ~2 minutos até o projeto ficar pronto.

## 2. Rodar o schema (script único)

1. No painel do projeto → **SQL Editor → New query**.
2. Abra `schema.sql` (raiz deste repositório), copie o conteúdo **inteiro** e cole no editor.
3. Clique em **Run**. Deve terminar com "Success. No rows returned".
   *(Este script é idempotente — `create table if not exists`, `create or replace function` —
   então rodar de novo por engano num projeto que já tem o schema não quebra nada.)*

Isso cria: perfis (RBAC de 4 níveis), WBS, decisões, repositório de documentos, orçamento/custos,
chaves de IA por usuário (nunca voltam ao navegador), toda a Row Level Security, e a coluna
`project_id` que permite múltiplos projetos dentro da mesma instância do cliente.

## 3. Deploy da Edge Function (proxy de IA)

O app nunca chama a API da Anthropic/OpenAI/Google direto do navegador — passa por uma Edge
Function no próprio projeto Supabase do cliente, que busca a chave da pessoa autenticada e faz a
chamada no servidor.

```bash
supabase login
supabase link --project-ref <project-ref-do-cliente>
supabase functions deploy ai-proxy
```

Não precisa configurar nenhum secret manualmente — `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`
já vêm injetados automaticamente em toda Edge Function do projeto. O código-fonte é
`supabase/functions/ai-proxy/index.ts` — não precisa editar nada nele por cliente.

## 4. Publicar o app (Vercel)

Duas opções, dependendo de quanto de identidade própria o cliente precisa ter na URL:

- **Deploy dedicado (recomendado para venda consultiva)**: importe o mesmo repositório GitHub
  como um **novo projeto Vercel**, aponte um domínio/subdomínio do próprio cliente (ex:
  `pmo.clientenome.com.br`) nas configurações de domínio do projeto. Não precisa de nenhuma
  variável de ambiente — a conexão com o Supabase é feita **em runtime, pela tela do app**
  (Passo 5), não por env var de build. `vercel.json` já libera CSP para `https://*.supabase.co`
  (qualquer projeto Supabase, não um específico), então nenhum arquivo de config muda por cliente.
- **Reaproveitar um deploy existente**: se o cliente só precisa testar rápido, ele pode logar no
  mesmo `pmo-compass.vercel.app` e conectar ao Supabase dele pela tela de Configurações — os dados
  ficam isolados normalmente porque cada usuário conecta ao *seu próprio* Supabase. Não recomendo
  isso além de uma demonstração: o cliente pagante deve ter marca e URL próprias (ver observação
  de white-label no final).

## 5. Conectar o app ao Supabase do cliente

1. Abra o deploy do cliente → **Configurações → Backend em nuvem (Supabase)**.
2. Cole a **Project URL** e a chave **anon public** (Project Settings → API no Supabase — nunca a
   `service_role`, essa não sai do servidor) → **Conectar**.
3. Clique em **Criar conta**, informe e-mail e senha da primeira pessoa (normalmente você mesmo,
   pra validar, ou o responsável do lado do cliente).

## 6. Promover o primeiro administrador

Toda conta nova nasce como **Consulta** (mais seguro por padrão — ninguém se autopromove, isso é
bloqueado pelo próprio Postgres, não só pela tela).

1. No Supabase → **Authentication → Users**, copie o **UID** da conta criada no Passo 5.
2. **SQL Editor**, rode (trocando o UID):
   ```sql
   update public.profiles set role = 'admin' where id = 'COLE_O_UID_AQUI';
   ```
3. No app, **Sair da conta** → login de novo. Agora como Administrador, dá pra promover as
   próximas pessoas direto pela tela (**Configurações → Usuários**), sem precisar mais de SQL.

## 7. Se estiver reaproveitando uma instância (não aplicável a projeto Supabase 100% novo)

Só relevante se você clonar dados de uma instância de demonstração para começar a de um cliente
real: rode `Cloud.resetForNewUsers()` (via console do navegador, logado como admin) para apagar
todo dado de demonstração da nuvem antes de convidar o cliente — essa função já existe no app
exatamente para isso. Pedirá confirmação e oferece baixar um backup antes de apagar.

## 8. Checklist de validação (smoke test antes de entregar)

- [ ] Login funciona com e-mail/senha reais do cliente.
- [ ] Criar um projeto novo no seletor (canto superior esquerdo) e trocar entre projetos.
- [ ] Cadastrar uma entrega de WBS com predecessora e ver o caminho crítico calcular.
- [ ] Cadastrar uma linha de orçamento e um custo real, ver CPI/EAC no Dashboard.
- [ ] Subir um documento no Raio-X do Projeto e confirmar que a IA responde (exige que a pessoa
      logada tenha configurado a própria chave de IA em Configurações → Provedor de IA).
- [ ] Trocar de projeto duas vezes seguidas rápido e confirmar que os dados não somem (a corrida
      assíncrona do Cloud foi corrigida, mas vale reconferir por instância nova).
- [ ] Um usuário com perfil **Consulta** tenta editar algo e é bloqueado — confirma que o RLS do
      banco está mesmo aplicado, não só escondido na interface.
- [ ] PWA instala (ícone "Adicionar à tela inicial" no navegador) e funciona offline depois de
      uma primeira visita online.

## O que este playbook NÃO resolve ainda (backlog conhecido)

- **Marca própria (white-label)**: nome "PMO Compass", ícones e cores em `manifest.json` /
  `PMO_Compass_v2.html` ainda são fixos no código — trocar por cliente hoje exige editar esses
  arquivos manualmente antes do deploy do Passo 4. Vira configurável no próximo item do roadmap.
- **SSO/SAML**: o Supabase Auth suporta como recurso pago (plano Team+) — ainda não conectado no
  app. Necessário se o cliente exigir login corporativo (Azure AD/Okta) na revisão de segurança.
- **Log de auditoria formal**: hoje existe `Trail.log()` (histórico simples dentro do app), não um
  registro append-only exportável para fins de compliance.
- **Domínio próprio**: é configuração de DNS no painel do Vercel (fora deste playbook) — direto,
  mas não é automático, precisa ser feito por projeto Vercel.

## Testando junto

Depois de provisionar uma instância nova de verdade (não a de demonstração), rode o checklist do
Passo 8 e me avise o que aconteceu — principalmente qualquer coisa que destoar do que está descrito
aqui, porque este documento deve continuar sendo a fonte única de verdade pra próxima instância.
