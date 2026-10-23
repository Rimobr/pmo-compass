// Utilitários puros compartilhados pelas funções de borda (Deno) e pelos testes (Node).
// Sem dependência de rede nem de banco: tudo aqui é testável de forma isolada.

// ── Dados pessoais (LGPD) ───────────────────────────────────────────────────────────────────────
// Mesmos padrões e decisões de design de anonymize() em PMO_Compass_v2.html e de redactPii() em
// ai-proxy: CEP/RG sem contexto não são redigidos (falso-positivo demais).
const PII_PATTERNS = [
  [/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g, '[CPF REDACTADO]'],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ REDACTADO]'],
  [/(?<=RG[:\s]{0,3})\d{1,2}[.\s]?\d{3}[.\s]?\d{3}-?[\dXx]\b/gi, '[RG REDACTADO]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[E-MAIL REDACTADO]'],
  [/\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g, '[TELEFONE REDACTADO]'],
  [/\b\d{5}-\d{3}\b/g, '[CEP REDACTADO]'],
  [/(?<=CEP[:\s]{0,3})\b\d{8}\b/gi, '[CEP REDACTADO]'],
];
export function redactPii(text) {
  if (!text) return text || '';
  let out = String(text);
  for (const [re, tag] of PII_PATTERNS) out = out.replace(re, tag);
  return out;
}

// ── Valores em R$ ───────────────────────────────────────────────────────────────────────────────
// Quem não pode ver finanças nunca recebe valor monetário — nem no alerta, nem na resposta da IA
// (a IA recebe fatos sem valores, e esta máscara é a segunda barreira sobre o texto final).
const MONEY_PATTERNS = [
  /R\$\s*\d[\d.,]*(?:\s*(?:mil|milh(?:ão|ões|ao|oes)|bilh(?:ão|ões|ao|oes)|mi|bi|k|m|b)\b)?/gi,
  /\b\d[\d.,]*\s*(?:mil\s+)?reais\b/gi,
  /\bUS\$\s*\d[\d.,]*/gi,
];
export function maskMoney(text, replacement = '[valor restrito]') {
  if (!text) return text || '';
  let out = String(text);
  for (const re of MONEY_PATTERNS) out = out.replace(re, replacement);
  return out;
}

// ── Texto ───────────────────────────────────────────────────────────────────────────────────────
export function normalizeText(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function truncate(text, max) {
  const t = String(text || '');
  return t.length <= max ? t : t.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}
// O WhatsApp aceita 4096 caracteres por mensagem; respostas de status devem ser curtas, mas se passarem
// do limite quebram em blocos nos parágrafos (nunca no meio de uma palavra).
export function splitMessage(text, max = 1500) {
  const t = String(text || '').trim();
  if (t.length <= max) return t ? [t] : [];
  const parts = []; let cur = '';
  for (const para of t.split(/\n{2,}/)) {
    if ((cur + '\n\n' + para).trim().length > max && cur) { parts.push(cur.trim()); cur = para; }
    else cur = cur ? cur + '\n\n' + para : para;
    while (cur.length > max) {
      const cut = cur.lastIndexOf(' ', max); const at = cut > max * 0.5 ? cut : max;
      parts.push(cur.slice(0, at).trim()); cur = cur.slice(at).trim();
    }
  }
  if (cur) parts.push(cur.trim());
  return parts;
}

// ── Telefone ────────────────────────────────────────────────────────────────────────────────────
// Devolve E.164 ("+5511999998888") ou null. Sem "+" e com 10–11 dígitos, assume Brasil.
export function normalizePhone(input) {
  const raw = String(input || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (!raw.startsWith('+')) {
    if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  }
  if (!/^[1-9]\d{9,14}$/.test(digits)) return null;
  if (digits.startsWith('55') && digits.length !== 12 && digits.length !== 13) return null;
  return '+' + digits;
}
// O WhatsApp entrega números móveis brasileiros às vezes com e às vezes sem o 9º dígito; casar o remetente
// com o cadastro precisa aceitar as duas formas. Devolve as variantes só com dígitos (como o "wa_id").
export function phoneVariants(e164) {
  const d = String(e164 || '').replace(/\D/g, '');
  const set = new Set([d]);
  if (d.startsWith('55')) {
    if (d.length === 13 && d[4] === '9') set.add(d.slice(0, 4) + d.slice(5));
    if (d.length === 12 && '6789'.includes(d[4])) set.add(d.slice(0, 4) + '9' + d.slice(4));
  }
  return [...set];
}
export function maskPhone(e164) {
  const d = String(e164 || '');
  return d.length > 4 ? '***' + d.slice(-4) : '***';
}

// ── Assinatura (HMAC) ───────────────────────────────────────────────────────────────────────────
export async function hmacSha256Hex(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function timingSafeEqualStr(a, b) {
  const x = String(a), y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

// ── Datas (sempre em America/Sao_Paulo) ─────────────────────────────────────────────────────────
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function saoPauloParts(date = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return { year: +p.year, month: +p.month, day: +p.day, weekday: WD[p.weekday], hour, iso: `${p.year}-${p.month}-${p.day}` };
}
export function parseIsoDate(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
export function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
// Mesma regra do app (Clock.today): data de referência do projeto, se houver; senão o dia real em Brasília.
export function projectToday(project, now = new Date()) {
  if (project && /^\d{4}-\d{2}-\d{2}$/.test(project.reference_date || '')) return parseIsoDate(project.reference_date);
  const sp = saoPauloParts(now);
  return new Date(sp.year, sp.month - 1, sp.day);
}
export function isoWeekKey(date = new Date()) {
  const sp = saoPauloParts(date);
  const d = new Date(Date.UTC(sp.year, sp.month - 1, sp.day));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
// Dentro da janela de silêncio (ex.: 21h às 7h)? A janela pode atravessar a meia-noite.
export function inQuietHours(hour, start, end) {
  if (start === end) return false;
  return start < end ? (hour >= start && hour < end) : (hour >= start || hour < end);
}
export function fmtDateBr(iso) { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; }
