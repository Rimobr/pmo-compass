import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="core\/methodology">([\s\S]*?)<\/script>/);
const { Methodology } = new Function(`${m[1]}\nreturn { Methodology };`)();

test('sem escolha (projetos antigos) vale Híbrido: nenhuma tela some', () => {
  assert.equal(Methodology.typeOf(null), 'hibrido');
  assert.equal(Methodology.typeOf({ type: 'inexistente' }), 'hibrido');
  for (const page of Object.keys(Methodology.ONLY)) assert.equal(Methodology.visibleFor(page, 'hibrido'), true);
});

test('Ágil esconde as telas de plano rígido; Cascata e Híbrido mostram todas', () => {
  for (const page of ['baseline', 'scope', 'estimates', 'whatif', 'raci']) {
    assert.equal(Methodology.visibleFor(page, 'agil'), false, page);
    assert.equal(Methodology.visibleFor(page, 'cascata'), true, page);
  }
});

test('telas do núcleo aparecem em todas as metodologias (incluindo WBS enquanto não existir o Kanban)', () => {
  for (const page of ['dashboard', 'wbs', 'risks', 'decisions', 'hours', 'chat', 'report']) {
    for (const t of Methodology.ORDER) assert.equal(Methodology.visibleFor(page, t), true, page + ' / ' + t);
  }
});

test('cada metodologia tem texto de apoio e orientação para a IA', () => {
  for (const t of Methodology.ORDER) {
    assert.ok(Methodology.TYPES[t].label && Methodology.TYPES[t].resumo && Methodology.TYPES[t].guidance.length > 40);
  }
  assert.deepEqual(Methodology.ORDER, [...Methodology.ORDER].sort((a, b) => Methodology.TYPES[a].short.localeCompare(Methodology.TYPES[b].short, 'pt-BR')));
});
