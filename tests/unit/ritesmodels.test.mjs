import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
const load = (name, exports) => { const m = html.match(new RegExp(`<script data-module="${name.replace('/', '\\/')}">([\\s\\S]*?)<\\/script>`)); return new Function(`${m[1]}\nreturn { ${exports} };`)(); };
const { AgileCalc } = load('services/agile-calc', 'AgileCalc');
const { AgileRites } = load('services/agile-rites', 'AgileRites');
const { ModelsCalc } = load('services/models-calc', 'ModelsCalc');

// ── Colunas do quadro ──
test('quadro padrão tem 4 colunas; todo é sempre a primeira e done a última', () => {
  assert.deepEqual(AgileCalc.cols(null).map(c => c.key), ['todo', 'doing', 'review', 'done']);
  const custom = AgileCalc.cols({ columns: [{ key: 'done', label: 'Pronto' }, { key: 'x1', label: 'Em teste' }, { key: 'todo', label: 'Fila' }, { key: 'doing', label: 'Fazendo' }] });
  assert.deepEqual(custom.map(c => c.key), ['todo', 'x1', 'doing', 'done']); // as do meio seguem a ordem que o usuário definiu
  assert.equal(custom[0].label, 'Fila'); assert.equal(custom[3].label, 'Pronto');
});

test('quadro inválido volta ao padrão e colunas do meio são limitadas a 5', () => {
  assert.deepEqual(AgileCalc.cols({ columns: [{ key: 'a', label: 'A' }] }).map(c => c.key), ['todo', 'doing', 'review', 'done']);
  assert.deepEqual(AgileCalc.cols({ columns: [{ key: 'todo', label: 'T' }, { key: 'Chave Inválida!', label: 'X' }, { key: 'todo', label: 'repetida' }, { key: 'done', label: 'D' }] }).map(c => c.key), ['todo', 'done']);
  const many = [{ key: 'todo', label: 'T' }, ...Array.from({ length: 9 }, (_, i) => ({ key: 'x' + i, label: 'C' + i })), { key: 'done', label: 'D' }];
  assert.equal(AgileCalc.cols({ columns: many }).length, 7);
});

test('limite WIP e vizinhança seguem as colunas personalizadas', () => {
  const cfg = AgileCalc.cfgOf({ columns: [{ key: 'todo', label: 'T' }, { key: 'x1', label: 'Teste' }, { key: 'done', label: 'D' }], wip: { x1: 1 } });
  const w = AgileCalc.wip([{ status: 'x1' }, { status: 'x1' }, { status: 'done' }], cfg);
  assert.deepEqual(w.map(c => c.key), ['todo', 'x1', 'done']);
  assert.equal(w.find(c => c.key === 'x1').over, true);
  assert.equal(AgileCalc.neighbor('x1', 1, cfg), 'done'); assert.equal(AgileCalc.neighbor('x1', -1, cfg), 'todo'); assert.equal(AgileCalc.neighbor('done', 1, cfg), null);
  assert.equal(AgileCalc.colLabel(cfg, 'x1'), 'Teste'); assert.equal(AgileCalc.colLabel(cfg, 'sumiu'), 'A fazer');
  assert.deepEqual(cfg.card, { id: true, kind: true, points: true, assignee: true, sprint: true, bugs: true, attachments: true, checklist: true, due: true });
});

// ── Ritos ──
const sprint = { id: 'S1', name: 'Sprint 1', startOn: '2026-06-01', endOn: '2026-06-28', state: 'ativa' }; // 4 semanas
test('duração máxima segue o Guia do Scrum (sprint de 4 semanas) e é proporcional em sprints menores', () => {
  const m = k => AgileRites.minutes(AgileRites.RITES.find(r => r.kind === k), sprint);
  assert.equal(m('planejamento'), 8 * 60); assert.equal(m('revisao'), 4 * 60); assert.equal(m('retrospectiva'), 3 * 60); assert.equal(m('daily'), 15);
  const duas = { ...sprint, endOn: '2026-06-14' };
  assert.equal(AgileRites.minutes(AgileRites.RITES.find(r => r.kind === 'planejamento'), duas), 4 * 60);
  assert.equal(AgileRites.fmtDuration(8 * 60), '8 h'); assert.equal(AgileRites.fmtDuration(45), '45 min'); assert.equal(AgileRites.fmtDuration(90), '1 h 30 min');
});

test('estado dos ritos: planejamento vale se a sprint começou; diária mostra impedimentos; revisão e retro dependem de registro', () => {
  const imp = [{ id: 'I1', status: 'aberto', sprintId: 'S1' }, { id: 'I2', status: 'resolvido', sprintId: 'S1' }];
  const st = AgileRites.status(sprint, [{ sprintId: 'S1', kind: 'revisao', heldOn: '2026-06-28' }], imp);
  const by = k => st.find(x => x.kind === k);
  assert.equal(by('planejamento').state, 'feito'); assert.equal(by('daily').state, 'atencao'); assert.match(by('daily').note, /1 impedimento/);
  assert.equal(by('revisao').state, 'feito'); assert.equal(by('retrospectiva').state, 'pendente'); assert.equal(by('refinamento').state, 'continuo');
  assert.equal(AgileRites.status({ ...sprint, state: 'planejada' }, [], []).find(x => x.kind === 'planejamento').state, 'pendente');
  assert.equal(AgileRites.status(sprint, [], []).find(x => x.kind === 'daily').state, 'continuo');
});

