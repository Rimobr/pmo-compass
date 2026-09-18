// Suíte E2E do PMO Compass — RLS/RBAC, anti-escalonamento, imutabilidade do audit_log, XSS e
// acessibilidade (WCAG 2.1 AA via axe-core). Ver tests/e2e/README.md pra configurar as
// credenciais de QA necessárias (não incluídas aqui — variáveis de ambiente, nunca hardcoded).
require('dotenv').config({ path: '.env.test' });
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // testes de RLS/auditoria compartilham estado no Supabase — evita corrida entre specs
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 120000, // o login pela UI carrega o SDK do Supabase por CDN — leva 20-40s no headless
  use: {
    baseURL: process.env.APP_BASE_URL || 'http://localhost:8080/PMO_Compass_v2.html',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.APP_BASE_URL ? undefined : {
    command: 'npx serve -l 8080 .',
    url: 'http://localhost:8080',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
