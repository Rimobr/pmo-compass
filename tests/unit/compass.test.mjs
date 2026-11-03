import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const mig = readFileSync(join(root, 'supabase', 'migrations', '20261103210000_compass.sql'), 'utf8');
const { CompassCore } = new Function(`${html.match(/<script data-module="services\/compass">([\s\S]*?)<\/script>/)[1]}\nreturn { CompassCore };`)();

const proj = (id, name, o = {}) => ({ id, name, client: 'Cli', modules: { count: 3, avgPct: 50, lateCount: 0, maxLate: 0, worst: [] }, sprint: null, risks: { open: 0, critical: 0, top: [] }, decisions: { pending: 0, critical: 0 }, scope: { pending: 0, impactDays: 0 }, impediments: 0, hours: { consumed: 10, last28: 5, pending: 0, budget: null }, team: 2, cost: null, ...o });
const digest = (projects, o = {}) => ({ today: '2026-11-04', canSeeCosts: false, canSeeHours: true, projects, people: [], overallocated: [], ...o });

test('desvio: projeto sem fator fica no rumo; atraso, risco crítico e decisão crítica somam pontos e viram sugestão', () => {
  const ok = CompassCore.score(proj('a', 'Alfa'), false);
  assert.equal(ok.value, 0); assert.equal(ok.level, 'ok'); assert.equal(ok.reasons.length, 0);
  const ruim = CompassCore.score(proj('b', 'Beta', { modules: { count: 4, avgPct: 30, lateCount: 3, maxLate: 20, worst: [{ label: 'Cadastro', daysLate: 20 }] }, risks: { open: 4, critical: 2, top: [{ title: 'Fornecedor', score: 20 }] }, decisions: { pending: 2, critical: 1 } }), false);
  assert.ok(ruim.value >= 50, 'crítico'); assert.equal(ruim.level, 'critico');
  assert.match(ruim.reasons[0].text, /3 entregas atrasadas.*20 dias.*Cadastro/);
  assert.ok(ruim.recs.some(r => r.go === 'wbs' && /Cadastro/.test(r.text)) && ruim.recs.some(r => r.go === 'risks') && ruim.recs.some(r => r.go === 'decisions'));
});
test('custo à frente do avanço só conta para quem vê custos', () => {
  const p = proj('c', 'Cama', { cost: { bac: 1000, ac: 800 }, modules: { count: 2, avgPct: 30, lateCount: 0, maxLate: 0, worst: [] } });
  assert.equal(CompassCore.score(p, false).value, 0);
  const s = CompassCore.score(p, true);
  assert.ok(s.value > 0); assert.match(s.reasons[0].text, /80% do orçamento com 30% de avanço/);
});
test('orçamento de horas: 85% é atenção, 100% é esgotado; projeto sem nenhum dado fica "sem dados"', () => {
  assert.match(CompassCore.score(proj('d', 'D', { hours: { consumed: 90, last28: 0, pending: 0, budget: 100 } }), false).reasons[0].text, /90%/);
  assert.match(CompassCore.score(proj('e', 'E', { hours: { consumed: 100, last28: 0, pending: 0, budget: 100 } }), false).reasons[0].text, /acabou/);
  const vazio = CompassCore.score(proj('f', 'F', { modules: { count: 0 }, hours: { consumed: 0, budget: null } }), false);
  assert.equal(vazio.value, null); assert.equal(vazio.level, 'sem_dado');
});
test('ranking: o pior primeiro; sem dados por último', () => {
  const d = digest([proj('a', 'Alfa'), proj('b', 'Beta', { risks: { open: 3, critical: 3, top: [] } }), proj('f', 'Fantasma', { modules: { count: 0 }, hours: { consumed: 0 } })]);
  assert.deepEqual(CompassCore.rank(d).map(r => r.name), ['Beta', 'Alfa', 'Fantasma']);
});
test('a pergunta é entendida: horas, desvio, atraso, riscos, decisões, orçamento, projeto citado e pergunta livre', () => {
  const d = digest([proj('a', 'Cla Guard Pro'), proj('b', 'Portal Nexus')]);
  const k = q => { const i = CompassCore.intent(q, d); return i && i.kind; };
  assert.equal(k('Qual profissional está com mais horas trabalhadas?'), 'horas');
  assert.equal(k('Quem trabalhou menos horas?'), 'horas');
  assert.equal(CompassCore.intent('quem lançou menos horas', d).asc, true);
  assert.equal(k('Qual projeto está com maior desvio e quais sugestões para retomada?'), 'desvio');
  assert.equal(k('o que está atrasado'), 'atraso');
  assert.equal(k('há riscos críticos?'), 'riscos');
  assert.equal(k('decisões pendentes'), 'decisoes');
  assert.equal(k('como está o consumo do orçamento'), 'orcamento');
  assert.equal(k('quem está com sobrecarga'), 'sobrecarga');
  assert.equal(k('faça um panorama'), 'panorama');
  const nome = CompassCore.intent('como está o Portal Nexus? o que fazer?', d);
  assert.deepEqual(nome, { kind: 'desvio', project: 'b' });
  assert.equal(k('escreva um poema'), null);
});
test('resposta de desvio: aponta o pior projeto, os motivos e as sugestões para retomar', () => {
  const d = digest([proj('a', 'Alfa'), proj('b', 'Beta', { modules: { count: 4, avgPct: 30, lateCount: 2, maxLate: 12, worst: [{ label: 'Entrega X', daysLate: 12 }] }, impediments: 2 })]);
  const a = CompassCore.answer({ kind: 'desvio' }, d);
  assert.match(a.lines[0].t, /«Beta»/); assert.ok(a.recs.length >= 2); assert.match(a.recs[0].text, /Entrega X/); assert.ok(a.how);
});
test('resposta de horas: ranking dos últimos 28 dias, alerta acima de 44 h por semana e respeito ao perfil', () => {
  const people = [{ name: 'Ana', hours28: 200, hoursTotal: 300, projects: 2 }, { name: 'Beto', hours28: 80, hoursTotal: 90, projects: 1 }];
  const a = CompassCore.answer({ kind: 'horas' }, digest([proj('a', 'A')], { people }));
  assert.match(a.lines[0].t, /«Ana» com 200 h/); assert.match(a.lines[1].t, /acima de 44 h/); assert.ok(!/acima de 44/.test(a.lines[2].t));
  assert.equal(a.recs[0].go, 'burnout');
  const sem = CompassCore.answer({ kind: 'horas' }, digest([proj('a', 'A')], { canSeeHours: false, people: null }));
  assert.match(sem.lines[0].t, /não vê as horas de todos/);
  const menos = CompassCore.answer({ kind: 'horas', asc: true }, digest([proj('a', 'A')], { people }));
  assert.match(menos.lines[0].t, /lançou menos horas.*«Beto»/);
});
test('as respostas de orçamento respeitam o perfil e os fatos para a IA não trazem dinheiro nem dados fora do panorama', () => {
  const d = digest([proj('a', 'A', { cost: { bac: 1000, ac: 500 } })], { canSeeCosts: false });
  assert.match(CompassCore.answer({ kind: 'orcamento' }, d).lines[0].t, /não vê custos/);
  const txt = CompassCore.factsText(digest([proj('a', 'A', { cost: { bac: 123456, ac: 99999 } })], { canSeeCosts: true }));
  assert.ok(!/123456|99999|R\$/.test(txt));
  assert.match(txt, /PROJETO «A»/);
});
test('a permissão: o app, o perfil padrão e o banco', () => {
  for (const k of ["'ask_compass'", 'data-perm="ask_compass"', 'onclick="Compass.open()"', 'id="modal-compass"', "client.rpc('compass_digest')", "Auth.guard('ask_compass')", 'data-can~="ask_compass"']) assert.ok(html.includes(k), k);
  assert.ok(html.includes("gerente: { name: 'Gerente de Projeto', perms: { ask_compass: true"));
  assert.ok(html.includes("patrocinador: { name: 'Patrocinador / Diretoria', perms: { ask_compass: true"));
  for (const k of ["has_perm('ask_compass')", "'gerente', 'patrocinador'", 'security definer set search_path = public', 'revoke all on function public.compass_digest() from public, anon', "case when costs then", "case when allh then"]) assert.ok(mig.includes(k), k);
});

