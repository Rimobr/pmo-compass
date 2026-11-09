import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="ui\/auto-refresh">([\s\S]*?)<\/script>/);
const { AutoRefresh } = new Function(`${m[1]}\nreturn { AutoRefresh };`)();

test('atualização automática: só passa a vez depois de 10 minutos', () => {
  assert.equal(AutoRefresh.EVERY_MS, 600000);
  assert.equal(AutoRefresh.due(599999, 0), false);
  assert.equal(AutoRefresh.due(600000, 0), true);
});
test('atualização automática: nunca interrompe janela aberta, digitação, aba oculta ou falta de rede', () => {
  assert.equal(AutoRefresh.blocked({}), false);
  for (const k of ['modalOpen', 'typing', 'hidden', 'offline']) assert.equal(AutoRefresh.blocked({ [k]: true }), true, k);
});
test('atualização automática: relê a nuvem e redesenha, sem recarregar a página nem gravar nada', () => {
  const body = m[1];
  assert.match(body, /Cloud\.pullAll\(\)/); assert.match(body, /renderAllModules/);
  assert.ok(!/location\.reload|localStorage\.setItem|DB\.set/.test(body));
  assert.match(body, /Cloud\.isSignedIn\(\)/);
});
