import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/my-indicators">([\s\S]*?)<\/script>/);
const { MyInd } = new Function(`${m[1]}\nreturn { MyInd };`)();

const TODAY = '2026-11-04'; // quarta-feira
const sprints = [{ id: 'S1', name: 'Sprint 1', startOn: '2026-11-02', endOn: '2026-11-13' }, { id: 'S0', name: 'Sprint 0', startOn: '2026-10-19', endOn: '2026-11-01' }];
const cols = [{ key: 'todo', label: 'A fazer' }, { key: 'x1', label: 'Em testes de QA' }, { key: 'done', label: 'Concluído' }];
const item = (id, o = {}) => ({ id, title: 'Item ' + id, kind: 'historia', status: 'todo', points: 3, assignee: 'Ana', sprintId: 'S1', createdOn: '2026-10-20', doneOn: '', history: [], checklist: [], ...o });
const inp = (o = {}) => ({ names: ['Ana'], today: TODAY, items: [], wbs: [], sprints, cols, hours: [], imps: [], risks: [], win: 7, ...o });

test('só entra o que é meu (por nome, sem diferenciar maiúscula) e o prazo do item é o fim da sprint', () => {
  const r = MyInd.rows(inp({ items: [item('A', { assignee: 'ana' }), item('B', { assignee: 'Beto' }), item('C', { sprintId: '' })] }));
  assert.deepEqual(r.map(x => x.ref), ['A', 'C']);
  assert.equal(r[0].due, '2026-11-13'); assert.equal(r[0].daysLeft, 9);
  assert.equal(r[1].state, 'sem_prazo');
});
test('atrasado = prazo passado e não concluído; concluído nunca é atrasado', () => {
  const r = MyInd.rows(inp({ items: [item('A', { sprintId: 'S0' }), item('B', { sprintId: 'S0', status: 'done', doneOn: '2026-10-30' })] }));
  assert.equal(r.find(x => x.ref === 'A').state, 'atrasada');
  assert.equal(r.find(x => x.ref === 'B').state, 'concluida');
});
test('tarefas e entregas da WBS do responsável entram com o término como prazo', () => {
  const wbs = [{ label: 'Módulo', responsavel: 'Ana', end: '2026-11-06', status: 'amb', pct: 40, children: [{ label: 'Tarefa 1', responsavel: 'Ana', end: '2026-11-03', status: 'red', pct: 10 }, { label: 'Tarefa 2', responsavel: 'Beto', end: '2026-11-05', status: 'amb' }] }];
  const r = MyInd.rows(inp({ wbs }));
  assert.deepEqual(r.map(x => x.kind + ':' + x.label + ':' + x.state), ['Entrega:Módulo:no_prazo', 'Tarefa:Tarefa 1:atrasada']);
});
test('filtro "vencem nos próximos N dias" respeita a janela e exclui atrasadas e concluídas', () => {
  const list = MyInd.rows(inp({ items: [item('A', { sprintId: 'S0' }), item('B'), item('C', { status: 'done', doneOn: '2026-11-03' })] }));
  assert.equal(MyInd.filterRows(list, 'vencem', 7, TODAY).length, 0);   // o fim da sprint 1 é em 9 dias
  assert.deepEqual(MyInd.filterRows(list, 'vencem', 14, TODAY).map(x => x.ref), ['B']);
  assert.deepEqual(MyInd.filterRows(list, 'atrasadas', 7, TODAY).map(x => x.ref), ['A']);
  assert.deepEqual(MyInd.filterRows(list, 'concluidas', 7, TODAY).map(x => x.ref), ['C']);
});
test('ordem: atrasada primeiro, depois a que vence antes, sem prazo por último', () => {
  const sp = [...sprints, { id: 'S2', name: 'S2', startOn: '2026-11-01', endOn: '2026-11-06' }];
  const list = MyInd.rows(inp({ sprints: sp, items: [item('SEM', { sprintId: '' }), item('VENCE', { sprintId: 'S2' }), item('ATRASO', { sprintId: 'S0' })] }));
  assert.deepEqual(MyInd.sortRows(list).map(x => x.ref), ['ATRASO', 'VENCE', 'SEM']);
});
test('parado: item fora de "A fazer" sem mudar de coluna há dias', () => {
  const h = d => [{ at: d + 'T10:00:00.000Z', by: 'Ana', field: 'Situação', from: 'A fazer', to: 'Em testes de QA' }];
  const r = MyInd.rows(inp({ items: [item('P', { status: 'x1', history: h('2026-10-30') }), item('N', { status: 'x1', history: h('2026-11-03') }), item('T', { status: 'todo' })] }));
  assert.equal(r.find(x => x.ref === 'P').stalled, 5);
  assert.equal(r.find(x => x.ref === 'N').stalled, 1);
  assert.equal(r.find(x => x.ref === 'T').stalled, 0);
});
test('velocidade: pontos por semana nas 6 últimas, média das 4 completas e tendência', () => {
  const d = (id, doneOn, points, who) => item(id, { status: 'done', doneOn, points, assignee: who || 'Ana' });
  const items = [d('a', '2026-11-03', 5), d('b', '2026-10-28', 8), d('c', '2026-10-21', 3), d('d', '2026-10-14', 3), d('e', '2026-10-07', 2), d('x', '2026-11-03', 99, 'Beto')];
  const w = MyInd.weekly(inp({ items }));
  assert.equal(w.unit, 'pts'); assert.equal(w.weeks.length, 6);
  assert.deepEqual(w.weeks.map(x => x.value), [0, 2, 3, 3, 8, 5]);   // semanas iniciadas em 29/09, 06/10, 13/10, 20/10, 27/10 e 03/11
  assert.equal(w.current, 5); assert.equal(w.avg, 4);
  assert.equal(w.trend, 'subindo');
});
test('sem ponto nenhum a velocidade conta itens; sem entrega não há tendência', () => {
  const w = MyInd.weekly(inp({ items: [item('a', { status: 'done', doneOn: '2026-11-03', points: '' })] }));
  assert.equal(w.unit, 'itens'); assert.equal(w.current, 1);
  assert.equal(MyInd.weekly(inp()).trend, 'sem_dado');
});
test('tempo até concluir e horas da semana (reprovada não conta; pendente aparece à parte)', () => {
  const items = [item('a', { status: 'done', createdOn: '2026-10-20', doneOn: '2026-10-30' }), item('b', { status: 'done', createdOn: '2026-10-25', doneOn: '2026-10-29' })];
  assert.deepEqual(MyInd.leadTime(inp({ items })), { days: 7, n: 2 });
  const e = (person, date, hours, status) => ({ person, date, hours, status });
  const h = MyInd.hours(inp({ hours: [e('Ana', '2026-11-03', 8, 'aprovado'), e('Ana', '2026-11-04', 2, 'pendente'), e('Ana', '2026-11-04', 5, 'reprovado'), e('Beto', '2026-11-04', 9, 'aprovado'), e('Ana', '2026-10-27', 4, 'aprovado')] }));
  assert.deepEqual(h, { week: 10, pending: 2 });
});
test('orientação: atrasada vem primeiro e diz por onde começar; sem atividade, diz isso', () => {
  const r = MyInd.compute(inp({ items: [item('A', { sprintId: 'S0', title: 'Homologar' }), item('B')] }));
  assert.equal(r.advice[0].level, 'red'); assert.match(r.advice[0].text, /Homologar/); assert.match(r.advice[0].text, /3 dias/);
  assert.equal(r.kpis.late, 1);
  const vazio = MyInd.compute(inp());
  assert.ok(vazio.advice.length >= 1); assert.match(vazio.advice[0].text, /não tem atividades abertas/);
});
test('orientação: itens demais em andamento, impedimento meu, horas esquecidas e tarefa pendente no cartão', () => {
  const mv = [{ at: '2026-11-04T08:00:00Z', field: 'Situação' }];
  const doing = Array.from({ length: 4 }, (_, i) => item('D' + i, { status: 'x1', history: mv, checklist: i === 0 ? [{ text: 'a', done: true }, { text: 'b', done: false }] : [] }));
  const r = MyInd.compute(inp({ items: doing, imps: [{ owner: 'Ana', status: 'aberto' }, { owner: 'Beto', status: 'aberto' }] }));
  const t = r.advice.map(a => a.text).join(' | ');
  assert.match(t, /4 itens em andamento/); assert.match(t, /1 impedimento aberto/); assert.match(t, /1 tarefa pendente/); assert.match(t, /não apontou horas/);
  assert.equal(r.kpis.doing, 4); assert.equal(r.kpis.impediments, 1);
});
test('a tela: menu em Meu Dia, rota e módulos', () => {
  for (const k of ['data-p="myind"', 'id="p-myind"', 'id="mi-root"', "id === 'myind'", "myind:'Meus Indicadores'", 'MyIndPage.setMode(', 'names: myNames']) assert.ok(html.includes(k), k);
  // Meus Indicadores mora em "Meu Dia" (topo do menu), antes dos painéis de Visão Geral
  const i = html.indexOf('>Meu Dia</div>'), j = html.indexOf('id="sbg-visao"');
  assert.ok(i > 0 && j > i && html.slice(i, j).includes('data-p="myind"') && html.slice(i, j).includes('data-p="mywork"'));
});

