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


test('o texto de Apagar Dados não promete confirmação digitada onde agora é OK ou Cancelar', () => {
  assert.ok(!html.includes('pede uma confirmação digitada'));
  assert.ok(html.includes('janela com botão vermelho (para apagar toda a base, marque também a caixa de ciência)'));
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
  for (const k of ["e.key === 'Escape'", "if(e.target === ov && !onlyOk) done(false);", "querySelector(onlyOk ? '#dlg-ok' : '#dlg-cancel').focus()", 'Marque a caixa acima para continuar.', 'prevFocus.focus()']) assert.ok(m.includes(k), k);
});

test('a Ajuda explica o menu, Quadros, nuvem por padrão e as janelas de exclusão', () => {
  const i = html.indexOf('id="p-help"'), a = html.slice(i, i + 20000);
  for (const k of ['Menu, Quadros e Nuvem', 'Mais Telas', 'Menos Telas', 'Salvar na nuvem', 'Quadros (tarefas sem projeto)', 'botão vermelho', 'Meu Dia']) assert.ok(a.includes(k), k);
});

test('feedback do Leandro: escolher Bug não fecha a janela à toa, comentário/evidência já na criação e Ctrl+V no cartão', () => {
  for (const k of ["document.getElementById('ai-kind').value = 'historia'; kindChanged(); T.show('⚠️ Ainda não há itens", "if(!refs.length && !board) {", "document.getElementById('ai-work').style.display = (it || full) ? '' : 'none';", 'draftId = it ? \'\' : AgileCalc.nextId(', "const ev = await collectEvidence(); if(ev === false) return;", "Colar o print direto no cartão (Ctrl+V)", 'Evidências (cole o print com Ctrl+V']) assert.ok(html.includes(k), k);
});

test('Responsável do cartão é lista da equipe e a regra vale na edição, no botão, no arrasto e na automação', () => {
  for (const k of ['<select class="input" id="ai-assignee" onchange="Agile.syncSprintLock()"></select>', 'function fillAssignee(cur)', 'const blk0 = cur0 ? moveBlock(f.assignee, to0) : \'\';', 'const blk = moveBlock(it.assignee, to);', '!moveBlock(it.assignee, a.column)', '(não cadastrado)']) assert.ok(html.includes(k), k);
  assert.ok(!html.includes('id="ai-people"'));
});

test('Colaboradores tem o botão Adicionar Colaborador (também no Quadro, que não tem Burnout Radar) e atualiza a lista ao salvar', () => {
  for (const k of ['onclick="Burnout.openAdd()"><i class="ti ti-plus"></i>Adicionar Colaborador', "render(); if(typeof Resources !== 'undefined') Resources.render();"]) assert.ok(html.includes(k), k);
  assert.ok(!html.includes('adicione pelo Burnout Radar'));
});

test('recusa de responsável ajuda: quem pode vai a Pessoas e Acesso; quem não pode vê a quem pedir (gerente e administradores, com e-mail)', () => {
  for (const k of ['async function askRegularize(msg, who)', 'Você pode resolver isto porque é ', 'Passar para Outro Profissional', "getElementById('users-q')", "okLabel: 'Incluir na Equipe'", "SettingsTabs.show('acesso')", 'Procure o administrador ou o gerente do projeto', 'Cloud.projectContacts(DB.getActiveProjectId())', 'const canManage = () =>', 'async function projectContacts(pid)', "client.rpc('project_contacts'", 'signed ? Auth.getName()']) assert.ok(html.includes(k), k);
  const sql = readFileSync(join(root, 'supabase', 'migrations', '20261106150000_item_assignee_self_and_contacts.sql'), 'utf8');
  for (const k of ['function public.project_contacts', 'has_project_access(pid)', "'Gerente do projeto'", "'Administrador'", 'revoke all on function public.project_contacts(text) from public, anon']) assert.ok(sql.includes(k), k);
});

