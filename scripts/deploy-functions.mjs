#!/usr/bin/env node
// Publica as funções de borda do Supabase e (opcional) cadastra os segredos delas, usando a CLI do Supabase via npx.
//
//   node scripts/deploy-functions.mjs                    # publica todas as funções
//   node scripts/deploy-functions.mjs wa-webhook         # publica só as nomeadas
//   node scripts/deploy-functions.mjs --secrets          # cadastra os segredos (WA_*, RESEND_API_KEY, EMAIL_FROM, CRON_SECRET) lidos do .env.deploy
//   node scripts/deploy-functions.mjs --list             # mostra o que seria feito, sem executar nada
//
// Credencial: SUPABASE_ACCESS_TOKEN (ambiente ou .env.deploy). Os segredos NUNCA são impressos.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env.deploy');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const ref = process.env.PROJECT_REF || (existsSync(join(root, 'supabase/.temp/project-ref')) ? readFileSync(join(root, 'supabase/.temp/project-ref'), 'utf8').trim() : '');

// Funções chamadas por quem NÃO tem JWT do Supabase (a Meta, o agendador, o clique no e-mail) se protegem sozinhas
// (assinatura HMAC, CRON_SECRET, token assinado). As demais exigem o JWT do usuário.
const PUBLIC = new Set(['wa-webhook', 'notify-dispatch', 'notify-digest', 'notify-unsub']);
const SECRET_KEYS = ['WA_ACCESS_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_APP_SECRET', 'WA_VERIFY_TOKEN', 'WA_TEMPLATE_CONFIRM', 'WA_TEMPLATE_ALERT', 'RESEND_API_KEY', 'EMAIL_FROM', 'CRON_SECRET'];

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const names = argv.filter(a => !a.startsWith('--'));
const all = readdirSync(join(root, 'supabase', 'functions'), { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(root, 'supabase', 'functions', d.name, 'index.ts'))).map(d => d.name).sort();
const targets = names.length ? names : all;
const unknown = targets.filter(n => !all.includes(n));
if (unknown.length) { console.error('Função inexistente: ' + unknown.join(', ') + '. Disponíveis: ' + all.join(', ')); process.exit(2); }

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
function run(args, { quiet = false } = {}) {
  const r = spawnSync(npx, ['--yes', 'supabase', ...args], { cwd: root, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', env: process.env, shell: process.platform === 'win32' });
  if (r.status !== 0) { if (quiet && r.stderr) console.error(String(r.stderr).replace(/(=)[^\s]+/g, '$1***')); return false; }
  return true;
}

if (flags.has('--list')) {
  if (flags.has('--secrets')) console.log('Segredos que seriam cadastrados (só os presentes): ' + SECRET_KEYS.filter(k => process.env[k]).join(', ') + '\nAusentes: ' + (SECRET_KEYS.filter(k => !process.env[k]).join(', ') || 'nenhum'));
  else targets.forEach(n => console.log(`${n}${PUBLIC.has(n) ? '  (--no-verify-jwt)' : ''}`));
  process.exit(0);
}
if (!process.env.SUPABASE_ACCESS_TOKEN) { console.error('Falta SUPABASE_ACCESS_TOKEN (ambiente ou .env.deploy).'); process.exit(2); }
if (!ref) { console.error('Falta PROJECT_REF (ou supabase/.temp/project-ref).'); process.exit(2); }

if (flags.has('--secrets')) {
  const present = SECRET_KEYS.filter(k => process.env[k]);
  if (!present.length) { console.error('Nenhum segredo encontrado no ambiente/.env.deploy.'); process.exit(2); }
  const ok = run(['secrets', 'set', ...present.map(k => `${k}=${process.env[k]}`), '--project-ref', ref], { quiet: true });
  console.log(ok ? `Segredos cadastrados: ${present.join(', ')}` : 'Falha ao cadastrar segredos.');
  process.exit(ok ? 0 : 1);
}

let failed = 0;
for (const n of targets) {
  console.log(`\n▶ publicando ${n}${PUBLIC.has(n) ? ' (sem JWT; protegida por assinatura/segredo)' : ''}`);
  if (!run(['functions', 'deploy', n, '--project-ref', ref, ...(PUBLIC.has(n) ? ['--no-verify-jwt'] : [])])) failed++;
}
console.log(failed ? `\n${failed} função(ões) com falha.` : `\n${targets.length} função(ões) publicada(s).`);
process.exit(failed ? 1 : 0);
