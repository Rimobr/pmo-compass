// Cola comum das funções de borda: respostas, autenticação do agendador e configuração dos canais.
import { timingSafeEqualStr, hmacSha256Hex } from './util.mjs';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// O agendador (pg_cron) chama as funções com "Authorization: Bearer <CRON_SECRET>".
export function isCron(req, env) {
  const secret = env.get('CRON_SECRET') || '';
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return secret.length >= 24 && timingSafeEqualStr(secret, got);
}

export function waConfig(env) {
  const accessToken = env.get('WA_ACCESS_TOKEN'), phoneNumberId = env.get('WA_PHONE_NUMBER_ID');
  return accessToken && phoneNumberId ? { accessToken, phoneNumberId } : null;
}
export function emailConfig(env) {
  const apiKey = env.get('RESEND_API_KEY'), from = env.get('EMAIL_FROM');
  return apiKey && from ? { apiKey, from } : null;
}
export function templateNames(env) {
  return { confirm: env.get('WA_TEMPLATE_CONFIRM') || 'pmo_confirmacao', alert: env.get('WA_TEMPLATE_ALERT') || 'pmo_alerta' };
}

// Link de descadastro de e-mail: id + assinatura (não adivinhável, sem login).
export async function unsubToken(env, recipientId) {
  return `${recipientId}.${(await hmacSha256Hex(env.get('CRON_SECRET') || '', 'unsub:' + recipientId)).slice(0, 32)}`;
}
export async function verifyUnsubToken(env, token) {
  const [id] = String(token || '').split('.');
  if (!id) return null;
  return timingSafeEqualStr(await unsubToken(env, id), token) ? id : null;
}
