import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const schema = readFileSync(join(root, 'schema.sql'), 'utf8');
const migs = readdirSync(join(root, 'supabase/migrations')).sort().map(f => [f, readFileSync(join(root, 'supabase/migrations', f), 'utf8')]);

test('toda função SECURITY DEFINER tem search_path fixo (na própria definição ou em um ALTER FUNCTION)', () => {
  const blocks = schema.split(/create or replace function /i).slice(1);
  const bad = [];
  for (const b of blocks) {
    const head = b.slice(0, b.search(/\$\$\s*language|\$\$;|language plpgsql|language sql/i) + 400);
    const stmt = b.slice(0, (b.indexOf('\n\n') > 0 ? b.indexOf('\n\n') : b.length));
    if (!/security definer/i.test(stmt) && !/security definer/i.test(head.slice(0, 600))) continue;
    const name = b.match(/^(public\.)?("?[a-z_]+"?)\s*\(/i);
    if (!name) continue;
    const n = name[2];
    const own = /search_path/i.test(b.slice(0, b.search(/\n\n|\ncreate |\nalter |\ndrop /i) > 0 ? b.search(/\n\n|\ncreate |\nalter |\ndrop /i) : b.length + 0));
    const altered = new RegExp(String.raw`alter function public\."?` + n.replace(/"/g, '') + String.raw`"?\([^)]*\)\s+set search_path`, 'i').test(schema);
    if (!own && !altered) bad.push(n);
  }
  assert.deepEqual([...new Set(bad)], [], 'funções definer sem search_path');
});

test('o anônimo não executa funções nem toca tabelas, e o que for criado depois já nasce assim', () => {
  const m = migs.find(([f]) => f.includes('db_hardening'))[1];
  for (const k of ['revoke all on all functions in schema public from public, anon', 'revoke all on all tables in schema public from anon', 'alter default privileges for role postgres in schema public revoke execute on functions from public, anon', 'grant execute on all functions in schema public to authenticated, service_role']) assert.ok(m.includes(k), k);
});

test('gravação "inserir ou atualizar" de um lançamento existente deixa a decisão para o gatilho de atualização (aprovação do gerente não falha)', () => {
  const m = migs.find(([f]) => f.includes('hours_upsert_fix'))[1];
  assert.equal((m.match(/if tg_op = 'INSERT' and exists \(select 1 from public\.time_entries where project_id = new\.project_id and id = new\.id\) then return new; end if;/g) || []).length, 2, 'na guarda principal e no bloqueio de orçamento');
  // a última definição de cada gatilho é a corrigida (migrações em ordem)
  const lastGuard = [...migs].reverse().find(([, t]) => t.includes('function public.time_entries_guard()'))[0];
  assert.ok(lastGuard.includes('hours_upsert_fix'), 'a correção é a última definição da guarda: ' + lastGuard);
});
