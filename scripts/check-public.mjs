#!/usr/bin/env node
// Conferência pós-publicação (regra "publicar só o app"): o app responde 200; arquivos de trabalho e
// credenciais respondem 404. Uso: node scripts/check-public.mjs [https://pmo-compass.vercel.app]
const base = (process.argv[2] || 'https://pmo-compass.vercel.app').replace(/\/$/, '');
const mustBeOk = ['/', '/manifest.json', '/sw.js', '/version.json', '/icon-192.png'];
const mustBeHidden = [
  '/schema.sql', '/DPA_LGPD.md', '/CONTEXTO_PROJETO.md', '/SETUP.md', '/package.json', '/package-lock.json',
  '/playwright.config.js', '/tests/e2e/fixtures.js', '/tests/run.js', '/supabase/functions/ai-proxy/index.ts',
  '/supabase/migrations/20260101000000_baseline.sql', '/scripts/db-apply.mjs', '/docs/WHATSAPP_GO_LIVE.md',
  '/.env.test', '/.env.test.example', '/.env.deploy', '/.github/workflows/ci.yml',
];
let bad = 0;
async function code(p) { const r = await fetch(base + p, { redirect: 'manual' }); return r.status; }
for (const p of mustBeOk) { const c = await code(p); const ok = c === 200; if (!ok) bad++; console.log(`${ok ? '✔' : '✖'} ${String(c).padEnd(4)} ${p}  (esperado 200)`); }
for (const p of mustBeHidden) { const c = await code(p); const ok = c === 404; if (!ok) bad++; console.log(`${ok ? '✔' : '✖'} ${String(c).padEnd(4)} ${p}  (esperado 404)`); }
console.log(bad ? `\n${bad} problema(s) de exposição.` : '\nTudo certo: só o app está público.');
process.exit(bad ? 1 : 0);
