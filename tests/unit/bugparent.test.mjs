import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const load = (name, exports) => { const m = html.match(new RegExp(`<script data-module="${name.replace('/', '\\/')}">([\\s\\S]*?)<\\/script>`)); return new Function(`${m[1]}\nreturn { ${exports} };`)(); };
const { AgileCalc } = load('services/agile-calc', 'AgileCalc');
const { SheetParse, SheetImport } = load('services/sheet-import', 'SheetParse, SheetImport');

const items = [{ id: 'US-1', kind: 'historia', title: 'Cadastro' }, { id: 'US-2', kind: 'bug', title: 'Erro', parentId: 'US-1' }, { id: 'US-3', kind: 'tarefa', title: 'Tarefa' }];

test('todo bug precisa de um item pai que exista e não seja outro bug', () => {
  assert.equal(AgileCalc.bugParentError({ id: 'N', kind: 'historia' }, items), '');
  assert.match(AgileCalc.bugParentError({ id: 'N', kind: 'bug' }, items), /precisa estar ligado/);
  assert.match(AgileCalc.bugParentError({ id: 'N', kind: 'bug', parentId: 'NAO' }, items), /não existe/);
  assert.match(AgileCalc.bugParentError({ id: 'N', kind: 'bug', parentId: 'US-2' }, items), /outro bug/);
  assert.match(AgileCalc.bugParentError({ id: 'US-9', kind: 'bug', parentId: 'US-9' }, [...items, { id: 'US-9', kind: 'historia' }]), /dele mesmo/);
  assert.equal(AgileCalc.bugParentError({ id: 'N', kind: 'bug', parentId: 'US-3' }, items), '');
});

test('bugs de um item e opções de item pai (nunca um bug, nunca o próprio item)', () => {
  assert.deepEqual(AgileCalc.bugsOf(items, 'US-1').map(x => x.id), ['US-2']);
  assert.deepEqual(AgileCalc.parentOptions(items, 'US-1').map(x => x.id), ['US-3']);
});

test('importação: bug sem item pai é recusado; com pai existente ou da própria planilha entra', () => {
  const map = { title: 0, kind: 1, parent: 2 };
  const rows = [['Nova história', 'História', ''], ['Bug ligado à história da planilha', 'Bug', 'Nova história'], ['Bug ligado ao item existente', 'Bug', 'US-1'], ['Bug solto', 'Bug', ''], ['Bug de pai inexistente', 'Bug', 'Fantasma'], ['Bug filho de bug', 'Bug', 'Erro']];
  const r = SheetImport.build('backlog', rows, map, { existingTitles: [], existingItems: items, sprints: [] }, 0);
  const titles = r.rows.map(x => x.title);
  assert.deepEqual(titles.sort(), ['Bug ligado ao item existente', 'Bug ligado à história da planilha', 'Nova história'].sort());
  assert.equal(r.rows.find(x => x.title === 'Bug ligado ao item existente').parentId, 'US-1');
  assert.equal(r.rows.find(x => x.title === 'Bug ligado à história da planilha').parentTitle, 'Nova história');
  assert.equal(r.errors.length, 3);
  assert.ok(r.errors.some(e => /falta o item pai/.test(e.msg || e.message || JSON.stringify(e))));
});

test('o banco aplica a mesma regra e o app mostra o bug como filho', () => {
  const sql = readFileSync(join(root, 'supabase', 'migrations', '20261101170000_bug_parent.sql'), 'utf8');
  for (const k of ['guard_bug_parent', 'Todo bug precisa estar ligado', 'filho de outro bug', "old.kind = 'bug' and new.parent_id is not distinct from old.parent_id"]) assert.ok(sql.includes(k), k);
  for (const k of ['Agile.openBugFor', 'ai-parent', 'parent_id:(x.kind', 'Abrir um Bug Neste Item']) assert.ok(html.includes(k), k);
});

test('sprints: história do que foi entregue e devolvido, e troca de sprint sem engessar', () => {
  const sql = readFileSync(join(root, 'supabase', 'migrations', '20261101180000_sprint_history.sql'), 'utf8');
  assert.match(sql, /carried jsonb/);
  for (const k of ['kb-sprint-bar', 'Nenhuma sprint ativa', 'O que esta sprint entregou', 'devolvido ao backlog', 'encerra a sprint ativa']) assert.ok(html.includes(k), k);
});

test('como os itens entram no quadro: Scrum por padrão, Kanban contínuo só quando escolhido', () => {
  assert.equal(AgileCalc.cfgOf(null).entry, 'scrum');
  assert.equal(AgileCalc.cfgOf({}).entry, 'scrum');
  assert.equal(AgileCalc.cfgOf({ entry: 'kanban' }).entry, 'kanban');
  assert.equal(AgileCalc.cfgOf({ entry: 'qualquer' }).entry, 'scrum');
  for (const k of ['ab-entry', 'Item Urgente na Sprint', 'mudança de escopo', 'Ir ao Backlog', 'si-signout', 'Sair / Trocar Usuário']) assert.ok(html.includes(k), k);
});

