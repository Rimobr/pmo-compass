import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../../PMO_Compass_v2.html', import.meta.url), 'utf8');
test('Controle de Cards exporta Excel e CSV com tempo por etapa', () => {
  assert.ok(/CardControl\.exportXlsx\(\)/.test(src) && /CardControl\.exportCsv\(\)/.test(src), 'botões de exportar');
  assert.ok(/return \{ render, toggle, more, openCard, exportRows, exportXlsx, exportCsv \}/.test(src), 'API exposta');
  assert.ok(src.includes("'Dias: ' + x"), 'uma coluna de dias por etapa');
});
test('Controle de Cards tem pizza por situação e quadro responsável × situação que filtram a lista', () => {
  assert.ok(src.includes('id="cc-pie"') && src.includes('id="cc-matrix"'), 'áreas dos gráficos');
  assert.ok(/pickStatus, pickCell/.test(src), 'cliques filtram');
});
