// Acesso a dados das funções de borda (sempre com a chave de serviço — nunca exposto ao navegador).
// Recebe o cliente do Supabase por parâmetro para os testes poderem usar um falso.
import { computeFacts, overallocatedNames } from './facts.mjs';
import { phoneVariants } from './util.mjs';

const group = (rows, key = 'project_id') => {
  const m = new Map();
  for (const r of rows || []) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); }
  return m;
};
async function sel(q) { const { data, error } = await q; if (error) throw new Error(error.message); return data || []; }

// Fatos de vários projetos de uma vez (uma consulta por tabela, não por projeto).
export async function loadFacts(db, projectIds, now = new Date()) {
  const ids = [...new Set(projectIds)];
  if (!ids.length) return [];
  const [projects, wbs, lines, actuals, decisions, risks, scope, team, board, allTeam] = await Promise.all([
    sel(db.from('projects').select('id,name,client,reference_date').in('id', ids)),
    sel(db.from('wbs_modules').select('id,project_id,label,status,pct,start_date,end_date').in('project_id', ids)),
    sel(db.from('budget_lines').select('id,project_id,planned_value,wbs_module_id,is_reserve').in('project_id', ids)),
    sel(db.from('cost_actuals').select('project_id,amount,kind').in('project_id', ids)),
    sel(db.from('decisions').select('project_id,title,status,severity').in('project_id', ids)),
    sel(db.from('risks').select('project_id,title,status,score,owner_name').in('project_id', ids)),
    sel(db.from('scope_changes').select('project_id,status,impact_days,impact_cost').in('project_id', ids)),
    sel(db.from('team_members').select('project_id,name,workload_pct').in('project_id', ids)),
    sel(db.from('board_decisions').select('project_id,board_decision,decided_at').in('project_id', ids)),
    sel(db.from('team_members').select('name,allocation_pct')),
  ]);
  const snaps = await Promise.all(ids.map(id =>
    db.from('project_snapshots').select('project_id,captured_at,health_status,health_score').eq('project_id', id)
      .order('captured_at', { ascending: false }).limit(1).then(r => r.data?.[0] || null)));
  const over = overallocatedNames(allTeam);
  const g = { wbs: group(wbs), lines: group(lines), actuals: group(actuals), decisions: group(decisions), risks: group(risks), scope: group(scope), team: group(team), board: group(board) };
  const byId = new Map(projects.map(p => [p.id, p]));
  return ids.filter(id => byId.has(id)).map(id => computeFacts({
    project: byId.get(id),
    wbs: g.wbs.get(id), budgetLines: g.lines.get(id), costActuals: g.actuals.get(id),
    decisions: g.decisions.get(id), risks: g.risks.get(id), scope: g.scope.get(id), team: g.team.get(id),
    boardDecisions: g.board.get(id), snapshot: snaps[ids.indexOf(id)], overallocated: over,
  }, now));
}

export async function allowedProjectIds(db, recipientId) {
  const rows = await sel(db.from('message_recipient_projects').select('project_id').eq('recipient_id', recipientId));
  return rows.map(r => r.project_id);
}

// O WhatsApp entrega o remetente só com dígitos ("wa_id"), com ou sem o 9º dígito — casa pelas duas formas.
export async function findRecipientByWaId(db, waId) {
  const candidates = phoneVariants('+' + String(waId).replace(/\D/g, '')).map(d => '+' + d);
  const rows = await sel(db.from('message_recipients').select('*').in('whatsapp', candidates).limit(1));
  return rows[0] || null;
}

export async function getSettings(db) {
  const rows = await sel(db.from('messaging_settings').select('*').eq('id', 1));
  return rows[0] || null;
}

// Chave de IA que responde as perguntas = a da conta escolhida pelo administrador (cada um paga a própria IA).
export async function getAiCredentials(db, settings) {
  if (!settings?.ai_owner_user_id || !settings?.ai_provider) return null;
  const rows = await sel(db.from('user_ai_keys').select('api_key').eq('user_id', settings.ai_owner_user_id).eq('provider', settings.ai_provider));
  return rows[0] ? { provider: settings.ai_provider, apiKey: rows[0].api_key } : null;
}

// Trilha: texto já com dados pessoais redigidos. Entrada duplicada (mesmo external_id) devolve false.
export async function logMessage(db, row) {
  const { error } = await db.from('message_log').insert(row);
  if (!error) return true;
  if (error.code === '23505') return false;
  throw new Error(error.message);
}

export async function countInbound(db, recipientId, sinceIso) {
  const { count, error } = await db.from('message_log').select('id', { count: 'exact', head: true })
    .eq('recipient_id', recipientId).eq('direction', 'in').eq('kind', 'pergunta').gte('created_at', sinceIso);
  if (error) throw new Error(error.message);
  return count || 0;
}

export async function recentTurns(db, recipientId, sinceIso, limit = 4) {
  const rows = await sel(db.from('message_log').select('direction,body_redacted,kind,created_at').eq('recipient_id', recipientId)
    .in('kind', ['pergunta', 'resposta']).gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(limit));
  return rows.reverse().filter(r => r.body_redacted).map(r => ({ direction: r.direction, body: r.body_redacted }));
}
