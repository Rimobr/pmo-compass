// Helpers compartilhados pelos specs E2E — criam um client Supabase autenticado como cada
// papel de QA, e uma função de login pela UI real do app (pros testes que precisam do DOM,
// não só da API).
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env.test') });
const { createClient } = require('@supabase/supabase-js');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ${name} não configurada — ver tests/e2e/README.md e .env.test.example`);
  return v;
}

async function supabaseClientAs(role) {
  const url = requireEnv('SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY');
  const email = requireEnv(`TEST_${role.toUpperCase()}_EMAIL`);
  const password = requireEnv(`TEST_${role.toUpperCase()}_PASSWORD`);
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Login de QA falhou pra ${role} (${email}): ${error.message}`);
  return client;
}

// Login pela UI real (não pela API) — usado pelos testes de XSS/acessibilidade, que precisam
// do DOM renderizado pelo app, não só de uma resposta de API.
async function loginViaUi(page, role) {
  const email = requireEnv(`TEST_${role.toUpperCase()}_EMAIL`);
  const password = requireEnv(`TEST_${role.toUpperCase()}_PASSWORD`);
  const url = requireEnv('SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY');

  // Sem barra inicial: com barra, o Playwright resolve contra a ORIGEM do baseURL (a raiz do
  // servidor estático, que aqui lista os arquivos do repo), não contra o caminho completo do
  // baseURL (.../PMO_Compass_v2.html) — foi o que quebrou o login na primeira rodada.
  await page.goto('#settings');
  // Conecta o projeto Supabase se ainda não estiver (modo local por padrão)
  await page.evaluate(({ url, anonKey }) => {
    if (typeof Cloud !== 'undefined' && !Cloud.isConfigured()) {
      const urlInput = document.getElementById('cloud-f-url');
      const keyInput = document.getElementById('cloud-f-key');
      if (urlInput) urlInput.value = url;
      if (keyInput) keyInput.value = anonKey;
      Cloud.configure();
    }
  }, { url, anonKey });
  await page.waitForTimeout(800);

  const signedIn = await page.evaluate(async ({ email, password }) => {
    if (typeof Cloud === 'undefined') return false;
    if (Cloud.isSignedIn()) return true;
    return await Cloud.doSignIn(email, password);
  }, { email, password });
  if (!signedIn) throw new Error(`Login de QA pela UI falhou pra ${email}`);
  await page.waitForTimeout(1000);
}

module.exports = { supabaseClientAs, loginViaUi, requireEnv };
