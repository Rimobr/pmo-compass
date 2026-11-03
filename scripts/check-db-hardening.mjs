#!/usr/bin/env node
// Confere o endurecimento do banco (somente leitura): RLS em todas as tabelas, funções SECURITY DEFINER com search_path fixo,
// anônimo sem execução em funções e sem privilégios em tabelas. Falha (código 1) se algo escapou.
//   node scripts/check-db-hardening.mjs
// Credencial: SUPABASE_ACCESS_TOKEN e PROJECT_REF (ambiente ou .env.deploy).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env.deploy');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.PROJECT_REF || (existsSync(join(root, 'supabase/.temp/project-ref')) ? readFileSync(join(root, 'supabase/.temp/project-ref'), 'utf8').trim() : '');
if (!token || !ref) { console.error('Falta SUPABASE_ACCESS_TOKEN ou PROJECT_REF.'); process.exit(2); }

const q = async sql => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`); return JSON.parse(t);
};

const checks = [
  ['tabelas do esquema public sem RLS', `select c.relname as item from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`],
  ['funções SECURITY DEFINER sem search_path fixo', `select p.oid::regprocedure::text as item from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%')`],
  ['funções públicas que o anônimo ainda executa', `select p.oid::regprocedure::text as item from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`],
  ['tabelas com privilégio para o anônimo', `select distinct table_name as item from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`]
];
let bad = 0;
try {
  for (const [name, sql] of checks) {
    const rows = await q(sql);
    if (rows.length) { bad += rows.length; console.log(`✖ ${name}: ${rows.map(r => r.item).join(', ')}`); } else console.log(`✔ ${name}: nenhuma`);
  }
} catch (e) { console.error('Falha: ' + String(e.message).slice(0, 300)); process.exit(2); }
process.exit(bad ? 1 : 0);
