// Motor de "fatos" do projeto — o que o assistente (WhatsApp) e o resumo semanal podem afirmar.
// A regra de ouro: a IA NUNCA calcula nem inventa número; ela só reformula os fatos produzidos aqui,
// a partir das linhas do banco. As fórmulas espelham o app (Budget.computeMetrics, Dashboard,
// ratioCode do Farol) — tests/unit/facts.parity.test.mjs compara as duas implementações com os mesmos dados.
import { parseIsoDate, isoDate, projectToday, truncate, redactPii, fmtDateBr } from './util.mjs';

export function riskLevel(score) { return score >= 15 ? 'crítico' : score >= 10 ? 'alto' : score >= 5 ? 'médio' : 'baixo'; }

// Mesma leitura do Farol da Diretoria: 1,00 = no combinado; fora de 0,5–1,3 quase sempre é erro de lançamento.
export function ratioCode(v) {
  if (v == null) return null;
  if (v > 1.3 || v < 0.5) return 'amb';
  if (v >= 1) return 'grn';
  if (v >= 0.9) return 'amb';
  return 'red';
}
const CODE_WORD = { grn: 'verde', amb: 'amarelo', red: 'vermelho' };
const STATUS_TO_FAROL = { 'Saudável': 'verde', 'Atenção': 'amarelo', 'Em risco': 'vermelho' };

function expectedPct(start, end, today) {
  if (!start || !end) return null;
  const s = parseIsoDate(start).getTime(), e = parseIsoDate(end).getTime(), t = today.getTime();
  if (e <= s) return null;
  if (t <= s) return 0;
  if (t >= e) return 100;
  return Math.round(((t - s) / (e - s)) * 100);
}
const num = v => (v == null || v === '' ? 0 : Number(v) || 0);

// Pessoas cuja soma de alocação entre TODOS os projetos passa de 100% (mesma regra de
// DB.computePortfolioAllocation: casa por nome, alocação ausente conta 100).
export function overallocatedNames(allTeamRows) {
  const sum = new Map();
  for (const m of allTeamRows || []) {
    const k = String(m.name || '').trim().toLowerCase();
    if (!k) continue;
    sum.set(k, (sum.get(k) || 0) + (m.allocation_pct != null ? num(m.allocation_pct) : 100));
  }
  return new Set([...sum].filter(([, v]) => v > 100).map(([k]) => k));
}

