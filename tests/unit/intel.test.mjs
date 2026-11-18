import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FUNCS } from '../../supabase/functions/_shared/intel.generated.mjs';
import { INTEL, sourceOf, generate } from '../../scripts/build-intel.mjs';
const html = fs.readFileSync(new URL('../../PMO_Compass_v2.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const input = {
  projects: [{ id: 'p1', name: 'Projeto A', facts: { decisions: { pendingCritical: ['Escolher fornecedor'] }, risks: { top: [{ level: 'crítico', owner: '', title: 'Sem backup' }] }, schedule: { delayedCount: 2, delayed: [{ label: 'Entrega 1', daysLate: 5 }], spi: 0.8 }, scope: { openCount: 1, daysImpact: 6, costImpact: 0 } }, sprint: { etaLate: 3, gap: 4 } }],
  capacity: [{ key: 'ana', name: 'Ana', total: 180, open: 7, plan: { kind: 'capacity', headline: 'Ana é ponto único de falha', steps: ['Priorizar'], mitigate: 'Ampliar equipe', solo: [{ projectName: 'Projeto A' }], cuts: [] } }],
  sysRisks: [], canCosts: false,
};
test('servidor: o código gerado dá o mesmo resultado do módulo do app (paridade)', () => {
  const app = new Function(sourceOf(html, 'services/decision-center') + '\nreturn DecisionCenter;')();
  assert.deepEqual(FUNCS['DecisionCenter.build'](input), app.build(input));
  assert.ok(FUNCS['DecisionCenter.build'](input).length >= 3, 'gerou decisões');
});
test('servidor: só roda o que está na lista fechada e o arquivo gerado está em dia', () => {
  assert.deepEqual(Object.keys(FUNCS), INTEL.flatMap(x => x.funcs.map(f => x.name + '.' + (typeof f === 'string' ? f : f.name))));
  const cur = fs.readFileSync(new URL('../../supabase/functions/_shared/intel.generated.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(cur, generate(), 'rode: node scripts/build-intel.mjs');
});
test('função intel: exige usuário logado, lista fechada, limite de tamanho; sem DOM no código gerado', () => {
  const fn = fs.readFileSync(new URL('../../supabase/functions/intel/index.ts', import.meta.url), 'utf8');
  assert.ok(fn.includes('/auth/v1/user') && fn.includes('hasOwnProperty.call(FUNCS') && fn.includes('MAX_BYTES'));
  const dep = fs.readFileSync(new URL('../../scripts/deploy-functions.mjs', import.meta.url), 'utf8');
  const pub = (dep.match(/const PUBLIC = new Set\(\[([^\]]*)\]\)/) || [])[1] || '';
  assert.ok(pub && pub.indexOf('intel') < 0, 'intel não é pública: o JWT é conferido');
  const gen = fs.readFileSync(new URL('../../supabase/functions/_shared/intel.generated.mjs', import.meta.url), 'utf8');
  assert.ok(!/document\.|window\.|localStorage|\bDB\.|Cloud\./.test(gen), 'módulo puro');
});
test('servidor: plano de capacidade (allocPlan) igual ao do app, nos dois tipos de plano', () => {
  const app = new Function(sourceOf(html, 'services/plan-vs-real') + '\nreturn PlanVsReal;')();
  const rows = [{ projectId: 'a', projectName: 'A', pct: 70, priorityValue: 5, openCards: 4 }, { projectId: 'b', projectName: 'B', pct: 60, priorityValue: 2, openCards: 2 }];
  for (const person of [{ name: 'Ana', total: 130, rows }, { name: 'Ana', total: 130, receivers: 0, rows: rows.map(r => ({ ...r, receivers: 0 })) }, { name: 'Bia', total: 90, rows }]) {
    assert.deepEqual(FUNCS['PlanVsReal.allocPlan'](person), app.allocPlan(person));
  }
  assert.equal(FUNCS['PlanVsReal.allocPlan']({ name: 'Ana', total: 130, receivers: 0, rows }).kind, 'capacity');
});
test('cliente Intel: depois de muitas respostas em sequência a tela ainda recebe o resultado final (sem descartar o último redesenho)', async () => {
  const mod = (html.match(/<script data-module="services\/intel-client">\n?([\s\S]*?)\n?<\/script>/) || [])[1];
  assert.ok(mod, 'módulo encontrado');
  let renders = 0, shown = null;
  const Cloud = { isSignedIn: () => true, invoke: async (name, body) => { await new Promise(r => setTimeout(r, 15)); return { ok: true, result: body.fn === 'P' ? { plan: body.args.n } : ['decisão ' + body.args.plans.length] }; } };
  const T = { show() {} };
  const g = {};
  const MgrPanel = { render() { renders++; const plans = [1, 2, 3, 4, 5, 6, 7, 8].map(n => globalThis.__Intel.get('P', { n }, null)).filter(Boolean); shown = globalThis.__Intel.get('D', { plans }, []); } };
  const Intel = new Function('Cloud', 'T', 'MgrPanel', mod + '\nreturn Intel;')(Cloud, T, MgrPanel);
  globalThis.__Intel = Intel;
  Intel.cfg.debounce = 5; Intel.cfg.window = 400; Intel.cfg.max = 2;
  MgrPanel.render();
  await new Promise(r => setTimeout(r, 2500));
  delete globalThis.__Intel;
  assert.deepEqual(shown, ['decisão 8'], 'mostra o cálculo final com os 8 planos; renders=' + renders);
});
test('servidor: carga do time (WorkloadCalc.all) igual à do app, com e sem evidência', () => {
  const app = new Function(sourceOf(html, 'services/workload') + '\nreturn WorkloadCalc;')();
  const team = [{ id: 'm1', name: 'Ana', allocationPct: 100 }, { id: 'm2', name: 'Bia', allocationPct: 100 }, { id: 'm3', name: 'Caio' }];
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((c, n) => ({ id: 'US-' + n, title: 'Card ' + c, assignee: n < 6 ? 'Ana' : 'Bia', status: n % 2 ? 'doing' : 'todo', points: 3, kind: 'story' }));
  const ctx = { items, sprints: [], hours: [], imps: [], today: '2026-11-18', capacity: null };
  assert.deepEqual(FUNCS['WorkloadCalc.all']({ team, ctx }), app.all(team, ctx));
  assert.deepEqual(FUNCS['WorkloadCalc.all']({ team, ctx: { ...ctx, items: [] } }), app.all(team, { ...ctx, items: [] }));
});
test('cliente Intel: o resultado de uma pessoa nunca aparece para outra enquanto a resposta não chega (stale só por opção)', async () => {
  const mod = (html.match(/<script data-module="services\/intel-client">\n?([\s\S]*?)\n?<\/script>/) || [])[1];
  const Cloud = { isSignedIn: () => true, invoke: async (name, body) => { await new Promise(r => setTimeout(r, 20)); return { ok: true, result: 'plano de ' + body.args.who }; } };
  const Intel = new Function('Cloud', 'T', mod + '\nreturn Intel;')(Cloud, { show() {} });
  assert.equal(Intel.get('PlanVsReal.allocPlan', { who: 'Ana' }, null), null);
  await new Promise(r => setTimeout(r, 120));
  assert.equal(Intel.get('PlanVsReal.allocPlan', { who: 'Ana' }, null), 'plano de Ana');
  assert.equal(Intel.get('PlanVsReal.allocPlan', { who: 'Bia' }, null), null, 'Bia não herda o plano da Ana');
  assert.equal(Intel.get('DecisionCenter.build', { x: 1 }, [], { stale: true }).length, 0);
  await new Promise(r => setTimeout(r, 120));
  assert.equal(Intel.get('DecisionCenter.build', { x: 2 }, [], { stale: true }), 'plano de undefined', 'consulta única com stale devolve a última');
});
test('cliente Intel: sessão que ainda não chegou e falha do servidor NÃO ficam guardadas para sempre (tenta de novo e mostra o resultado)', async () => {
  const mod = (html.match(/<script data-module="services\/intel-client">\n?([\s\S]*?)\n?<\/script>/) || [])[1];
  let signed = false, calls = 0, fail = true, renders = 0, shown = 'nada';
  const Cloud = { isSignedIn: () => signed, invoke: async () => { calls++; await new Promise(r => setTimeout(r, 10)); return fail ? null : { ok: true, result: { m1: { pct: 80 } } }; } };
  const MgrPanel = { render() { renders++; shown = globalThis.__I.get('WorkloadCalc.all', { team: [1] }, null); } };
  const Intel = new Function('Cloud', 'T', 'MgrPanel', mod + '\nreturn Intel;')(Cloud, { show() {} }, MgrPanel);
  globalThis.__I = Intel; Intel.cfg.debounce = 5; Intel.cfg.retry = 120;
  // 1) a página abre e desenha ANTES do login terminar: não chama o servidor e não registra falha
  MgrPanel.render(); await new Promise(r => setTimeout(r, 50));
  assert.equal(calls, 0, 'sem sessão não chama o servidor'); assert.equal(shown, null);
  // 2) o login termina, mas o servidor falha uma vez
  signed = true; MgrPanel.render(); await new Promise(r => setTimeout(r, 60));
  assert.equal(calls, 1, 'tentou assim que houve sessão'); assert.equal(shown, null);
  // 3) o servidor volta: a nova tentativa acontece sozinha e a tela recebe o resultado
  fail = false; await new Promise(r => setTimeout(r, 500));
  delete globalThis.__I;
  assert.deepEqual(shown, { m1: { pct: 80 } }, 'tentou de novo e mostrou; chamadas=' + calls + ' desenhos=' + renders);
});
test('servidor: Dr. PMO (analyze e pack) igual ao do app, para quadro, projeto e sem documentos', () => {
  const app = new Function(sourceOf(html, 'services/dr-pmo') + '\nreturn DrPmoCore;')();
  const sets = [
    [],
    [{ name: 'tarefas.xlsx', ext: 'xlsx', content: 'Tarefa 1 ana 12/11\nTarefa 2 bruno 15/11' }],
    [{ name: 'plano.docx', ext: 'docx', content: 'Termo de abertura do projeto. EAP e WBS com fases e marcos. Cronograma detalhado e linha de base.' }, { name: 'sprints.xlsx', ext: 'xlsx', content: 'Sprint 1 backlog historias de usuario scrum retrospectiva' }],
  ];
  for (const docs of sets) {
    assert.deepEqual(FUNCS['DrPmoCore.analyze'](docs), app.analyze(docs));
    assert.deepEqual(FUNCS['DrPmoCore.pack'](docs), app.pack(docs));
  }
  assert.ok(FUNCS['DrPmoCore.pack'](sets[2]).system.length > 100, 'instrução da IA presente');
});
test('pacote público: o Dr. PMO guarda no navegador só a leitura da resposta da IA (parse)', () => {
  const body = sourceOf(html, 'services/dr-pmo');
  const a = body.indexOf('// ▼ NAVEGADOR'), b = body.indexOf('// ▲ fim do trecho que fica no navegador');
  assert.ok(a > 0 && b > a, 'marcadores');
  const keep = body.slice(a, b);
  assert.ok(keep.includes('function parse(') && !/SYSTEM|ARTIFACTS|function analyze|function prompt/.test(keep), 'só validação');
});
