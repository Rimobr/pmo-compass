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
const base = { department: ' TI ', knowledge: 'gestão', tools: 'Excel' };

test('cadastro complementar: departamento, conhecimentos e ferramentas são obrigatórios', () => {
  for (const f of ['department', 'knowledge', 'tools']) assert.equal(validateDetails({ ...base, [f]: '  ' }).ok, false, f);
  const r = validateDetails(base); assert.ok(r.ok); assert.equal(r.value.department, 'TI'); assert.equal(r.value.phone, null); assert.equal(r.value.consent, false);
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
    { ...base, phone: '', consent: true }, { ...base, phone: '123', consent: true }, { ...base, tools: 'x'.repeat(900) }, null, {}];
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
  for (const p of ['anthropic', 'openai', 'google']) assert.match(html, new RegExp(`onclick="AI\.test\('${p}'\)"`));
  const a = html.match(/<script data-module="services\/ai">([\s\S]*?)<\/script>/);
  assert.ok(a && /async function test\(provider\)/.test(a[1]) && /function explain\(err\)/.test(a[1]));
  const explain = new Function(a[1].match(/function explain\(err\) \{[\s\S]*?\n  \}/)[0] + '\nreturn explain;')();
  assert.match(explain('HTTP 401 Incorrect API key provided'), /recusada/);
  assert.match(explain('You exceeded your current quota'), /limite ou saldo/);
  assert.match(explain('Failed to fetch'), /internet/);
  assert.equal(explain('algo diferente'), '');
});
