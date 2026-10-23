# WhatsApp e e-mail — roteiro para colocar no ar

O que já está pronto no código: cadastro de destinatários com consentimento, avisos automáticos (decisão crítica, projeto em
risco, risco crítico, resumo semanal), assistente que responde perguntas de status, horário de silêncio, limites de uso,
descadastro (PARAR) e trilha de mensagens. **O que falta é só a conta do WhatsApp e do e-mail** — e isso só você pode abrir.

> Até concluir este roteiro nada é enviado: a tela **Configurações → WhatsApp & E-mail** mostra o que ainda está pendente.

## 1. Banco e funções (uma vez)

Crie `.env.deploy` na raiz (ele é ignorado pelo git e pelo Vercel):

```
SUPABASE_ACCESS_TOKEN=<token pessoal em supabase.com/dashboard/account/tokens>
CRON_SECRET=<uma senha longa e aleatória, 32+ caracteres>
```

```bash
node scripts/db-apply.mjs --dry-run
```

```bash
node scripts/db-apply.mjs
```

```bash
node scripts/db-apply.mjs --setup-cron
```

```bash
node scripts/deploy-functions.mjs
```

## 2. WhatsApp Business (Meta)

1. Em [business.facebook.com](https://business.facebook.com) crie/valide a conta empresarial (pode levar dias).
2. Em [developers.facebook.com](https://developers.facebook.com) crie um app tipo **Business**, adicione o produto **WhatsApp**
   e registre um número dedicado (não pode estar em uso no app WhatsApp comum).
3. Anote: **Phone number ID**, **App Secret** (Configurações do app → Básico) e gere um **token permanente** (usuário do sistema).
4. Crie e envie para aprovação **dois modelos** (categoria *Utilitário*, idioma pt_BR):
   - `pmo_confirmacao` — corpo: `Olá, {{1}}! O PMO Compass quer enviar avisos e responder perguntas sobre os projetos que você acompanha. Responda SIM para aceitar ou PARAR para não receber.`
   - `pmo_alerta` — corpo: `PMO Compass — {{1}} · {{2}}: {{3}}. Responda "ajuda" para fazer perguntas.`
5. Em WhatsApp → Configuração → Webhook: URL `https://<ref>.supabase.co/functions/v1/wa-webhook`, token de verificação à sua escolha,
   assine o campo **messages**.

## 3. E-mail (Resend)

Crie conta em resend.com, verifique o domínio de envio e gere uma chave de API. O remetente (`EMAIL_FROM`) deve ser desse domínio.

## 4. Segredos

Acrescente ao `.env.deploy`:

```
WA_ACCESS_TOKEN=...
WA_PHONE_NUMBER_ID=...
WA_APP_SECRET=...
WA_VERIFY_TOKEN=<o mesmo token de verificação do passo 2.5>
RESEND_API_KEY=...
EMAIL_FROM=PMO Compass <avisos@seudominio.com.br>
```

```bash
node scripts/deploy-functions.mjs --secrets
```

## 5. Ligar e testar

1. Entre como Administrador → Configurações → **WhatsApp & E-mail**. Tudo na lista deve ficar *pronto*.
2. Escolha o provedor de IA (a chave é a da sua conta) e marque **Ligar mensagens** + os canais → Salvar.
3. Use **Testar o assistente** para ver as respostas sem enviar nada. Confira com uma pessoa **sem** permissão financeira que nenhum R$ aparece.
4. Cadastre você mesmo como destinatário (com o seu consentimento registrado), clique **Pedir confirmação por WhatsApp**, responda SIM no celular e pergunte "como está o projeto X?".

## Como a segurança funciona (para a diretoria perguntar)

- A pessoa só vê os **projetos que você marcou** para ela; a IA só recebe esses fatos.
- **Valores em R$** só para quem tiver a permissão; senão nem entram no que a IA lê, e a resposta ainda passa por um filtro.
- O WhatsApp só fica ativo quando **a própria pessoa responde SIM** (nem o administrador consegue ativar).
- **PARAR** descadastra na hora; depois disso o sistema fica em silêncio.
- Cada chamada da Meta é verificada por assinatura; mensagem repetida é processada uma só vez; há limite de perguntas por pessoa/dia.
- Textos digitados nos projetos são tratados como dado, nunca como instrução para a IA. CPF, e-mail e telefone são mascarados.
- Histórico guardado 90 dias, já mascarado.

## Custos

Conversas iniciadas por você (aviso/modelo) são cobradas pela Meta por conversa; respostas dentro de 24 h após a pessoa escrever
têm custo menor/zero conforme a tabela vigente. A IA usa a sua chave (custo por pergunta, centavos). Resend tem plano gratuito inicial.
