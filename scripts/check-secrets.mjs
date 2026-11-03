#!/usr/bin/env node
// Varredura de segredos nos arquivos versionados: chaves e tokens que nunca devem ir para o repositório.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PADROES = [
  ['token de acesso do Supabase', /\bsbp_[a-f0-9]{30,}\b/],
  ['chave secreta do Supabase', /\bsb_secret_[A-Za-z0-9_-]{20,}\b/],
  ['chave da Anthropic', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['chave da OpenAI', /\bsk-(proj-)?[A-Za-z0-9]{40,}\b/],
  ['chave do Resend', /\bre_[A-Za-z0-9]{24,}\b/],
  ['chave privada', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['chave de acesso da AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['token do GitHub', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/]
];
// JWT: só é segredo se for a chave de serviço (role service_role); a chave pública (anon) é feita para ir no app
const jwt = /\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}\b/g;
const files = execSync('git ls-files', { cwd: root }).toString().split('\n').filter(f => f && !/\.(png|zip|xlsx|ico|lock)$|package-lock\.json$/.test(f));
let bad = 0;
for (const f of files) {
  let t; try { t = readFileSync(join(root, f), 'utf8'); } catch (e) { continue; }
  for (const [nome, re] of PADROES) if (re.test(t)) { bad++; console.error(`✖ ${f}: parece ${nome}`); }
  for (const m of t.matchAll(jwt)) { try { if (JSON.parse(Buffer.from(m[1], 'base64url').toString()).role === 'service_role') { bad++; console.error(`✖ ${f}: chave de serviço (service_role) do Supabase`); } } catch (e) { /* não é JWT */ } }
}
console.log(bad ? `${bad} achado(s).` : `✔ Nenhum segredo nos ${files.length} arquivos versionados.`);
process.exit(bad ? 1 : 0);
