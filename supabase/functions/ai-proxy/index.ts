// PMO Compass — ai-proxy
//
// Proxy de IA no servidor: cada usuário continua usando (e pagando) a própria
// chave de Claude/ChatGPT/Gemini, mas ela nunca chega ao navegador depois de
// salva. O navegador chama esta função autenticado (JWT do Supabase); a função
// busca a chave da PESSOA QUE ESTÁ CHAMANDO na tabela user_ai_keys (usando a
// service_role key, que ignora RLS) e faz a chamada real à API de IA aqui dentro.
//
// Deploy: supabase functions deploy ai-proxy --project-ref <seu-project-ref>
// Não precisa configurar nenhum secret manualmente — SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY já vêm injetados automaticamente pelo Supabase
// em toda Edge Function do projeto.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROVIDER_MODEL: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function callAnthropic(apiKey: string, messages: any[], system: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: PROVIDER_MODEL.anthropic, max_tokens: 8192, system, messages }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    return { error: e?.error?.message || `HTTP ${res.status}` };
  }
  const data = await res.json();
  return { text: (data.content || []).map((b: any) => b.text || "").join("") };
}

async function callOpenAI(apiKey: string, messages: any[], system: string) {
  const oaMessages = [{ role: "system", content: system }, ...messages.map((m: any) => ({ role: m.role, content: m.content }))];
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify({ model: PROVIDER_MODEL.openai, max_tokens: 4096, messages: oaMessages }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    return { error: e?.error?.message || `HTTP ${res.status}` };
  }
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content || "" };
}

async function callGoogle(apiKey: string, messages: any[], system: string) {
  const contents = messages.map((m: any) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDER_MODEL.google}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    return { error: e?.error?.message || `HTTP ${res.status}` };
  }
  const data = await res.json();
  return { text: (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Não autenticado." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Nunca confia em um user_id vindo do corpo da requisição — sempre valida o JWT de verdade.
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: "Sessão inválida ou expirada." }, 401);
  const userId = userData.user.id;

  let body: any = {};
  try { body = await req.json(); } catch (_e) { /* corpo vazio é tratado abaixo */ }

  if (body.action === "status") {
    const { data, error } = await admin.from("user_ai_keys").select("provider").eq("user_id", userId);
    if (error) return json({ error: error.message }, 500);
    const has = { anthropic: false, openai: false, google: false } as Record<string, boolean>;
    (data || []).forEach((r: any) => { has[r.provider] = true; });
    return json({ has });
  }

  if (body.action === "send") {
    const provider = body.provider;
    if (!["anthropic", "openai", "google"].includes(provider)) return json({ error: "Provedor inválido." }, 400);
    const { data: row, error } = await admin.from("user_ai_keys").select("api_key").eq("user_id", userId).eq("provider", provider).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!row) return json({ error: `Nenhuma chave de ${provider} configurada para esta conta. Configure em Configurações → Provedor de IA.` }, 400);

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = body.system || "";
    try {
      if (provider === "anthropic") return json(await callAnthropic(row.api_key, messages, system));
      if (provider === "openai") return json(await callOpenAI(row.api_key, messages, system));
      return json(await callGoogle(row.api_key, messages, system));
    } catch (e) {
      return json({ error: (e as Error).message || "Erro ao chamar o provedor de IA." }, 500);
    }
  }

  return json({ error: "Ação desconhecida." }, 400);
});
