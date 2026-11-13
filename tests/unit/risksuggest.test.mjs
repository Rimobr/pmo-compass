import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'PMO_Compass_v2.html'), 'utf8');
const m = html.match(/<script data-module="services\/risk-suggest">([\s\S]*?)<\/script>/);
const { RiskSuggest: R } = new Function(`${m[1]}\nreturn { RiskSuggest };`)();

const base = (o = {}) => ({ title: 'Fornecedor atrasa a entrega e o go-live escorrega', description: '', today: '2026-11-11', signals: {}, wbs: [], me: 'Ricardo', ...o });

test('rascunho de risco: título curto não gera sugestão', () => {
  assert.equal(R.analyze(base({ title: 'ok' })), null);
});
test('rascunho de risco: categoria pelo texto, impacto pela gravidade e probabilidade pelo que o projeto já mostra', () => {
  const sem = R.analyze(base({ title: 'Atraso na entrega do módulo de relatórios' }));
  assert.equal(sem.category, 'prazo'); assert.equal(sem.probability, 3); assert.equal(sem.impact, 4); // "atraso": efeito médio-alto
  const com = R.analyze(base({ title: 'Atraso na entrega do módulo de relatórios', signals: { delayedModules: 2, overdueCards: 2 } }));
  assert.equal(com.probability, 5); assert.ok(com.why.some(w => /4 entrega\(s\)\/card\(s\) já atrasados/.test(w)));
  assert.equal(R.analyze(base({ title: 'Pode parar toda a operação do cliente por falha técnica' })).impact, 5);
  assert.equal(R.analyze(base({ title: 'Pequeno atraso pontual em um relatório menor' })).impact, 3); // "pequeno" abaixa um nível
  assert.equal(R.analyze(base({ title: 'Detalhe pequeno de texto numa tela menor' })).impact, 2);
});
test('rascunho de risco: carga alta da equipe, orçamento consumido, bugs e mudanças de escopo pesam na probabilidade da categoria certa', () => {
  const rec = R.analyze(base({ title: 'Sobrecarga da equipe de desenvolvimento pode gerar saída de pessoas', signals: { loaded: [{ name: 'Ana', pct: 132 }, { name: 'Bia', pct: 90 }] } }));
  assert.equal(rec.category, 'recursos'); assert.equal(rec.probability, 5); assert.match(rec.mitigation, /Ana \(132%\), Bia \(90%\)/);
  const cus = R.analyze(base({ title: 'Estouro do orçamento por reajuste de custo', signals: { budgetPct: 104 } }));
  assert.equal(cus.category, 'custo'); assert.equal(cus.probability, 5);
  assert.equal(R.analyze(base({ title: 'Defeitos e retrabalho nos testes', signals: { openBugs: 7 } })).category, 'qualidade');
  assert.equal(R.analyze(base({ title: 'Mudança de escopo sem controle, novo pedido do cliente', signals: { openScope: 4 } })).category, 'escopo');
  assert.equal(R.analyze(base({ title: 'Prazo apertado no cronograma', signals: { loaded: [{ name: 'Ana', pct: 99 }] } })).probability, 3); // carga alta só pesa em risco de pessoas
});
test('rascunho de risco: resposta, revisão e responsável', () => {
  const crit = R.analyze(base({ title: 'Pode parar o sistema inteiro por falha de migração', signals: {} }));
  assert.equal(crit.reviewOn, '2026-11-18'); assert.equal(crit.response, 'mitigar'); // 3 x 5 = 15: crítico, revisão em 7 dias
  const ext = R.analyze(base({ title: 'Dependência do fornecedor de integração: atraso e multa', signals: {} }));
  assert.equal(ext.category, 'externo'); assert.equal(ext.response, 'transferir');
  const baixo = R.analyze(base({ title: 'Detalhe pequeno de texto numa tela menor, raro', signals: {} }));
  assert.equal(baixo.response, 'aceitar'); assert.equal(baixo.reviewOn, '2027-01-10'); // nota baixa: revisão em 60 dias
  const dono = R.analyze(base({ title: 'Atraso na entrega de Relatórios gerenciais', wbs: [{ label: 'Relatórios gerenciais', responsavel: 'Leandro' }, { label: 'Cadastros', responsavel: 'Ana' }] }));
  assert.equal(dono.owner, 'Leandro');
  assert.equal(R.analyze(base({ title: 'Algo que pode dar errado no projeto', me: 'Marcos' })).owner, 'Marcos'); // sem entrega citada: quem registra
  assert.equal(R.analyze(base({ title: 'Atraso grande na entrega', nextWorking: d => d === '2026-11-25' ? '2026-11-26' : d })).reviewOn, '2026-11-26'); // respeita o calendário de trabalho
});
test('rascunho de risco: ligado ao formulário, sem sobrescrever o que a pessoa já preencheu', () => {
  for (const k of ['id="rk-f-sug"', 'function riskSignals()', 'function sugApply(all)', 'Sugestão do sistema (rascunho)', 'Usar Sugestão nos Campos Vazios', "(pid === DB.getActiveProjectId() && typeof Burnout !== 'undefined')"]) assert.ok(html.includes(k), k);
});
