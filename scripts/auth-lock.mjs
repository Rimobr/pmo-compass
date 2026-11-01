#!/usr/bin/env node
// Fecha (ou reabre) o cadastro aberto do Supabase Auth: com o cadastro fechado só o administrador cria contas
// (Configurações → Pessoas & acesso → Nova conta, função users-admin).
//
//   node scripts/auth-lock.mjs --status   # mostra se o cadastro está aberto ou fechado
//   node scripts/auth-lock.mjs            # fecha o cadastro aberto
//   node scripts/auth-lock.mjs --open     # reabre (só para montar o primeiro administrador, se preferir)
//
// Credencial: SUPABASE_ACCESS_TOKEN (variável de ambiente ou .env.deploy).
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
const args = new Set(process.argv.slice(2));
const url = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function call(method, body) {
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${typeof j === 'string' ? j : (j.message || JSON.stringify(j))}`);
  return j;
}
const show = c => console.log(c.disable_signup ? 'Cadastro FECHADO (só o administrador cria contas).' : 'Cadastro ABERTO (qualquer pessoa pode criar conta).');

try {
  if (args.has('--status')) show(await call('GET'));
  else {
    await call('PATCH', { disable_signup: !args.has('--open') });
    show(await call('GET'));
  }
} catch (e) { console.error(String(e.message)); process.exitCode = 1; }
