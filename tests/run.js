#!/usr/bin/env node
// Suite de regressão para a lógica pura do PMO Compass (PMO_Compass_v2.html).
//
// O app é um HTML único sem build (Vercel serve o arquivo direto — ver vercel.json), então
// este script não usa nenhuma dependência: extrai o código-fonte de blocos <script> específicos
// direto do HTML e o avalia isoladamente, testando só a lógica que não depende de DOM/rede/nuvem
// (mascaramento LGPD, cálculo de caminho crítico, health score). Não substitui teste manual de
// UI/integração — cobre a parte que mais provoca bug silencioso quando alguém mexe em regex ou
// em fórmula sem perceber o efeito colateral.
//
// Rodar: node tests/run.js  (sai com código 1 se alguma asserção falhar — dá pra plugar em CI)

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const HTML_PATH = path.join(__dirname, '..', 'PMO_Compass_v2.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (e) { failed++; console.log(`  FALHA — ${name}\n    ${e.message}`); }
}
function section(title) { console.log(`\n${title}`); }

// ── Extração de código-fonte do HTML ────────────────────────────────────────

// Pega o conteúdo inteiro de um bloco <script data-module="X">...</script> e o avalia,
// devolvendo o valor da variável global que o módulo declara (ex.: "CPM", "HealthScore").
// Seguro porque esses módulos só DECLARAM funções/objetos no top-level — nada é chamado até
// o teste chamar explicitamente, então referências a DB/Auth/Cloud dentro de function bodies
// nunca são avaliadas.
function loadModule(dataModuleAttr, globalName) {
  const re = new RegExp(`<script data-module="${dataModuleAttr}">([\\s\\S]*?)<\\/script>`);
  const m = html.match(re);
  if (!m) throw new Error(`Bloco <script data-module="${dataModuleAttr}"> não encontrado`);
  const fn = new Function(`${m[1]}\nreturn ${globalName};`);
  return fn();
}

// Extrai só o corpo de UMA function nomeada de dentro de um bloco de módulo (contagem de
// chaves) — usado para módulos como file-intake, cujo anonymize() é interno e não exposto no
// return público. Evita ter de avaliar o módulo inteiro (que referencia Auth/DB/Cloud/XLSX).
function extractFunction(dataModuleAttr, fnName) {
  const blockRe = new RegExp(`<script data-module="${dataModuleAttr}">([\\s\\S]*?)<\\/script>`);
  const blockMatch = html.match(blockRe);
  if (!blockMatch) throw new Error(`Bloco <script data-module="${dataModuleAttr}"> não encontrado`);
  const src = blockMatch[1];
  const startMarker = `function ${fnName}(`;
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error(`function ${fnName}( não encontrada em ${dataModuleAttr}`);
  let i = src.indexOf('{', start);
  let depth = 0, end = i;
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}') { depth--; if (depth === 0) break; }
  }
  const fnSrc = src.slice(start, end + 1);
  const wrapped = new Function(`${fnSrc}\nreturn ${fnName};`);
  return wrapped();
}

// ── services/file-intake → anonymize() ──────────────────────────────────────
section('LGPD — anonymize() (services/file-intake)');
const anonymize = extractFunction('services/file-intake', 'anonymize');

const anonymizeCases = [
  ['CPF com pontuação', 'CPF: 123.456.789-01', true],
  ['CPF sem pontuação', 'CPF 12345678901', true],
  ['CPF com espaços', '123 456 789 01', true],
  ['CNPJ com pontuação', 'CNPJ: 12.345.678/0001-99', true],
  ['CNPJ sem pontuação', 'CNPJ 12345678000199', true],
  ['E-mail simples', 'contato: joao.silva@empresa.com.br', true],
  ['E-mail com subdomínio', 'joao@mail.empresa.com.br', true],
  ['Telefone com DDD e traço', '(11) 98765-4321', true],
  ['Telefone sem formatação', '11987654321', true],
  ['Telefone fixo (8 dígitos + DDD)', '(11) 3456-7890', true],
  ['Telefone com código do país', '+55 11 98765-4321', true],
  ['CEP formatado', 'CEP 01310-100', true],
  ['CEP sem traço, com contexto "CEP"', 'CEP 01310100', true],
  ['CEP sem traço, sem contexto — NÃO deve redigir', 'código interno 01310100', false],
  ['RG com contexto', 'RG: 34.567.890-1', true],
  ['RG sem contexto — NÃO deve redigir (ambíguo demais)', '34.567.890-1', false],
  ['Código de projeto — NÃO deve redigir', 'Código interno: PRJ-ERP-VULCANO-2026', false],
  ['Data — NÃO deve redigir', 'Início do projeto: 12/01/2026', false],
  ['Número de pedido de 8 dígitos — NÃO deve redigir', 'Pedido nº 20260458', false],
  ['Valor monetário — NÃO deve redigir', 'R$ 1.850.000,00', false],
  ['Numeração de item de WBS — NÃO deve redigir', '1.3.2 Aprovação orçamentária', false],
  ['Dois CPFs na mesma linha', 'Responsáveis: 123.456.789-01 e 987.654.321-00', true],
  ['CEP dentro de endereço, sem a palavra CEP', 'Rua das Flores, 100 - 04567-890, São Paulo', true],
];

