// XSS em campos de texto livre (CT12) — os 3 pontos de entrada de maior risco apontados na
// última rodada de aceitação: nome de membro de equipe, título de decisão, título de mudança de
// escopo. Confirma que o payload aparece como TEXTO LITERAL no DOM, nunca como tag/script vivo.
const { test, expect } = require('@playwright/test');
const { loginViaUi, requireEnv } = require('./fixtures');

const XSS_PAYLOAD = '<img src=x onerror="window.__xssFired = true">';

test.describe('XSS em campos de texto livre (CT12)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { window.__xssFired = false; });
    await loginViaUi(page, 'admin');
    await page.evaluate((pid) => { if (typeof DB !== 'undefined') DB.switchProject(pid); }, requireEnv('TEST_PROJECT_WITH_GRANT_ID'));
  });

  test('nome de membro de equipe não executa script ao renderizar', async ({ page }) => {
    await page.goto('#burnout');
    const memberId = await page.evaluate((payload) => {
      Burnout.openAdd();
      document.getElementById('burnout-f-name').value = payload;
      document.getElementById('burnout-f-role').value = 'QA E2E';
      document.getElementById('burnout-f-alloc').value = '10';
      document.getElementById('burnout-f-pct').value = '10';
      Burnout.saveFromModal();
      const created = DB.get('team').find(m => m.name === payload);
      return created && created.id;
    }, XSS_PAYLOAD);
    expect(memberId).toBeTruthy();
    await page.waitForTimeout(300);

    const xssFired = await page.evaluate(() => window.__xssFired === true);
    expect(xssFired).toBe(false);

    const renderedHtml = await page.locator('#res-list-root').innerHTML().catch(() => '');
    // limpeza: remove o membro de teste (local + nuvem) antes de qualquer assert que possa falhar o teste
    await page.evaluate((id) => {
      const team = DB.get('team').filter(m => m.id !== id);
      DB.set('team', team);
      if (typeof Cloud !== 'undefined') Cloud.deleteTeamMember(id);
    }, memberId);

    // O payload deve aparecer como texto escapado (&lt;img...), nunca como <img> de verdade
    expect(renderedHtml).not.toMatch(/<img[^>]*onerror=/i);
  });

  test('título de decisão não executa script ao renderizar', async ({ page }) => {
    await page.goto('#decisions');
    const decisionId = await page.evaluate((payload) => {
      // Grava direto no DB (não há "criar decisão manual" exposto na UI) — o alvo do teste é a
      // RENDERIZAÇÃO da lista de decisões, não o fluxo de criação em si.
      const id = 'dec-e2e-' + Date.now();
      const decisions = DB.get('decisions') || [];
      decisions.push({ id, severity: 'crit', pct: 100, title: payload, body: 'teste e2e', sources: [], status: 'pending', actions: ['accept'], createdAt: new Date().toISOString() });
      DB.set('decisions', decisions);
      if (typeof Decisions !== 'undefined') Decisions.render();
      return id;
    }, XSS_PAYLOAD);
    expect(decisionId).toBeTruthy();
    await page.waitForTimeout(300);

    const xssFired = await page.evaluate(() => window.__xssFired === true);

    const renderedHtml = await page.locator('#p-decisions').innerHTML().catch(() => '');
    await page.evaluate((id) => {
      DB.set('decisions', (DB.get('decisions') || []).filter(d => d.id !== id));
      if (typeof Cloud !== 'undefined') Cloud.deleteDecision(id);
    }, decisionId);

    expect(xssFired).toBe(false);
    expect(renderedHtml).not.toMatch(/<img[^>]*onerror=/i);
  });

  test('título de mudança de escopo não executa script ao renderizar', async ({ page }) => {
    await page.goto('#scope');
    const scopeId = await page.evaluate((payload) => {
      const id = 'SC-E2E-' + Date.now();
      const scope = DB.get('scopeChanges') || [];
      scope.push({ id, title: payload, status: 'pending', impactDays: 1, impactCost: 100 });
      DB.set('scopeChanges', scope);
      if (typeof Scope !== 'undefined') Scope.render();
      return id;
    }, XSS_PAYLOAD);
    expect(scopeId).toBeTruthy();
    await page.waitForTimeout(300);

    const xssFired = await page.evaluate(() => window.__xssFired === true);
    const renderedHtml = await page.locator('#p-scope').innerHTML().catch(() => '');
    await page.evaluate((id) => {
      DB.set('scopeChanges', (DB.get('scopeChanges') || []).filter(s => s.id !== id));
    }, scopeId);

    expect(xssFired).toBe(false);
    expect(renderedHtml).not.toMatch(/<img[^>]*onerror=/i);
  });
});
