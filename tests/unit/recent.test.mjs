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

test('Quadro de tarefas não mostra sprint: todos os itens no Kanban, sem seletor, faixa nem Planejar sprint', () => {
  assert.ok(html.includes("if(document.body.classList.contains('is-board')) return items.slice();"));
  assert.ok(html.includes('body.is-board #kb-sprint,body.is-board #kb-sprint-bar,body.is-board [onclick*="openPlanNext"],body.is-board .ai-sprint-grp{display:none !important}'));
});

test('o texto de Apagar Dados não promete confirmação digitada onde agora é OK ou Cancelar', () => {
  assert.ok(!html.includes('pede uma confirmação digitada'));
  assert.ok(html.includes('janela com botão vermelho (para apagar toda a base, marque também a caixa de ciência)'));
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
  for (const k of ["const { data: have, error: haveErr } = await client.from('projects').select('id');", '!inCloud.has(p.id) && p.unsynced)', 'function markProjectSynced(id)', 'icon:' + "'compass', unsynced: true"]) assert.ok(html.includes(k), k);
});

test('Quadro de tarefas fica fora dos painéis que juntam projetos (portfólio, diretoria, executiva, PMO, relatório, priorização)', () => {
  assert.ok(html.includes("function listPortfolio() { return loadProjects().filter(p => p.methodology !== 'quadro'); }"));
  const n = (html.match(/DB\.listPortfolio\(\)/g) || []).length;
  assert.ok(n >= 17, 'painéis usando a lista sem quadros: ' + n);
});

test('projeto apagado na nuvem não ressuscita mesmo com dados locais (sem exceção por "ter dados")', () => {
  assert.ok(!html.includes('projectHasLocalData') && !html.includes('LOCAL_DATA_KEYS'));
});

test('exclusões usam a janela do sistema (Dlg) com botão vermelho, sem confirm do navegador e sem digitar nome ou APAGAR', () => {
  assert.ok(html.includes('data-module="ui/confirm-dialog"') && html.includes('role="alertdialog"'));
  for (const k of ["okLabel: 'Excluir o Projeto'", "okLabel: 'Apagar os Dados'", "okLabel: 'Apagar Toda a Base'", "check: 'Entendo que isso apaga os dados de todas as pessoas"]) assert.ok(html.includes(k), k);
  for (const k of ['digite o nome do projeto exatamente', "typed !== 'APAGAR'", "confirm('⚠️ ATENÇÃO", 'Clique OK para excluir de vez', 'Clique OK para apagar os dados']) assert.ok(!html.includes(k), k);
});
test('a janela Dlg devolve verdadeiro/falso, cancela com Esc e pela área escura, e foca em Cancelar', () => {
  const m = html.match(/<script data-module="ui\/confirm-dialog">([\s\S]*?)<\/script>/)[1];
  for (const k of ["e.key === 'Escape'", "if(e.target === ov) done(false);", "querySelector('#dlg-cancel').focus()", 'Marque a caixa acima para continuar.', 'prevFocus.focus()']) assert.ok(m.includes(k), k);
});

test('a Ajuda explica o menu, Quadros, nuvem por padrão e as janelas de exclusão', () => {
  const i = html.indexOf('id="p-help"'), a = html.slice(i, i + 20000);
  for (const k of ['Menu, Quadros e Nuvem', 'Mais Telas', 'Menos Telas', 'Salvar na nuvem', 'Quadros (tarefas sem projeto)', 'botão vermelho', 'Meu Dia']) assert.ok(a.includes(k), k);
});

test('feedback do Leandro: escolher Bug não fecha a janela à toa, comentário/evidência já na criação e Ctrl+V no cartão', () => {
  for (const k of ["document.getElementById('ai-kind').value = 'historia'; kindChanged(); T.show('⚠️ Ainda não há itens", "if(!refs.length && !board) {", "document.getElementById('ai-work').style.display = (it || full) ? '' : 'none';", 'draftId = it ? \'\' : AgileCalc.nextId(', "const ev = await collectEvidence(); if(ev === false) return;", "Colar o print direto no cartão (Ctrl+V)", 'Evidências (cole o print com Ctrl+V']) assert.ok(html.includes(k), k);
});

test('Responsável do cartão é lista da equipe e a regra vale na edição, no botão, no arrasto e na automação', () => {
  for (const k of ['<select class="input" id="ai-assignee"></select>', 'function fillAssignee(cur)', 'const blk0 = cur0 ? moveBlock(f.assignee, to0) : \'\';', 'const blk = moveBlock(it.assignee, to);', '!moveBlock(it.assignee, a.column)', '(sem acesso ao sistema)']) assert.ok(html.includes(k), k);
  assert.ok(!html.includes('id="ai-people"'));
});

test('Colaboradores tem o botão Adicionar Colaborador (também no Quadro, que não tem Burnout Radar) e atualiza a lista ao salvar', () => {
  for (const k of ['onclick="Burnout.openAdd()"><i class="ti ti-plus"></i>Adicionar Colaborador', "render(); if(typeof Resources !== 'undefined') Resources.render();"]) assert.ok(html.includes(k), k);
  assert.ok(!html.includes('adicione pelo Burnout Radar'));
});

test('recusa de responsável ajuda: quem pode vai a Pessoas e Acesso; quem não pode vê a quem pedir (gerente e administradores, com e-mail)', () => {
  for (const k of ['async function askRegularize(msg)', "okLabel: 'Abrir Pessoas e Acesso'", "SettingsTabs.show('acesso')", 'Procure o administrador ou o gerente do projeto', 'Cloud.projectContacts(DB.getActiveProjectId())', 'const canManage = () =>', 'async function projectContacts(pid)', "client.rpc('project_contacts'", 'signed ? Auth.getName()']) assert.ok(html.includes(k), k);
  const sql = readFileSync(join(root, 'supabase', 'migrations', '20261106150000_item_assignee_self_and_contacts.sql'), 'utf8');
  for (const k of ['function public.project_contacts', 'has_project_access(pid)', "'Gerente do projeto'", "'Administrador'", 'revoke all on function public.project_contacts(text) from public, anon']) assert.ok(sql.includes(k), k);
});
