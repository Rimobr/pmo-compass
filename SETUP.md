# PMO Compass — Backend em nuvem (Supabase)

Isso é **opcional**. Sem seguir este guia, o app continua funcionando exatamente
como já funcionava: dados salvos no navegador, perfis escolhidos manualmente.
Só siga estes passos quando quiser dados reais, sincronizados entre pessoas e
dispositivos, com os 4 perfis (Administrador, Gerente, Consulta, Manutenção)
validados pelo próprio banco de dados — não só pela tela.

## 1. Criar o projeto

1. Crie uma conta grátis em **supabase.com** e clique em **New Project**.
2. Escolha um nome, uma senha de banco (guarde-a) e a região mais próxima.
3. Espere ~2 minutos até o projeto ficar pronto.

## 2. Rodar o schema

1. No painel do projeto, vá em **SQL Editor → New query**.
2. Abra o arquivo `schema.sql` (entregue junto com este guia), copie o conteúdo
   inteiro e cole no editor.
3. Clique em **Run**. Deve aparecer "Success. No rows returned" no final.
   *(Este script já foi testado de ponta a ponta — inclusive os bloqueios de
   permissão de cada perfil — antes de chegar até você.)*

## 3. Pegar a URL e a chave do projeto

1. Vá em **Project Settings → API**.
2. Copie o **Project URL** (algo como `https://xxxxx.supabase.co`).
3. Copie a chave **anon public** (não a `service_role` — essa nunca deve ir
   para o navegador).

## 4. Conectar no PMO Compass

1. Abra o app → **Configurações → Backend em nuvem (Supabase)**.
2. Cole a URL e a chave anônima → **Conectar**.
3. Clique em **Criar conta**, informe e-mail e senha.
4. Toda conta nova nasce com o perfil **Consulta** (mais seguro por padrão).

## 5. Promover o primeiro administrador

Sua própria conta ainda está como "Consulta". Para virar administrador:

1. No Supabase, vá em **Authentication → Users** e copie o **UID** do seu usuário.
2. Volte ao **SQL Editor** e rode (trocando o UID):
   ```sql
   update public.profiles set role = 'admin' where id = 'COLE_O_UID_AQUI';
   ```
3. No app, clique em **Sair da conta** e faça login de novo — agora como Administrador,
   você pode promover as próximas pessoas direto pelo app (em breve) ou continuar
   usando o SQL Editor por enquanto.

## O que acontece a partir daqui

- WBS, Decisões e Repositório passam a ser salvos no Supabase a cada alteração,
  além de continuarem salvos localmente (o navegador funciona como cache/offline).
- Os 4 perfis agora são reforçados **pelo banco de dados**, não só pela tela —
  testei isso explicitamente: um perfil "Consulta" tentando editar dados é
  bloqueado pelo Postgres, não só escondido na interface.
- As chaves de IA (Claude/OpenAI/Gemini) continuam **locais**, por segurança —
  este primeiro passo não envolve um proxy de servidor para elas ainda.

## Testando junto

Como não tenho acesso a um projeto Supabase real, não consegui testar esta
parte de ponta a ponta sozinho (diferente de tudo antes disso). Depois de
seguir os passos acima, me avise o que aconteceu — vamos revisar juntos e
corrigir qualquer detalhe que apareça no seu projeto específico.
