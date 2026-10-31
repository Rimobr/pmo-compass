import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="core\/org-settings">([\s\S]*?)<\/script>/);
const make = () => {
  const store = {};
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const pushed = [];
  const Cloud = { pushOrgSetting: (k, v) => pushed.push([k, v]) };
  const { OrgSettings } = new Function('localStorage', 'Cloud', `${m[1]}\nreturn { OrgSettings };`)(localStorage, Cloud);
  return { OrgSettings, pushed, store };
};

test('sem escolha nenhuma, vale o estado inicial da demonstração', () => {
  const { OrgSettings } = make();
  assert.equal(OrgSettings.get('pmoProfile').type, 'controle');
  assert.equal(OrgSettings.get('outraChave'), null);
});

test('depois que a organização escolhe, o valor dela vale para todos os projetos e vai para a nuvem', () => {
  const { OrgSettings, pushed } = make();
  OrgSettings.set('pmoProfile', { type: 'agil', setAt: 'x' });
  assert.equal(OrgSettings.get('pmoProfile').type, 'agil');
  assert.deepEqual(pushed, [['pmoProfile', { type: 'agil', setAt: 'x' }]]);
});

test('valor vindo da nuvem grava só no navegador (não reenvia)', () => {
  const { OrgSettings, pushed } = make();
  OrgSettings.setLocal('pmoProfile', { type: 'estrategico', setAt: 'y' });
  assert.equal(OrgSettings.get('pmoProfile').type, 'estrategico');
  assert.equal(pushed.length, 0);
});
