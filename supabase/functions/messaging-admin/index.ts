// PMO Compass — messaging-admin
//
// Ações do administrador na tela Configurações → Mensagens que precisam de segredo ou de chamada externa:
//   status            → quais integrações estão configuradas (sem revelar nenhum segredo)
//   send_confirmation → manda o modelo "pmo_confirmacao" ao WhatsApp da pessoa (ela responde SIM)
//   test_question     → simula uma pergunta como se fosse a pessoa (NÃO envia nada, NÃO grava nada)
// Autenticação: JWT do Supabase + perfil "admin" conferido no servidor.
// Deploy: supabase functions deploy messaging-admin
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhatsAppTemplate, callAI } from "../_shared/providers.mjs";
import { handleInbound } from "../_shared/assistant.mjs";
import { CORS, json, waConfig, emailConfig, templateNames } from "../_shared/runtime.mjs";
import * as store from "../_shared/store.mjs";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const env = Deno.env;
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Não autenticado." }, 401);

  const db = createClient(env.get("SUPABASE_URL")!, env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: u, error: ue } = await db.auth.getUser(jwt);
  if (ue || !u?.user) return json({ error: "Sessão inválida ou expirada." }, 401);
  const { data: prof } = await db.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
  if (prof?.role !== "admin") return json({ error: "Somente o administrador." }, 403);

  let body: any = {};
  try { body = await req.json(); } catch (_e) { /* tratado abaixo */ }

  if (body.action === "status") {
    const settings = await store.getSettings(db);
    const ai = await store.getAiCredentials(db, settings);
    return json({
      whatsapp: !!waConfig(env), webhookSecret: !!env.get("WA_APP_SECRET") && !!env.get("WA_VERIFY_TOKEN"),
      email: !!emailConfig(env), cron: (env.get("CRON_SECRET") || "").length >= 24, ai: !!ai,
      webhookUrl: `${env.get("SUPABASE_URL")}/functions/v1/wa-webhook`, templates: templateNames(env),
    });
  }

  const recipientId = String(body.recipient_id || "");
  const { data: r } = await db.from("message_recipients").select("*").eq("id", recipientId).maybeSingle();
  if (!r) return json({ error: "Destinatário não encontrado." }, 404);

  if (body.action === "send_confirmation") {
    const settings = await store.getSettings(db);
    const wa = waConfig(env);
    if (!settings?.enabled || !settings.whatsapp_enabled) return json({ error: "Ative as mensagens e o canal WhatsApp primeiro." }, 400);
    if (!wa) return json({ error: "WhatsApp ainda não configurado no servidor (WA_ACCESS_TOKEN e WA_PHONE_NUMBER_ID)." }, 400);
    if (!r.whatsapp) return json({ error: "Este destinatário não tem WhatsApp." }, 400);
    if (!r.consent_recorded_at) return json({ error: "Registre a base do consentimento antes de enviar." }, 400);
    if (r.whatsapp_status === "ativo" || r.whatsapp_status === "descadastrado") {
      return json({ error: r.whatsapp_status === "ativo" ? "Já confirmado." : "A pessoa pediu para não receber (PARAR)." }, 400);
    }
    const first = String(r.name).trim().split(/\s+/)[0];
    const res = await sendWhatsAppTemplate(wa, r.whatsapp, templateNames(env).confirm, [first]);
    await store.logMessage(db, {
      recipient_id: r.id, channel: "whatsapp", direction: "out", kind: "confirmacao_enviada",
      body_redacted: "Pedido de confirmação (modelo aprovado)", error: res.ok ? null : res.error,
    });
    return res.ok ? json({ ok: true }) : json({ error: res.error }, 502);
  }

  if (body.action === "test_question") {
    const text = String(body.text || "").slice(0, 500);
    const settings = await store.getSettings(db);
    const creds = await store.getAiCredentials(db, settings);
    // Simula a pessoa já confirmada; nada é gravado nem enviado (setWhatsappStatus não faz nada).
    const sim = { ...r, whatsapp_status: "ativo", active: true };
    const result = await handleInbound({
      recipient: sim, text, settings: settings || {},
      deps: {
        allowedProjectIds: (id: string) => store.allowedProjectIds(db, id),
        loadFacts: (ids: string[]) => store.loadFacts(db, ids),
        setWhatsappStatus: async () => {},
        countQuestions: async () => 0, recentTurns: async () => [],
        askAI: async ({ system, messages, maxTokens }: any) =>
          creds ? callAI(creds.provider, creds.apiKey, { system, messages, maxTokens })
                : { error: "Escolha a conta e o provedor de IA em Mensagens." },
      },
    });
    return json({ replies: result.replies, kind: result.kind, projectIds: result.projectIds, aiMs: result.aiMs ?? null, error: result.error ?? null });
  }

  return json({ error: "Ação desconhecida." }, 400);
});
