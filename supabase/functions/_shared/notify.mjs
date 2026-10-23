// Montagem dos avisos (alerta, confirmação, resumo semanal) — texto puro, sem rede.
// Regras: nada de quebra de linha nos parâmetros de modelo do WhatsApp (a Meta rejeita), nada de dado pessoal
// vazando por título digitado, e valores em R$ somem para quem não pode ver finanças.
import { maskMoney, redactPii, truncate, inQuietHours, fmtDateBr, saoPauloParts } from './util.mjs';
import { oneLineStatus, restrictFacts } from './facts.mjs';

export const EVENT_LABEL = {
  decisao_critica: 'Decisão crítica pendente',
  farol_vermelho: 'Projeto entrou em risco',
  risco_alto: 'Risco crítico no projeto',
  resumo_semanal: 'Resumo semanal dos projetos',
};

// Parâmetro de modelo do WhatsApp: uma linha só, sem 4 espaços seguidos, tamanho limitado.
export function sanitizeParam(text, max = 200) {
  return truncate(String(text || '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim(), max) || '—';
}
export function cleanForRecipient(text, recipient) {
  let t = redactPii(String(text || ''));
  if (!recipient.can_see_financials) t = maskMoney(t);
  return t;
}

// Os 3 parâmetros do modelo "pmo_alerta" (aprovado na Meta): {{1}} o que aconteceu · {{2}} projeto · {{3}} detalhe.
export function whatsappAlertParams(item, projectName, recipient) {
  return [
    sanitizeParam(EVENT_LABEL[item.event_type] || item.title, 80),
    sanitizeParam(projectName || 'projeto', 80),
    sanitizeParam(cleanForRecipient(item.detail || item.title, recipient), 220),
  ];
}

export function emailAlert(item, projectName, recipient, { unsubscribeUrl } = {}) {
  const title = EVENT_LABEL[item.event_type] || item.title;
  const detail = cleanForRecipient(item.detail || '', recipient);
  const subject = `PMO Compass — ${title}: ${projectName || 'projeto'}`;
  const text = [`Olá, ${String(recipient.name).split(/\s+/)[0]}.`, '', `${title} — ${projectName || 'projeto'}`, detail, '',
    'Para perguntar sobre os projetos, use o WhatsApp cadastrado ou fale com o responsável pelo PMO Compass.',
    unsubscribeUrl ? `\nNão quer mais receber? ${unsubscribeUrl}` : ''].join('\n');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#16302d"><p>Olá, ${esc(String(recipient.name).split(/\s+/)[0])}.</p>`
    + `<p><strong>${esc(title)}</strong> — ${esc(projectName || 'projeto')}</p><p>${esc(detail)}</p>`
    + `<p style="color:#4f6b67;font-size:12px">Para perguntar sobre os projetos, use o WhatsApp cadastrado ou fale com o responsável pelo PMO Compass.`
    + (unsubscribeUrl ? `<br><a href="${esc(unsubscribeUrl)}">Não quero mais receber</a>` : '') + `</p></div>`;
  return { subject, text, html };
}

// Resumo semanal: determinístico (sem IA, sem custo, sem risco de alucinar). Uma linha por projeto liberado.
export function buildDigest(recipient, factsList, now = new Date()) {
  const list = factsList.map(f => restrictFacts(f, recipient.can_see_financials));
  const when = fmtDateBr(saoPauloParts(now).iso);
  const lines = list.map(f => oneLineStatus(f));
  const red = list.filter(f => f.farol.color === 'vermelho').length;
  const short = `${list.length} projeto(s) em ${when}: ${red ? red + ' em risco' : 'nenhum em risco'}. ${lines.slice(0, 3).join(' | ')}${lines.length > 3 ? ' …' : ''}`;
  return { short: sanitizeParam(cleanForRecipient(short, recipient), 220), lines, when };
}

// Horário de silêncio: alerta proativo fora da janela; se cair dentro, adia até o fim dela.
export function nextAllowedTime(now, settings) {
  const sp = saoPauloParts(now);
  if (!inQuietHours(sp.hour, settings.quiet_start, settings.quiet_end)) return now;
  const hoursToAdd = ((settings.quiet_end - sp.hour) + 24) % 24 || 24;
  const t = new Date(now.getTime() + hoursToAdd * 3600 * 1000);
  t.setMinutes(0, 0, 0);
  return t;
}
