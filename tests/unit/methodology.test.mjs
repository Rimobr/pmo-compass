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
  for (const page of ['wbs', 'baseline', 'scope', 'estimates', 'whatif', 'raci']) {
    assert.equal(Methodology.visibleFor(page, 'agil'), false, page);
    assert.equal(Methodology.visibleFor(page, 'cascata'), true, page);
  }
});

test('telas do núcleo aparecem em todas as metodologias (a WBS é plano preditivo: fora do Ágil)', () => {
  for (const page of ['dashboard', 'risks', 'decisions', 'hours', 'chat', 'report', 'mywork', 'myind', 'lessons']) {
    for (const t of Methodology.ORDER) assert.equal(Methodology.visibleFor(page, t), true, page + ' / ' + t);
  }
});

test('cada metodologia tem texto de apoio e orientação para a IA', () => {
  for (const t of Methodology.ORDER) {
    assert.ok(Methodology.TYPES[t].label && Methodology.TYPES[t].resumo && Methodology.TYPES[t].guidance.length > 40);
  }
  assert.deepEqual(Methodology.ORDER, [...Methodology.ORDER].sort((a, b) => Methodology.TYPES[a].short.localeCompare(Methodology.TYPES[b].short, 'pt-BR')));
});

test('Quadro, Backlog e Sprints aparecem só em Ágil e Híbrido', () => {
  for (const page of ['kanban', 'backlog', 'sprints']) {
    assert.equal(Methodology.visibleFor(page, 'agil'), true, page);
    assert.equal(Methodology.visibleFor(page, 'hibrido'), true, page);
    assert.equal(Methodology.visibleFor(page, 'cascata'), false, page);
  }
});

test('projeto ágil monta o menu em torno do Quadro: WBS fora, mas aparece sozinha se já houver entregas (nada fica órfão)', () => {
  assert.equal(Methodology.visibleFor('wbs', 'agil'), false);
  assert.equal(Methodology.visibleFor('wbs', 'cascata'), true);
  assert.equal(Methodology.visibleFor('wbs', 'hibrido'), true);
  // com dado na WBS a tela volta, mesmo no Ágil (o módulo lê DB e a metodologia do projeto aberto)
  const calls = { wbs: [], type: 'agil' };
  const env = { DB: { get: k => (k === 'wbs' ? calls.wbs : null), getActiveProjectId: () => 'p', listProjects: () => [{ id: 'p', methodology: calls.type }], getForProject: () => null }, localStorage: { getItem: () => null, setItem() {} }, document: { querySelectorAll: () => [], getElementById: () => null }, Auth: {}, T: {}, Nav: undefined };
  const M = new Function(...Object.keys(env), m[1] + '\nreturn Methodology;')(...Object.values(env));
  assert.equal(M.visible('wbs'), false);
  calls.wbs = [{ label: 'Entrega 1' }];
  assert.equal(M.visible('wbs'), true);
  assert.equal(M.visible('baseline'), false);   // só a WBS tem a proteção: o resto do plano rígido continua fora
});
test('primeiros passos do projeto ágil falam de Backlog, não de WBS', () => {
  assert.ok(html.includes("title: 'Cadastre os itens no Backlog'"));
  assert.ok(html.includes("agil ? { done: has('backlog')"));
});

test('Quadro de tarefas: só Quadro, Backlog, Meu Trabalho, Arquivos e Colaboradores; fora de ORDER; migração libera o valor', async () => {
  const { readFileSync } = await import('node:fs');
  const h = readFileSync(new URL('../../PMO_Compass_v2.html', import.meta.url), 'utf8');
  for (const k of ["quadro:  { label:'Quadro de Tarefas (sem projeto)'", "const BOARD_OK = ['kanban', 'backlog', 'mywork', 'repository', 'resources']", "id=\"sbg-quadros\"", "Wizard.open(\'quadro\')", "entry: 'kanban'", "'Criar Quadro'"]) assert.ok(h.includes(k), k);
  assert.ok(h.includes("const ORDER = ['agil', 'cascata', 'hibrido'];"), 'o quadro não entra nas comparações de metodologia');
  const mig = readFileSync(new URL('../../supabase/migrations/20261104200000_board_methodology.sql', import.meta.url), 'utf8');
  assert.ok(/'quadro'/.test(mig));
});