export function computeFacts(input, nowDate = new Date()) {
  const { project } = input;
  const today = projectToday(project, nowDate);
  const wbs = input.wbs || [], lines = input.budgetLines || [], actuals = input.costActuals || [];
  const decisions = input.decisions || [], risks = input.risks || [], scope = input.scope || [], team = input.team || [];
  const snapshot = input.snapshot || null;

  // ── Prazo ──
  const moduleCount = wbs.length;
  const avgPct = moduleCount ? Math.round(wbs.reduce((s, m) => s + num(m.pct), 0) / moduleCount) : null;
  const delayed = wbs
    .filter(m => m.status !== 'grn' && m.end_date && parseIsoDate(m.end_date) < today)
    .map(m => ({ label: m.label, daysLate: Math.round((today - parseIsoDate(m.end_date)) / 86400000) }))
    .sort((a, b) => b.daysLate - a.daysLate);
  const next = wbs
    .filter(m => m.status !== 'grn' && m.end_date && parseIsoDate(m.end_date) >= today)
    .sort((a, b) => (a.end_date < b.end_date ? -1 : 1)).slice(0, 3)
    .map(m => ({ label: m.label, end: m.end_date }));

  // ── Custo e prazo em valor (EVM) ──
  const base = lines.filter(l => !l.is_reserve), reserve = lines.filter(l => l.is_reserve);
  const BAC = base.reduce((s, l) => s + num(l.planned_value), 0);
  const reserveInitial = reserve.reduce((s, l) => s + num(l.planned_value), 0);
  const AC = actuals.filter(a => a.kind === 'real').reduce((s, a) => s + num(a.amount), 0);
  let EV = 0, PV = 0;
  for (const l of base) {
    if (!l.wbs_module_id) continue;
    const m = wbs.find(x => x.id === l.wbs_module_id);
    if (!m) continue;
    EV += num(l.planned_value) * (num(m.pct) / 100);
    const exp = expectedPct(m.start_date, m.end_date, today);
    PV += num(l.planned_value) * ((exp == null ? num(m.pct) : exp) / 100);
  }
  const CPI = AC > 0 ? EV / AC : null;
  const SPI = PV > 0 ? EV / PV : null;
  const EAC = (CPI && CPI > 0) ? AC + (BAC - EV) / CPI : BAC;
  const consumoPct = BAC > 0 ? Math.round((AC / BAC) * 100) : null;

  // ── Semáforo: a leitura do app (mais completa) se for recente; senão estimativa pelos índices ──
  let farol = { color: null, source: null, asOf: null, healthScore: null };
  const snapAge = snapshot ? Math.round((today - parseIsoDate(String(snapshot.captured_at).slice(0, 10))) / 86400000) : null;
  if (snapshot && STATUS_TO_FAROL[snapshot.health_status] && (project.reference_date || snapAge <= 14)) {
    farol = { color: STATUS_TO_FAROL[snapshot.health_status], source: 'leitura', asOf: String(snapshot.captured_at).slice(0, 10), healthScore: snapshot.health_score ?? null };
  } else {
    const codes = [ratioCode(SPI), ratioCode(CPI)].filter(Boolean);
    if (codes.length) farol = { color: CODE_WORD[codes.includes('red') ? 'red' : codes.includes('amb') ? 'amb' : 'grn'], source: 'indices', asOf: isoDate(today), healthScore: null };
  }

  // ── Decisões, riscos, escopo, equipe ──
  const pendingCritical = decisions.filter(d => d.status === 'pending' && d.severity === 'crit').map(d => d.title);
  const openRisks = risks.filter(r => r.status === 'aberto' || r.status === 'mitigando').sort((a, b) => num(b.score) - num(a.score));
  const byLevel = { crítico: 0, alto: 0, médio: 0, baixo: 0 };
  openRisks.forEach(r => { byLevel[riskLevel(num(r.score))]++; });
  const openScope = scope.filter(s => s.status === 'pending' || s.status === 'analysis');
  const over = input.overallocated || new Set();
  const overCount = team.filter(m => over.has(String(m.name || '').trim().toLowerCase())).length;
  const lb = (input.boardDecisions || []).filter(b => b.board_decision).sort((a, b) => (a.decided_at < b.decided_at ? 1 : -1))[0] || null;

  return {
    project: { id: project.id, name: project.name, client: project.client || '' },
    asOf: isoDate(today), usesReferenceDate: !!project.reference_date,
    farol,
    schedule: { moduleCount, avgPct, doneCount: wbs.filter(m => m.status === 'grn').length, delayedCount: delayed.length, delayed: delayed.slice(0, 5), next, spi: SPI },
    budget: {
      hasBudget: BAC > 0, consumoPct, cpi: CPI, spi: SPI,
      eacPctOfBac: BAC > 0 ? Math.round((EAC / BAC) * 100) : null,
      amounts: { bac: BAC, ac: AC, eac: EAC, reserveInitial },
    },
    decisions: { pendingCritical: pendingCritical.slice(0, 5), pendingCriticalCount: pendingCritical.length },
    risks: { openCount: openRisks.length, byLevel, top: openRisks.slice(0, 5).map(r => ({ title: r.title, score: num(r.score), level: riskLevel(num(r.score)), status: r.status, owner: r.owner_name || '' })) },
    scope: { openCount: openScope.length, daysImpact: openScope.reduce((s, x) => s + num(x.impact_days), 0), costImpact: openScope.reduce((s, x) => s + num(x.impact_cost), 0) },
    team: { size: team.length, overallocated: overCount, highLoad: team.filter(m => num(m.workload_pct) >= 85).length },
    lastBoardDecision: lb ? { decision: lb.board_decision, decidedAt: String(lb.decided_at || '').slice(0, 10) } : null,
  };
}

// Remove tudo que é dinheiro quando a pessoa não pode ver finanças (a regra mora aqui, no servidor).
export function restrictFacts(facts, canSeeFinancials) {
  const f = JSON.parse(JSON.stringify(facts));
  if (!canSeeFinancials) { delete f.budget.amounts; delete f.scope.costImpact; }
  return f;
}

const fmt1 = v => (v == null ? '—' : v.toFixed(2).replace('.', ','));
const money = v => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
const safe = s => '«' + truncate(redactPii(String(s || '')).replace(/[\r\n\t]+/g, ' ').replace(/[«»]/g, '"'), 120) + '»';
function ratioWord(v, kind) {
  const c = ratioCode(v);
  if (v == null) return 'sem dado suficiente';
  if (v > 1.3 || v < 0.5) return 'valor atípico — conferir os lançamentos';
  if (c === 'grn') return kind === 'spi' ? 'no prazo ou adiantado' : 'dentro do orçamento';
  if (c === 'amb') return 'atenção (um pouco abaixo do combinado)';
  return kind === 'spi' ? 'atrasado em relação ao planejado' : 'gastando acima do previsto pelo que já foi entregue';
}

