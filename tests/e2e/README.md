# Testes E2E (RLS, anti-escalonamento, auditoria, XSS, acessibilidade)

Complementam `tests/run.js` (unitários puros, sem browser/rede). Estes aqui testam
contra o **Supabase real** e o **app real** rodando localmente — cobrem exatamente os
pontos "Crítico (Bloqueia Release)" da última rodada de aceitação: RLS por projeto,
trava anti-escalonamento, imutabilidade do `audit_log` e XSS em campos de texto livre,
mais uma auditoria de acessibilidade (WCAG 2.1 AA via axe-core) nas telas novas.

## Contas de QA necessárias (uma vez só, não são recriadas a cada rodada)

Três contas dedicadas, sem relação com contas reais de cliente:

| Conta | Papel | Acesso a projeto |
|---|---|---|
| `qa.admin@pmo-compass-test.local` | admin | todos (admin sempre vê tudo) |
| `qa.gerente@pmo-compass-test.local` | gerente | um projeto específico (`TEST_PROJECT_WITH_GRANT_ID`) |
| `qa.consulta@pmo-compass-test.local` | consulta | **nenhum** — usada só pra confirmar que RLS bloqueia quem não tem grant |

Criadas via Supabase Auth (dashboard → Authentication → Users → Create new user,
"Auto confirm user" marcado) e promovidas pelo próprio app (Configurações → Nuvem →
Usuários), do mesmo jeito que qualquer conta real seria promovida — sem SQL manual.

## Configuração

1. Copie `.env.test.example` pra `.env.test` (já no `.gitignore` — nunca commitar).
2. Preencha com a URL/anon key do projeto Supabase e as credenciais das 3 contas de QA acima.
3. `npm install && npx playwright install chromium` (uma vez).
4. `npm run test:e2e` — sobe o app localmente (`npx serve`) e roda tudo.

## O que cada spec cobre

- `rls.spec.js` — RLS bloqueia leitura entre projetos sem grant; `gerente`/`consulta` não
  conseguem se auto-promover a `admin`; `audit_log` rejeita `UPDATE`/`DELETE` mesmo por admin.
- `xss.spec.js` — payload de XSS em nome de membro de equipe, título de decisão e título de
  scope change é renderizado como texto literal, nunca executado.
- `accessibility.spec.js` — Farol do Portfólio, Visão Executiva e Membros do Projeto sem
  violação crítica/séria de WCAG 2.1 AA (axe-core), nos 3 temas (escuro/claro/cinza).

## Por que não roda em todo commit ainda

Depende de credenciais reais de QA (não gratuitas de gerar sozinho — exigem decisão de
manter contas de teste permanentes no Supabase de produção) e de `npx playwright install`
(download de browser). Pensado pra rodar manualmente antes de cada release, ou plugado
num CI que já tenha os secrets configurados.
