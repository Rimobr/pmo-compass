// Conectores externos: WhatsApp Cloud API (Meta), e-mail (Resend) e provedores de IA.
// Cada função recebe as credenciais por parâmetro e devolve { ok, id } ou { ok:false, error, retryable } —
// nunca lança por falha de rede, para o chamador decidir entre tentar de novo e desistir.
import { hmacSha256Hex, timingSafeEqualStr, redactPii } from './util.mjs';

const GRAPH = 'https://graph.facebook.com/v21.0';

// ── WhatsApp ──────────────────────────────────────────────────────────────────────────────────────
// Meta assina o corpo bruto com HMAC-SHA256 usando o "App Secret" e manda "sha256=<hex>" em X-Hub-Signature-256.
export async function verifyMetaSignature(rawBody, header, appSecret) {
  if (!appSecret || !header || !header.startsWith('sha256=')) return false;
  const expected = await hmacSha256Hex(appSecret, rawBody);
  return timingSafeEqualStr(expected, header.slice(7));
}

// Extrai só mensagens recebidas (ignora recibos de entrega/leitura). Devolve [{ id, from, type, text, ts }].
export function parseWhatsAppPayload(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const ch of entry?.changes || []) {
      for (const m of ch?.value?.messages || []) {
        const text = m.type === 'text' ? m.text?.body
          : m.type === 'button' ? m.button?.text
          : m.type === 'interactive' ? (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title) : '';
        out.push({ id: String(m.id || ''), from: String(m.from || ''), type: m.type || 'unknown', text: text || '', ts: Number(m.timestamp) || 0 });
      }
    }
  }
  return out.filter(m => m.id && m.from);
}

async function metaPost(cfg, body) {
  try {
    const res = await fetch(`${GRAPH}/${cfg.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.accessToken}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, id: data?.messages?.[0]?.id || null };
    const msg = data?.error?.message || `HTTP ${res.status}`;
    // 4xx (número inválido, modelo reprovado, fora da janela) não melhora tentando de novo; 429/5xx sim
    return { ok: false, error: msg, retryable: res.status === 429 || res.status >= 500 };
  } catch (e) {
    return { ok: false, error: e.message || 'falha de rede', retryable: true };
  }
}
// Texto livre: só dentro de 24h depois da última mensagem da pessoa.
export const sendWhatsAppText = (cfg, to, body) =>
  metaPost(cfg, { to: String(to).replace(/\D/g, ''), type: 'text', text: { body, preview_url: false } });
// Modelo aprovado pela Meta: necessário para falar primeiro (confirmação, alertas, resumo).
export const sendWhatsAppTemplate = (cfg, to, name, params = [], lang = 'pt_BR') =>
  metaPost(cfg, {
    to: String(to).replace(/\D/g, ''), type: 'template',
    template: { name, language: { code: lang }, components: [{ type: 'body', parameters: params.map(text => ({ type: 'text', text })) }] },
  });

// ── E-mail (Resend) ───────────────────────────────────────────────────────────────────────────────
export async function sendEmail(cfg, { to, subject, text, html, unsubscribeUrl }) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        from: cfg.from, to: [to], subject, text, html,
        headers: unsubscribeUrl ? { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, id: data?.id || null };
    return { ok: false, error: data?.message || `HTTP ${res.status}`, retryable: res.status === 429 || res.status >= 500 };
  } catch (e) {
    return { ok: false, error: e.message || 'falha de rede', retryable: true };
  }
}

// ── IA (mesmos modelos do ai-proxy) ───────────────────────────────────────────────────────────────
export const PROVIDER_MODEL = { anthropic: 'claude-sonnet-4-6', openai: 'gpt-4o', google: 'gemini-3.6-flash' };

async function aiError(res) { const e = await res.json().catch(() => ({})); return { error: e?.error?.message || `HTTP ${res.status}` }; }

export async function callAI(provider, apiKey, { system, messages, maxTokens = 8192 }) {
  const msgs = (messages || []).map(m => ({ role: m.role, content: typeof m.content === 'string' ? redactPii(m.content) : m.content }));
  const sys = redactPii(system || '');
  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: PROVIDER_MODEL.anthropic, max_tokens: maxTokens, system: sys, messages: msgs }),
      });
      if (!res.ok) return await aiError(res);
      const d = await res.json();
      return { text: (d.content || []).map(b => b.text || '').join('') };
    }
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({ model: PROVIDER_MODEL.openai, max_tokens: maxTokens, messages: [{ role: 'system', content: sys }, ...msgs] }),
      });
      if (!res.ok) return await aiError(res);
      const d = await res.json();
      return { text: d.choices?.[0]?.message?.content || '' };
    }
    if (provider === 'google') {
      const contents = msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${PROVIDER_MODEL.google}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { maxOutputTokens: maxTokens } }),
      });
      if (!res.ok) return await aiError(res);
      const d = await res.json();
      return { text: (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('') };
    }
    return { error: 'Provedor de IA inválido.' };
  } catch (e) {
    return { error: e.message || 'Erro ao chamar o provedor de IA.' };
  }
}
