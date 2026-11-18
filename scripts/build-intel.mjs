#!/usr/bin/env node
// Gera o código de servidor da "inteligência" a partir do MESMO fonte do app (PMO_Compass_v2.html):
//   supabase/functions/_shared/intel.generated.mjs
// Cada módulo listado em INTEL abaixo é copiado como está (uma só fonte da verdade, sem duplicar), recebe
// "export" e entra na tabela FUNCS (nome → função) que a função de borda `intel` aceita chamar.
//   node scripts/build-intel.mjs           # regrava o arquivo
//   node scripts/build-intel.mjs --check   # falha (código 1) se estiver desatualizado (usado no check:all)
// Para levar um módulo novo ao servidor: acrescente-o em INTEL (módulo, constante, funções chamáveis) e, em
// scripts/build-public.mjs, em STUBS; módulos puros apenas (sem DOM, sem DB, sem Cloud).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const INTEL = [
  { module: 'services/decision-center', name: 'DecisionCenter', funcs: ['build'] },
  { module: 'services/plan-vs-real', name: 'PlanVsReal', funcs: ['allocPlan'] },
  { module: 'services/dr-pmo', name: 'DrPmoCore', funcs: ['analyze', 'pack'] },
  { module: 'services/workload', name: 'WorkloadCalc', funcs: [{ name: 'all', call: '(a) => WorkloadCalc.all(a.team, a.ctx)' }] },
];

export function sourceOf(html, moduleId) {
  const esc = moduleId.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  const m = new RegExp('<script data-module="' + esc + '">\\n?([\\s\\S]*?)\\n?</script>').exec(html);
  if (!m) throw new Error('Módulo não encontrado no HTML: ' + moduleId);
  return m[1];
}

export function generate() {
  const html = fs.readFileSync(path.join(root, 'PMO_Compass_v2.html'), 'utf8').replace(/\r\n/g, '\n');
  const parts = ['// GERADO por scripts/build-intel.mjs a partir de PMO_Compass_v2.html. NÃO edite aqui.', '// Cada módulo abaixo é o mesmo código do app; a função de borda `intel` só chama o que está em FUNCS.', ''];
  INTEL.forEach(x => { parts.push('// ── ' + x.module + ' ──', sourceOf(html, x.module).trim(), ''); });
  parts.push('export const FUNCS = {');
  INTEL.forEach(x => x.funcs.forEach(f => { const n = typeof f === 'string' ? f : f.name; parts.push("  '" + x.name + '.' + n + "': " + (typeof f === 'string' ? '(args) => ' + x.name + '.' + f + '(args)' : f.call) + ','); }));
  parts.push('};', '');
  return parts.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const out = path.join(root, 'supabase', 'functions', '_shared', 'intel.generated.mjs');
  const code = generate();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n') : '';
    if (cur !== code) { console.log('✖ intel.generated.mjs desatualizado. Rode: node scripts/build-intel.mjs'); process.exit(1); }
    console.log('✔ intel.generated.mjs está igual ao fonte.'); process.exit(0);
  }
  fs.writeFileSync(out, code);
  console.log('Gerado: ' + path.relative(root, out) + ' (' + INTEL.length + ' módulo(s)).');
}