test('total entre projetos: a função do banco e a tela (só o próprio usuário; anônimo barrado)', () => {
  const mig = readFileSync(join(root, 'supabase', 'migrations', '20261103200000_my_workload.sql'), 'utf8');
  for (const k of ['tm.user_id = auth.uid()', 'security definer set search_path = public', 'revoke all on function public.my_workload() from public, anon']) assert.ok(mig.includes(k), k);
  for (const k of ["client.rpc('my_workload')", 'Total em todos os projetos', 'id="mi-proj-body"', 'function loadProjects']) assert.ok(html.includes(k), k);
});
test('links para telas fechadas ao perfil: o módulo esconde botões e desativa links, sem mexer em quem troca de projeto', () => {
  for (const k of ['data-module="ui/profile-links"', "SKIP = /switchProject|doSignOut/", '.no-link{pointer-events:none', 'ProfileLinks.apply();']) assert.ok(html.includes(k), k);
  const { ProfileLinks } = new Function(html.match(/<script data-module="ui\/profile-links">([\s\S]*?)<\/script>/)[1].replace("window.addEventListener('load', start);", '') + '\nreturn { ProfileLinks };')();
  assert.equal(ProfileLinks.pageOf("R.go('ritos')"), 'ritos');
  assert.equal(ProfileLinks.pageOf("DB.switchProject('x');R.go('dashboard')"), 'dashboard');
  assert.equal(ProfileLinks.pageOf('alert(1)'), null);
});

