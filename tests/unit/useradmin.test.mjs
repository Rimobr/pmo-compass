import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tempPassword, validateCreate, validatePassword } from '../../supabase/functions/_shared/useradmin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const fn = readFileSync(join(root, 'supabase', 'functions', 'users-admin', 'index.ts'), 'utf8');
const roles = ['admin', 'gerente', 'consulta'], projs = ['p1', 'p2'];
const ok = { email: ' Ana@Empresa.com ', name: '  Ana   Souza ', role: 'gerente', password: 'abcd1234', project_ids: ['p1', 'p1', 'zzz'] };

test('criação: limpa e-mail, nome e projetos; só aceita perfil existente', () => {
  const r = validateCreate(ok, roles, projs);
  assert.ok(r.ok); assert.equal(r.value.email, 'ana@empresa.com'); assert.equal(r.value.name, 'Ana Souza');
  assert.deepEqual(r.value.projectIds, ['p1']);
  assert.equal(validateCreate({ ...ok, role: 'superuser' }, roles, projs).ok, false);
  assert.equal(validateCreate({ ...ok, email: 'sem-arroba' }, roles, projs).ok, false);
  assert.equal(validateCreate({ ...ok, name: 'A' }, roles, projs).ok, false);
  assert.equal(validateCreate({ ...ok, password: '123' }, roles, projs).ok, false);
  assert.equal(validateCreate(null, roles, projs).ok, false);
});

test('senha de outra conta exige identificador válido e tamanho mínimo', () => {
  assert.ok(validatePassword({ user_id: '123e4567-e89b-12d3-a456-426614174000', password: 'abcd1234' }).ok);
  assert.equal(validatePassword({ user_id: 'x', password: 'abcd1234' }).ok, false);
  assert.equal(validatePassword({ user_id: '123e4567-e89b-12d3-a456-426614174000', password: 'curta' }).ok, false);
});