test('campo Sprint só abre com responsável escolhido; backlog, planejamento e importação respeitam a mesma regra', () => {
  for (const k of ['onchange="Agile.syncSprintLock()"', 'function syncSprintLock()', "'Este item está sendo criado dentro da sprint ativa; a sprint não muda aqui.'", 'AgileCalc.sprintAssigneeError(it.assignee, teamNames())', 'Ficaram de fora da sprint por falta de responsável cadastrado', 'entraram em "A fazer", sem sprint', 'kindPicked, syncSprintLock,']) assert.ok(html.includes(k), k);
});

test('janela do cartão: Excluir, Cancelar e Salvar ficam no cabeçalho fixo; "Incluir na Equipe" inclui sozinho quando acha a conta', () => {
  const i = html.indexOf('id="modal-agile-item"'), j = html.indexOf('id="modal-agile-behalf"'), m = html.slice(i, j);
  assert.ok(m.includes('class="ai-hd" style="position:sticky;top:-24px'));
  const hd = m.slice(m.indexOf('class="ai-hd"'), m.indexOf('<label for="ai-title">'));
  for (const k of ['id="ai-del"', 'Agile.closeItem()', 'Agile.saveItem()']) assert.ok(hd.includes(k), k);
  assert.ok(!m.slice(m.indexOf('id="ai-hist-list"')).includes('Agile.saveItem()'), 'sobrou botão Salvar no pé da janela');
  for (const k of ['async function findAccount(nome)', 'Cloud.setProjectAccess(hit.id, DB.getActiveProjectId(), true)', 'foi incluído(a) na equipe deste projeto']) assert.ok(html.includes(k), k);
});

test('resumo de entrada: já vem ligado (uma vez por dia), é parâmetro da organização e mostra só os cards da própria pessoa', () => {
  const m = html.match(/<script data-module="ui\/my-digest">([\s\S]*?)<\/script>/)[1];
  for (const k of ["const mode = () =>", "MODES.includes(o.mode) ? o.mode : 'diario'", "OrgSettings.set(ORG, { mode: v })", "Cloud.myOpenItems()", "Auth.getRole() !== 'admin'", 'state.mine.length > (st.n || 0)', 'onlyOk: true', "okLabel: 'OK, Li e Entendi'", 'function acknowledge(action, label, list, m)', "'digest_ack'"]) assert.ok(m.includes(k), k);
  for (const k of ['id="digest-mode"', 'MyDigest.setMode(this.value)', 'Resumo de Entrada (Meus Cards)', 'async function myOpenItems()', ".in('assignee', names).neq('status', 'done')"]) assert.ok(html.includes(k), k);
  assert.ok(readFileSync(join(root, 'docs', 'mapa-de-dados.json'), 'utf8').includes('"pmo_digest_v1"'));
});

test('resumo de entrada: sem espera (dispara ao terminar o login), só o botão OK e o OK vai para a auditoria de cada projeto', () => {
  assert.ok(!html.includes('setTimeout(check, 9000)'));
  assert.ok(html.includes("if(typeof MyDigest !== 'undefined') MyDigest.check();"));
  const dlg = html.match(/<script data-module="ui\/confirm-dialog">([\s\S]*?)<\/script>/)[1];
  for (const k of ['onlyOk = !!o.onlyOk', "if(e.target === ov && !onlyOk) done(false);", "if(!onlyOk) done(false); return; }"]) assert.ok(dlg.includes(k), k);
  assert.ok(html.includes("function pushAuditEvent(action, description, metadata, projectId)") && html.includes("project_id: projectId || DB.getActiveProjectId(),"));
  assert.ok(html.includes("digest_ack:'Resumo de entrada (OK)'"));
});

