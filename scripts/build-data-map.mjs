#!/usr/bin/env node
// Gera docs/MAPA_DE_DADOS.md: o que o sistema cria (tabelas e campos na nuvem, chaves no navegador, pastas de arquivos, funções)
// e o que cada limpeza faz com cada item. A fonte é docs/mapa-de-dados.json (classificação feita por pessoas) + schema.sql (campos reais).
//
//   node scripts/build-data-map.mjs           # grava o documento
//   node scripts/build-data-map.mjs --check   # falha se o documento estiver desatualizado
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAP = JSON.parse(readFileSync(join(root, 'docs', 'mapa-de-dados.json'), 'utf8'));
const OUT = join(root, 'docs', 'MAPA_DE_DADOS.md');

// ── Estrutura real do banco: tabelas criadas (menos as apagadas) e seus campos, lidos das migrações em ordem ──
export function parseSchema(sql) {
  const tables = {}; const order = [];
  const ensure = n => { if (!tables[n]) { tables[n] = { cols: [], pk: [] }; order.push(n); } return tables[n]; };
  for (const m of sql.matchAll(/create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const t = ensure(m[1]);
    for (const line of m[2].split('\n')) {
      const l = line.trim().replace(/--.*$/, '').trim();
      const c = l.match(/^(\w+)\s+(uuid|text|int|integer|bigint|boolean|numeric|date|timestamptz|jsonb|smallint)\b/);
      if (c && !/^(primary|check|constraint|unique|foreign)$/i.test(c[1])) t.cols.push({ name: c[1], type: c[2] });
      const p = l.match(/^primary key \(([^)]*)\)/i); if (p) t.pk = p[1].split(',').map(x => x.trim());
    }
  }
  for (const m of sql.matchAll(/alter table public\.(\w+)\s+add column if not exists (\w+) (\w+)/g)) {
    const t = tables[m[1]]; if (t && !t.cols.some(c => c.name === m[2])) t.cols.push({ name: m[2], type: m[3] });
  }
  for (const m of sql.matchAll(/alter table public\.(\w+)\s+drop column if exists (\w+)/g)) {
    const t = tables[m[1]]; if (t) t.cols = t.cols.filter(c => c.name !== m[2]);
  }
  for (const m of sql.matchAll(/drop table if exists public\.(\w+)/g)) { delete tables[m[1]]; const i = order.indexOf(m[1]); if (i >= 0) order.splice(i, 1); }
  return { tables, order };
}

export function render(schema) {
  const L = [];
  L.push('# Mapa de dados do PMO Compass', '', '> Gerado por `node scripts/build-data-map.mjs` a partir de `docs/mapa-de-dados.json` (classificação) e `schema.sql` (campos reais). **Não edite à mão**: altere o JSON e gere de novo.', '',
    'Para que serve: saber, sem procurar no código, **o que o sistema guarda, onde, de quem é e o que cada limpeza faz com isso**. Toda tabela, campo, chave do navegador, pasta de arquivos ou função nova entra aqui na mesma entrega (os testes falham se faltar).', '');
  L.push('## Como ler as limpezas', '');
  for (const [k, v] of Object.entries(MAP.limpezas)) L.push(`- **${v.nome}** (${v.onde}): ${v.efeito}`);
  L.push('', '## Tabelas na nuvem (Supabase)', '');
  const byDomain = {};
  for (const n of schema.order) { const d = (MAP.tables[n] || { domain: '(sem classificação)' }).domain; (byDomain[d] = byDomain[d] || []).push(n); }
  for (const d of Object.keys(byDomain)) {
    L.push(`### ${d}`, '');
    L.push('| Tabela | Para que serve | Escopo | Dado pessoal | Apagar dados do projeto | Apagar toda a base | Campos |', '|---|---|---|---|---|---|---|');
    for (const n of byDomain[d]) {
      const m = MAP.tables[n] || {}, t = schema.tables[n];
      L.push(`| \`${n}\` | ${m.desc || ''} | ${m.scope || ''} | ${m.personal ? 'sim' : 'não'} | ${m.clearProject || ''} | ${m.resetAll || ''} | ${t.cols.map(c => `\`${c.name}\``).join(', ')} |`);
    }
    L.push('');
  }
  L.push('## Dados no navegador (localStorage)', '', '| Chave | O que guarda | Tipo | Ao sair da conta | Ao apagar o projeto |', '|---|---|---|---|---|');
  for (const [k, v] of Object.entries(MAP.localKeys)) L.push(`| \`${k}\` | ${v.desc} | ${v.kind} | ${v.logout} | ${v.deleteProject} |`);
  L.push('', '## Pastas de arquivos (Storage)', '', '| Pasta | Para que serve | Quem lê | Situação |', '|---|---|---|---|');
  for (const [k, v] of Object.entries(MAP.buckets)) L.push(`| \`${k}\` | ${v.desc} | ${v.quemLe} | ${v.situacao} |`);
  L.push('', '## Funções de borda (servidor)', '', '| Função | Para que serve | Segredos que usa | Quem chama |', '|---|---|---|---|');
  for (const [k, v] of Object.entries(MAP.functions)) L.push(`| \`${k}\` | ${v.desc} | ${v.segredos} | ${v.quemChama} |`);
  L.push('', '## Registros (logs) e rastros', '', '| Onde | O que registra | Pode ser apagado? |', '|---|---|---|');
  for (const [k, v] of Object.entries(MAP.logs)) L.push(`| ${k} | ${v.desc} | ${v.apagavel} |`);
  L.push('', '## Configurações fora do banco', '', '| Onde | O que é | Como mudar |', '|---|---|---|');
  for (const [k, v] of Object.entries(MAP.config)) L.push(`| ${k} | ${v.desc} | ${v.comoMudar} |`);
  L.push('', '## Quem vê o quê', '', 'O menu esconde, a abertura direta pelo endereço é barrada e o banco nega a leitura dos dados correspondentes.', '', '| Permissão de visão | O que libera |', '|---|---|');
  for (const [k, v] of Object.entries(MAP.visoes.permissoes)) L.push('| `' + k + '` | ' + v + ' |');
  L.push('', '| Tela | Exige |', '|---|---|');
  for (const v of Object.values(MAP.visoes.telas)) L.push('| ' + v[0] + ' | `' + v[1] + '` |');
  L.push('', 'Telas abertas a quem tem acesso ao projeto: ' + MAP.visoes.abertas.map(x => '`' + x + '`').join(', ') + '.', '', '| Perfil pronto | Vê |', '|---|---|');
  for (const [k, v] of Object.entries(MAP.visoes.perfis)) L.push('| `' + k + '` | ' + v + ' |');
  L.push('', '## Regras de uma base nova', '');
  MAP.regras.forEach((r, i) => L.push(`${i + 1}. ${r}`));
  L.push('');
  return L.join('\n');
}

export function loadSchema() { return parseSchema(readFileSync(join(root, 'schema.sql'), 'utf8')); }

if (process.argv[1] && process.argv[1].endsWith('build-data-map.mjs')) {
  const doc = render(loadSchema());
  if (process.argv.includes('--check')) {
    const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (cur !== doc) { console.error('docs/MAPA_DE_DADOS.md está desatualizado: rode "node scripts/build-data-map.mjs".'); process.exit(1); }
    console.log('MAPA_DE_DADOS.md em dia.');
  } else { writeFileSync(OUT, doc); console.log('docs/MAPA_DE_DADOS.md gerado (' + doc.split('\n').length + ' linhas).'); }
}
