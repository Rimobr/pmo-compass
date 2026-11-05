import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const mod = html.match(/<script data-module="ui\/recent-pages">([\s\S]*?)<\/script>/)[1];

test('Usados Recentemente: guarda as últimas telas sem repetir, no máximo 6, e ignora Dashboard e sem-projeto', () => {
  const store = {}; const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  const { visit, load } = new Function('localStorage', 'document', mod + '\nreturn Recent;')(ls, { getElementById: () => null, querySelector: () => null });
  for (const p of ['risks', 'kanban', 'dashboard', 'risks', 'wbs', 'noproject', 'hours', 'budget', 'scope', 'raci']) visit(p);
  assert.deepEqual(load(), ['raci', 'scope', 'budget', 'hours', 'wbs', 'risks']);
  assert.equal(new Set(load()).size, load().length);
});

test('só aparece o que existe no menu, não está escondido e o perfil abre; chave do navegador no mapa; o menu usa aspas válidas', () => {
  for (const k of ['Auth.canOpen(id)', 'm-hidden', 'Usados Recentemente']) assert.ok(mod.includes(k), k);
  assert.ok(html.includes("if(typeof Recent !== 'undefined') Recent.visit(id);"));
  assert.ok(readFileSync(join(root, 'docs', 'mapa-de-dados.json'), 'utf8').includes('pmo_recent_pages_v1'));
});

test('nenhuma tela aparece duas vezes na área do projeto (soltas à vista e dentro de "Mais Telas")', () => {
  const a = html.indexOf('id="sb-proj-area"'), b = html.indexOf('<!-- /sb-proj-area -->');
  const area = html.slice(a, b);
  const ids = [...area.matchAll(/<button class="si[^"]*"[^>]*data-p="([a-z]+)"/g)].map(m => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepEqual(dup, [], 'repetidos: ' + dup.join(', '));
});

test('o menu do Quadro tem Quadro Kanban, Backlog, Arquivos e Colaboradores (e Meu Trabalho fica em Meu Dia)', () => {
  const i = html.indexOf('id="sb-board-menu"'), j = html.indexOf('</div>', i);
  const m = html.slice(i, j);
  for (const p of ['kanban', 'backlog', 'repository', 'resources']) assert.ok(m.includes('data-p="' + p + '"'), p);
  assert.ok(!m.includes('data-p="mywork"'));
});

test('nenhuma expressão regular perdeu a barra invertida (\s, \d) ao ser escrita por script', () => {
  const re = new RegExp('[(,]/[sdwSDW]\\+/[gi]*[,)]', 'g');
  const bad = html.match(re) || [];
  assert.deepEqual(bad, [], 'verifique: ' + bad.join(' '));
});

test('com um quadro ativo o grupo Quadros / Kanban não fecha ao abrir o Kanban', () => {
  assert.ok(html.includes("if(!groupId && document.body.classList.contains('is-board')) groupId = 'sbg-quadros';"));
});

test('excluir e apagar os dados do projeto pedem só OK ou Cancelar (sem digitar o nome)', () => {
  assert.ok(!html.includes('digite o nome do projeto exatamente'));
  for (const k of ['Clique OK para excluir de vez, ou Cancelar para manter o projeto.', 'Clique OK para apagar os dados, ou Cancelar para manter tudo.']) assert.ok(html.includes(k), k);
});

test('Quadro de tarefas não mostra sprint: todos os itens no Kanban, sem seletor, faixa nem Planejar sprint', () => {
  assert.ok(html.includes("if(document.body.classList.contains('is-board')) return items.slice();"));
  assert.ok(html.includes('body.is-board #kb-sprint,body.is-board #kb-sprint-bar,body.is-board [onclick*="openPlanNext"],body.is-board .ai-sprint-grp{display:none}'));
});

test('o texto de Apagar Dados não promete confirmação digitada onde agora é OK ou Cancelar', () => {
  assert.ok(!html.includes('pede uma confirmação digitada'));
  assert.ok(html.includes('OK ou Cancelar; para apagar toda a base, digitar APAGAR'));
});

test('o campo Sprint do cartão também some no Quadro de tarefas', () => {
  assert.ok(html.includes('class="field-group ai-sprint-grp"'));
});
