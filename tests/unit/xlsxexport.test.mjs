import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="ui\/xlsx-export">([\s\S]*?)<\/script>/);
const { XlsxExport } = new Function(`${m[1]}\nreturn { XlsxExport };`)();

test('célula que começa com = + - @ vira texto literal; número continua número', () => {
  for (const s of ['=1+1', '+cmd', '-2', '@SUM(A1)']) assert.equal(XlsxExport.safeCell(s), "'" + s);
  assert.equal(XlsxExport.safeCell('Entrega normal'), 'Entrega normal');
  assert.equal(XlsxExport.safeCell(12.5), 12.5);
  assert.equal(XlsxExport.safeCell(null), '');
  assert.equal(XlsxExport.safeCell(NaN), '');
});

test('nome de aba: sem caracteres proibidos e até 31 letras', () => {
  assert.equal(XlsxExport.sheetName('A/B:C*D?[E]\\F', 0), 'A B C D  E  F');
  assert.equal(XlsxExport.sheetName('x'.repeat(50), 0).length, 31);
  assert.equal(XlsxExport.sheetName('', 2), 'Planilha 3');
});