test('gestão: cards sem responsável cadastrado têm aviso próprio (OK na auditoria) e o sino soma os pendentes', () => {
  const m = html.match(/<script data-module="ui\/my-digest">([\s\S]*?)<\/script>/)[1].replace(/\r\n/g, '\n');
  for (const k of ["isMgr = () => typeof Auth !== 'undefined' && Auth.can('manage_backlog')", "'digest_ack_unassigned'", "title: 'Cards Sem Responsável Cadastrado'", 'function findLoose(d)', 'pendingCount', 'function panelHtml()']) assert.ok(m.includes(k), k);
  for (const k of ['async function openItemsForManagers()', "const extra = (typeof MyDigest !== 'undefined') ? MyDigest.pendingCount() : 0, total = n + extra;", "typeof MyDigest !== 'undefined' ? MyDigest.panelHtml() : ''", "digest_ack_unassigned:'Cards sem responsável (OK)'"]) assert.ok(html.includes(k), k);
  // findLoose: sem nome ou com nome que não é de pessoa ligada a conta nem de perfil cadastrado
  const src = m.match(/const norm = [^\n]*\n/)[0] + m.match(/  function findLoose\(d\) \{[\s\S]*?\n  \}\n/)[0];
  const { findLoose } = new Function(src + '\nreturn { findLoose };')();
  const d = { items: [{ project_id: 'p', id: '1', assignee: '' }, { project_id: 'p', id: '2', assignee: 'Ricardo' }, { project_id: 'p', id: '3', assignee: 'Ana Souza' }, { project_id: 'p', id: '4', assignee: 'Rícardo M' }], linked: [{ project_id: 'p', name: 'ana souza' }], profileNames: ['Ricardo M'] };
  assert.deepEqual(findLoose(d).map(i => i.id), ['1', '2']);
});

test('resumo de entrada: coluna criada no quadro (ex.: x1) entra na soma como "outras colunas"', () => {
  assert.ok(html.includes("parts.push(outras + ' em outras colunas do quadro')"));
});

test('quatro temas em todo produto: Branco, Cinza, Preto e Verde (Vigilae), aplicados antes da primeira pintura e no botão da barra', () => {
  const th = html.match(/<script data-module="core\/theme">([\s\S]*?)<\/script>/)[1];
  for (const k of ["label:'Branco'", "label:'Cinza'", "label:'Preto'", "label:'Verde'", "|| theme === 'green'", 'function next()']) assert.ok(th.includes(k), k);
  assert.ok(html.includes('html[data-theme="green"] {') && html.includes('html[data-theme="green"] .sidebar {'));
  assert.ok(html.includes("t === 'light' || t === 'gray' || t === 'green'"));
  assert.ok(html.includes('onclick="Theme.next()"'));
  assert.ok(readFileSync(join(root, 'tests', 'smoke', 'screens-a11y.mjs'), 'utf8').includes("['dark', 'light', 'gray', 'green']"));
});

test('o sino separa Pendências do dia (resumo) de Avisos das automações, e a tela de Automações explica quando o aviso chega', () => {
  for (const k of ['Pendências do dia</div>', 'Avisos das automações</div>', 'Se a pessoa está logada, aparecem em instantes; se não está, esperam e aparecem quando ela entrar.']) assert.ok(html.includes(k), k);
  assert.ok(!html.includes('aparecem na tela da pessoa depois do login'));
});


test('Quadro tem sprint simples: janela de tempo (2 semanas), prazo em cada card, faixa com encerrar e transbordo; sem planejamento por pontos, meta nem capacidade', () => {
  for (const k of ['function boardBar(act)', 'Encerrar e Decidir o que Sobrou', 'Agile.openDue(', 'Agile.startSprint(', "boardSprint === '__auto' ? (isB ? '__all'", "'Todos os cards'", 'const dueChip =', 'atrasado · ', 'function sprintDur()', 'id="as-dur"', 'id="as-goal-grp"', 'id="as-cap-grp"', "presetSprint = (!it && location.hash === '#kanban' && active())"]) assert.ok(html.includes(k), k);
  assert.ok(html.includes('body.is-board [onclick*="openPlanNext"],body.is-board #as-goal-grp,body.is-board #as-cap-grp{display:none !important}'));
  assert.ok(!html.includes('body.is-board #kb-sprint,'));
  assert.ok(html.includes('<select class="input" data-perm="manage_backlog" aria-label="Sprint do item'));
});

test('Sprint do card novo: pelo Quadro Kanban vem escolhida e travada; pelo Backlog é livre e começa em "Sem sprint"; sem aviso silencioso', () => {
  const m = html.replace(/\r\n/g, '\n').match(/function syncSprintLock\(\) \{[\s\S]*?\n  \}\n/)[0];
  for (const k of ['const locked = !!presetSprint && !itemCtx;', "el.options[0].textContent = 'Sem sprint'"]) assert.ok(m.includes(k), k);
  assert.ok(!m.includes('sprintAssigneeError'), 'o campo não trava mais por falta de responsável');
  assert.ok(html.includes("presetSprint = a.id; document.getElementById('ai-sprint').value = a.id; syncSprintLock();"));
  assert.ok(!html.includes('o card ficou fora da sprint'));
});

