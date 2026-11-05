import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
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
  assert.ok(html.includes("if(!groupId) { try { if(typeof DB !== 'undefined' && typeof Methodology !== 'undefined' && Methodology.isBoard(DB.getActiveProjectId())) groupId = 'sbg-quadros'; } catch(e) {} }"));
});

test('excluir e apagar os dados do projeto pedem só OK ou Cancelar (sem digitar o nome)', () => {
  assert.ok(!html.includes('digite o nome do projeto exatamente'));
  for (const k of ['Clique OK para excluir de vez, ou Cancelar para manter o projeto.', 'Clique OK para apagar os dados, ou Cancelar para manter tudo.']) assert.ok(html.includes(k), k);
});

test('Quadro de tarefas não mostra sprint: todos os itens no Kanban, sem seletor, faixa nem Planejar sprint', () => {
  assert.ok(html.includes("if(document.body.classList.contains('is-board')) return items.slice();"));
  assert.ok(html.includes('body.is-board #kb-sprint,body.is-board #kb-sprint-bar,body.is-board [onclick*="openPlanNext"],body.is-board .ai-sprint-grp{display:none !important}'));
});

test('o texto de Apagar Dados não promete confirmação digitada onde agora é OK ou Cancelar', () => {
  assert.ok(!html.includes('pede uma confirmação digitada'));
  assert.ok(html.includes('OK ou Cancelar; para apagar toda a base, digitar APAGAR'));
});

test('o campo Sprint do cartão também some no Quadro de tarefas', () => {
  assert.ok(html.includes('class="field-group ai-sprint-grp"'));
});

test('Usados Recentemente foi removido do menu (e a chave do navegador some do mapa)', () => {
  assert.ok(!html.includes('sb-recent') && !html.includes('Recent.visit') && !html.includes('pmo_recent_pages_v1'));
  assert.ok(!readFileSync(join(root, 'docs', 'mapa-de-dados.json'), 'utf8').includes('pmo_recent_pages_v1'));
});

test('criar projeto avisa quando o nome já existe (mesmo com acento, hífen, maiúscula ou "de" de diferença)', () => {
  const src = html.match(/const normName = [^\n]*\n  const sameName = [^\n]*\n/)[0];
  const { sameName } = new Function(src + '\nreturn { sameName };')();
  assert.equal(sameName('Sistema Gestão Barbearia', 'Sistema de Gestão Barbearia'), true);
  assert.equal(sameName('Vida-Financeira', 'Vida Financeira'), true);
  assert.equal(sameName('Implantação  Cla Guard Pro', 'implantacao cla guard pro'), true);
  assert.equal(sameName('Vida Financeira', 'Vida Financeira 2'), false);
  assert.equal(sameName('', ''), false);
  assert.ok(html.includes('Clique OK para criar mais um com este nome, ou Cancelar para voltar.'));
});

test('o Backlog do quadro não fala de sprint (subtítulo e previsão em sprints)', () => {
  assert.ok(html.includes('<span class="ai-sprint-grp"> Coloque os mais importantes na próxima sprint.</span>'));
  assert.ok(html.includes("(document.body.classList.contains('is-board') ? '' : kpi('Previsão'"));
});

test('a nuvem é o padrão: o app nasce conectado e "usar só este navegador" é escolha (cfg.localOnly)', () => {
  for (const k of ['const DEFAULT_CLOUD = { url: ', 'let cfg = { ...DEFAULT_CLOUD };', "if(saved && saved.localOnly) cfg = { url:'', anonKey:'', localOnly:true };", 'pendingCloudConfirm = !(cloudCfg && cloudCfg.localOnly);', 'Salvar na nuvem (recomendado)', 'Cloud.setUse(this.checked)']) assert.ok(html.includes(k), k);
  const m = html.match(/const DEFAULT_CLOUD = \{ url: '([^']+)', anonKey: '([^']+)' \}/);
  assert.ok(m && /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(m[1]));
  const role = JSON.parse(Buffer.from(m[2].split('.')[1], 'base64url').toString()).role;
  assert.equal(role, 'anon', 'só a chave pública (anon) pode ir no app, nunca a de serviço');
});
test('sincronização de projetos: a nuvem manda (não recria projeto vazio que foi apagado lá)', () => {
  for (const k of ["const { data: have, error: haveErr } = await client.from('projects').select('id');", '!inCloud.has(p.id) && (p.unsynced || DB.projectHasLocalData(p.id))', 'function markProjectSynced(id)', 'icon:' + "'compass', unsynced: true"]) assert.ok(html.includes(k), k);
});
