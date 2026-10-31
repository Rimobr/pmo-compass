import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const sql = readFileSync(join(root, 'supabase', 'migrations', '20261023101500_access_profiles.sql'), 'utf8');
const m = html.match(/<script data-module="services\/access-profiles">([\s\S]*?)<\/script>/);
const { AccessProfiles } = new Function(`${m[1]}\nreturn { AccessProfiles };`)();

test('sanitize guarda só permissões conhecidas e verdadeiras', () => {
  assert.deepEqual(AccessProfiles.sanitize({ view_costs: true, hack: true, edit_plan: 'true', log_hours: false, update_own: true }), { view_costs: true, update_own: true });
  assert.deepEqual(AccessProfiles.sanitize(null), {});
});

test('identificador do perfil: sem acento, minúsculo e único', () => {
  assert.equal(AccessProfiles.idFromName('Líder Técnico', []), 'lider_tecnico');
  assert.equal(AccessProfiles.idFromName('Líder Técnico', ['lider_tecnico']), 'lider_tecnico_2');
  assert.equal(AccessProfiles.idFromName('!!', []), 'perfil');
  assert.ok(AccessProfiles.idFromName('x'.repeat(80), []).length <= 28);
});

test('perfis prontos: custos só para quem deve ver; time não vê dinheiro', () => {
  const L = AccessProfiles.LOCAL;
  assert.equal(AccessProfiles.count(L.admin.perms), AccessProfiles.KEYS.length);
  assert.ok(L.gerente.perms.view_costs && L.patrocinador.perms.view_costs);
  ['time', 'consulta', 'po', 'sm', 'manutencao'].forEach(r => assert.ok(!L[r].perms.view_costs, r));
  assert.ok(L.time.perms.update_own && L.time.perms.log_hours && !L.time.perms.manage_backlog);
});

test('as chaves do app são as mesmas que o banco conhece', () => {
  AccessProfiles.KEYS.forEach(k => assert.ok(sql.includes(k), `a migração não cita a permissão ${k}`));
  Object.keys(AccessProfiles.LOCAL).forEach(r => assert.ok(sql.includes(`'${r}'`), `perfil ${r} não está no seed do banco`));
});

test('toda marca data-perm / guard do app usa uma permissão que existe', () => {
  const ok = new Set([...AccessProfiles.KEYS, 'business', 'settings', 'admin']);
  const used = new Set([...html.matchAll(/data-perm="([a-z_]+)"/g)].map(x => x[1]).concat([...html.matchAll(/Auth\.guard\('([a-z_]+)'\)/g)].map(x => x[1])));
  used.forEach(k => assert.ok(ok.has(k), `permissão desconhecida: ${k}`));
});