test('relatar um bug: exige a entrega pai, monta a descrição estruturada e respeita o limite do banco', () => {
  const m = html.match(/<script data-module="ui\/bugreport">([\s\S]*?)<\/script>/);
  const BugReport = new Function('document', 'window', 'Agile', 'Cloud', 'T', 'DB', 'Auth', 'BRAND', m[1] + '\nreturn BugReport;')({ getElementById: () => null, querySelector: () => null, addEventListener: () => {} }, { addEventListener: () => {}, innerWidth: 1280, innerHeight: 900 }, {}, {}, {}, {}, {}, { version: '9.9.9' });
  const ok = { parentId: 'US-1', title: 'Importar não abre', severity: 'atrapalha', path: 'Kanban → Importar', steps: '1) Abri 2) Cliquei', expected: 'Abrir a janela', actual: 'Nada abriu', context: 'v9.9.9' };
  assert.equal(BugReport.validate(ok), '');
  assert.match(BugReport.validate({ ...ok, parentId: '' }), /entrega/);
  assert.match(BugReport.validate({ ...ok, title: 'ab' }), /resumo/i);
  assert.match(BugReport.validate({ ...ok, steps: 'curto' }), /passo a passo/);
  assert.match(BugReport.validate({ ...ok, actual: '' }), /aconteceu/);
  const d = BugReport.buildDescription(ok);
  for (const k of ['Caminho no sistema: Kanban → Importar', 'O que foi feito (passo a passo):', '1) Abri 2) Cliquei', 'O que se esperava:', 'O que aconteceu:', 'Contexto: v9.9.9']) assert.ok(d.includes(k), k);
  assert.ok(d.length <= BugReport.MAX_DESC);
  assert.match(BugReport.validate({ ...ok, steps: 'x'.repeat(2100) }), /grande demais/);
  assert.match(BugReport.buildDescription({ ...ok, expected: '' }), /\(não informado\)/);
  const sql = readFileSync(join(root, 'supabase', 'migrations', '20261101190000_item_attachments.sql'), 'utf8');
  for (const k of ['attachments jsonb', "'item-files'", 'has_project_access', 'drop table if exists public.bug_reports']) assert.ok(sql.includes(k), k);
  for (const k of ['Agile.createBug', 'Cloud.uploadItemFile', 'Relatar um Bug']) assert.ok(html.includes(k), k);
});

test('Quadro de tarefas: bug sem item pai é aceito; com pai continua validado', () => {
  const items = [{ id: 'US-1', kind: 'historia' }, { id: 'US-2', kind: 'bug', parentId: 'US-1' }];
  assert.equal(AgileCalc.bugParentError({ id: 'N', kind: 'bug' }, items, { board: true }), '');
  assert.match(AgileCalc.bugParentError({ id: 'N', kind: 'bug' }, items, { board: false }), /precisa estar ligado/);
  assert.match(AgileCalc.bugParentError({ id: 'N', kind: 'bug', parentId: 'NAO' }, items, { board: true }), /não existe/);
  assert.match(AgileCalc.bugParentError({ id: 'N', kind: 'bug', parentId: 'US-2' }, items, { board: true }), /outro bug/);
});

test('responsável: vazio só na primeira coluna; da segunda em diante tem de ser pessoa com acesso ao sistema', () => {
  const cfg = {}, first = AgileCalc.cols(cfg)[0].key, second = AgileCalc.cols(cfg)[1].key, team = ['Ana Souza', 'Bruno'];
  assert.equal(AgileCalc.assigneeError('', first, cfg, team), '');
  assert.match(AgileCalc.assigneeError('', second, cfg, team), /escolha o responsável/);
  assert.match(AgileCalc.assigneeError('Fulano', second, cfg, team), /nome cadastrado/);
  assert.equal(AgileCalc.assigneeError(' ana souza ', second, cfg, team), '');
  assert.match(AgileCalc.assigneeError('Ana Souza', second, cfg, []), /nome cadastrado/);
});

test('banco: a regra do responsável (vazio só na primeira coluna; da segunda em diante, pessoa com conta e acesso ao projeto) tem trava própria', () => {
  const sql = readFileSync(join(root, 'supabase', 'migrations', '20261106120000_item_assignee_rule.sql'), 'utf8');
  for (const k of ['guard_item_assignee', "new.status = 'todo'", 'lower(btrim(tm.name)) = lower(btrim(new.assignee))', 'before insert or update on public.backlog_items', 'o.status is not distinct from new.status']) assert.ok(sql.includes(k), k);
  assert.ok(readFileSync(join(root, 'schema.sql'), 'utf8').includes('guard_item_assignee'));
});

test('banco: o responsável precisa ser colaborador ligado a conta ativa com acesso ao projeto (ou administrador)', () => {
  const sql = readFileSync(join(root, 'supabase', 'migrations', '20261106140000_item_assignee_account.sql'), 'utf8');
  for (const k of ['join public.profiles p on p.id = tm.user_id and p.active', "p.role = 'admin'", 'project_access pa', 'Pessoas e Acesso']) assert.ok(sql.includes(k), k);
});

test('nome antigo do cartão é ligado ao cadastro só quando há uma única pessoa com o mesmo primeiro nome', () => {
  assert.equal(AgileCalc.matchPerson('Ricardo', ['Carla Nogueira', 'Ricardo M']), 'Ricardo M');
  assert.equal(AgileCalc.matchPerson('ricardo', ['Ricardo M', 'Ricardo Souza']), '');
  assert.equal(AgileCalc.matchPerson('Ricardo M', ['Ricardo M']), '');
  assert.equal(AgileCalc.matchPerson('José', ['Jose Alves']), 'Jose Alves');
  assert.equal(AgileCalc.matchPerson('', ['Ana']), '');
});

test('sprint: o item só é atrelado a uma sprint com responsável cadastrado', () => {
  const team = ['Ana Souza'];
  assert.match(AgileCalc.sprintAssigneeError('', team), /escolha antes o responsável/);
  assert.match(AgileCalc.sprintAssigneeError('Fulano', team), /nome cadastrado/);
  assert.equal(AgileCalc.sprintAssigneeError(' ana souza ', team), '');
  const sql = readFileSync(join(root, 'supabase', 'migrations', '20261106160000_item_sprint_needs_assignee.sql'), 'utf8');
  for (const k of ['old.sprint_id is null', 'new.sprint_id is not null', 'entrar numa sprint']) assert.ok(sql.includes(k), k);
});