test('sprint travada no card novo avisa no rótulo que o responsável é obrigatório', () => {
  assert.ok(html.includes("'Responsável (obrigatório na sprint)' : 'Responsável'"));
});

test('pessoa única: "quem sou eu" cai no nome do cadastro, administrador entra na equipe com um clique e o renome leva os cards', () => {
  for (const k of ['return { names: [Auth.getName()], roles: [], linked: false, viaConta: true };', 'function linkHint()', 'MyWork.joinTeam()', "'</b></div>' + MyWork.linkHint() + kp", 'async function joinTeam(projectId)', 'return setProjectAccess(session.user.id, projectId, true);', 'function renamePerson(oldName, newName)', 'Agile.renamePerson(oldName, name)', 'return track(client.from(\'team_members\').upsert(']) assert.ok(html.includes(k), k);
});

test('a gestão escolhe o que aparece no cartão: código, tipo, pontos, responsável, sprint, prazo, bugs ligados, anexos e tarefas', () => {
  for (const k of ["const DEFAULT_CARD = { id: true, kind: true, points: true, assignee: true, sprint: true, bugs: true, attachments: true, checklist: true, due: true };", "['due', 'Prazo (até quando)'], ['bugs', 'Bugs ligados'], ['attachments', 'Anexos'], ['checklist', 'Tarefas do cartão']", 'const bottom = [f.bugs && rel, f.attachments && att, f.checklist && chk, f.assignee &&', 'f.due && dueChip']) assert.ok(html.includes(k), k);
  assert.ok(html.includes('data-perm="manage_backlog" onclick="Agile.openBoardCfg()"'));
});

test('Bússola é a porta única da IA: ferramentas por permissão, botão para quem tem alguma, modo documentos responde dentro dela e a consulta dos Arquivos passa por ela', () => {
  const m = html.match(/<script data-module="ui\/compass">([\s\S]*?)<\/script>/)[1].replace(/\r\n/g, '\n');
  for (const k of ["{ id: 'proj'", "{ id: 'docs'", "{ id: 'xray'", "{ id: 'estimate'", "{ id: 'models'", "{ id: 'whatif'", 'const tools = () => TOOLS.filter', 'function paint()', 'async function askDocs(q)', "kind: 'aid'", 'function askDocsFrom(q)', "if(mode === 'docs')"]) assert.ok(m.includes(k), k);
  for (const k of ['id="tb-compass"', 'id="cp-tools"', "Compass.paint) Compass.paint();", "onclick=\"Compass.askDocsFrom(document.getElementById('repo-search').value)\""]) assert.ok(html.includes(k), k);
  assert.ok(!html.includes('data-perm="ask_compass" onclick="Compass.open()"'));
});

test('Bússola: trocar de modo começa conversa nova', () => {
  assert.ok(html.includes('function setMode(m) { if(m !== mode) items = [];'));
});

test('os blocos Gestão do Projeto e Quadros / Kanban têm fundo mais escuro que o resto do menu', () => {
  for (const k of ['.sidebar{--sb-dark:70%}', 'html[data-theme="light"] .sidebar{--sb-dark:93%}', '#sbg-quadros{background:color-mix(in srgb,var(--s1) var(--sb-dark,70%),#000)', '.sb-proj-area{display:flex;flex-direction:column;gap:1px;background:color-mix(in srgb,var(--s1) var(--sb-dark,70%),#000)']) assert.ok(html.includes(k), k);
});

test('projeto ou quadro selecionado no menu fica em destaque: fonte maior, negrito, cor da marca e marcador', () => {
  for (const k of ['.si.proj-active{color:var(--acc);background:color-mix(in srgb,var(--acc) 20%,transparent);font-size:14px;font-weight:700', '.si.proj-active::after{content:']) assert.ok(html.includes(k), k);
});
