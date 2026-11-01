import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const MAP = JSON.parse(readFileSync(join(root, 'docs', 'mapa-de-dados.json'), 'utf8'));
const load = (name, exports) => { const m = html.match(new RegExp(`<script data-module="${name.replace('/', '\\/')}">([\\s\\S]*?)<\\/script>`)); return new Function(`${m[1]}\nreturn { ${exports} };`)(); };
const { AccessProfiles } = load('services/access-profiles', 'AccessProfiles');
const { DeliveryRisk } = load('services/delivery-risk', 'DeliveryRisk');
const pagesOfR = [...html.match(/const pages = \[([^\]]*)\]/)[1].matchAll(/'([a-z]+)'/g)].map(m => m[1]);
const has = role => p => !!(AccessProfiles.LOCAL[role].perms[p]) || role === 'admin';
const openPages = role => pagesOfR.filter(p => { const n = AccessProfiles.PAGE_NEEDS[p]; return !n || has(role)(n); });

test('o mapa de visões (docs) é o mesmo que o app usa', () => {
  const fromMap = Object.fromEntries(Object.entries(MAP.visoes.telas).map(([k, v]) => [k, v[1]]));
  assert.deepEqual(AccessProfiles.PAGE_NEEDS, fromMap);
  const closed = Object.keys(fromMap);
  assert.deepEqual(pagesOfR.filter(p => !closed.includes(p)).sort(), [...MAP.visoes.abertas].sort(), 'as telas abertas do mapa são as que não exigem permissão');
  for (const perm of Object.values(fromMap)) assert.ok(AccessProfiles.KEYS.includes(perm), perm);
  for (const k of Object.keys(MAP.visoes.perfis)) assert.ok(AccessProfiles.LOCAL[k], 'perfil: ' + k);
});

test('Membro do time (Dev, QA): só o próprio trabalho — nada de diretoria, PMO, gestão, custos nem dados dos colegas', () => {
  const open = openPages('time');
  assert.deepEqual(open.sort(), ['account', 'backlog', 'help', 'hours', 'kanban', 'lessons', 'mywork', 'noproject', 'raci', 'settings', 'sprintnow', 'wbs'].sort());
  for (const p of ['sprints', 'ritos']) assert.ok(!open.includes(p), 'o time usa "Sprint atual"; ' + p + ' é de quem conduz');
  for (const p of ['board', 'execview', 'pmoview', 'pfkpi', 'portfolio', 'prioritization', 'dashboard', 'xray', 'decisions', 'risks', 'repository', 'chat', 'budget', 'burnout', 'resources', 'report', 'stakeholders']) assert.ok(!open.includes(p), 'time não deve abrir ' + p);
  assert.equal(AccessProfiles.homeFor(has('time')), 'mywork');
});

test('cada perfil pronto abre o que o seu papel pede', () => {
  const o = r => new Set(openPages(r));
  assert.ok(o('gerente').has('board') && o('gerente').has('burnout') && o('gerente').has('budget') && o('gerente').has('dashboard'));
  assert.ok(o('patrocinador').has('execview') && o('patrocinador').has('budget') && !o('patrocinador').has('burnout'));
  assert.ok(o('po').has('risks') && !o('po').has('board') && !o('po').has('burnout') && !o('po').has('budget'));
  assert.ok(o('sm').has('burnout') && o('sm').has('decisions') && !o('sm').has('board') && !o('sm').has('budget'));
  assert.ok(o('consulta').has('execview') && !o('consulta').has('risks') && !o('consulta').has('burnout') && !o('consulta').has('budget'));
  assert.ok(!o('manutencao').has('board') && !o('manutencao').has('dashboard') && o('manutencao').has('settings'));
  assert.equal(openPages('admin').length, pagesOfR.length);
  assert.equal(AccessProfiles.homeFor(has('consulta')), 'execview');
  assert.equal(AccessProfiles.homeFor(has('gerente')), 'dashboard');
});

test('risco de estourar o prazo: regra simples, com a explicação de cada conta', () => {
  const A = (t) => DeliveryRisk.assess(t, '2026-11-10');
  assert.equal(A({ start: '2026-11-01', end: '2026-11-20', pct: 100 }).code, 'entregue');
  assert.equal(A({ start: '2026-11-01', end: '2026-11-20', pct: 30, done: true }).code, 'entregue');
  assert.equal(A({ start: '2026-11-01', end: '2026-11-05', pct: 40 }).code, 'atrasada');
  assert.match(A({ start: '2026-11-01', end: '2026-11-05', pct: 40 }).why, /5 dia/);
  // 10 dias de 19 passaram (~47%): 45% feito = no ritmo; 30% = atenção (17 pts atrás); 10% = pode estourar (37 pts atrás)
  assert.equal(A({ start: '2026-11-01', end: '2026-11-20', pct: 45 }).code, 'ritmo');
  assert.equal(A({ start: '2026-11-01', end: '2026-11-20', pct: 30 }).code, 'atencao');
  assert.equal(A({ start: '2026-11-01', end: '2026-11-20', pct: 10 }).code, 'estourando');
  assert.equal(A({ start: '2026-11-01', end: '2026-11-20', pct: 10 }).prob, 'alta');
  assert.equal(A({ start: '2026-11-05', end: '2026-11-12', pct: 85 }).code, 'quase');
  assert.equal(A({ pct: 20 }).code, 'sem_prazo');
  assert.equal(A({ end: '2026-11-11', pct: 20 }).code, 'estourando'); // sem início: 1 dia e 20%
  assert.equal(DeliveryRisk.itemPct('review'), 80);
  assert.deepEqual(['ritmo', 'atrasada', 'entregue', 'estourando'].map(c => ({ code: c })).sort((a, b) => DeliveryRisk.rank(a) - DeliveryRisk.rank(b)).map(x => x.code), ['atrasada', 'estourando', 'ritmo', 'entregue']);
});