// Texto que vai para a IA (ou para a resposta determinística). Títulos digitados por usuários vão entre « »
// e truncados: são DADOS, nunca instruções.
export function factsToText(f, { canSeeFinancials = false } = {}) {
  const L = [];
  L.push(`PROJETO: ${f.project.name}${f.project.client ? ` (${f.project.client})` : ''}`);
  L.push(`Data de referência dos números: ${fmtDateBr(f.asOf)}${f.usesReferenceDate ? ' (projeto de demonstração)' : ''}`);
  if (f.farol.color) {
    L.push(`Semáforo geral: ${f.farol.color} — ${f.farol.source === 'leitura'
      ? `leitura do aplicativo em ${fmtDateBr(f.farol.asOf)}${f.farol.healthScore != null ? `, saúde ${f.farol.healthScore}/100` : ''}`
      : 'estimado pelos índices de prazo e custo (não há leitura recente do aplicativo)'}`);
  } else L.push('Semáforo geral: sem dados suficientes');
  const s = f.schedule;
  if (s.moduleCount) {
    L.push(`Prazo: ${s.avgPct}% concluído em média; ${s.doneCount} de ${s.moduleCount} entregas concluídas; ${s.delayedCount} atrasada(s)${s.delayed.length ? ': ' + s.delayed.map(d => `${safe(d.label)} (${d.daysLate} dia(s))`).join(', ') : ''}`);
    if (s.next.length) L.push(`Próximas entregas: ${s.next.map(n => `${safe(n.label)} até ${fmtDateBr(n.end)}`).join('; ')}`);
  } else L.push('Prazo: nenhuma entrega cadastrada na WBS');
  const b = f.budget;
  if (b.hasBudget) {
    L.push(`Índice de prazo (SPI): ${fmt1(b.spi)} — ${ratioWord(b.spi, 'spi')}`);
    L.push(`Índice de custo (CPI): ${fmt1(b.cpi)} — ${ratioWord(b.cpi, 'cpi')}`);
    L.push(`Orçamento: ${b.consumoPct}% do orçado já consumido; previsão no término = ${b.eacPctOfBac}% do orçado`);
    if (canSeeFinancials && b.amounts) L.push(`Valores: orçado ${money(b.amounts.bac)}, gasto ${money(b.amounts.ac)}, previsão no término ${money(b.amounts.eac)}`);
  } else L.push('Orçamento: nenhuma linha de orçamento lançada');
  L.push(f.decisions.pendingCriticalCount
    ? `Decisões críticas pendentes (${f.decisions.pendingCriticalCount}): ${f.decisions.pendingCritical.map(safe).join('; ')}`
    : 'Decisões críticas pendentes: nenhuma');
  const r = f.risks;
  L.push(r.openCount
    ? `Riscos abertos: ${r.openCount} (${r.byLevel.crítico} crítico(s), ${r.byLevel.alto} alto(s), ${r.byLevel.médio} médio(s), ${r.byLevel.baixo} baixo(s)). Principais: ${r.top.map(x => `${safe(x.title)} [${x.level}, nota ${x.score}${x.owner ? ', dono ' + safe(x.owner) : ''}]`).join('; ')}`
    : 'Riscos abertos: nenhum registrado');
  L.push(f.scope.openCount
    ? `Mudanças de escopo sem aprovação: ${f.scope.openCount} (impacto de +${f.scope.daysImpact} dia(s)${canSeeFinancials && f.scope.costImpact ? `, +${money(f.scope.costImpact)}` : ''})`
    : 'Mudanças de escopo sem aprovação: nenhuma');
  L.push(`Equipe: ${f.team.size} pessoa(s)${f.team.size ? `; ${f.team.overallocated} sobrealocada(s) entre projetos; ${f.team.highLoad} com carga muito alta` : ''}`);
  if (f.lastBoardDecision) L.push(`Última decisão da diretoria: ${f.lastBoardDecision.decision} em ${fmtDateBr(f.lastBoardDecision.decidedAt)}`);
  return L.join('\n');
}

// Frase curta de uma linha por projeto (comando "projetos" e resumo semanal) — determinística, sem IA.
export function oneLineStatus(f) {
  const emoji = { verde: '🟢', amarelo: '🟡', vermelho: '🔴' }[f.farol.color] || '⚪';
  const bits = [];
  if (f.schedule.moduleCount) bits.push(`${f.schedule.avgPct}% concluído`);
  if (f.schedule.delayedCount) bits.push(`${f.schedule.delayedCount} atrasada(s)`);
  if (f.decisions.pendingCriticalCount) bits.push(`${f.decisions.pendingCriticalCount} decisão(ões) crítica(s)`);
  if (f.risks.byLevel['crítico']) bits.push(`${f.risks.byLevel['crítico']} risco(s) crítico(s)`);
  return `${emoji} ${f.project.name}${bits.length ? ' — ' + bits.join(', ') : ''}`;
}
