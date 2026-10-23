// PMO Compass — notify-dispatch
//
// Esvazia a fila de avisos (notification_outbox) a cada 2 minutos (pg_cron → esta função, com CRON_SECRET).
// Respeita: canal ainda ativo, horário de silêncio (WhatsApp), tentativas com espera crescente, e nunca envia
// valores em R$ a quem não pode ver finanças. Sem credenciais configuradas, não faz nada (a fila espera).
// Deploy: supabase functions deploy notify-dispatch --no-verify-jwt   (autenticação própria por CRON_SECRET)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhatsAppTemplate, sendEmail } from "../_shared/providers.mjs";
import { whatsappAlertParams, emailAlert, nextAllowedTime } from "../_shared/notify.mjs";
import { redactPii, truncate } from "../_shared/util.mjs";
import { isCron, json, waConfig, emailConfig, templateNames, unsubToken } from "../_shared/runtime.mjs";
import * as store from "../_shared/store.mjs";

const MAX_ATTEMPTS = 5;
const BATCH = 40;

Deno.serve(async (req) => {
  const env = Deno.env;
  if (!isCron(req, env)) return json({ error: "Não autorizado." }, 401);
  const db = createClient(env.get("SUPABASE_URL")!, env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const settings = await store.getSettings(db);
  if (!settings?.enabled) return json({ skipped: "mensagens desligadas" });
  const wa = settings.whatsapp_enabled ? waConfig(env) : null;
  const mail = settings.email_enabled ? emailConfig(env) : null;
  if (!wa && !mail) return json({ skipped: "nenhum canal configurado" });

  const now = new Date();
  // Recupera itens presos em "sending" (função caiu no meio do envio)
  await db.from("notification_outbox").update({ status: "pending" })
    .eq("status", "sending").lt("scheduled_at", new Date(now.getTime() - 10 * 60 * 1000).toISOString());

  const channels = [wa ? "whatsapp" : null, mail ? "email" : null].filter(Boolean) as string[];
  const { data: due, error } = await db.from("notification_outbox").select("id")
    .in("status", ["pending", "failed"]).in("channel", channels).lt("attempts", MAX_ATTEMPTS)
    .lte("scheduled_at", now.toISOString()).order("scheduled_at").limit(BATCH);
  if (error) return json({ error: error.message }, 500);
  if (!due?.length) return json({ sent: 0 });

  // Reserva os itens (outra execução simultânea não pega os mesmos)
  const { data: claimed } = await db.from("notification_outbox")
    .update({ status: "sending", scheduled_at: now.toISOString() })
    .in("id", due.map((d: any) => d.id)).in("status", ["pending", "failed"]).select("*");

  const tpl = templateNames(env);
  let sent = 0, failed = 0, deferred = 0, skipped = 0;
  const projectNames = new Map<string, string>();
  const nameOf = async (id: string | null) => {
    if (!id) return "seus projetos";
    if (!projectNames.has(id)) {
      const { data } = await db.from("projects").select("name").eq("id", id).maybeSingle();
      projectNames.set(id, data?.name || "projeto");
    }
    return projectNames.get(id)!;
  };

  for (const item of claimed || []) {
    const finish = (patch: Record<string, unknown>) => db.from("notification_outbox").update(patch).eq("id", item.id);
    const { data: r } = await db.from("message_recipients").select("*").eq("id", item.recipient_id).maybeSingle();
    const channelOn = r && r.active && (item.channel === "whatsapp"
      ? r.whatsapp && r.whatsapp_status === "ativo" : r.email && r.email_status === "ativo");
    if (!channelOn) { await finish({ status: "skipped", last_error: "destinatário inativo ou descadastrado" }); skipped++; continue; }

    if (item.channel === "whatsapp") {
      const when = nextAllowedTime(now, settings);
      if (when > now) { await finish({ status: "pending", scheduled_at: when.toISOString() }); deferred++; continue; }
    }

    const projectName = await nameOf(item.project_id);
    let res;
    if (item.channel === "whatsapp") {
      res = await sendWhatsAppTemplate(wa!, r.whatsapp, tpl.alert, whatsappAlertParams(item, projectName, r));
    } else {
      const unsub = `${env.get("SUPABASE_URL")}/functions/v1/notify-unsub?t=${await unsubToken(env, r.id)}`;
      const m = emailAlert(item, projectName, r, { unsubscribeUrl: unsub });
      res = await sendEmail(mail!, { to: r.email, subject: m.subject, text: m.text, html: m.html, unsubscribeUrl: unsub });
    }

    const attempts = item.attempts + 1;
    if (res.ok) {
      await finish({ status: "sent", sent_at: new Date().toISOString(), attempts, last_error: null }); sent++;
    } else {
      const giveUp = !res.retryable || attempts >= MAX_ATTEMPTS;
      await finish({
        status: "failed", attempts: giveUp ? MAX_ATTEMPTS : attempts, last_error: truncate(res.error || "erro", 300),
        scheduled_at: new Date(Date.now() + attempts * 5 * 60 * 1000).toISOString(),
      });
      failed++;
    }
    await store.logMessage(db, {
      recipient_id: r.id, channel: item.channel, direction: "out", kind: item.event_type,
      external_id: null, body_redacted: redactPii(truncate(`${item.title}: ${item.detail || ""}`, 400)),
      project_ids: item.project_id ? [item.project_id] : [], error: res.ok ? null : truncate(res.error || "erro", 300),
    });
  }
  return json({ sent, failed, deferred, skipped });
});
