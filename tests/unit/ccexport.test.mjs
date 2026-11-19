import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../../PMO_Compass_v2.html', import.meta.url), 'utf8');
test('Controle de Cards exporta Excel e CSV com tempo por etapa', () => {
  assert.ok(/CardControl\.exportXlsx\(\)/.test(src) && /CardControl\.exportCsv\(\)/.test(src), 'botões de exportar');
  assert.ok(/openCard, exportRows, exportXlsx, exportCsv \}/.test(src), 'API exposta');
  assert.ok(src.includes("'Dias: ' + x"), 'uma coluna de dias por etapa');
});
test('Controle de Cards tem pizza por situação e quadro responsável × situação que filtram a lista', () => {
  assert.ok(src.includes('id="cc-pie"') && src.includes('id="cc-matrix"'), 'áreas dos gráficos');
  assert.ok(/pickStatus, pickCell/.test(src), 'cliques filtram');
});
test('Central de Relatórios tem o tempo por etapa dos cards e o relatório padrão de fluxo', () => {
  assert.ok(src.includes("F('dias_etapa', 'Na etapa (d)'") && src.includes("id: 'p-fluxo'"), 'campos e padrão');
});
test('pacote público (dist) existe, está na versão do app e não leva os comentários do fonte', () => {
  const d = fs.readFileSync(new URL('../../dist/PMO_Compass_v2.html', import.meta.url), 'utf8');
  const v = (src.match(/version:\s*'([\d.]+)'/) || [])[1];
  assert.ok(d.includes("version:\"" + v + "\"") || d.includes("version:'" + v + "'"), 'versão do dist');
  assert.ok(d.indexOf('■ MODULE') < 0, 'sem comentários de módulo');
  const vj = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  assert.equal(vj.outputDirectory, 'dist');
  assert.ok(vj.headers.some(h => h.headers.some(x => x.key === 'Strict-Transport-Security')), 'HSTS');
});
test('Controle de Cards: números, pizza e lista usam o mesmo conjunto filtrado; quadro navega e há "Limpar Filtros"', () => {
  assert.ok(src.includes('const open = rows.filter(r => !r.a.done)'), 'números do topo seguem o filtro');
  assert.ok(src.includes('charts(g, rows, q, onlyAlert)') && src.includes('const pr = rows, tot = pr.length;'), 'pizza segue o filtro');
  assert.ok(src.includes('CardControl.clearFilters()') && /clearFilters, pickStatus/.test(src), 'limpar filtros');
});
test('Central de Relatórios: agrupadores escolhidos na hora (até 3) e cálculo à escolha, com "Voltar ao Original"', () => {
  assert.ok(src.includes('Reports.setAgg(this.id)') && src.includes('Reports.resetAgg()'), 'controles');
  for (const id of ['rpt-g1', 'rpt-g2', 'rpt-g3', 'rpt-m']) assert.ok(src.includes("'" + id + "'"), id);
  assert.ok(src.includes('exec(withAgg(d), \'rpt-out\')'), 'o Gerar usa os agrupadores');
});
