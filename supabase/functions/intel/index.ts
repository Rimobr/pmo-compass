// PMO Compass — intel
//
// A "inteligência" do produto (cálculo das decisões, planos, diagnósticos) roda AQUI e não no navegador: o app
// público só recebe o resultado pronto. O código vem de _shared/intel.generated.mjs, gerado do mesmo fonte do app
// (scripts/build-intel.mjs), então o cálculo é idêntico ao que os testes cobrem.
//
// Segurança: o Supabase confere o JWT antes de chamar a função (não use --no-verify-jwt). A função só executa nomes
// que estão na tabela FUNCS (lista fechada), recusa entrada grande e nunca devolve dado que a própria pessoa não
// tenha mandado: ela envia os fatos que já enxerga (com as permissões dela) e recebe o cálculo.
// Deploy: supabase functions deploy intel   (ou node scripts/deploy-functions.mjs intel)
import { FUNCS } from "../_shared/intel.generated.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_BYTES = 2_000_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  // A chave pública (anon) também é um JWT válido para a plataforma: exigimos um USUÁRIO logado de verdade.
  const auth = req.headers.get("authorization") || "";
  if (!auth) return json({ error: "sem sessão" }, 401);
  const who = await fetch(Deno.env.get("SUPABASE_URL")! + "/auth/v1/user", { headers: { authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY") || "" } }).catch(() => null);
  if (!who || !who.ok) return json({ error: "sessão inválida" }, 401);
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return json({ error: "entrada grande demais" }, 413);
  let body: any; try { body = JSON.parse(raw); } catch { return json({ error: "JSON inválido" }, 400); }
  const fn = String(body && body.fn || "");
  if (!Object.prototype.hasOwnProperty.call(FUNCS, fn)) return json({ error: "função desconhecida" }, 404);
  try { return json({ ok: true, result: (FUNCS as any)[fn](body.args) }); }
  catch (e) { return json({ error: "falha no cálculo" }, 500); }
});