test('ações da retrospectiva anterior em aberto reaparecem na retro seguinte', () => {
  const sprints = [{ id: 'S0', name: 'Sprint 0', startOn: '2026-05-01' }, sprint];
  const rites = [{ id: 'R0', sprintId: 'S0', kind: 'retrospectiva', data: { actions: [{ id: 'a', text: 'Antecipar GPS', done: false }, { id: 'b', text: 'Já feito', done: true }] } }];
  const p = AgileRites.pendingActions(sprint, sprints, rites);
  assert.equal(p.length, 1); assert.equal(p[0].text, 'Antecipar GPS'); assert.equal(p[0].fromSprint, 'Sprint 0'); assert.equal(p[0].riteId, 'R0');
});

test('resumo da revisão e saneamento da retrospectiva', () => {
  const items = [{ sprintId: 'S1', status: 'done', points: 5 }, { sprintId: 'S1', status: 'doing', points: 3 }, { sprintId: 'S2', status: 'done', points: 8 }];
  const r = AgileRites.reviewSummary(sprint, items);
  assert.equal(r.delivered.length, 1); assert.equal(r.points, 5); assert.equal(r.committed, 8); assert.equal(r.pct, 50);
  const d = AgileRites.normalizeRetro({ well: [{ text: '  bom  ', votes: 500 }, { text: '' }], improve: 'lixo', actions: [{ text: 'agir', due: 'amanhã', done: 1 }, { text: '' }] });
  assert.deepEqual(d.well, [{ text: 'bom', votes: 99 }]); assert.deepEqual(d.improve, []);
  assert.equal(d.actions.length, 1); assert.equal(d.actions[0].due, ''); assert.equal(d.actions[0].done, true);
});

// ── Modelos ──
test('cada modelo nasce com conteúdo inicial no formato certo', () => {
  assert.deepEqual(ModelsCalc.ORDER.sort(), ['5w2h', 'comunicacao', 'cutover', 'handover', 'swot']);
  assert.equal(ModelsCalc.create('5w2h').rows.length, 1);
  assert.ok(ModelsCalc.create('cutover').rows.length >= 6);
  assert.deepEqual(Object.keys(ModelsCalc.create('swot').lists), ['forcas', 'fraquezas', 'oportunidades', 'ameacas']);
  const h = ModelsCalc.create('handover'); assert.equal(Object.keys(h.sections).length, 7); assert.ok(h.sections.docs.items.length >= 3);
  assert.equal(ModelsCalc.create('inexistente'), null);
});

test('saneamento: valores fora do formato são corrigidos e o tamanho é limitado', () => {
  const s = ModelsCalc.sanitize('cutover', { rows: [{ activity: ' Migrar ', minutes: '-5', status: 'qualquer', start: '2026-06-01T22:00' }, { activity: 'x'.repeat(900), minutes: 'abc', start: 'ontem' }] });
  assert.equal(s.rows[0].activity, 'Migrar'); assert.equal(s.rows[0].minutes, 0); assert.equal(s.rows[0].status, 'pendente'); assert.equal(s.rows[0].start, '2026-06-01T22:00');
  assert.equal(s.rows[1].activity.length, 300); assert.equal(s.rows[1].minutes, 0); assert.equal(s.rows[1].start, '');
  assert.equal(ModelsCalc.sanitize('5w2h', { rows: Array.from({ length: 500 }, () => ({})) }).rows.length, 200);
  const sw = ModelsCalc.sanitize('swot', { lists: { forcas: ['  a ', '', 'b'], ameacas: 'lixo' } });
  assert.deepEqual(sw.lists.forcas, ['a', 'b']); assert.deepEqual(sw.lists.ameacas, []);
});

test('andamento do cutover e do handover', () => {
  const c = ModelsCalc.create('cutover'); c.rows[0].status = 'concluido'; c.rows[1].status = 'concluido';
  const p = ModelsCalc.progress('cutover', c); assert.equal(p.done, 2); assert.equal(p.total, c.rows.length);
  const h = ModelsCalc.create('handover'); h.sections.escopo.items[0].done = true;
  const ph = ModelsCalc.progress('handover', h); assert.equal(ph.done, 1); assert.ok(ph.total > 10);
  assert.equal(ModelsCalc.progress('swot', ModelsCalc.create('swot')), null);
});

test('exportação em Excel tem cabeçalho e linhas legíveis', () => {
  const c = ModelsCalc.create('cutover'); c.rows[0].status = 'concluido';
  const rows = ModelsCalc.excelRows('cutover', { data: c });
  assert.equal(rows[0][0], 'Atividade'); assert.equal(rows[1][4], 'Concluído');
  const sw = ModelsCalc.create('swot'); sw.lists.forcas = ['Time unido', 'Cliente engajado']; sw.lists.ameacas = ['Prazo curto'];
  const r = ModelsCalc.excelRows('swot', { data: sw }); assert.equal(r[0].length, 4); assert.equal(r.length, 3); assert.equal(r[2][0], 'Cliente engajado');
  const h = ModelsCalc.create('handover'); assert.equal(ModelsCalc.excelRows('handover', { data: h })[0][0], 'Seção');
});
