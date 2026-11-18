// GERADO por scripts/build-intel.mjs a partir de PMO_Compass_v2.html. NÃO edite aqui.
// Cada módulo abaixo é o mesmo código do app; a função de borda `intel` só chama o que está em FUNCS.

// ── services/decision-center ──
const DecisionCenter = (() => {
  const LV = s => s >= 85 ? 'crit' : s >= 65 ? 'high' : 'med';
  const pl = (n, a, b) => n + ' ' + (n === 1 ? a : b);
  // input: { projects:[{ id, name, facts, ev, sprint }], capacity:[{ key, name, total, open, plan }], sysRisks:[{ key, person, projectId, projectName, title }], canCosts }
  function build(input) {
    const out = [], P = (input && input.projects) || [];
    const add = d => out.push(Object.assign({ level: LV(d.score), actions: [], recommend: [] }, d));
    // 1) Capacidade do time (a decisão mais grave: sem gente, nada anda)
    ((input && input.capacity) || []).forEach(x => {
      const pl0 = x.plan; if(!pl0) return;
      if(pl0.kind === 'capacity') {
        const solo = (pl0.solo || []).map(r => r.projectName), share = Math.max(1, Math.round(100 / Math.max(1, (pl0.cuts || []).length + 1)));
        add({ id: 'cap-' + x.key, kind: 'capacidade', score: 100, title: 'Falta capacidade: ' + x.name + ' é a única pessoa em ' + (solo.length ? solo.join(', ') : 'seus projetos'),
          why: x.name + ' soma ' + x.total + '% de alocação e tem ' + pl(x.open, 'card', 'cards') + ' em aberto, sem ninguém na equipe para receber.',
          forecast: 'Cada projeto recebe cerca de ' + share + '% da atenção dela: o prazo tende a esticar em torno de ' + Math.max(2, Math.round(x.total / 100)) + 'x. Se ' + x.name + ' faltar uma semana, ' + pl(solo.length || 1, 'projeto para', 'projetos param') + '.',
          recommend: pl0.steps, mitigate: pl0.mitigate, decideBy: 'hoje',
          actions: (input.sysRisks || []).filter(r => r.key === x.key).slice(0, 1).map(r => ({ type: 'risk', label: 'Registrar Risco de Ponto Único de Falha', key: r.key, pid: r.projectId })).concat([{ type: 'team', label: 'Incluir Pessoas na Equipe' }]) });
      } else {
        add({ id: 'over-' + x.key, kind: 'alocacao', score: 85, title: x.name + ' está em ' + x.total + '% de alocação: transferir atividades',
          why: pl(x.open, 'card', 'cards') + ' em aberto somando ' + x.total + '% entre projetos; há quem possa receber.',
          forecast: 'Acima de 100% por semanas gera atraso nas entregas e risco de esgotamento (burnout).',
          recommend: pl0.steps, mitigate: pl0.mitigate, decideBy: 'esta semana', actions: [{ type: 'transfer', label: 'Escolher Cards e Quem Recebe', key: x.key }] });
      }
    });
    P.forEach(p => {
      const F = p.facts || {};
      // 2) Decisões críticas paradas
      ((F.decisions && F.decisions.pendingCritical) || []).forEach((t, i) => add({ id: 'dec-' + p.id + '-' + i, kind: 'decisao', score: 90, title: 'Decidir: ' + t, why: 'Decisão crítica pendente em ' + p.name + '.',
        forecast: 'Enquanto não for decidida, tudo o que depende dela fica parado e o atraso cresce a cada dia.', recommend: ['Decida na próxima reunião; se faltar informação, peça ao gerente do projeto em até 2 dias.', 'Registre o prazo limite da decisão.'], decideBy: 'em 2 dias',
        actions: [{ type: 'open', label: 'Decidir Agora', pid: p.id, page: 'decisions' }] }));
      // 3) Riscos críticos sem dono
      ((F.risks && F.risks.top) || []).filter(r => r.level === 'crítico').forEach((r, i) => add({ id: 'rsk-' + p.id + '-' + i, kind: 'risco', score: r.owner ? 66 : 80, title: 'Risco crítico' + (r.owner ? '' : ' sem dono') + ': ' + r.title, why: 'Nota ' + r.score + ' em ' + p.name + (r.owner ? ', dono ' + r.owner : ', sem responsável') + '.',
        forecast: r.owner ? 'Sem resposta ativa, a chance de o risco virar problema continua alta.' : 'Risco sem dono não é tratado: tende a virar problema sem aviso.', recommend: [r.owner ? 'Confirme o plano de resposta e a data de revisão.' : 'Nomeie um responsável hoje e defina a resposta.', 'Tenha o plano B pronto.'], decideBy: r.owner ? 'esta semana' : 'hoje',
        actions: [{ type: 'open', label: 'Abrir Riscos', pid: p.id, page: 'risks' }] }));
      // 4) Entregas atrasadas, com previsão pelo ritmo (SPI)
      const dl = (F.schedule && F.schedule.delayed) || [], dn = (F.schedule && F.schedule.delayedCount) || 0;
      if(dn) { const spi = F.schedule.spi, stretch = spi && spi > 0 && spi < 1 ? Math.round((1 / spi - 1) * 100) : null;
        add({ id: 'del-' + p.id, kind: 'prazo', score: Math.min(84, 68 + dn * 3), title: pl(dn, 'entrega atrasada', 'entregas atrasadas') + ' em ' + p.name, why: dl.map(d => d.label + ' (' + d.daysLate + ' d)').join('; ') + '.',
          forecast: stretch ? 'No ritmo atual (SPI ' + String(Math.round(spi * 100) / 100).replace('.', ',') + ') o término tende a ficar ' + stretch + '% mais longo que o planejado.' : 'Sem ação, o atraso se acumula nas entregas seguintes.',
          recommend: ['Replanejar as entregas atrasadas com o responsável: nova data ou corte de escopo.', 'Avisar as partes interessadas do novo prazo.'], decideBy: 'esta semana', actions: [{ type: 'open', label: 'Abrir Cronograma', pid: p.id, page: 'wbs' }] }); }
      // 5) Custo: previsão no término acima do orçado
      const B = F.budget;
      if(input.canCosts && B && B.hasBudget && ((B.eacPctOfBac != null && B.eacPctOfBac > 105) || (B.cpi != null && B.cpi < 0.9))) add({ id: 'bud-' + p.id, kind: 'custo', score: 75, title: 'Custo acima do orçado em ' + p.name,
        why: 'CPI ' + (B.cpi != null ? String(Math.round(B.cpi * 100) / 100).replace('.', ',') : '—') + '; previsão no término em ' + (B.eacPctOfBac != null ? B.eacPctOfBac + '% do orçamento' : 'valor acima do orçado') + '.', forecast: 'No ritmo atual o projeto fecha acima do orçamento aprovado.',
        recommend: ['Revisar as linhas do orçamento e pedir a previsão no término.', 'Exigir aprovação para novos gastos até estabilizar.'], decideBy: 'esta semana', actions: [{ type: 'open', label: 'Abrir Orçamento', pid: p.id, page: 'budget' }] });
      // 6) Sprint: previsão de término pelo ritmo
      if(p.sprint && p.sprint.etaLate > 0) add({ id: 'spr-' + p.id, kind: 'sprint', score: 65 + Math.min(10, p.sprint.etaLate), title: 'A sprint de ' + p.name + ' deve terminar ' + pl(p.sprint.etaLate, 'dia', 'dias') + ' depois', why: 'No ritmo atual de conclusão a meta da sprint não fecha na data.',
        forecast: 'Sem ajuste, ' + (p.sprint.gap > 0.5 ? p.sprint.gap + ' pts ficam para a próxima sprint.' : 'parte do escopo transborda para a próxima sprint.'), recommend: ['Tirar ou dividir o que não vai terminar.', 'Puxar ajuda para o que está parado.'], decideBy: 'hoje', actions: [{ type: 'open', label: 'Abrir o Quadro', pid: p.id, page: 'kanban' }] });
      // 7) Escopo aguardando aprovação
      const sc = F.scope; if(sc && sc.openCount) add({ id: 'scp-' + p.id, kind: 'escopo', score: 50 + Math.min(14, Math.round((sc.daysImpact || 0) / 2)), title: pl(sc.openCount, 'mudança de escopo aguardando aprovação', 'mudanças de escopo aguardando aprovação') + ' em ' + p.name,
        why: 'Impacto somado: +' + (sc.daysImpact || 0) + ' dia(s)' + (input.canCosts ? ' e R$ ' + Math.round(sc.costImpact || 0).toLocaleString('pt-BR') : '') + '.', forecast: 'Mudança sem decisão vira trabalho não planejado e estoura prazo e custo.',
        recommend: ['Aprovar, recusar ou negociar cada mudança com o impacto à vista.', 'Fixar um dia por semana para decidir escopo.'], decideBy: 'esta semana', actions: [{ type: 'open', label: 'Abrir Mudanças', pid: p.id, page: 'scope' }] });
    });
    return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'pt-BR'));
  }
  return { build, LV };
})();