test('a conta tem uma única entrada (o avatar) e a página Minha conta existe', () => {
  assert.match(html, /id="tb-avatar"[^>]*onclick="Auth\.openAccount\(\)"/);
  assert.doesNotMatch(html, /id="tb-cloud-badge"[^>]*onclick/);
  assert.doesNotMatch(html, /id="tb-role-tag"[^>]*onclick/);
  for (const k of ['id="p-account"', 'const Account = ', 'Alterar o meu cadastro', 'Retirar a autorização do WhatsApp']) assert.ok(html.includes(k), k);
});

test('o banco nega a leitura de gestão e de dados das pessoas a quem não tem a visão', () => {
  const sql = readFileSync(join(root, 'supabase', 'migrations', '20261102100000_view_permissions.sql'), 'utf8');
  for (const t of ['board_decisions', 'decisions', 'documents', 'scope_changes', 'baselines', 'risks', 'project_snapshots']) assert.ok(new RegExp(`on public\\.${t} for select[\\s\\S]{0,160}has_perm\\('view_management'\\)`).test(sql), t);
  assert.match(sql, /on public\.team_members for select[\s\S]{0,260}has_perm\('view_team_load'\) or user_id = auth\.uid\(\)/);
  assert.match(sql, /function public\.project_team/);
  assert.doesNotMatch(sql.match(/function public\.project_team[\s\S]*?\$\$ language/)[0], /workload|signals|recommendation/);
});

test('incluir uma pessoa de execução no projeto cria o colaborador ligado à conta; quem só acompanha não entra', () => {
  const sql = ['20261102110000_team_link.sql', '20261102110100_team_link_fix.sql'].map(f => readFileSync(join(root, 'supabase', 'migrations', f), 'utf8')).join(' ');
  assert.match(sql, /function public\.ensure_team_member/);
  assert.match(sql, /insert into public\.team_members\(id, project_id, name, role, allocation_pct, workload_pct, signals, user_id\)/);
  assert.match(sql, /update_own' = 'true' or ap\.perms ->> 'log_hours' = 'true'/);
  assert.match(sql, /guard_member_link[\s\S]*is_project_manager/);
  assert.match(sql, /revoke all on function public\._link_team_member/);
  for (const k of ['Cloud.ensureTeamMember', "rpc('ensure_team_member'"]) assert.ok(html.includes(k), k);
  assert.ok(readFileSync(join(root, 'supabase', 'functions', 'users-admin', 'index.ts'), 'utf8').includes('ensure_team_member'));
});

test('base vazia de verdade: nenhum projeto de enchimento ("Meu projeto"); quem entra cria o primeiro', () => {
  assert.doesNotMatch(html, /name:'Meu projeto'/);
  for (const k of ['isEmpty, NONE_ID', "DB.isEmpty() && !['settings', 'account', 'help', 'noproject'].includes(id)", 'Nenhum projeto ainda', 'Criar o meu projeto', 'body.no-project .sb-proj-area', "setItem(PROJECTS_KEY, '[]')"]) assert.ok(html.includes(k), k);
  assert.ok(html.includes('if(!Array.isArray(cloudList)) return;'), 'a nuvem manda, inclusive lista vazia (sem exigir ao menos um projeto)');
  assert.ok(!html.includes('!cloudList.length) return;'));
});

test('Sprint atual: a visão do time (meta, andamento, impedimentos, ações da retro) no lugar de Sprints e Ritos', () => {
  for (const k of ['id="p-sprintnow"', 'const SprintNow = ', 'O que está travando', 'Ações combinadas na retrospectiva', 'data-p="sprintnow"', "sprints: 'manage_backlog', ritos: 'run_rites'"]) assert.ok(html.includes(k), k);
});

test('"Ver como": só o Administrador, só na memória, sem gravar e sem permitir alterações', () => {
  for (const k of ['id="tb-viewas"', 'function setPreview', 'if(previewRole) return; /* a visualização nunca é gravada */', 'Você está só visualizando', 'Voltar ao meu perfil', 'actor_role: (typeof Auth !== \'undefined\') ? Auth.realRole()']) assert.ok(html.includes(k), k);
  assert.match(html, /function setPreview\(roleId\) \{\s*if\(realRole\(\) !== 'admin'\) return;/);
});

test('a Minha conta espera o login terminar e acompanha a mudança de estado', () => {
  for (const k of ['Confirmando a sua conta', 'isPending: () => pendingCloudConfirm', "if(typeof Account !== 'undefined') Account.render();\n  WBS.render();".replace(/\n/g, '\r\n')]) assert.ok(html.includes(k) || html.includes(k.replace(/\r\n/g, '\n')), k);
});
