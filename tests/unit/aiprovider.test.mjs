import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const src = html.match(/<script data-module="core\/store">([\s\S]*?)<\/script>/) || html.match(/const Store = \(\(\) => \{[\s\S]*?\n\}\)\(\);/);
const code = src[1] || src[0];

// Ambiente mínimo: sem tela, com um "servidor" que diz quais chaves existem
function make({ signedIn, serverKeys, local }) {
  const mem = {}; if(local) mem.pmo_v1 = JSON.stringify(local);
  const toasts = [];
  const env = {
    document: { getElementById: () => null, querySelector: () => null },
    localStorage: { getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } },
    Cloud: { isSignedIn: () => signedIn, getAiKeyStatus: async () => serverKeys, saveAiKey: async () => true },
    Auth: { guard: () => true }, T: { show: m => toasts.push(m) }, Onboarding: undefined, confirm: () => true
  };
  const Store = new Function(...Object.keys(env), code + '\nreturn Store;')(...Object.values(env));
  return { Store, toasts, mem };
}
const tick = () => new Promise(r => setTimeout(r, 5));

test('só a chave do Gemini salva na conta: o provedor que roda é o Gemini, não a Anthropic', async () => {
  const { Store } = make({ signedIn: true, serverKeys: { anthropic: false, openai: false, google: true } });
  Store.load(); await tick();
  assert.equal(Store.getProvider(), 'google');
});
test('a escolha explícita vale quando o provedor escolhido tem chave', async () => {
  const { Store } = make({ signedIn: true, serverKeys: { anthropic: true, openai: false, google: true }, local: { aiProvider: 'google' } });
  Store.load(); await tick();
  assert.equal(Store.getProvider(), 'google');
  const b = make({ signedIn: true, serverKeys: { anthropic: true, openai: false, google: true } });
  b.Store.load(); await tick();
  assert.equal(b.Store.getProvider(), 'anthropic');
});
test('enquanto o servidor não disse quais chaves existem, respeita a escolha (sem falso negativo)', () => {
  const { Store } = make({ signedIn: true, serverKeys: null });
  Store.load();
  assert.equal(Store.getProvider(), 'anthropic');
});
test('modo local: sem chave da Anthropic e com a do OpenAI, usa a do OpenAI; sem nenhuma, fica no padrão', () => {
  const a = make({ signedIn: false, serverKeys: null, local: { apiKeys: { anthropic: '', openai: 'sk-x', google: '' } } });
  a.Store.load(); assert.equal(a.Store.getProvider(), 'openai'); assert.equal(a.Store.getKey(), 'sk-x');
  const b = make({ signedIn: false, serverKeys: null });
  b.Store.load(); assert.equal(b.Store.getProvider(), 'anthropic'); assert.equal(b.Store.getKey(), '');
});
test('não deixa ativar um provedor sem chave; salvar a primeira chave já ativa o provedor', async () => {
  const { Store, toasts } = make({ signedIn: false, serverKeys: null });
  Store.load(); Store.setProvider('google');
  assert.ok(toasts.some(t => /Salve a chave de Gemini/.test(t)));
  assert.equal(Store.get().aiProvider, 'anthropic');
});

test('a IA consulta o servidor antes de escolher o provedor (sem precisar abrir Configurações)', async () => {
  const { Store } = make({ signedIn: true, serverKeys: { anthropic: false, openai: false, google: true } });
  assert.equal(Store.getProvider(), 'anthropic');   // ainda não sabe
  await Store.ensureKeys();
  assert.equal(Store.getProvider(), 'google');
  assert.ok(html.includes('await Store.ensureKeys();'));
});
