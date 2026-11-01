// Regras do cadastro de contas feito pelo administrador (sem Deno nem rede: testável com node --test).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_MIN = 8;

// Senha temporária legível (sem 0/O/1/l/I), 12 caracteres, com letras, números e um símbolo
export function tempPassword(rand = (n) => crypto.getRandomValues(new Uint32Array(n))) {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', digits = '23456789', sym = '#@%*';
  const pool = letters + digits;
  const r = rand(12);
  let out = '';
  for (let i = 0; i < 9; i++) out += pool[r[i] % pool.length];
  out += digits[r[9] % digits.length] + sym[r[10] % sym.length] + letters[r[11] % letters.length];
  return out;
}

// Confere e limpa o pedido de criação; devolve { ok, value } ou { ok:false, error }
export function validateCreate(body, knownRoles, knownProjects) {
  const email = String(body && body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 160) return { ok: false, error: 'Informe um e-mail válido.' };
  const name = String(body && body.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) return { ok: false, error: 'Informe o nome da pessoa (2 a 80 letras).' };
  const role = String(body && body.role || '');
  if (!knownRoles.includes(role)) return { ok: false, error: 'Perfil de acesso inexistente.' };
  const password = String(body && body.password || '');
  if (password.length < PASSWORD_MIN || password.length > 72) return { ok: false, error: `A senha temporária precisa ter de ${PASSWORD_MIN} a 72 caracteres.` };
  const ids = Array.isArray(body && body.project_ids) ? body.project_ids.map(String) : [];
  const projectIds = [...new Set(ids)].filter(id => knownProjects.includes(id));
  return { ok: true, value: { email, name, role, password, projectIds } };
}

export function validatePassword(body) {
  const userId = String(body && body.user_id || '');
  const password = String(body && body.password || '');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { ok: false, error: 'Conta inválida.' };
  if (password.length < PASSWORD_MIN || password.length > 72) return { ok: false, error: `A senha temporária precisa ter de ${PASSWORD_MIN} a 72 caracteres.` };
  return { ok: true, value: { userId, password } };
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// E-mail de boas-vindas (ou de nova senha) com a senha temporária; a troca no primeiro acesso é obrigatória
export function accessEmail({ name, email, password, appUrl, reset = false }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'olá';
  const subject = reset ? 'PMO Compass — sua nova senha temporária' : 'PMO Compass — seu acesso foi criado';
  const intro = reset ? 'Uma nova senha temporária foi definida para a sua conta.' : 'O administrador criou o seu acesso ao PMO Compass.';
  const text = `Olá, ${first}!\n\n${intro}\n\nEndereço: ${appUrl}\nE-mail: ${email}\nSenha temporária: ${password}\n\nNo primeiro acesso você precisará criar uma nova senha e completar o seu cadastro (departamento, conhecimentos, ferramentas e, se quiser, o WhatsApp para receber mensagens do sistema — só com a sua autorização).\n\nSe você não esperava este e-mail, ignore-o e avise o administrador.`;
  const html = `<p>Olá, ${esc(first)}!</p><p>${esc(intro)}</p><p><b>Endereço:</b> <a href="${esc(appUrl)}">${esc(appUrl)}</a><br><b>E-mail:</b> ${esc(email)}<br><b>Senha temporária:</b> <code>${esc(password)}</code></p><p>No primeiro acesso você precisará <b>criar uma nova senha</b> e completar o seu cadastro (departamento, conhecimentos, ferramentas e, se quiser, o WhatsApp para receber mensagens do sistema — só com a sua autorização).</p><p style="color:#555">Se você não esperava este e-mail, ignore-o e avise o administrador.</p>`;
  return { subject, text, html };
}

// Cadastro complementar da própria pessoa: obrigatórios departamento, conhecimentos e ferramentas;
// o telefone só vale com o "sim" do consentimento (LGPD).
export function validateDetails(d) {
  const clean = (v, max) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max);
  const department = clean(d && d.department, 80), knowledge = clean(d && d.knowledge, 600), tools = clean(d && d.tools, 400);
  if (!department) return { ok: false, error: 'Informe o departamento.' };
  if (!knowledge) return { ok: false, error: 'Descreva brevemente os seus conhecimentos.' };
  if (!tools) return { ok: false, error: 'Informe as ferramentas que você domina.' };
  const consent = d && d.consent === true;
  let phone = null;
  const digits = String(d && d.phone || '').replace(/\D/g, '');
  if (digits) {
    if (!consent) return { ok: false, error: 'Para guardar o telefone é preciso autorizar o uso para mensagens (escolha "Sim") — ou deixe o telefone em branco.' };
    const full = digits.length <= 11 ? '55' + digits : digits; // sem DDI: assume Brasil
    if (full.length < 12 || full.length > 15) return { ok: false, error: 'Telefone inválido — informe DDD + número.' };
    phone = full;
  } else if (consent) {
    return { ok: false, error: 'Você autorizou as mensagens: informe o telefone com WhatsApp (ou escolha "Não").' };
  }
  return { ok: true, value: { department, knowledge, tools, phone, consent: !!phone } };
}