// ── services/plan-vs-real ──
const PlanVsReal = (() => {
  const ISO = /^\d{4}-\d{2}-\d{2}/;
  const iso = v => ISO.test(String(v || '')) ? String(v).slice(0, 10) : '';
  const days = (a, b) => (iso(a) && iso(b)) ? Math.round((Date.parse(iso(b) + 'T12:00:00Z') - Date.parse(iso(a) + 'T12:00:00Z')) / 86400000) : null;
  const median = l => { const a = l.slice().sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  // nível: dentro do esperado (grn), passou até 50% do esperado (amb) ou mais (red)
  const level = (age, exp) => age <= exp ? 'grn' : age <= exp * 1.5 ? 'amb' : 'red';
  const pack = (age, exp, basis, extra) => Object.assign({ age, expected: exp, basis, late: Math.max(0, age - exp), level: level(age, exp) }, extra || {});

  // Impedimentos: esperado = mediana dos já resolvidos (mínimo 3) ou 3 dias (regra padrão)
  function impediments(imps, today) {
    const res = (imps || []).filter(i => i.status === 'resolvido' && days(i.createdOn, i.resolvedOn) != null).map(i => days(i.createdOn, i.resolvedOn));
    const exp = res.length >= 3 ? Math.max(1, Math.round(median(res))) : 3, basis = res.length >= 3 ? 'mediana dos ' + res.length + ' resolvidos' : 'regra padrão de 3 dias';
    return (imps || []).filter(i => i.status === 'aberto' && iso(i.createdOn)).map(i => pack(Math.max(0, days(i.createdOn, today)), exp, basis, { id: i.id, title: i.title, owner: i.owner || '' }));
  }
  // Decisões da diretoria: esperado = mediana do tempo até decidir nas já decididas (mínimo 3) ou 3 dias
  function decisions(rows, today) {
    const dec = (rows || []).filter(r => r.boardDecision && days(r.aiGeneratedAt, r.decidedAt) != null).map(r => days(r.aiGeneratedAt, r.decidedAt));
    const exp = dec.length >= 3 ? Math.max(1, Math.round(median(dec))) : 3, basis = dec.length >= 3 ? 'mediana de ' + dec.length + ' decisões' : 'regra padrão de 3 dias';
    return (rows || []).filter(r => !r.boardDecision && iso(r.aiGeneratedAt)).map(r => pack(Math.max(0, days(r.aiGeneratedAt, today)), exp, basis, { id: r.id, title: r.aiSuggestion || 'Decisão' }));
  }
  // Riscos: a revisão esperada é a data de revisão; atrasada se já passou e o risco segue aberto
  function riskReviews(risks, today) {
    return (risks || []).filter(r => (r.status === 'aberto' || r.status === 'mitigando') && iso(r.reviewOn)).map(r => {
      const late = days(r.reviewOn, today); return { id: r.id, title: r.title, owner: r.owner || '', reviewOn: iso(r.reviewOn), late: Math.max(0, late), level: late <= 0 ? 'grn' : late <= 7 ? 'amb' : 'red' };
    });
  }
  // Partes interessadas: contato esperado a cada 14 (alta), 30 (média) ou 60 dias (baixa influência)
  const EVERY = { alta: 14, media: 30, baixa: 60 };
  function stakeholders(list, today) {
    return (list || []).filter(x => iso(x.lastContact)).map(x => {
      const exp = EVERY[x.influence] || 30, age = Math.max(0, days(x.lastContact, today)); return pack(age, exp, 'influência ' + (x.influence || 'média') + ': contato a cada ' + exp + ' dias', { id: x.id, title: x.name });
    });
  }
  // Mudança de escopo: impacto sugerido (mediana das já aprovadas parecidas; ou de todas se houver 3+) × impacto real (desvio do término contra a linha de base)
  const tok = t => new Set(String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4));
  const jac = (a, b) => { let c = 0; a.forEach(w => { if(b.has(w)) c++; }); return c ? c / (a.size + b.size - c) : 0; };
  function scopeSuggest(changes, title) {
    const past = (changes || []).filter(c => c.status === 'approved' && (Number(c.impactDays) > 0 || Number(c.impactCost) > 0)), t = tok(title);
    if(!past.length) return null;
    const sim = t.size ? past.map(c => ({ c, s: jac(t, tok(c.title)) })).filter(x => x.s >= 0.25).sort((a, b) => b.s - a.s).slice(0, 5).map(x => x.c) : [];
    const base = sim.length ? sim : (past.length >= 3 ? past : []);
    if(!base.length) return null;
    return { days: Math.round(median(base.map(c => Number(c.impactDays) || 0))), cost: Math.round(median(base.map(c => Number(c.impactCost) || 0))), n: base.length, basis: sim.length ? 'mudanças aprovadas parecidas' : 'todas as mudanças aprovadas' };
  }
  function scopeReality(changes, finishVar) {
    const declared = (changes || []).filter(c => c.status === 'approved').reduce((a, c) => a + (Number(c.impactDays) || 0), 0);
    if(finishVar == null) return { declared, real: null, gap: null, level: 'neu' };
    const gap = finishVar - declared; return { declared, real: finishVar, gap, level: gap <= 0 ? 'grn' : gap <= 5 ? 'amb' : 'red' };
  }
  // Ata: o que o sistema viu acontecer desde a última reunião (cards concluídos, impedimentos, riscos, escopo) e quem esteve ativo; a pessoa só revisa e completa
  const SYS = /^(claude code|sistema)/i;
  function meetingDigest(o) {
    const since = iso(o.since), today = iso(o.today), items = (o.items || []).filter(i => i.kind !== 'epico');
    const done = items.filter(i => i.status === 'done' && iso(i.doneOn) && iso(i.doneOn) >= since);
    const doing = items.filter(i => i.status !== 'done' && i.status !== 'todo').length;
    const imps = o.impediments || [], opened = imps.filter(i => i.status === 'aberto'), solved = imps.filter(i => i.status === 'resolvido' && iso(i.resolvedOn) >= since);
    const oldest = opened.reduce((m, i) => Math.max(m, days(i.createdOn, today) || 0), 0);
    const lateRisks = riskReviews(o.risks, today).filter(r => r.late > 0).length;
    const scope = (o.scope || []).filter(c => c.status === 'pending' || c.status === 'analysis').length;
    const lines = [];
    lines.push('Desde ' + since.split('-').reverse().join('/') + ': ' + done.length + ' card(s) concluído(s)' + (done.length ? ' (' + done.slice(0, 6).map(i => i.id).join(', ') + (done.length > 6 ? '…' : '') + ')' : '') + '; ' + doing + ' em andamento.');
    lines.push('Impedimentos: ' + opened.length + ' aberto(s)' + (opened.length ? ' (o mais antigo há ' + oldest + ' dia(s))' : '') + ', ' + solved.length + ' resolvido(s) no período.');
    if(lateRisks) lines.push('Riscos com revisão vencida: ' + lateRisks + '.');
    if(scope) lines.push('Mudanças de escopo aguardando decisão: ' + scope + '.');
    const who = new Set(); items.forEach(i => { (i.history || []).forEach(h => { const by = String(h && h.by || '').trim(); if(by && !SYS.test(by) && iso(h.at) >= since) who.add(by); }); });
    return { lines, attendees: Array.from(who).sort((a, b) => a.localeCompare(b)), done: done.length };
  }
  // Ritmo das entregas: avanço que o cronograma manda estar hoje × avanço real, ponderado pela duração planejada de cada entrega
  function pace(wbs, today) {
    let w = 0, e = 0, r = 0, n = 0;
    (wbs || []).forEach(m => {
      const d = days(m.start, m.end); if(d == null || d <= 0) return;
      const el = Math.max(0, Math.min(d, days(m.start, today))), real = m.status === 'grn' ? 100 : Math.max(0, Math.min(100, Number(m.pct) || 0));
      w += d; e += d * el / d * 100; r += d * real; n++;
    });
    if(!w) return null;
    const exp = Math.round(e / w), real = Math.round(r / w), gap = real - exp;
    return { expected: exp, real, gap, n, level: gap >= -5 ? 'grn' : gap >= -15 ? 'amb' : 'red' };
  }
  // Quadro Estimado × Real do portfólio: uma linha por projeto juntando o esperado × real de cada tema. d = dados do projeto; ext = { sprint, cost, cadence, finishVar }
  const WORST = { red: 3, amb: 2, grn: 1, neu: 0 };
  function projectRow(d, today, ext) {
    ext = ext || {};
    const pc = pace(d.wbs, today);
    const imp = impediments(d.imps, today), impBad = imp.filter(x => x.level !== 'grn').length;
    const rk = riskReviews(d.risks, today), rkBad = rk.filter(x => x.late > 0).length;
    const st = stakeholders(d.stakeholders, today), stBad = st.filter(x => x.late > 0).length;
    const sc = scopeReality(d.scope, ext.finishVar == null ? null : ext.finishVar);
    const cells = {
      entregas: pc ? { text: 'esperado ' + pc.expected + '% × real ' + pc.real + '%', level: pc.level } : null,
      sprint: ext.sprint ? { text: (ext.sprint.gap > 0.5 ? ext.sprint.gap + ' pts atrás' : 'no ritmo') + (ext.sprint.etaLate ? ' · +' + ext.sprint.etaLate + ' d' : ''), level: ext.sprint.level } : null,
      custo: ext.cost && ext.cost.rate != null && ext.cost.gap != null ? { text: 'horas R$' + Math.round(ext.cost.apurado).toLocaleString('pt-BR') + ' × lançado R$' + Math.round(ext.cost.ac).toLocaleString('pt-BR'), level: ext.cost.level === 'ok' ? 'grn' : 'amb' } : null,
      horas: ext.cadence && ext.cadence.pct != null ? { text: ext.cadence.pct + '% da jornada apontada', level: ext.cadence.level } : null,
      impedimentos: imp.length ? { text: impBad + ' de ' + imp.length + ' fora do esperado', level: impBad ? (imp.some(x => x.level === 'red') ? 'red' : 'amb') : 'grn' } : null,
      riscos: rk.length ? { text: rkBad + ' revisão(ões) vencida(s)', level: rkBad ? (rk.some(x => x.level === 'red') ? 'red' : 'amb') : 'grn' } : null,
      partes: st.length ? { text: stBad + ' sem contato no prazo', level: stBad ? (st.some(x => x.level === 'red') ? 'red' : 'amb') : 'grn' } : null,
      escopo: sc.real != null ? { text: 'declarado +' + sc.declared + ' d × real ' + (sc.real > 0 ? '+' : '') + sc.real + ' d', level: sc.level } : null
    };
    const vals = Object.keys(cells).map(k => cells[k]).filter(Boolean);
    return { cells, fixes: fixesOf(cells), red: vals.filter(c => c.level === 'red').length, amb: vals.filter(c => c.level === 'amb').length, known: vals.length, worst: vals.reduce((m, c) => Math.max(m, WORST[c.level] || 0), 0) };
  }
  // O que fazer quando um tema do quadro Estimado × Real sai do esperado (corrigir e mitigar)
  const CELL_FIX = {
    entregas: 'Replanejar as entregas atrasadas com o responsável (nova data ou corte de escopo); mitigar acompanhando o ritmo toda semana.',
    sprint: 'Rever o que cabe na sprint com o time: tirar ou dividir o que não vai terminar; mitigar puxando ajuda para o que está parado.',
    custo: 'Conferir os lançamentos de custo contra as horas apontadas e atualizar a previsão; mitigar travando gasto novo sem aprovação.',
    horas: 'Pedir o apontamento dos dias sem lançamento (use a estimativa do sistema e confirme); mitigar combinando um horário fixo para apontar.',
    impedimentos: 'Resolver o impedimento mais antigo com o dono do bloqueio; mitigar escalando ao patrocinador se passar do esperado.',
    riscos: 'Revisar os riscos vencidos com os donos e marcar a próxima revisão; mitigar mantendo o plano B de cada risco crítico.',
    partes: 'Contatar as partes interessadas sem retorno e registrar o contato; mitigar combinando uma cadência fixa de comunicação.',
    escopo: 'Atualizar o declarado das mudanças aprovadas com o desvio real do término; mitigar exigindo impacto em dias antes de aprovar novas.'
  };
  function fixesOf(cells) { return Object.keys(cells || {}).filter(k => cells[k] && cells[k].level !== 'grn' && CELL_FIX[k]).map(k => ({ key: k, level: cells[k].level, text: CELL_FIX[k] })); }
  // Plano para quem soma mais de 100% entre projetos: de onde tirar, quanto, o que fazer com os cards em aberto e como mitigar.
  // person = { name, total, rows: [{ projectId, projectName, pct, priorityValue|null, openCards }] }. Só sugere; quem decide é o gerente.
  // person.receivers (opcional): quantas pessoas, nas equipes dos projetos dela, poderiam receber cards; 0 = ninguém
  function allocPlan(person) {
    const rows = (person && person.rows || []).map(r => Object.assign({}, r, { pct: Number(r.pct) || 0, openCards: Number(r.openCards) || 0 }));
    const total = rows.reduce((a, r) => a + r.pct, 0), excess = total - 100;
    if(excess <= 0 || rows.length < 2) return null;
    const hasPri = rows.some(r => r.priorityValue != null);
    // quem reduz primeiro: menor prioridade (se houver pontuação); senão o projeto com menos cards em aberto (menor impacto)
    const order = rows.slice().sort((a, b) => hasPri ? ((a.priorityValue == null ? 1e9 : a.priorityValue) - (b.priorityValue == null ? 1e9 : b.priorityValue)) : (a.openCards - b.openCards || b.pct - a.pct));
    let left = excess; const cuts = [];
    for(const r of order) { if(left <= 0) break; const take = Math.min(left, r.pct); if(take > 0) { cuts.push({ projectId: r.projectId, projectName: r.projectName, from: r.pct, to: r.pct - take, openCards: r.openCards }); left -= take; } }
    if(person.receivers === 0) { // ninguém para quem transferir: não é ajuste de carga, é falta de capacidade (ponto único de falha)
      const keep = order[order.length - 1], pause = order.slice(0, -1), need = Math.max(1, Math.ceil(total / 100) - 1);
      const names = pause.map(r => r.projectName).join(', ');
      return { kind: 'capacity', excess, total, keep: keep.projectName, cuts: pause.map(r => ({ projectId: r.projectId, projectName: r.projectName, from: r.pct, to: 0, openCards: r.openCards })), peopleNeeded: need, escalate: true,
        basis: hasPri ? 'a Priorização dos projetos' : 'o volume de trabalho em aberto',
        solo: rows.filter(r => r.receivers === 0).map(r => ({ projectId: r.projectId, projectName: r.projectName, openCards: r.openCards })),
        headline: person.name + ' é a única pessoa disponível' + (rows.some(r => r.receivers === 0) ? ' em ' + rows.filter(r => r.receivers === 0).map(r => r.projectName).join(', ') : ' nas equipes') + ': ' + total + '% de alocação somada e ninguém para receber os cards',
        steps: ['Não há para quem transferir: isto é falta de capacidade do time, não um ajuste de carga entre pessoas.',
          'Decida a prioridade: mantenha ' + keep.projectName + ' em andamento e coloque ' + names + ' em pausa ou em ritmo reduzido até haver mais gente.',
          'Amplie o time: faltam cerca de ' + need + ' pessoa(s) em tempo integral. Dê acesso ao projeto a quem puder ajudar (Pessoas e Acesso) ou peça reforço de outra área.'],
        mitigate: 'Avise a diretoria hoje: enquanto não houver decisão, o prazo de todos esses projetos depende de uma só pessoa. Registre o risco "ponto único de falha" e renegocie prazos e escopo com os clientes.' };
    }
    const basis = hasPri ? 'o projeto de menor prioridade na Priorização' : 'o projeto com menos cards em aberto (menor impacto); cadastre a Priorização para decidir pelo valor';
    const steps = cuts.map(c => 'Reduzir a alocação em ' + c.projectName + ' de ' + c.from + '% para ' + c.to + '% (Burnout Radar do projeto)' + (c.openCards ? ' e passar os ' + c.openCards + ' card(s) em aberto para quem tem folga.' : '.'));
    const mitigate = (total > 150 ? 'Escalar à diretoria hoje: ' + person.name + ' está em ' + total + '%. ' : '') + 'Avisar o gerente de cada projeto, registrar a nova alocação e revisar em 1 semana até a soma ficar em 100%.';
    return { excess, total, cuts, basis, steps, mitigate, escalate: total > 150 };
  }
  return { impediments, decisions, riskReviews, stakeholders, scopeSuggest, scopeReality, meetingDigest, pace, projectRow, fixesOf, allocPlan, days, median };
})();

export const FUNCS = {
  'DecisionCenter.build': (args) => DecisionCenter.build(args),
  'PlanVsReal.allocPlan': (args) => PlanVsReal.allocPlan(args),
};
