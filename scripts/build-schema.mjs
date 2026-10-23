#!/usr/bin/env node
// Gera schema.sql (referência única para quem monta um projeto Supabase do zero) a partir das migrações.
// Fonte da verdade = supabase/migrations/. NUNCA edite schema.sql à mão: rode `node scripts/build-schema.mjs`.
//   --check  falha (código 1) se o schema.sql estiver desatualizado em relação às migrações (usado no CI).
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase', 'migrations');
const files = readdirSync(dir).filter(f => /^\d{14}_.+\.sql$/.test(f)).sort();

const header = `-- =========================================================================
-- PMO Compass — esquema completo (GERADO por scripts/build-schema.mjs — não edite à mão)
-- Fonte: supabase/migrations/ (${files.length} arquivos). Para instalação do zero, rode este arquivo inteiro
-- no SQL Editor; para um banco que já existe, use \`node scripts/db-apply.mjs\` (aplica só o que falta).
-- =========================================================================
`;
const body = files.map(f => `\n-- ▼▼▼ ${f} ▼▼▼\n` + readFileSync(join(dir, f), 'utf8').trimEnd() + '\n').join('');
const out = (header + body).replace(/\r\n/g, '\n');

const target = join(root, 'schema.sql');
if (process.argv.includes('--check')) {
  const cur = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (cur.replace(/\r\n/g, '\n') !== out) { console.error('schema.sql está desatualizado — rode: node scripts/build-schema.mjs'); process.exit(1); }
  console.log('schema.sql em dia com as migrações.');
} else {
  writeFileSync(target, out);
  console.log(`schema.sql gerado (${files.length} migrações, ${out.split('\n').length} linhas).`);
}