test('horas: projeto novo não dilui a média (semanas contadas desde a primeira hora), e quem não está na janela nem na equipe não vira "0 horas"', () => {
  const people = [{ name: 'Ana', hours28: 100, hoursTotal: 100, projects: 1, since: '2026-11-03' }, { name: 'Beto', hours28: 100, hoursTotal: 100, projects: 1, since: '2026-10-08' }];
  const a = CompassCore.answer({ kind: 'horas' }, digest([proj('a', 'A')], { people }));
  assert.match(a.lines.find(l => /Ana/.test(l.t) && /^1\./.test(l.t)).t, /acima de 44 h/);        // 100 h em 2 dias = semana de 100 h
  assert.ok(!/acima de 44/.test(a.lines.find(l => /^2\./.test(l.t)).t));                          // 100 h em 4 semanas = 25 h por semana
  const txt = CompassCore.factsText(digest([proj('a', 'A')], { people: [{ name: 'Ana', hours28: 9, since: '2026-11-03' }, { name: 'Leandro', hours28: 0 }] }));
  assert.match(txt, /JANELA DAS HORAS/); assert.match(txt, /Ana 9 h/); assert.match(txt, /sem horas na janela: Leandro/);
  const mig2 = readFileSync(join(root, 'supabase', 'migrations', '20261103220000_compass_people.sql'), 'utf8');
  for (const k of ["'since'", 'having coalesce(sum(h.hours)', 'team_members tm where lower(btrim(tm.name))']) assert.ok(mig2.includes(k), k);
});
