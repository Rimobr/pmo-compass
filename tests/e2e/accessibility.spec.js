// Acessibilidade (WCAG 2.1 AA via axe-core) nas 3 telas construídas/alteradas na última sessão
// (CT10, CT11) — Farol do Portfólio, Visão Executiva e Membros do Projeto —, nos 3 temas do app.
// Falha em qualquer violação "critical" ou "serious", que é o que a rodada de aceitação pediu.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { loginViaUi } = require('./fixtures');

const THEMES = ['dark', 'light', 'gray'];
const PAGES = [
  { hash: '#board', name: 'Painel da Diretoria (Farol do Portfólio)' },
  { hash: '#execview', name: 'Visão Executiva' },
  { hash: '#settings', name: 'Membros do Projeto' },
];

test.describe('Acessibilidade WCAG 2.1 AA', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page, 'admin');
  });

  for (const theme of THEMES) {
    for (const p of PAGES) {
      test(`${p.name} — tema ${theme}`, async ({ page }) => {
        await page.evaluate((t) => { if (typeof Theme !== 'undefined') Theme.set(t); }, theme);
        await page.goto('/' + p.hash);
        await page.waitForTimeout(600); // deixa o render assíncrono (Cloud/DB) terminar

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();

        const blocking = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
        if (blocking.length) {
          console.log(JSON.stringify(blocking.map(v => ({
            id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
            targets: v.nodes.slice(0, 3).map(n => n.target),
          })), null, 2));
        }
        expect(blocking, `Violações WCAG bloqueantes em ${p.name} (tema ${theme})`).toEqual([]);
      });
    }
  }

  test('Farol do Portfólio é 100% navegável por teclado', async ({ page }) => {
    await page.goto('/#board');
    await page.waitForTimeout(500);
    let foundProjectLink = false;
    for (let i = 0; i < 60 && !foundProjectLink; i++) {
      await page.keyboard.press('Tab');
      const ariaLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      if (ariaLabel && ariaLabel.startsWith('Abrir ')) foundProjectLink = true;
    }
    expect(foundProjectLink).toBe(true);
  });
});
