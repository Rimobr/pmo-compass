import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/card-flow">([\s\S]*?)<\/script>/);
const { CardFlow } = new Function(`${m[1]}\nreturn { CardFlow };`)();
const cols = [{ key: 'todo', label: 'A fazer' }, { key: 'doing', label: 'Em andamento' }, { key: 'review', label: 'Em revisão' }, { key: 'qa', label: 'Em testes' }, { key: 'done', label: 'Concluído' }];
const mv = (day, by, from, to) => ({ at: `2026-11-${day}T10:00:00Z`, by, field: 'Situação', from, to });
const note = (day, by, text) => ({ at: `2026-11-${day}T10:00:30Z`, by, field: '', from: '', to: 'Comentário: ' + text });
const card = { status: 'doing', history: [
  { at: '2026-11-01T10:00:00Z', by: 'Ana', field: '', from: '', to: 'Card criado' },
  mv('02', 'Ana', 'A fazer', 'Em andamento'), mv('03', 'Ana', 'Em andamento', 'Em revisão'), mv('04', 'Bia', 'Em revisão', 'Em testes'),
  mv('05', 'Caio', 'Em testes', 'Em andamento'), note('05', 'Caio', 'botão não responde'),
  mv('06', 'Claude Code (correção automática)', 'Em andamento', 'Em revisão'), mv('07', 'Bia', 'Em revisão', 'Em andamento'),
] };

test('voltas por etapa de origem, com quem devolveu, quem tinha enviado e o motivo', () => {
  const a = CardFlow.analyze(card, cols, Date.parse('2026-11-09T10:00:00Z'), {});
  assert.equal(a.returns, 2);
  assert.deepEqual(a.returnsBy, [{ label: 'Em revisão', count: 1 }, { label: 'Em testes', count: 1 }]);
  const [t, r] = a.returnList;
  assert.deepEqual([t.from, t.to, t.by, t.sent, t.reason], ['Em testes', 'Em andamento', 'Caio', 'Bia', 'botão não responde']);
  assert.deepEqual([r.from, r.by, r.sent], ['Em revisão', 'Bia', 'Correção automática']);
  assert.equal(a.lastReturn.from, 'Em revisão');
});
test('tempo por etapa soma todas as passagens', () => {
  const a = CardFlow.analyze(card, cols, Date.parse('2026-11-09T10:00:00Z'), {});
  const dias = Object.fromEntries(a.stages.map(s => [s.label, s.days]));
  assert.equal(dias['Em andamento'], 4); // 1 (02 a 03) + 1 (05 a 06) + 2 (07 a 09)
  assert.equal(dias['Em testes'], 1);
});
test('retrabalho de vários cards: total, por etapa e por quem tinha enviado', () => {
  const a = CardFlow.analyze(card, cols, Date.parse('2026-11-09T10:00:00Z'), {});
  const w = CardFlow.rework([{ key: 'A', returnList: a.returnList }, { key: 'B', returnList: [a.returnList[0]] }, { key: 'C', returnList: [] }]);
  assert.equal(w.total, 3); assert.equal(w.cards, 2);
  assert.deepEqual(w.byStage.map(x => [x.name, x.count, Object.keys(x.keys).length]), [['Em testes', 2, 2], ['Em revisão', 1, 1]]);
  assert.deepEqual(w.bySender.map(x => [x.name, x.count]), [['Bia', 2], ['Correção automática', 1]]);
});
test('card que nunca voltou: nada a mostrar', () => {
  const a = CardFlow.analyze({ status: 'doing', history: card.history.slice(0, 2) }, cols, Date.parse('2026-11-09T10:00:00Z'), {});
  assert.equal(a.returns, 0); assert.deepEqual(a.returnsBy, []); assert.equal(a.lastReturn, null);
});