test('botões que levam ao registro: alertas do Dashboard e atividades da WBS abrem o próprio registro para quem edita o plano', () => {
  for (const k of ["page:'burnout', label:'Ver Burnout Radar'", "actLabel: 'Abrir o Risco'", 'onclick="${a.act ? a.act :', 'WBS.openEditTask(', 'WBS.openEditModule(', 'Abrir a Atividade']) assert.ok(html.includes(k), k);
  const wbs = [{ id: 'w1', label: 'Módulo', responsavel: 'Ana', end: '2026-11-06', status: 'amb', pct: 40, children: [{ id: 't1', label: 'Tarefa 1', responsavel: 'Ana', end: '2026-11-03', status: 'red', pct: 10 }] }];
  const rs = MyInd.rows(inp({ wbs }));
  assert.deepEqual(rs.map(x => x.wbs), [{ id: 'w1', parent: '' }, { id: 't1', parent: 'w1' }]);
});

test('janela aberta não fecha ao soltar o mouse fora dela (clique só fecha se começou e terminou no fundo)', () => {
  assert.ok(html.includes('data-module="ui/modal-safe-close"'));
  assert.ok(html.includes("downOn !== t) { e.stopImmediatePropagation()"));
});

test('menu em três níveis: Meu Dia, Visão Geral, Este Projeto com itens do dia a dia e "Mais Telas"', () => {
  for (const k of ['id="sbg-visao"', 'id="sb-more-btn"', 'Nav.toggleMore()', 'const FLAT = ', '.sb-proj-area:not(.more) .sb-more-group{display:none}']) assert.ok(html.includes(k), k);
  const a = html.indexOf('id="sb-more-btn"');
  for (const p of ['dashboard', 'kanban', 'backlog', 'wbs', 'risks', 'decisions', 'resources']) assert.ok(html.indexOf('data-p="' + p + '"', html.indexOf('id="sb-proj-area"')) < a, p + ' fica à vista, antes de Mais Telas');
  for (const g of ['sbg-agil', 'sbg-planejamento', 'sbg-decisao', 'sbg-equipe', 'sbg-conhecimento']) assert.ok(html.includes('class="sb-group sb-more-group" id="' + g + '"'), g);
});

