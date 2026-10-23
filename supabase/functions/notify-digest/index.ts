// PMO Compass — notify-digest
//
// Roda de hora em hora (pg_cron); só age na hora e no dia da semana escolhidos em Mensagens (America/Sao_Paulo).
// Monta o resumo semanal de cada pessoa a partir dos fatos calculados no servidor — sem IA, sem custo, sem
// risco de inventar número — e enfileira em notification_outbox (a chave por semana impede envio em dobro).
// Deploy: supabase functions deploy notify-digest --no-verify-jwt   (autenticação própria por CRON_SECRET)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildDigest } from "../_shared/notify.mjs";
import { saoPauloParts, isoWeekKey } from "../_shared/util.mjs";
import { isCron, json } from "../_shared/runtime.mjs";
import * as store from "../_shared/store.mjs";

Deno.serve(async (req) => {
  const env = Deno.env;
  if (!isCron(req, env)) return json({ error: "Não autorizado." }, 401);
  const db = createClient(env.get("SUPABASE_URL")!, env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const settings = await store.getSettings(db);
  if (!settings?.enabled) return json({ skipped: "mensagens desligadas" });

  const now = new Date();
  const sp = saoPauloParts(now);
  if (sp.weekday !== settings.digest_weekday || sp.hour !== settings.digest_hour) return json({ skipped: "fora do horário do resumo" });

  const week = isoWeekKey(now);
  const { data: recipients, error } = await db.from("message_recipients").select("*").eq("active", true).contains("events", ["resumo_semanal"]);
  if (error) return json({ error: error.message }, 500);

  let queued = 0;
  for (const r of recipients || []) {
    const channels = [
      settings.whatsapp_enabled && r.whatsapp && r.whatsapp_status === "ativo" ? "whatsapp" : null,
      settings.email_enabled && r.email && r.email_status === "ativo" ? "email" : null,
    ].filter(Boolean) as string[];
    if (!channels.length) continue;
    const ids = await store.allowedProjectIds(db, r.id);
    if (!ids.length) continue;
    const facts = await store.loadFacts(db, ids, now);
    if (!facts.length) continue;
    const d = buildDigest(r, facts, now);
    for (const channel of channels) {
      const { data, error: e } = await db.from("notification_outbox").upsert({
        recipient_id: r.id, channel, event_type: "resumo_semanal", project_id: null,
        title: "Resumo semanal dos projetos", detail: channel === "email" ? d.lines.join("\n") : d.short,
        dedupe_key: `digest:${week}`,
      }, { onConflict: "recipient_id,channel,dedupe_key", ignoreDuplicates: true }).select("id");
      if (!e && data?.length) queued++;
    }
  }
  return json({ week, queued });
});
