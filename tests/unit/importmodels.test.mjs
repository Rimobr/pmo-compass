import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
const load = (name, exports) => { const m = html.match(new RegExp(`<script data-module="${name.replace('/', '\\/')}">([\\s\\S]*?)<\\/script>`)); return new Function(`${m[1]}\nreturn { ${exports} };`)(); };
const { SheetImport } = load('services/sheet-import', 'SheetImport');

test('há um modelo para cada tipo de importação', () => {
  assert.deepEqual(Object.keys(SheetImport.MODELS).sort(), Object.keys(SheetImport.TARGETS).sort());
});

for (const target of Object.keys(SheetImport.TARGETS)) {
  test(`modelo "${target}": colunas reconhecidas, importa sem erro nem aviso e traz as linhas de exemplo`, () => {
    const m = SheetImport.MODELS[target];
    const map = SheetImport.autoMap(m.headers, target);
    for (const f of SheetImport.TARGETS[target].fields.filter(x => x.req)) assert.notEqual(map[f.key], undefined, `coluna obrigatória "${f.label}" não reconhecida`);
    assert.equal(SheetImport.detectHeaderRow([m.headers, ...m.rows], target), 0, 'cabeçalho na primeira linha');
    const r = SheetImport.build(target, m.rows, map, m.ctx, 1);
    assert.deepEqual(r.errors, [], 'sem erros');
    assert.deepEqual(r.warnings, [], 'sem avisos');
    assert.equal(r.rows.length, m.expect);
    if(target === 'wbs') assert.deepEqual(r.rows.map(x => (x.children || []).length), [2, 2], 'cada entrega com suas 2 subtarefas');
  });

  test(`modelo "${target}": o guia descreve cada coluna do cabeçalho`, () => {
    const m = SheetImport.MODELS[target], sheets = SheetImport.modelSheets(target);
    assert.equal(sheets.length, 2); assert.equal(sheets[0].rows[0].length, m.headers.length);
    assert.equal(m.guide.length >= SheetImport.TARGETS[target].fields.length - 1, true);
    assert.ok(m.guide.some(g => g[1].startsWith('Sim')), 'indica o que é obrigatório');
    for (const row of m.rows) assert.equal(row.length, m.headers.length, 'linha com o mesmo número de colunas');
  });
}

test('modelo do backlog: o bug do exemplo está ligado ao item pai', () => {
  const m = SheetImport.MODELS.backlog, map = SheetImport.autoMap(m.headers, 'backlog');
  const r = SheetImport.build('backlog', m.rows, map, m.ctx, 1);
  const bug = r.rows.find(x => x.kind === 'bug');
  assert.equal(bug.parentTitle, 'Cadastro de clientes');
});
