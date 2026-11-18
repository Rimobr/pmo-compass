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

export const FUNCS = {
  'DecisionCenter.build': (args) => DecisionCenter.build(args),
};
