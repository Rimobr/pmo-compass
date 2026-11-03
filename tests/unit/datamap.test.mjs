import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadSchema, render } from '../../scripts/build-data-map.mjs';

// O mapa de dados (docs/mapa-de-dados.json) é a lista única de tudo que o sistema cria.
// Estes testes falham quando algo novo é criado sem entrar no mapa, ou quando uma limpeza esquece uma tabela.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const MAP = JSON.parse(readFileSync(join(root, 'docs', 'mapa-de-dados.json'), 'utf8'));
const schema = loadSchema();
const list = name => { const m = html.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`)); assert.ok(m, name + ' não encontrada'); return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]); };
const PROJECT = list('PROJECT_DATA_TABLES'), EXTRA = list('PROJECT_EXTRA_TABLES'), MESSAGES = list('RESET_MESSAGE_TABLES');

test('toda tabela do banco está no mapa (e o mapa não cita tabela que não existe)', () => {
  const real = Object.keys(schema.tables).sort(), mapped = Object.keys(MAP.tables).sort();
  assert.deepEqual(real.filter(t => !mapped.includes(t)), [], 'tabelas criadas e fora do mapa');
  assert.deepEqual(mapped.filter(t => !real.includes(t)), [], 'tabelas no mapa que não existem');
  for (const [n, m] of Object.entries(MAP.tables)) for (const k of ['domain', 'desc', 'scope', 'clearProject', 'resetAll']) assert.ok(m[k] !== undefined && m[k] !== '', `${n}.${k}`);
});

test('"Apagar Dados do projeto" apaga exatamente as tabelas que o mapa marca, e todas filtram por project_id', () => {
  const lists = [...PROJECT, ...EXTRA].sort();
  const marked = Object.entries(MAP.tables).filter(([, m]) => m.clearProject.startsWith('apaga')).map(([n]) => n).sort();
  assert.deepEqual(lists, marked, 'listas de limpeza x mapa');
  for (const t of lists) assert.ok(schema.tables[t].cols.some(c => c.name === 'project_id'), `${t} precisa de project_id (a limpeza filtra por ele)`);
});

test('"Apagar toda a base" apaga o que o mapa marca e preserva o resto', () => {
  const doesDelete = new Set([...PROJECT, ...EXTRA, ...MESSAGES, 'projects']);
  for (const [n, m] of Object.entries(MAP.tables)) {
    const apaga = m.resetAll.startsWith('apaga');
    if (n === 'project_access') { assert.ok(apaga, n); continue; } // sai em cascata com o projeto
    assert.equal(doesDelete.has(n), apaga, `${n}: resetAll="${m.resetAll}" x código`);
  }
  for (const t of MESSAGES) assert.ok(schema.tables[t], t);
  assert.match(html, /const RESET_MESSAGE_TABLES/);
});

test('toda chave do navegador (pmo_…) usada pelo app está no mapa, e vice-versa', () => {
  const used = new Set([...html.matchAll(/'(pmo_[A-Za-z0-9_]*)'/g)].map(m => m[1]));
  const mapped = new Set(Object.keys(MAP.localKeys));
  assert.deepEqual([...used].filter(k => !mapped.has(k)), [], 'chaves usadas e fora do mapa');
  assert.deepEqual([...mapped].filter(k => !used.has(k)), [], 'chaves do mapa que o app não usa mais');
});

test('o que o mapa diz que "Sair da Conta" apaga é exatamente o que a regra apaga', () => {
  const m = html.match(/const KEEP_ON_WIPE = [^\n]*\n\s*function localKeysToWipe\(keys, keepAuth\) \{[\s\S]*?\n  \}/);
  const localKeysToWipe = new Function(m[0] + '\nreturn localKeysToWipe;')();
  const keys = Object.keys(MAP.localKeys);
  const wiped = localKeysToWipe(keys, false).sort();
  const expected = keys.filter(k => MAP.localKeys[k].logout === 'apaga').sort();
  assert.deepEqual(wiped, expected);
});

test('pastas de arquivos e funções de borda estão no mapa', () => {
  const buckets = new Set();
  for (const f of readdirSync(join(root, 'supabase', 'migrations'))) for (const m of readFileSync(join(root, 'supabase', 'migrations', f), 'utf8').matchAll(/storage\.buckets[\s\S]{0,200}?values\s*\('([a-z-]+)'/g)) buckets.add(m[1]);
  for (const b of buckets) assert.ok(MAP.buckets[b], 'pasta fora do mapa: ' + b);
  const fns = readdirSync(join(root, 'supabase', 'functions'), { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(root, 'supabase', 'functions', d.name, 'index.ts'))).map(d => d.name);
  for (const f of fns) assert.ok(MAP.functions[f], 'função fora do mapa: ' + f);
  for (const f of Object.keys(MAP.functions)) assert.ok(fns.includes(f), 'função do mapa que não existe: ' + f);
});

test('o documento docs/MAPA_DE_DADOS.md está em dia com o mapa e com o banco', () => {
  const cur = readFileSync(join(root, 'docs', 'MAPA_DE_DADOS.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(cur, render(schema), 'rode: node scripts/build-data-map.mjs');
});