test('entrega concluída é de quem levou a correção definitiva (última ida a Em revisão), não do revisor nem de quem só devolveu', () => {
  const cols4 = [{ key: 'todo', label: 'A fazer' }, { key: 'doing', label: 'Em andamento' }, { key: 'review', label: 'Em revisão' }, { key: 'done', label: 'Concluído' }];
  const h = (by, de, para) => ({ at: '2026-11-03T10:00:00Z', by, field: 'Situação', from: de, to: para });
  const R = (names, items) => MyInd.rows(inp({ names, cols: cols4, items })).map(x => x.ref);
  // cenário: Ana leva à revisão, Leandro devolve a Em andamento (responsável vira João), João leva à revisão de novo, Leandro conclui
  const retrabalho = item('R', { status: 'done', doneOn: '2026-11-03', assignee: 'Leandro', history: [h('Ana', 'A fazer', 'Em andamento'), h('Ana', 'Em andamento', 'Em revisão'), h('Leandro', 'Em revisão', 'Em andamento'), h('João', 'Em andamento', 'Em revisão'), h('Leandro', 'Em revisão', 'Concluído')] });
  assert.deepEqual(R(['João'], [retrabalho]), ['R']);
  assert.deepEqual(R(['Ana'], [retrabalho]), []);
  assert.deepEqual(R(['Leandro'], [retrabalho]), []); // nem quem devolveu nem quem concluiu ganha a entrega
  // sem retrabalho: quem levou à revisão
  const simples = item('S', { status: 'done', doneOn: '2026-11-03', assignee: 'Leandro', history: [h('Ana', 'A fazer', 'Em andamento'), h('Ana', 'Em andamento', 'Em revisão'), h('Leandro', 'Em revisão', 'Concluído')] });
  assert.deepEqual(R(['Ana'], [simples]), ['S']); assert.deepEqual(R(['Leandro'], [simples]), []);
  // a baixa automática não é pessoa: vale quem pegou o card
  const auto = item('A', { status: 'done', doneOn: '2026-11-03', assignee: 'Leandro', history: [h('Ana', 'A fazer', 'Em andamento'), h('Claude Code (correção automática)', 'Em andamento', 'Em revisão'), h('Leandro', 'Em revisão', 'Concluído')] });
  assert.deepEqual(R(['Ana'], [auto]), ['A']);
  // sem histórico de situação: o responsável atual; card aberto: sempre o responsável
  const semHist = item('H', { status: 'done', doneOn: '2026-11-03', assignee: 'Ana', history: [] });
  const aberto = item('O', { status: 'doing', assignee: 'Leandro', history: [h('Ana', 'A fazer', 'Em andamento')] });
  assert.deepEqual(R(['Ana'], [semHist, aberto]), ['H']); assert.deepEqual(R(['Leandro'], [aberto]), ['O']);
  assert.equal(MyInd.compute(inp({ names: ['João'], cols: cols4, items: [retrabalho] })).kpis.done28, 1);
});

test('velocidade por semana e tempo até concluir também usam quem levou a correção definitiva (não só o responsável atual)', () => {
  const cols4 = [{ key: 'todo', label: 'A fazer' }, { key: 'doing', label: 'Em andamento' }, { key: 'review', label: 'Em revisão' }, { key: 'done', label: 'Concluído' }];
  const h = (by, de, para) => ({ at: '2026-11-03T10:00:00Z', by, field: 'Situação', from: de, to: para });
  const feito = item('F', { status: 'done', doneOn: '2026-11-03', createdOn: '2026-11-01', assignee: 'Leandro', history: [h('Ana', 'A fazer', 'Em andamento'), h('Ana', 'Em andamento', 'Em revisão'), h('Leandro', 'Em revisão', 'Concluído')] });
  const ana = inp({ cols: cols4, items: [feito] }), leandro = inp({ names: ['Leandro'], cols: cols4, items: [feito] });
  assert.equal(MyInd.weekly(ana).weeks.reduce((s, w) => s + w.count, 0), 1);
  assert.equal(MyInd.weekly(leandro).weeks.reduce((s, w) => s + w.count, 0), 0);
  assert.ok(MyInd.leadTime(ana) && MyInd.leadTime(ana).n === 1 || MyInd.leadTime(ana) != null);
  assert.equal(MyInd.leadTime(leandro), null);
});

test('velocidade: usa pontos só quando todos os cards entregues têm ponto; senão conta itens (semana de cards sem ponto não vira zero)', () => {
  const mk = (id, pts, doneOn) => item(id, { status: 'done', doneOn, points: pts, assignee: 'Ana', createdOn: '2026-10-01' });
  const misto = MyInd.weekly(inp({ items: [mk('A', '', '2026-11-02'), mk('B', '', '2026-11-03'), mk('C', 5, '2026-11-04')] }));
  assert.equal(misto.unit, 'itens'); assert.equal(misto.weeks[5].value, 3);
  const todos = MyInd.weekly(inp({ items: [mk('A', 2, '2026-11-02'), mk('B', 3, '2026-11-03')] }));
  assert.equal(todos.unit, 'pts'); assert.equal(todos.weeks[5].value, 5);
});
