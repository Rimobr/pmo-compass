// PMO Compass — users-admin
//
// O cadastro de contas é FECHADO: ninguém cria conta sozinho. Só o administrador, aqui:
//   create         → cria a conta (e-mail confirmado), define o perfil e, se pedido, os projetos; envia a senha temporária por e-mail
//   set_active     → inativa/reativa contas (bloqueia o login no Auth e tira o perfil); nunca a si mesmo nem o último administrador
//   delete         → exclui contas SEM vínculo; quem já está em projeto, tem atividade ou foi responsável precisa ser inativado
//   reset_password → define uma nova senha temporária para uma conta existente (e envia por e-mail)
// Toda senha temporária obriga a troca no primeiro acesso (user_metadata.must_change_password).
// Autenticação: JWT do Supabase + perfil "admin" conferido no servidor.
// Deploy: supabase functions deploy users-admin
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS, json, emailConfig } from "../_shared/runtime.mjs";
import { sendEmail } from "../_shared/providers.mjs";
import { validateCreate, validatePassword, accessEmail } from "../_shared/useradmin.mjs";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const env = Deno.env;
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Não autenticado." }, 401);

  const url = env.get("SUPABASE_URL")!;
  const db = createClient(url, env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: u, error: ue } = await db.auth.getUser(jwt);
  if (ue || !u?.user) return json({ error: "Sessão inválida ou expirada." }, 401);
  const { data: prof } = await db.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
  if (prof?.role !== "admin") return json({ error: "Somente o administrador." }, 403);

  let body: any = {};
  try { body = await req.json(); } catch (_e) { return json({ error: "Pedido inválido." }, 400); }

  if (body.action === "create") {
    const [{ data: roles }, { data: projs }] = await Promise.all([
      db.from("access_profiles").select("id"), db.from("projects").select("id"),
    ]);
    const v = validateCreate(body, (roles || []).map((r: any) => r.id), (projs || []).map((p: any) => p.id));
    if (!v.ok) return json({ error: v.error }, 400);
    const { email, name, role, password, projectIds } = v.value;

    const { data: created, error: ce } = await db.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name, must_change_password: true },
    });
    if (ce || !created?.user) {
      const dup = /already|registered|exists/i.test(ce?.message || "");
      return json({ error: dup ? "Já existe uma conta com este e-mail." : "Não foi possível criar a conta: " + (ce?.message || "erro desconhecido") }, dup ? 409 : 400);
    }
    const newId = created.user.id;

    // Perfil e projetos entram pela sessão do ADMINISTRADOR, para as travas do banco (RLS e gatilhos) valerem como em qualquer ajuste dele.
    const asAdmin = createClient(url, env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { error: re } = await asAdmin.from("profiles").update({ role, name }).eq("id", newId);
    let accessErr = "";
    if (projectIds.length) {
      const { error: ae } = await asAdmin.from("project_access").upsert(projectIds.map((pid: string) => ({ project_id: pid, user_id: newId, granted_by: u.user.id })));
      if (ae) accessErr = ae.message;
      // quem executa entra na equipe de cada projeto e a conta fica ligada ao colaborador
      else for (const pid of projectIds) await asAdmin.rpc("ensure_team_member", { pid, uid: newId });
    }
    if (re || accessErr) {
      const mail0 = await notify(env, { name, email, password, reset: false });
      return json({ ok: true, user_id: newId, partial: true, ...mail0, error: "Conta criada, mas ajuste o perfil/projetos na lista: " + (re?.message || accessErr) });
    }
    const mail = await notify(env, { name, email, password, reset: false });
    return json({ ok: true, user_id: newId, ...mail });
  }

  if (body.action === "reset_password") {
    const v = validatePassword(body);
    if (!v.ok) return json({ error: v.error }, 400);
    const { data: tgt } = await db.auth.admin.getUserById(v.value.userId);
    const meta = { ...(tgt?.user?.user_metadata || {}), must_change_password: true };
    const { error: pe } = await db.auth.admin.updateUserById(v.value.userId, { password: v.value.password, user_metadata: meta });
    if (pe) return json({ error: "Não foi possível trocar a senha: " + pe.message }, 400);
    const mail = tgt?.user?.email ? await notify(env, { name: meta.name, email: tgt.user.email, password: v.value.password, reset: true }) : { email_sent: false };
    return json({ ok: true, email: tgt?.user?.email || null, ...mail });
  }

  if (body.action === "set_active" || body.action === "delete") {
    const ids = [...new Set((Array.isArray(body.user_ids) ? body.user_ids : []).map(String))].filter((i) => /^[0-9a-f-]{36}$/i.test(i)).slice(0, 50);
    if (!ids.length) return json({ error: "Escolha ao menos uma conta." }, 400);
    const active = body.active !== false;
    const { data: admins } = await db.from("profiles").select("id").eq("role", "admin").eq("active", true);
    const remainingAdmins = new Set((admins || []).map((a: any) => a.id));
    const results: any[] = [];
    for (const id of ids) {
      if (id === u.user.id) { results.push({ id, status: "blocked", reason: "Você não pode inativar nem excluir a sua própria conta." }); continue; }
      const { data: p } = await db.from("profiles").select("id,name,role,active").eq("id", id).maybeSingle();
      if (!p) { results.push({ id, status: "error", reason: "Conta não encontrada." }); continue; }
      const leaving = body.action === "delete" || !active;
      if (leaving && p.role === "admin" && p.active && remainingAdmins.has(id)) {
        if (remainingAdmins.size <= 1) { results.push({ id, name: p.name, status: "blocked", reason: "É o último administrador ativo." }); continue; }
        remainingAdmins.delete(id);
      }
      if (body.action === "set_active") {
        const { error: be } = await db.auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
        if (be) { results.push({ id, name: p.name, status: "error", reason: be.message }); continue; }
        const { error: pe } = await db.from("profiles").update({ active }).eq("id", id);
        results.push(pe ? { id, name: p.name, status: "error", reason: pe.message } : { id, name: p.name, status: active ? "reactivated" : "inactivated" });
        continue;
      }
      // Exclusão: só sem vínculo nenhum (projeto, equipe, criação/gerência de projeto ou trabalho em seu nome)
      const nm = String(p.name || "").trim().replace(/[%_]/g, "");
      const count = async (q: any) => (await q).count || 0;
      const links = await Promise.all([
        count(db.from("project_access").select("user_id", { count: "exact", head: true }).eq("user_id", id)),
        count(db.from("team_members").select("id", { count: "exact", head: true }).eq("user_id", id)),
        count(db.from("projects").select("id", { count: "exact", head: true }).or(`created_by.eq.${id},manager_id.eq.${id}`)),
        nm ? count(db.from("backlog_items").select("id", { count: "exact", head: true }).ilike("assignee", nm)) : 0,
        nm ? count(db.from("time_entries").select("id", { count: "exact", head: true }).ilike("person_name", nm)) : 0,
      ]);
      // O log de auditoria é permanente (nem o administrador apaga): quem já deixou rastro nele só pode ser inativado
      const audit = await count(db.from("audit_log").select("id", { count: "exact", head: true }).eq("actor_id", id));
      if (links.every((n: number) => n === 0) && audit > 0) {
        results.push({ id, name: p.name, status: "blocked", reason: `Tem ${audit} registro(s) no log de auditoria (permanente, por segurança) — inative em vez de excluir.`, must_inactivate: true });
        continue;
      }
      if (links.some((n: number) => n > 0)) { results.push({ id, name: p.name, status: "blocked", reason: "Tem vínculo com projeto ou atividade — inative em vez de excluir.", must_inactivate: true }); continue; }
      const { error: de } = await db.auth.admin.deleteUser(id);
      results.push(de ? { id, name: p.name, status: "blocked", reason: "Tem histórico no sistema — inative em vez de excluir.", must_inactivate: true } : { id, name: p.name, status: "deleted" });
    }
    return json({ ok: true, results });
  }

  return json({ error: "Ação desconhecida." }, 400);
});

// Envia a senha temporária por e-mail; sem provedor de e-mail configurado (RESEND_API_KEY/EMAIL_FROM) devolve email_sent=false
// e a tela mostra os dados para o administrador repassar.
async function notify(env: any, a: { name: string; email: string; password: string; reset: boolean }) {
  const cfg = emailConfig(env);
  if (!cfg) return { email_sent: false, email_error: "E-mail não configurado no servidor (RESEND_API_KEY e EMAIL_FROM)." };
  const appUrl = env.get("APP_URL") || "https://pmo-compass.vercel.app";
  const res = await sendEmail(cfg, { to: a.email, ...accessEmail({ ...a, appUrl }) });
  return res.ok ? { email_sent: true } : { email_sent: false, email_error: res.error };
}