anonymizeCases.forEach(([label, input, expectRedacted]) => {
  test(label, () => {
    const { redactions } = anonymize(input);
    assert.strictEqual(redactions > 0, expectRedacted,
      `esperava redigir=${expectRedacted}, obteve redactions=${redactions} para "${input}"`);
  });
});

test('Texto vazio não quebra', () => {
  assert.deepStrictEqual(anonymize(''), { text: '', redactions: 0 });
});

// ── services/cpm → CPM.compute() ────────────────────────────────────────────
section('Caminho crítico — CPM.compute() (services/cpm)');
const CPM = loadModule('services/cpm', 'CPM');

test('Cadeia linear de 3 itens: todos ficam no caminho crítico, folga zero', () => {
  const items = [
    { id: 'a', start: '2026-01-01', end: '2026-01-10', predecessors: [] },
    { id: 'b', start: '2026-01-10', end: '2026-01-20', predecessors: ['a'] },
    { id: 'c', start: '2026-01-20', end: '2026-01-25', predecessors: ['b'] },
  ];
  const { error, result } = CPM.compute(items);
  assert.strictEqual(error, null);
  ['a', 'b', 'c'].forEach(id => assert.strictEqual(result.get(id).critical, true, `${id} deveria ser crítico`));
});

test('Item sem nenhuma dependência é ignorado (não compete pelo fim do projeto)', () => {
  const items = [
    { id: 'a', start: '2026-01-01', end: '2026-01-10', predecessors: [] },
    { id: 'b', start: '2026-01-10', end: '2026-01-20', predecessors: ['a'] },
    { id: 'isolado', start: '2026-06-01', end: '2026-06-30', predecessors: [] },
  ];
  const { result } = CPM.compute(items);
  assert.strictEqual(result.has('isolado'), false, 'item isolado não deveria entrar no cálculo');
});

test('Dependência circular é detectada e reportada como erro', () => {
  const items = [
    { id: 'a', start: '2026-01-01', end: '2026-01-05', predecessors: ['b'] },
    { id: 'b', start: '2026-01-05', end: '2026-01-10', predecessors: ['a'] },
  ];
  const { error } = CPM.compute(items);
  assert.ok(error && /circular/i.test(error), 'esperava erro de dependência circular');
});

test('Predecessora referenciando id inexistente é ignorada sem quebrar', () => {
  const items = [
    { id: 'a', start: '2026-01-01', end: '2026-01-10', predecessors: ['nao-existe'] },
  ];
  const { error, result } = CPM.compute(items);
  assert.strictEqual(error, null);
  assert.strictEqual(result.has('a'), false, 'sem predecessora válida, item não entra no grafo');
});

test('Lista vazia não quebra', () => {
  const { error, result } = CPM.compute([]);
  assert.strictEqual(error, null);
  assert.strictEqual(result.size, 0);
});

// ── services/health-score → HealthScore.calculate()/getStatus() ────────────
section('Health Score — calculate()/getStatus() (services/health-score)');
const HealthScore = loadModule('services/health-score', 'HealthScore');

test('Todas as dimensões em 100 → score 100', () => {
  const metrics = { schedule: 100, budget: 100, team: 100, quality: 100, learning: 100, scope: 100 };
  assert.strictEqual(HealthScore.calculate(metrics), 100);
});

test('Todas as dimensões em 0 → score 0', () => {
  const metrics = { schedule: 0, budget: 0, team: 0, quality: 0, learning: 0, scope: 0 };
  assert.strictEqual(HealthScore.calculate(metrics), 0);
});

test('Pesos batem 100% (soma de WEIGHTS)', () => {
  const total = Object.values(HealthScore.WEIGHTS).reduce((s, w) => s + w, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `soma dos pesos é ${total}, deveria ser 1`);
});

test('getStatus: limiares grn/amb/red', () => {
  assert.strictEqual(HealthScore.getStatus(80).label, 'Saudável');
  assert.strictEqual(HealthScore.getStatus(79).label, 'Atenção');
  assert.strictEqual(HealthScore.getStatus(60).label, 'Atenção');
  assert.strictEqual(HealthScore.getStatus(59).label, 'Em risco');
  assert.strictEqual(HealthScore.getStatus(0).label, 'Em risco');
});

// ── Resultado ────────────────────────────────────────────────────────────────
console.log(`\n${passed} passaram, ${failed} falharam.`);
process.exit(failed > 0 ? 1 : 0);
