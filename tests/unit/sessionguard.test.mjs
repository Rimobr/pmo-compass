import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="ui\/session-guard">([\s\S]*?)<\/script>/);
const { SessionGuard: S } = new Function(`${m[1]}\nreturn { SessionGuard };`)();

test('sessão: padrão é atualizar a cada 10 min e 8 horas logado; valor fora da lista volta ao padrão', () => {
  assert.deepEqual(S.clean(null), { refreshMin: 10, sessionMin: 480 });
  assert.deepEqual(S.clean({ refreshMin: 5, sessionMin: 0 }), { refreshMin: 5, sessionMin: 0 });
  assert.deepEqual(S.clean({ refreshMin: 7, sessionMin: 99 }), { refreshMin: 10, sessionMin: 480 });
});
test('sessão: o cronômetro conta do início e o aviso é nos últimos 30 segundos', () => {
  const t0 = 1000000;
  assert.equal(S.remainingSec(t0, 60, t0), 3600);
  assert.equal(S.remainingSec(t0, 60, t0 + 3570000), 30);
  assert.equal(S.remainingSec(t0, 0, t0 + 9e9), Infinity);
  assert.equal(S.stage(31), 'normal'); assert.equal(S.stage(30), 'aviso'); assert.equal(S.stage(1), 'aviso'); assert.equal(S.stage(0), 'expirou');
  assert.equal(S.fmt(30), '00:30'); assert.equal(S.fmt(3725), '1:02:05');
});
test('sessão: renova sem recarregar a página e confere a senha de novo', () => {
  const body = m[1];
  assert.ok(!/location\.reload\(\)\s*;?\s*\}\s*\n/.test(body.replace(/catch\(e\) \{ location\.reload\(\); \}/, '')));
  assert.match(body, /Cloud\.renewSession\(/);
  const cloud = html.match(/async function renewSession\(password\) \{[\s\S]*?\n  \}/)[0];
  assert.match(cloud, /signInWithPassword/); assert.match(cloud, /session_renew/);
  for (const k of ['id="tb-ses"', 'id="sg-refresh"', 'id="sg-session"', 'SessionGuard.render()', 'SessionGuard.policy().refreshMin']) assert.ok(html.includes(k), k);
});

test('cronômetro: a cor de aviso vence o selo do perfil (senão o administrador não vê a mudança)', () => {
  assert.match(html, /body\[data-role\] \.ses-timer\.warn/);
  assert.match(html, /body\[data-role\] \.ses-timer\.crit/);
});
