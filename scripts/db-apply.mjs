#!/usr/bin/env node
// Aplica as migrações de supabase/migrations/ no projeto Supabase, em ordem, uma vez cada.
//
//   node scripts/db-apply.mjs --status        # o que já foi aplicado e o que está pendente
//   node scripts/db-apply.mjs --dry-run       # roda TODAS as pendentes numa transação e desfaz (valida a sintaxe e as regras)
//   node scripts/db-apply.mjs                 # aplica as pendentes (cada uma em transação + registro)
//   node scripts/db-apply.mjs --setup-cron    # grava URL das funções + segredo do agendador em private.cron_config
//
// Credencial: SUPABASE_ACCESS_TOKEN (variável de ambiente ou .env.deploy, que é ignorado pelo git e pelo Vercel).
// Usa a API de gerenciamento (a mesma da CLI) — não precisa de Docker nem da senha do banco.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(root, 'supabase', 'migrations');
const BASELINE = '20260101000000';

function loadEnv() {
  const f = join(root, '.env.deploy');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.PROJECT_REF || (existsSync(join(root, 'supabase/.temp/project-ref')) ? readFileSync(join(root, 'supabase/.temp/project-ref'), 'utf8').trim() : '');
const args = new Set(process.argv.slice(2));

if (!token) { console.error('Falta SUPABASE_ACCESS_TOKEN (variável de ambiente ou .env.deploy).'); process.exit(2); }
if (!ref) { console.error('Falta PROJECT_REF (ou supabase/.temp/project-ref).'); process.exit(2); }

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${typeof body === 'string' ? body : (body.message || JSON.stringify(body))}`);
  return body;
}

function listMigrations() {
  return readdirSync(MIGRATIONS).filter(f => /^\d{14}_.+\.sql$/.test(f)).sort()
    .map(f => ({ file: f, version: f.slice(0, 14), name: f.slice(15, -4), sql: readFileSync(join(MIGRATIONS, f), 'utf8') }));
}

const q = s => `'${String(s).replace(/'/g, "''")}'`;

async function applied() {
  await query(`create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
  const rows = await query('select version from supabase_migrations.schema_migrations');
  return new Set(rows.map(r => r.version));
}

async function main() {
  const all = listMigrations();
  const done = await applied();

  // Instalação que já existia antes das migrações versionadas: o baseline já está lá, só registra.
  if (!done.has(BASELINE)) {
    const [{ exists }] = await query(`select to_regclass('public.profiles') is not null as exists`);
    if (exists) {
      const b = all.find(m => m.version === BASELINE);
      await query(`insert into supabase_migrations.schema_migrations (version, name, statements) values (${q(BASELINE)}, ${q(b.name)}, '{}') on conflict do nothing`);
      done.add(BASELINE);
      console.log(`• baseline ${BASELINE} já estava no banco — registrado sem reexecutar.`);
    }
  }

  const pending = all.filter(m => !done.has(m.version));

  if (args.has('--status')) {
    for (const m of all) console.log(`${done.has(m.version) ? '✔ aplicada ' : '… pendente '} ${m.file}`);
    return;
  }

  if (args.has('--setup-cron')) {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new Error('Falta CRON_SECRET (.env.deploy).');
    await query(`insert into private.cron_config (key, value) values ('functions_url', ${q(`https://${ref}.supabase.co/functions/v1`)}), ('cron_secret', ${q(secret)})
      on conflict (key) do update set value = excluded.value`);
    console.log('✔ private.cron_config gravado (URL das funções + segredo do agendador).');
    return;
  }

  if (!pending.length) { console.log('Nada pendente: o banco está em dia.'); return; }
  console.log(`${pending.length} migração(ões) pendente(s):\n  ` + pending.map(m => m.file).join('\n  '));

  if (args.has('--dry-run')) {
    const sql = `begin;\n${pending.map(m => m.sql).join('\n;\n')}\nrollback;`;
    try { await query(sql); console.log('\n✔ Simulação OK — tudo passou e foi DESFEITO (nada foi gravado).'); }
    catch (e) { console.error('\n✖ A simulação falhou (nada foi gravado):\n  ' + e.message); process.exit(1); }
    return;
  }

  for (const m of pending) {
    try {
      await query(`begin;\n${m.sql}\n;\ninsert into supabase_migrations.schema_migrations (version, name, statements) values (${q(m.version)}, ${q(m.name)}, '{}');\ncommit;`);
      console.log('✔ aplicada', m.file);
    } catch (e) {
      console.error(`✖ falhou em ${m.file} (desfeita):\n  ${e.message}`);
      process.exit(1);
    }
  }
}

main().catch(e => { console.error('Erro:', e.message); process.exit(1); });