test('senha temporária: 12 caracteres, legível e válida', () => {
  for (let i = 0; i < 50; i++) {
    const p = tempPassword();
    assert.equal(p.length, 12); assert.match(p, /^[A-Za-z2-9#@%*]+$/); assert.match(p, /[0-9]/); assert.match(p, /[#@%*]/);
    assert.ok(validatePassword({ user_id: '123e4567-e89b-12d3-a456-426614174000', password: p }).ok);
  }
});

test('a função só atende o administrador e o app não tem mais cadastro aberto', () => {
  assert.match(fn, /prof\?\.role !== "admin"/);
  assert.match(fn, /email_confirm: true/);
  assert.doesNotMatch(html, /auth\.signUp\(/);
  assert.doesNotMatch(html, /Auth\.doSignUp|auth-f-signup-name/);
  assert.match(html, /Users\.newAccount\(\)/);
  assert.match(html, /createAccount[\s\S]{0,200}users-admin/);
});

// ── Primeiro acesso: cadastro complementar e e-mail ──
import { validateDetails, accessEmail } from '../../supabase/functions/_shared/useradmin.mjs';
const m = html.match(/<script data-module="ui\/first-access">([\s\S]*?)<\/script>/);
const FirstAccess = new Function('document', 'Cloud', 'T', `${m[1]}\nreturn FirstAccess;`)({ getElementById: () => null }, undefined, undefined);
const base = { department: ' TI ', skills: [{ kind: 'conhecimento', name: ' Gestão  de projetos ', level: 'senior' }, { kind: 'ferramenta', name: 'Excel', level: 'pleno' }] };

test('cadastro complementar: departamento, conhecimentos e ferramentas são obrigatórios', () => {
  assert.equal(validateDetails({ ...base, department: '  ' }).ok, false, 'departamento');
  assert.equal(validateDetails({ ...base, skills: base.skills.filter(x => x.kind === 'ferramenta') }).ok, false, 'sem conhecimento');
  assert.equal(validateDetails({ ...base, skills: base.skills.filter(x => x.kind === 'conhecimento') }).ok, false, 'sem ferramenta');
  assert.equal(validateDetails({ ...base, skills: [{ kind: 'conhecimento', name: 'X', level: 'senior' }, base.skills[1]] }).ok, false, 'nome curto');
  assert.equal(validateDetails({ ...base, skills: [{ kind: 'conhecimento', name: 'Scrum', level: 'mestre' }, base.skills[1]] }).ok, false, 'nível inválido');
  assert.equal(validateDetails({ ...base, skills: [...base.skills, { kind: 'ferramenta', name: 'excel', level: 'junior' }] }).value.skills.length, 2, 'repetido some');
  const r = validateDetails(base); assert.ok(r.ok); assert.equal(r.value.department, 'TI'); assert.equal(r.value.skills[0].name, 'Gestão de projetos'); assert.equal(r.value.phone, null); assert.equal(r.value.consent, false);
});

test('LGPD: telefone só com o "sim"; "sim" exige telefone; sem DDI assume Brasil', () => {
  assert.equal(validateDetails({ ...base, phone: '(11) 91234-5678', consent: false }).ok, false);
  assert.equal(validateDetails({ ...base, phone: '', consent: true }).ok, false);
  assert.equal(validateDetails({ ...base, phone: '12345', consent: true }).ok, false);
  const r = validateDetails({ ...base, phone: '(11) 91234-5678', consent: true });
  assert.ok(r.ok); assert.equal(r.value.phone, '5511912345678'); assert.equal(r.value.consent, true);
  assert.equal(validateDetails({ ...base, phone: '+55 11 91234-5678', consent: true }).value.phone, '5511912345678');
});

test('as regras da tela são idênticas às do servidor', () => {
  const cases = [base, { ...base, department: '' }, { ...base, phone: '11912345678', consent: true }, { ...base, phone: '11912345678', consent: false },
    { ...base, phone: '', consent: true }, { ...base, phone: '123', consent: true }, { ...base, skills: [{ kind: 'conhecimento', name: 'x'.repeat(90), level: 'pleno' }, base.skills[1]] }, { ...base, skills: [] }, null, {}];
  for (const c of cases) assert.deepEqual(FirstAccess.validate(c), validateDetails(c), JSON.stringify(c));
});

test('e-mail de acesso traz endereço, senha temporária e aviso da troca; escapa HTML', () => {
  const e = accessEmail({ name: 'Ana <b>', email: 'a@b.com', password: 'Abc#1234', appUrl: 'https://x.app' });
  assert.match(e.text, /Abc#1234/); assert.match(e.text, /nova senha/); assert.match(e.subject, /acesso foi criado/);
  assert.doesNotMatch(e.html, /<b>Ana/); assert.match(accessEmail({ name: 'A', email: 'a@b.com', password: 'p', appUrl: 'u', reset: true }).subject, /nova senha/);
});

test('migração do cadastro complementar: telefone só com consentimento, leitura restrita', () => {
  const sql = readFileSync(join(root, 'supabase', 'migrations', '20261101100000_profile_details.sql'), 'utf8');
  assert.match(sql, /profile_phone_needs_consent/); assert.match(sql, /enable row level security/);
  assert.match(sql, /user_id = auth\.uid\(\) or public\.current_role\(\) = 'admin'/);
  assert.doesNotMatch(sql, /for update using \(public\.current_role/); // admin não escreve no telefone de terceiros
});

test('teste de conexão da IA: botão por provedor, explica chave recusada e falta de saldo', () => {
  for (const p of ['anthropic', 'openai', 'google']) assert.ok(html.includes(`onclick="AI.test('${p}')"`), p);
  const a = html.match(/<script data-module="services\/ai">([\s\S]*?)<\/script>/);
  assert.ok(a && /async function test\(provider\)/.test(a[1]) && /function explain\(err\)/.test(a[1]));
  const explain = new Function(a[1].match(/function explain\(err\) \{[\s\S]*?\n  \}/)[0] + '\nreturn explain;')();
  assert.match(explain('HTTP 401 Incorrect API key provided'), /recusada/);
  assert.match(explain('You exceeded your current quota'), /limite ou saldo/);
  assert.match(explain('Failed to fetch'), /internet/);
  assert.equal(explain('algo diferente'), '');
});

test('ciclo de vida do usuário: inativar tira o perfil, só admin/gerente responsável troca responsável, nulo nunca autoriza', () => {
  const sql = ['20261101110000_user_lifecycle.sql', '20261101110100_user_lifecycle_fix.sql'].map(f => readFileSync(join(root, 'supabase', 'migrations', f), 'utf8')).join('\n');
  assert.match(sql, /where id = auth\.uid\(\) and active/);
  assert.match(sql, /coalesce\(public\.current_role\(\), ''\) = 'admin' or coalesce\(public\.is_project_manager\(pid\), false\)/);
  assert.match(sql, /status <> 'done'/); assert.match(sql, /status <> 'grn'/); // concluídas nunca mudam
  assert.match(sql, /guard_profile_active/);
  assert.match(fn, /set_active/); assert.match(fn, /último administrador/); assert.match(fn, /ban_duration/);
  assert.match(fn, /status: "blocked"[\s\S]{0,120}inative em vez de excluir/);
  for (const k of ['Users.startLife', 'Users.rwRun', 'Cloud.manageUsers', 'chave salva']) assert.ok(html.includes(k), k);
});

test('ver cadastro: gerente só vê pessoas dos seus projetos e nunca o telefone', () => {
  const sql = readFileSync(join(root, 'supabase', 'migrations', '20261101120000_person_details.sql'), 'utf8');
  assert.match(sql, /is_project_manager\(pr\.id\)/); assert.match(sql, /project_access/); assert.match(sql, /team_members/);
  assert.match(sql, /'phone', case when is_admin or uid = auth\.uid\(\) then d\.phone end/);
  assert.match(sql, /raise exception 'Sem permissão/);
  for (const k of ['Users.showPerson', 'Cloud.personDetails', 'person_details']) assert.ok(html.includes(k), k);
});

test('perfis dispensados do cadastro complementar; os demais passam a ser obrigados', () => {
  for (const r of ['admin', 'patrocinador', 'consulta', 'manutencao']) assert.equal(FirstAccess.isRequired(r), false, r);
  for (const r of ['gerente', 'po', 'sm', 'time', 'perfil_personalizado']) assert.equal(FirstAccess.isRequired(r), true, r);
});


test('avaliações: 5 critérios de 1 a 5, média e divergência entre a pessoa e o gerente', () => {
  const rv = html.match(/<script data-module="ui\/reviews">([\s\S]*?)<\/script>/);
  const Reviews = new Function('document', 'Cloud', 'T', 'DB', 'FirstAccess', 'Auth', rv[1] + '\nreturn Reviews;')({ getElementById: () => null }, {}, {}, {}, {}, {});
  const ok5 = { qualidade: 4, prazos: 3, comunicacao: 5, colaboracao: 4, autonomia: 4 };
  assert.equal(Reviews.average(ok5), 4); assert.equal(Reviews.validate({ scores: ok5 }).ok, true);
  assert.equal(Reviews.validate({ scores: { ...ok5, prazos: 6 } }).ok, false); assert.equal(Reviews.validate({ scores: { ...ok5, prazos: 2.5 } }).ok, false);
  assert.equal(Reviews.validate({ scores: { qualidade: 4 } }).ok, false);
  assert.deepEqual(Reviews.gaps({ ...ok5, prazos: 5 }, { ...ok5, prazos: 2 }), ['Cumprimento de prazos']);
  assert.deepEqual(Reviews.gaps(ok5, ok5), []);
  const sql = ['20261101130000_skills_reviews.sql', '20261101140000_skill_catalog.sql'].map(f => readFileSync(join(root, 'supabase', 'migrations', f), 'utf8')).join('\n');
  for (const k of ['person_reviews_select', "kind = 'self' and person_id = auth.uid()", 'is_project_manager(project_id)', 'find_people', 'resolve_skills', 'merged_into', 'skill_catalog_admin_write']) assert.ok(sql.includes(k), k);
});
