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
  const metrics = { schedule: 100, budget: 100, team: 100, quality: 100, learning: 100, scope: 100, risks: 100 };
  assert.strictEqual(HealthScore.calculate(metrics), 100);
});

test('Todas as dimensões em 0 → score 0', () => {
  const metrics = { schedule: 0, budget: 0, team: 0, quality: 0, learning: 0, scope: 0, risks: 0 };
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

// ── services/forecast → Forecast.analyze() ──────────────────────────────────
section('Tendência e previsão — Forecast.analyze() (services/forecast)');
const Forecast = loadModule('services/forecast', 'Forecast');

test('Menos de 2 pontos → "enough" é false, nunca inventa tendência', () => {
  assert.strictEqual(Forecast.analyze([], 'p1').enough, false);
  assert.strictEqual(Forecast.analyze([{ health_score:80, captured_at:'2026-01-01' }], 'p1').enough, false);
});

test('Saúde caindo 3 leituras seguidas → declineStreak = 3', () => {
  const rows = [
    { captured_at:'2026-01-01', health_score:90 },
    { captured_at:'2026-01-02', health_score:85 },
    { captured_at:'2026-01-03', health_score:80 },
    { captured_at:'2026-01-04', health_score:70 },
  ];
  const a = Forecast.analyze(rows, 'p1');
  assert.strictEqual(a.enough, true);
  assert.strictEqual(a.declineStreak, 3);
  assert.strictEqual(a.healthDelta, -20);
});

test('Saúde subindo → declineStreak = 0, healthDelta positivo', () => {
  const rows = [
    { captured_at:'2026-01-01', health_score:60 },
    { captured_at:'2026-01-02', health_score:70 },
  ];
  const a = Forecast.analyze(rows, 'p1');
  assert.strictEqual(a.declineStreak, 0);
  assert.strictEqual(a.healthDelta, 10);
});

test('Ritmo de queima projeta data de estouro do orçamento coerente com a reta', () => {
  // 10pp em 10 dias = 1pp/dia; de 50% faltam 50pp → 50 dias até 100%
  const rows = [
    { captured_at:'2026-01-01T00:00:00Z', budget_consumo_pct:40 },
    { captured_at:'2026-01-11T00:00:00Z', budget_consumo_pct:50 },
  ];
  const a = Forecast.analyze(rows, 'p1');
  assert.ok(a.budgetForecast, 'esperava budgetForecast calculado');
  assert.strictEqual(a.budgetForecast.daysToExhaust, 50);
});

test('Consumo de orçamento caindo ou estável → não projeta estouro (sem inventar previsão)', () => {
  const rows = [
    { captured_at:'2026-01-01T00:00:00Z', budget_consumo_pct:50 },
    { captured_at:'2026-01-11T00:00:00Z', budget_consumo_pct:50 },
  ];
  const a = Forecast.analyze(rows, 'p1');
  assert.strictEqual(a.budgetForecast, null);
});

// ── core/clock → Clock.today() ───────────────────────────────────────────────
section('"Hoje" do app — Clock (core/clock)');
const Clock = loadModule('core/clock', 'Clock');

test('Projeto de demonstração usa a data de referência; projeto real usa o dia de hoje', () => {
  global.DB = { getActiveProjectId: () => 'demo', listProjects: () => [{ id: 'demo', refDate: '2026-06-20' }, { id: 'real' }] };
  assert.strictEqual(Clock.iso(Clock.today()), '2026-06-20');
  assert.strictEqual(Clock.iso(Clock.today('demo')), '2026-06-20');
  const n = new Date();
  assert.strictEqual(Clock.iso(Clock.today('real')), Clock.iso(new Date(n.getFullYear(), n.getMonth(), n.getDate())));
});

test('Data de referência malformada é ignorada (nunca devolve data inválida)', () => {
  global.DB = { getActiveProjectId: () => 'x', listProjects: () => [{ id: 'x', refDate: '20/06/2026' }] };
  assert.ok(!isNaN(Clock.today().getTime()));
  assert.notStrictEqual(Clock.iso(Clock.today()), '2026-06-20');
});

test('Sem DB carregado cai no dia real sem lançar erro', () => {
  delete global.DB;
  assert.ok(!isNaN(Clock.today().getTime()));
});

// ── services/risk-matrix → RiskMatrix ────────────────────────────────────────
section('Matriz de riscos — RiskMatrix (services/risk-matrix)');
const RiskMatrix = loadModule('services/risk-matrix', 'RiskMatrix');

test('Faixas da nota: 1–4 baixo · 5–9 médio · 10–14 alto · 15–25 crítico', () => {
  [[1,'baixo'],[4,'baixo'],[5,'medio'],[9,'medio'],[10,'alto'],[14,'alto'],[15,'critico'],[25,'critico']]
    .forEach(([sc, k]) => assert.strictEqual(RiskMatrix.level(sc).key, k, `nota ${sc}`));
});

test('Nota = probabilidade × impacto; abertos = aberto + mitigando', () => {
  assert.strictEqual(RiskMatrix.scoreOf({ probability:4, impact:5 }), 20);
  assert.ok(RiskMatrix.isOpen({ status:'mitigando' }) && !RiskMatrix.isOpen({ status:'aceito' }) && !RiskMatrix.isOpen({ status:'ocorrido' }));
});

test('summarize conta por faixa só os abertos e as revisões vencidas', () => {
  const risks = [
    { status:'aberto', probability:5, impact:4, reviewOn:'2026-06-01' },   // 20 crítico, vencido
    { status:'mitigando', probability:3, impact:4, reviewOn:'2026-07-01' }, // 12 alto
    { status:'encerrado', probability:5, impact:5, reviewOn:'2026-01-01' }, // ignorado
    { status:'aberto', probability:1, impact:2 },                           // 2 baixo
  ];
  const s = RiskMatrix.summarize(risks, new Date(2026, 5, 20));
  assert.deepStrictEqual(s.byLevel, { critico:1, alto:1, medio:0, baixo:1 });
  assert.strictEqual(s.open, 3);
  assert.strictEqual(s.overdueReviews, 1);
});

test('healthScore: sem riscos = 100; cada crítico tira 25, alto 10, médio 3; piso 0', () => {
  assert.strictEqual(RiskMatrix.healthScore([]), 100);
  assert.strictEqual(RiskMatrix.healthScore([{ status:'aberto', probability:4, impact:4 }]), 75);
  assert.strictEqual(RiskMatrix.healthScore([{ status:'aberto', probability:4, impact:4 }, { status:'aberto', probability:2, impact:5 }, { status:'aberto', probability:2, impact:3 }]), 62);
  const many = Array.from({ length: 6 }, () => ({ status:'aberto', probability:5, impact:5 }));
  assert.strictEqual(RiskMatrix.healthScore(many), 0);
});

test('cellRisks agrupa por célula da matriz apenas riscos abertos', () => {
  const risks = [{ status:'aberto', probability:2, impact:3 }, { status:'aceito', probability:2, impact:3 }, { status:'aberto', probability:2, impact:4 }];
  assert.strictEqual(RiskMatrix.cellRisks(risks, 2, 3).length, 1);
});

// ── services/sheet-import → SheetParse / SheetImport ─────────────────────────
section('Importação de planilha — SheetParse/SheetImport (services/sheet-import)');
const { SheetParse, SheetImport } = (() => {
  const m = html.match(/<script data-module="services\/sheet-import">([\s\S]*?)<\/script>/);
  return new Function(`${m[1]}\nreturn { SheetParse, SheetImport };`)();
})();

test('CSV: ponto e vírgula, aspas, vírgula dentro de aspas, BOM e quebra de linha dentro da célula', () => {
  const rows = SheetParse.parseDelimited('﻿Nome;Obs\r\n"Silva, Ana";"linha 1\nlinha 2"\r\n"Aspas ""duplas""";ok\r\n');
  assert.deepStrictEqual(rows, [['Nome','Obs'], ['Silva, Ana','linha 1\nlinha 2'], ['Aspas "duplas"','ok']]);
});

test('CSV: detecta tabulação (colar do Excel) e ignora linhas vazias', () => {
  assert.deepStrictEqual(SheetParse.parseDelimited('a\tb\n\n1\t2'), [['a','b'], ['1','2']]);
});

test('Datas: ISO, dd/mm/aaaa, dd/mm/aa com dia da semana, serial do Excel; inválidas viram null', () => {
  assert.strictEqual(SheetParse.parseDate('2026-05-05'), '2026-05-05');
  assert.strictEqual(SheetParse.parseDate('05/05/2026'), '2026-05-05');
  assert.strictEqual(SheetParse.parseDate('seg 05/05/26'), '2026-05-05');
  assert.strictEqual(SheetParse.parseDate(46147), '2026-05-05');
  assert.strictEqual(SheetParse.parseDate('31/02/2026'), null);
  assert.strictEqual(SheetParse.parseDate('amanhã'), null);
});

test('Números: formato brasileiro, R$, %, milhar e decimal', () => {
  assert.strictEqual(SheetParse.parseNumber('R$ 1.234,56'), 1234.56);
  assert.strictEqual(SheetParse.parseNumber('2.500'), 2500);
  assert.strictEqual(SheetParse.parseNumber('1,5'), 1.5);
  assert.strictEqual(SheetParse.parseNumber('45%'), 45);
  assert.strictEqual(SheetParse.parseNumber('abc'), null);
  assert.strictEqual(SheetParse.parseHours('1h30'), 1.5);
  assert.strictEqual(SheetParse.parseHours('7:30'), 7.5);
});

test('autoMap reconhece colunas de exportação do MS Project (pt e en) e acha o cabeçalho abaixo do título', () => {
  const m1 = SheetImport.autoMap(['ID','Nome da tarefa','Duração','Início','Término','% concluída','Predecessoras','Nomes dos recursos'], 'wbs');
  assert.deepStrictEqual([m1.name, m1.start, m1.end, m1.pct, m1.pred, m1.owner, m1.id], [1, 3, 4, 5, 6, 7, 0]);
  const m2 = SheetImport.autoMap(['Task Name','Start','Finish','% Complete','Outline Level'], 'wbs');
  assert.deepStrictEqual([m2.name, m2.start, m2.end, m2.pct, m2.level], [0, 1, 2, 3, 4]);
  const matrix = [['Cronograma do projeto X'], [''], ['Nome da tarefa','Início','Término'], ['A','01/01/2026','10/01/2026']];
  assert.strictEqual(SheetImport.detectHeaderRow(matrix, 'wbs'), 2);
});

test('WBS: nível 1 vira entrega, nível 2 vira subtarefa; predecessoras do MS Project viram ids do app; datas trocadas avisam', () => {
  const rows = [
    ['1','Fase 1','01/05/2026','30/05/2026','50%','1','', ''],
    ['2','Levantamento','01/05/2026','10/05/2026','100%','2','', 'Ana'],
    ['3','Desenho','11/05/2026','05/05/2026','0%','2','2', 'Bia'],
    ['4','Fase 2','01/06/2026','30/06/2026','0%','1','1;3FS+2d', ''],
  ];
  const map = SheetImport.autoMap(['ID','Nome da tarefa','Início','Término','% concluída','Nível da estrutura de tópicos','Predecessoras','Nomes dos recursos'], 'wbs');
  const r = SheetImport.build('wbs', rows, map, { idSeed:'x' });
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual(r.rows.length, 2);
  assert.strictEqual(r.rows[0].children.length, 2);
  assert.strictEqual(r.rows[0].children[1].start, '2026-05-05', 'datas invertidas são trocadas');
  assert.ok(r.warnings.some(w => /trocadas/.test(w.msg)));
  const ids = new Set([r.rows[0].id, ...r.rows[0].children.map(c => c.id), r.rows[1].id]);
  assert.strictEqual(r.rows[1].predecessors.length, 2);
  r.rows[1].predecessors.forEach(p => assert.ok(ids.has(p)));
  assert.strictEqual(r.rows[0].children[0].status, 'grn');
  assert.strictEqual(r.rows[0].children[1].responsavel, 'Bia');
});

test('Obrigatórios: sem coluna mapeada nada é importado e o erro diz qual falta', () => {
  const r = SheetImport.build('risks', [['x']], { title: 0 }, {});
  assert.strictEqual(r.rows.length, 0);
  assert.ok(r.errors.some(e => /Probabilidade/.test(e.msg)) && r.errors.some(e => /Impacto/.test(e.msg)));
});

test('Riscos: valida faixa 1–5, mapeia categoria/resposta, ignora duplicados existentes', () => {
  const map = SheetImport.autoMap(['Risco','Probabilidade','Impacto','Categoria','Responsável','Resposta'], 'risks');
  const rows = [['Fornecedor atrasa','4','5','Externo','Ana','Evitar'], ['Sem nota','9','2','',' ',''], ['Já existe','2','2','','',''], ['Fornecedor atrasa','3','3','','','']];
  const r = SheetImport.build('risks', rows, map, { existingTitles: ['já existe'] });
  assert.strictEqual(r.rows.length, 1);
  assert.deepStrictEqual([r.rows[0].category, r.rows[0].response, r.rows[0].probability, r.rows[0].impact], ['externo','evitar',4,5]);
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.warnings.length, 2);
});

test('Horas: aceita 7:30 e 8h, recusa fora de 0–24 e data inválida; sem duplicar o que já existe', () => {
  const map = SheetImport.autoMap(['Pessoa','Data','Horas'], 'hours');
  const rows = [['Ana','01/06/2026','7:30'], ['Ana','01/06/2026','25'], ['Ana','32/13/2026','8'], ['Bia','02/06/2026','8h'], ['Bia','02/06/2026','8h']];
  const r = SheetImport.build('hours', rows, map, {});
  assert.deepStrictEqual(r.rows.map(x => [x.person, x.date, x.hours]), [['Ana','2026-06-01',7.5], ['Bia','2026-06-02',8]]);
  assert.strictEqual(r.errors.length, 2);
  assert.strictEqual(r.warnings.length, 1);
});

test('Custos: valor inválido é recusado; sem data usa hoje; tipo desconhecido vira "real"', () => {
  const map = SheetImport.autoMap(['Descrição','Valor','Data','Tipo'], 'costs');
  const r = SheetImport.build('costs', [['Licença','R$ 1.500,00','','Previsto'], ['Sem valor','abc','',''], ['Consultoria','2.000','10/06/2026','xyz']], map, { today:'2026-06-20' });
  assert.deepStrictEqual(r.rows.map(x => [x.label, x.amount, x.date, x.kind]), [['Licença',1500,'2026-06-20','comprometido'], ['Consultoria',2000,'2026-06-10','real']]);
  assert.strictEqual(r.errors.length, 1);
});

test('Equipe: não duplica quem já existe e limita alocação/carga', () => {
  const map = SheetImport.autoMap(['Nome','Função','Alocação'], 'team');
  const r = SheetImport.build('team', [['Ana','Dev','100'], ['ana','Dev','50'], ['Bia','QA','900']], map, { existingNames: [] });
  assert.deepStrictEqual(r.rows.map(x => [x.name, x.allocationPct]), [['Ana',100], ['Bia',200]]);
  assert.strictEqual(r.warnings.length, 1);
});

// ── Cobertura de limpeza na nuvem ─────────────────────────────────────────────
section('Nuvem — toda tabela de dados do projeto está na lista central de limpeza (core/cloud)');
test('PROJECT_DATA_TABLES cobre toda tabela do schema com project_id (exceto as de governança/mensagens)', () => {
  const m = html.match(/const PROJECT_DATA_TABLES = \[([^\]]+)\]/);
  assert.ok(m, 'lista PROJECT_DATA_TABLES não encontrada');
  const listed = new Set(m[1].match(/'([a-z_]+)'/g).map(s => s.replace(/'/g, '')));
  const schemaPath = path.join(__dirname, '..', 'schema.sql');
  assert.ok(fs.existsSync(schemaPath), 'schema.sql não existe — rode: node scripts/build-schema.mjs');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  // Tabelas que NÃO são "dados do projeto" para fins de Zerar base: governança (auditoria, acesso, snapshots), configuração por
  // projeto e equipe (têm fluxo próprio) e mensagens (pessoas externas — apagadas pelo administrador na tela Mensagens).
  const EXEMPT = new Set(['audit_log','project_access','project_snapshots','project_settings','team_members','board_decisions','wbs_tasks_legacy','message_recipient_projects','notification_outbox']);
  const tables = [...schema.matchAll(/create table if not exists public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/g)];
  const withProject = new Set();
  tables.forEach(([, name, body]) => { if (/\bproject_id\b/.test(body)) withProject.add(name); });
  // tabelas que ganham project_id por "alter table ... add column"
  [...schema.matchAll(/alter table public\.([a-z_]+)\s+add column if not exists project_id/g)].forEach(([, n]) => withProject.add(n));
  const missing = [...withProject].filter(t => !listed.has(t) && !EXEMPT.has(t));
  assert.deepStrictEqual(missing, [], `tabelas com project_id fora da lista de limpeza: ${missing.join(', ')}`);
});

// ── ui/column-drag → ordem das colunas ───────────────────────────────────────
section('Colunas arrastáveis — ColumnDrag (ui/column-drag)');
const ColumnDrag = loadModule('ui/column-drag', 'ColumnDrag');

test('moveOrder: antes/depois da coluna alvo, sem perder nem duplicar colunas', () => {
  assert.deepStrictEqual(ColumnDrag.moveOrder([0,1,2,3], 0, 2, false), [1,0,2,3]);
  assert.deepStrictEqual(ColumnDrag.moveOrder([0,1,2,3], 0, 2, true), [1,2,0,3]);
  assert.deepStrictEqual(ColumnDrag.moveOrder([0,1,2,3], 3, 0, false), [3,0,1,2]);
  assert.deepStrictEqual(ColumnDrag.moveOrder([0,1,2,3], 1, 1, true), [0,1,2,3]);
  for (let f = 0; f < 4; f++) for (let t = 0; t < 4; t++) for (const a of [false, true])
    assert.ok(ColumnDrag.isPermutation(ColumnDrag.moveOrder([0,1,2,3], f, t, a), 4));
});

test('isPermutation recusa ordem salva de uma tabela com outro número de colunas', () => {
  assert.ok(ColumnDrag.isPermutation([2,0,1], 3));
  assert.ok(!ColumnDrag.isPermutation([2,0,1], 4));
  assert.ok(!ColumnDrag.isPermutation([0,0,1], 3));
  assert.ok(!ColumnDrag.isPermutation('x', 1));
});

// ── Versão publicada: um número só em todos os lugares ───────────────────────
section('Versão e aviso de atualização (ui/update-check)');
const UpdateCheck = loadModule('ui/update-check', 'UpdateCheck');

test('version.json, BRAND.version, package.json e cache do service worker têm a MESMA versão', () => {
  const root = path.join(__dirname, '..');
  const v = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).version;
  const brand = html.match(/tagline: [^\n]*\n\s*version: '([0-9.]+)'/)[1];
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/CACHE_NAME = 'pmo-compass-v([0-9.]+)'/)[1];
  assert.deepStrictEqual([brand, pkg, sw], [v, v, v], 'suba a versão nos 4 lugares ao publicar (senão o aviso de atualização não dispara)');
});

test('differs: avisa quando a versão publicada é outra e nunca com resposta vazia', () => {
  assert.ok(UpdateCheck.differs('2.1.0', '2.1.1'));
  assert.ok(UpdateCheck.differs('2.1.1', '2.1.0'));
  assert.ok(!UpdateCheck.differs('2.1.1', '2.1.1'));
  assert.ok(!UpdateCheck.differs('2.1.1', undefined));
  assert.ok(!UpdateCheck.differs('2.1.1', ''));
});

// ── Resultado ────────────────────────────────────────────────────────────────
console.log(`\n${passed} passaram, ${failed} falharam.`);
process.exit(failed > 0 ? 1 : 0);
