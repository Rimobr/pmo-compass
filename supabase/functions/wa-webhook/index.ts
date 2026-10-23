// PMO Compass — wa-webhook
//
// Recebe as mensagens que diretoria/stakeholders enviam ao número de WhatsApp do PMO Compass e responde
// (SIM / PARAR / ajuda / perguntas de status respondidas pela IA a partir de fatos calculados no servidor).
//
// Segurança: toda chamada é verificada pela assinatura HMAC da Meta (App Secret); remetente desconhecido é
// ignorado sem resposta; cada mensagem é processada uma única vez (id externo único em message_log).
// Deploy (sem JWT, a Meta não envia JWT): supabase functions deploy wa-webhook --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyMetaSignature, parseWhatsAppPayload, sendWhatsAppText, callAI } from "../_shared/providers.mjs";
import { handleInbound, TEXT } from "../_shared/assistant.mjs";
import { redactPii, truncate, splitMessage, timingSafeEqualStr } from "../_shared/util.mjs";
import { waConfig } from "../_shared/runtime.mjs";
import * as store from "../_shared/store.mjs";

Deno.serve(async (req) => {
  const env = Deno.env;
  const url = new URL(req.url);

  // Verificação de URL pedida pela Meta ao cadastrar o webhook
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe"
      && timingSafeEqualStr(env.get("WA_VERIFY_TOKEN") || "\u0000", url.searchParams.get("hub.verify_token") || "");
    return ok ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 }) : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const raw = await req.text();
  if (!(await verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), env.get("WA_APP_SECRET") || ""))) {
    return new Response("invalid signature", { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch (_e) { return new Response("bad request", { status: 400 }); }

  const db = createClient(env.get("SUPABASE_URL")!, env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const wa = waConfig(env);
  const settings = await store.getSettings(db);
  // Sempre 200 para a Meta não reentregar; o que não pode ser tratado fica registrado no log.
  if (!wa || !settings?.enabled || !settings.whatsapp_enabled) return new Response("ok");

  for (const m of parseWhatsAppPayload(payload)) {
    try { await processMessage(db, wa, settings, m); }
    catch (e) { console.error("wa-webhook: falha ao processar", m.id, (e as Error).message); }
  }
  return new Response("ok");
});

async function processMessage(db: any, wa: any, settings: any, m: { id: string; from: string; type: string; text: string }) {
  const recipient = await store.findRecipientByWaId(db, m.from);
  if (!recipient) return; // número desconhecido: não responde, não guarda

  const isNew = await store.logMessage(db, {
    recipient_id: recipient.id, channel: "whatsapp", direction: "in", kind: "entrada",
    external_id: m.id, body_redacted: redactPii(truncate(m.text, 500)),
  });
  if (!isNew) return; // reentrega da Meta

  let result;
  if (m.type !== "text" && m.type !== "button" && m.type !== "interactive") {
    result = { replies: recipient.whatsapp_status === "descadastrado" ? [] : [TEXT.unsupported], kind: "nao_texto", projectIds: [] };
  } else {
    result = await handleInbound({
      recipient, text: m.text, settings,
      deps: {
        allowedProjectIds: (id: string) => store.allowedProjectIds(db, id),
        loadFacts: (ids: string[]) => store.loadFacts(db, ids),
        setWhatsappStatus: async (id: string, status: string) => {
          const patch: Record<string, unknown> = { whatsapp_status: status };
          if (status === "ativo") patch.whatsapp_confirmed_at = new Date().toISOString();
          const { error } = await db.from("message_recipients").update(patch).eq("id", id);
          if (error) throw new Error(error.message);
        },
        countQuestions: (id: string, since: string) => store.countInbound(db, id, since),
        recentTurns: (id: string, since: string, limit: number) => store.recentTurns(db, id, since, limit),
        askAI: async ({ system, messages, maxTokens }: any) => {
          const creds = await store.getAiCredentials(db, settings);
          if (!creds) return { error: "IA não configurada (conta e provedor em Mensagens)." };
          return callAI(creds.provider, creds.apiKey, { system, messages, maxTokens });
        },
      },
    });
  }

  if (result.kind === "resposta" || result.kind === "erro_ia") {
    await db.from("message_log").update({ kind: "pergunta" }).eq("channel", "whatsapp").eq("external_id", m.id).eq("direction", "in");
  }
  for (const reply of result.replies) {
    for (const part of splitMessage(reply)) {
      const sent = await sendWhatsAppText(wa, m.from, part);
      await store.logMessage(db, {
        recipient_id: recipient.id, channel: "whatsapp", direction: "out",
        kind: result.kind === "resposta" ? "resposta" : result.kind, external_id: null,
        body_redacted: redactPii(truncate(part, 1500)), project_ids: result.projectIds || [],
        ai_provider: result.kind === "resposta" ? settings.ai_provider : null, ai_ms: result.aiMs ?? null,
        error: sent.ok ? (result.error ?? null) : sent.error,
      });
    }
  }
}
