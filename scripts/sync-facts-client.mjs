#!/usr/bin/env node
// Copia a lógica de "fatos" do servidor (supabase/functions/_shared/util.mjs + facts.mjs) para dentro do app (PMO_Compass_v2.html),
// no módulo services/shared-facts. Assim a mensagem de status gerada na tela e a resposta do assistente de WhatsApp usam
// EXATAMENTE o mesmo cálculo — uma só fonte da verdade.
//   node scripts/sync-facts-client.mjs          # regrava o bloco no HTML
//   node scripts/sync-facts-client.mjs --check  # falha (código 1) se o HTML estiver desatualizado (usado no teste e no CI)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n');
const strip = src => src.split('\n').filter(l => !/^\s*import\s.+from\s.+;?\s*$/.test(l)).join('\n').replace(/^export\s+(async\s+)?/gm, m => (m.includes('async') ? 'async ' : ''));

const BEGIN = '/* ▼▼▼ GERADO por scripts/sync-facts-client.mjs a partir de supabase/functions/_shared/{util,facts}.mjs — NÃO edite aqui ▼▼▼ */';
const END = '/* ▲▲▲ fim do trecho gerado ▲▲▲ */';
const body = `${BEGIN}\nconst SharedFacts = (() => {\n${strip(read('supabase/functions/_shared/util.mjs'))}\n${strip(read('supabase/functions/_shared/facts.mjs'))}\nreturn { computeFacts, restrictFacts, factsToText, oneLineStatus, riskLevel, ratioCode, overallocatedNames, redactPii, maskMoney, fmtDateBr, projectToday, isoDate };\n})();\n${END}`;

const htmlPath = join(root, 'PMO_Compass_v2.html');
let html = readFileSync(htmlPath, 'utf8');
const crlf = html.includes('\r\n');
html = html.replace(/\r\n/g, '\n');
const re = /(<script data-module="services\/shared-facts">\n?)((?:(?!<\/script>)[\s\S])*?)(\n?<\/script>)/; // nunca ultrapassa o </script> do próprio bloco
if (!re.test(html)) { console.error('Bloco <script data-module="services/shared-facts"> não encontrado no HTML.'); process.exit(2); }
const next = html.replace(re, (_, a, _b, c) => a + body + '\n' + c.replace(/^\n/, ''));
if (process.argv.includes('--check')) {
  if (next !== html) { console.error('services/shared-facts está desatualizado — rode: node scripts/sync-facts-client.mjs'); process.exit(1); }
  console.log('services/shared-facts em dia com o servidor.');
} else {
  writeFileSync(htmlPath, crlf ? next.replace(/\n/g, '\r\n') : next);
  console.log('services/shared-facts atualizado.');
}
