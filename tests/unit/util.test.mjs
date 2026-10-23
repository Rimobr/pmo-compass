import test from 'node:test';
import assert from 'node:assert/strict';
import { redactPii, maskMoney, normalizePhone, phoneVariants, splitMessage, hmacSha256Hex, timingSafeEqualStr, inQuietHours, isoWeekKey, projectToday, truncate } from '../../supabase/functions/_shared/util.mjs';

test('redactPii remove CPF, e-mail e telefone', () => {
  const t = redactPii('CPF 123.456.789-09, ana@x.com, (11) 99999-8888');
  assert.ok(!/123\.456/.test(t) && !/ana@x/.test(t) && !/99999/.test(t));
});
test('maskMoney esconde valores em R$', () => {
  for (const s of ['custou R$ 1.234,56', 'R$ 2 milhões', '500 mil reais', 'US$ 300'])
    assert.ok(!/\d/.test(maskMoney(s)), s);
  assert.equal(maskMoney('SPI 0,95 e 40% consumido'), 'SPI 0,95 e 40% consumido');
});
test('normalizePhone', () => {
  assert.equal(normalizePhone('(11) 99999-8888'), '+5511999998888');
  assert.equal(normalizePhone('+55 11 99999-8888'), '+5511999998888');
  assert.equal(normalizePhone('123'), null);
  assert.equal(normalizePhone(''), null);
});
test('phoneVariants cobre o 9º dígito', () => {
  assert.deepEqual(phoneVariants('+5511999998888').sort(), ['551199998888', '5511999998888']);
  assert.ok(phoneVariants('551199998888').includes('5511999998888'));
});
test('splitMessage respeita o limite e não perde texto', () => {
  const big = Array.from({ length: 40 }, (_, i) => 'parágrafo ' + i + ' ' + 'x'.repeat(100)).join('\n\n');
  const parts = splitMessage(big, 500);
  assert.ok(parts.every(p => p.length <= 500));
  assert.equal(parts.join(' ').replace(/\s+/g, ' ').length >= big.replace(/\s+/g, ' ').length - 5, true);
  assert.deepEqual(splitMessage('oi'), ['oi']);
  assert.deepEqual(splitMessage('  '), []);
});
test('HMAC e comparação em tempo constante', async () => {
  const h = await hmacSha256Hex('segredo', 'corpo');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await hmacSha256Hex('segredo', 'corpo'));
  assert.notEqual(h, await hmacSha256Hex('outro', 'corpo'));
  assert.ok(timingSafeEqualStr(h, h));
  assert.ok(!timingSafeEqualStr('a', 'ab'));
  assert.ok(!timingSafeEqualStr('abc', 'abd'));
});
test('horário de silêncio atravessa a meia-noite', () => {
  assert.ok(inQuietHours(22, 21, 7)); assert.ok(inQuietHours(3, 21, 7));
  assert.ok(!inQuietHours(12, 21, 7)); assert.ok(!inQuietHours(7, 21, 7));
  assert.ok(!inQuietHours(5, 5, 5));
});
test('isoWeekKey e projectToday', () => {
  assert.equal(isoWeekKey(new Date('2026-01-01T15:00:00Z')), '2026-W01');
  const d = projectToday({ reference_date: '2026-06-20' }, new Date());
  assert.equal(d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(), '2026-6-20');
});
test('truncate', () => { assert.equal(truncate('abcdef', 4), 'abc…'); assert.equal(truncate('abc', 4), 'abc'); });
