// PMO Compass — notify-unsub
//
// Link de "Não quero mais receber" dos e-mails (LGPD: sair precisa ser tão fácil quanto entrar). Aceita GET
// (clique) e POST (One-Click Unsubscribe do cabeçalho List-Unsubscribe). O token é id + assinatura HMAC.
// Deploy: supabase functions deploy notify-unsub --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyUnsubToken } from "../_shared/runtime.mjs";

const page = (msg: string, status = 200) => new Response(
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PMO Compass</title></head>` +
  `<body style="font-family:Arial,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;color:#16302d"><h1 style="font-size:20px">PMO Compass</h1><p>${msg}</p></body></html>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const id = await verifyUnsubToken(Deno.env, new URL(req.url).searchParams.get("t") || "");
  if (!id) return page("Link inválido ou expirado.", 400);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await db.from("message_recipients").update({ email_status: "descadastrado" }).eq("id", id).not("email", "is", null);
  if (error) return page("Não foi possível concluir agora. Tente novamente em alguns minutos.", 500);
  return page("Pronto: você não receberá mais e-mails do PMO Compass.");
});
