import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const read = f => fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const html = read('PMO_Compass_v2.html');
test('bibliotecas de terceiros vêm do próprio app: nenhum CDN nem Google Fonts no HTML, e a política de conteúdo não aceita domínio de script, estilo ou fonte externo', () => {
  assert.ok(!/cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis|fonts\.gstatic|cdnjs\.cloudflare/.test(html), 'HTML sem CDN');
  const csp = JSON.parse(read('vercel.json')).headers.flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy').value;
  for (const dir of ['script-src', 'style-src', 'font-src', 'worker-src']) {
    const v = (csp.match(new RegExp(dir + ' ([^;]*)')) || [])[1] || '';
    assert.ok(!/https?:\/\//.test(v), dir + ' não aceita domínio externo: ' + v);
  }
  assert.ok(!/'unsafe-eval'/.test(csp), 'sem unsafe-eval');
});
test('vendor/: cada arquivo bate com o MANIFEST (sha256) e os pacotes têm versão fixa e integridade do npm', () => {
  const mf = JSON.parse(read('vendor/MANIFEST.json'));
  for (const [rel, h] of Object.entries(mf.files)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('../../vendor/' + rel, import.meta.url))).digest('hex'), h, rel);
  for (const p of mf.pacotes) { assert.match(p.versao, /^\d+\.\d+\.\d+$/, p.pacote); assert.ok(p.integridade.startsWith('sha512-'), p.pacote); }
  assert.ok(mf.pacotes.some(p => p.pacote === '@supabase/supabase-js'), 'supabase presente');
});
test('PDF: o leitor não executa código embutido (isEvalSupported desligado)', () => {
  assert.ok(html.includes('getDocument({ data: buf, isEvalSupported: false })'));
});
