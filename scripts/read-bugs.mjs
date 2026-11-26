#!/usr/bin/env node
// Exporta os BUGS de um projeto do PMO Compass (descrição passo a passo + prints) para uma pasta, só LEITURA.
// Serve para quem vai corrigir o sistema do projeto (ex.: ClãGuard Pro) ler os relatos e ver os prints direto,
// sem copiar nada à mão: o PMO Compass guarda o controle, o outro sistema recebe a lista.
//
// REGRA DA CORREÇÃO AUTOMÁTICA (dono): só entra card do tipo BUG que esteja em "Em andamento". Os outros bugs em aberto são só listados.
//
//   node scripts/read-bugs.mjs "ClãGuard"                 # bugs PRONTOS PARA CORREÇÃO (Em andamento) do projeto cujo nome contém o texto
//   node scripts/read-bugs.mjs --id <id> --take US-007    # GRAVA o "primeiro contato": comentário "Recebido pela correção automática…" nos bugs em Em andamento
//   (Personalizar quadro → Correção Automática: desligada = nada é exportado, recebido nem baixado; a publicação "auto" ou "approve" é informada na saída)
//   node scripts/read-bugs.mjs "ClãGuard" --all           # só leitura: todos os bugs, inclusive os de outras situações (não corrigir os de fora de Em andamento)
//   node scripts/read-bugs.mjs "ClãGuard" --out C:\caminho\pasta
//   node scripts/read-bugs.mjs --list                     # lista TODOS os projetos e quadros (id | tipo | nome | bugs em aberto)
//   node scripts/read-bugs.mjs --id <id-do-projeto>       # escolhe pelo id exato (use depois do --list)
//   node scripts/read-bugs.mjs --id <id> --mark US-007,BUG-3 --note "texto curto"
//        # GRAVA: leva os bugs para "Em revisão" e acrescenta no fim do campo Descrição e critérios de aceite (o texto original fica) um bloco entre linhas de asteriscos com
//        # "<o que foi feito> — Auto Corrigido!" (a nota tem até 100 caracteres, sem contar o rótulo, que é somado no fim; se passar, o script recusa)
//   Se o nome não achar o projeto (ou achar mais de um), sai com código 3 e a lista, para a pessoa escolher.
//
// Gera <pasta>/bugs.md e <pasta>/anexos/*. Credencial: SUPABASE_ACCESS_TOKEN (ambiente ou .env.deploy); só o --mark grava (situação e histórico do card).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env.deploy');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.PROJECT_REF || (existsSync(join(root, 'supabase/.temp/project-ref')) ? readFileSync(join(root, 'supabase/.temp/project-ref'), 'utf8').trim() : '');
const args = process.argv.slice(2);
const flag = f => args.includes(f);
const outIdx = args.indexOf('--out');
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const name = args.find((a, i) => !a.startsWith('--') && !['--out', '--id', '--mark', '--note'].includes(args[i - 1]));
if (!token || !ref) { console.error('Falta SUPABASE_ACCESS_TOKEN ou PROJECT_REF.'); process.exit(2); }
if (!name && !val('--id') && !flag('--list')) { console.error('Informe o nome (ou parte do nome) do projeto, ou use --list. Ex.: node scripts/read-bugs.mjs "ClãGuard"'); process.exit(2); }

const q = async sql => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`); return JSON.parse(t);
};
const lit = s => `'${String(s).replace(/'/g, "''")}'`;
const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'projeto';
const safe = s => String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);

const READY = 'doing'; // "Em andamento": a única situação em que a correção automática pega um bug
const plain = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const allProjects = () => q(`select p.id, p.name, p.client, p.methodology, (select count(*) from public.backlog_items b where b.project_id = p.id and b.kind = 'bug' and b.status <> 'done') as bugs, (select count(*) from public.backlog_items b where b.project_id = p.id and b.kind = 'bug' and b.status = 'doing') as ready from public.projects p order by p.name`);
const showList = rows => rows.map(p => `  ${p.id} | ${p.methodology === 'quadro' ? 'Quadro ' : 'Projeto'} | ${p.name}${p.client ? ' (' + p.client + ')' : ''} | ${p.bugs} bug(s) em aberto, ${p.ready} em Em andamento (prontos para correção)`).join('\n');

const main = async () => { try {
  if (flag('--list')) { console.log('Projetos e quadros (id | tipo | nome | bugs em aberto):\n' + showList(await allProjects())); { process.exitCode = 0; return; } }
  let projs = await allProjects();
  if (val('--id')) projs = projs.filter(p => p.id === val('--id'));
  else {
    const hit = projs.filter(p => plain(p.name).includes(plain(name)));
    if (hit.length !== 1) {
      console.error((hit.length ? `Mais de um projeto combina com "${name}"` : `Nenhum projeto com "${name}" no nome`) + '. ESCOLHA qual (id | tipo | nome | bugs em aberto) e rode de novo com --id <id>:\n' + showList(hit.length ? hit : projs));
      { process.exitCode = 3; return; }
    }
    projs = hit;
  }
  if (!projs.length) { console.error('Id de projeto não encontrado. Use --list.'); { process.exitCode = 1; return; } }
  const p = projs[0];
  const cfgRow = await q(`select value from public.project_settings where project_id = ${lit(p.id)} and key = 'agileConfig'`);
  const fix = (cfgRow[0] && cfgRow[0].value && cfgRow[0].value.autoFix) || {}, fixOn = fix.on !== false, publish = fix.publish === 'approve' ? 'approve' : 'auto';
  console.log('Correção automática: ' + (fixOn ? 'LIGADA' : 'DESLIGADA') + ' neste quadro · publicação: ' + (publish === 'auto' ? 'AUTOMÁTICA depois dos testes (desenvolvimento/testes)' : 'SÓ COM APROVAÇÃO (produção)') + '.');
  if (!fixOn && (val('--mark') || val('--take') || !flag('--all'))) { console.error('A correção automática está desligada neste quadro (Personalizar quadro). Nada foi exportado nem gravado.'); process.exitCode = val('--mark') || val('--take') ? 2 : 0; return; }
  if (val('--take')) {
    // Primeiro contato: quem abriu o bug vê no próprio card que ele foi recebido
    const ids = val('--take').split(',').map(x => x.trim()).filter(Boolean), by = 'Claude Code (correção automática)', now = new Date();
    const rows = await q(`select id, status, history from public.backlog_items where project_id = ${lit(p.id)} and kind = 'bug' and id in (${ids.map(lit).join(',')})`);
    const miss = ids.filter(i => !rows.find(r => r.id === i)); if (miss.length) console.error('Não é bug deste projeto (ignorado): ' + miss.join(', '));
    for (const row of rows) {
      if (row.status !== READY) { console.error(`  ${row.id}: não está em "Em andamento", não recebi.`); process.exitCode = 2; continue; }
      const hist = Array.isArray(row.history) ? row.history.slice() : [], last = f => { for (let i = hist.length - 1; i >= 0; i--) if (f(hist[i])) return i; return -1; };
      const moved = last(h => h && h.field === 'Situação'), took = last(h => h && !h.field && /^claude code/i.test(h.by || '') && String(h.to).startsWith('Comentário: Recebido pela correção automática'));
      if (took > moved) { console.log(`  ${row.id}: já tinha sido recebido.`); continue; }
      const when = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
      hist.push({ at: now.toISOString(), by, field: '', from: '', to: 'Comentário: Recebido pela correção automática em ' + when + '; em análise.' });
      while (hist.length > 300) { const k = hist.findIndex((h, i) => i > 0 && !(h && !h.field && String(h.to).startsWith('Comentário: '))); if (k < 0) break; hist.splice(k, 1); } // criação e comentários nunca saem do corte (auditoria)
      await q(`update public.backlog_items set history = ${lit(JSON.stringify(hist))}::jsonb, updated_at = now() where project_id = ${lit(p.id)} and id = ${lit(row.id)} and status = ${lit(READY)}`);
      console.log(`  ${row.id}: recebido (primeiro contato registrado no card).`);
    }
    { process.exitCode = process.exitCode || 0; return; }
  }
  if (val('--mark')) {
    const ids = val('--mark').split(',').map(x => x.trim()).filter(Boolean);
    const LABEL = 'Auto Corrigido!', SEP = ' — ', room = 100; // a nota usa até 100 caracteres; o rótulo fica fora da conta e é somado no fim
    const note = String(val('--note') || '').replace(/\s+/g, ' ').trim();
    if (!note) { console.error('Informe --note com o que foi feito (até ' + room + ' caracteres).'); process.exitCode = 2; return; }
    if (note.length > room) { console.error('A nota tem ' + note.length + ' caracteres; o máximo é ' + room + ' (o rótulo "' + LABEL + '" é somado depois). Reescreva mais curta, sem cortar com reticências.'); process.exitCode = 2; return; }
    const comment = note + SEP + LABEL;
    const now = new Date().toISOString(), by = 'Claude Code (correção automática)';
    const rows = await q(`select id, status, history, description, assignee from public.backlog_items where project_id = ${lit(p.id)} and kind = 'bug' and id in (${ids.map(lit).join(',')})`);
    const miss = ids.filter(i => !rows.find(r => r.id === i)); if (miss.length) console.error('Não é bug deste projeto (ignorado): ' + miss.join(', '));
    // Ao ir para Em revisão o card volta para quem o ABRIU (primeiro registro do histórico), para essa pessoa conferir a correção.
    // Só se ela for uma pessoa da equipe ligada a uma conta (regra do banco para responsável); se não achar uma só, o responsável fica como está.
    const team = await q(`select name, user_id from public.team_members where project_id = ${lit(p.id)} and user_id is not null`);
    const reporterOf = row => {
      const by = plain(((Array.isArray(row.history) && row.history[0] && row.history[0].by) || '')).trim(); if (!by || by.startsWith('claude')) return null;
      const exact = team.filter(m => plain(m.name).trim() === by); if (exact.length === 1) return exact[0].name;
      const first = team.filter(m => plain(m.name).trim().split(' ')[0] === by.split(' ')[0]); return first.length === 1 ? first[0].name : null;
    };
    for (const row of rows) {
      if (row.status !== READY) { console.error(`  ${row.id}: não está em "Em andamento", não mexi (a correção automática só dá baixa em bug em Em andamento).`); process.exitCode = 2; continue; }
      const hist = (Array.isArray(row.history) ? row.history : []).concat([
        { at: now, by, field: 'Situação', from: ({ todo: 'A fazer', doing: 'Em andamento', review: 'Em revisão' })[row.status] || row.status, to: 'Em revisão' },
      ]);
      const back = reporterOf(row);
      if (back && back !== row.assignee) hist.push({ at: now, by, field: 'Responsável', from: row.assignee || '(vazio)', to: back });
      while (hist.length > 300) { const k = hist.findIndex((h, i) => i > 0 && !(h && !h.field && String(h.to).startsWith('Comentário: '))); if (k < 0) break; hist.splice(k, 1); } // criação e comentários nunca saem do corte (auditoria)
      // O que foi feito entra no campo Descrição e critérios de aceite: o texto original fica e o bloco é somado no fim, entre linhas de asteriscos
      const bar = '*'.repeat(36), block = bar + '\n' + comment + '\n' + bar;
      const desc = (row.description ? row.description.replace(/\s+$/, '') + '\n\n' : '') + block;
      if (desc.length > 2000) { console.error(`  ${row.id}: a descrição ficaria com ${desc.length} caracteres (máximo 2000); não mexi. Reduza o texto do card.`); continue; }
      await q(`update public.backlog_items set status = 'review', done_on = null, ${back && back !== row.assignee ? 'assignee = ' + lit(back) + ', ' : ''}description = ${lit(desc)}, history = ${lit(JSON.stringify(hist))}::jsonb, updated_at = now() where project_id = ${lit(p.id)} and id = ${lit(row.id)}`);
      console.log(`  ${row.id}: movido para Em revisão` + (back ? `, devolvido a ${back} (quem abriu)` : ', responsável mantido (não achei quem abriu na equipe)') + `; descrição recebeu o bloco: "${comment}"`);
    }
    { process.exitCode = process.exitCode || 0; return; }
  }
  const open = await q(`select b.id, b.title, b.status, b.description, b.parent_id, par.title as parent_title, b.sprint_id, s.name as sprint_name, b.attachments, b.created_on, b.bug_priority
    from public.backlog_items b
    left join public.backlog_items par on par.project_id = b.project_id and par.id = b.parent_id
    left join public.sprints s on s.project_id = b.project_id and s.id = b.sprint_id
    where b.project_id = ${lit(p.id)} and b.kind = 'bug' ${flag('--all') ? '' : "and b.status <> 'done'"}
    order by b.bug_priority asc nulls last, b.created_on desc, b.id`);
  // Só o que está em "Em andamento" vai para a correção; --all é leitura de tudo
  const bugs = flag('--all') ? open : open.filter(b => b.status === READY), waiting = flag('--all') ? [] : open.filter(b => b.status !== READY);
  const out = outIdx >= 0 ? args[outIdx + 1] : join(root, 'bugs-export', slug(p.name));
  mkdirSync(join(out, 'anexos'), { recursive: true });

  // Os prints ficam numa pasta privada: a chave de serviço só é usada aqui, para gerar o link temporário de cada arquivo
  let service = null;
  const files = bugs.flatMap(b => (b.attachments || []).map(a => ({ bug: b.id, ...a })));
  if (files.length) {
    const keys = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${token}` } })).json();
    if (Array.isArray(keys)) service = (keys.find(k => k.name === 'service_role') || {}).api_key;
    else console.error('  ! sem permissão para ler as chaves do projeto (' + String((keys && keys.message) || 'resposta inesperada').slice(0, 80) + '): os prints não serão baixados, só o texto dos bugs.');
  }
  const saved = {};
  for (const f of files) {
    if (!service) break;
    try {
      const sign = await (await fetch(`https://${ref}.supabase.co/storage/v1/object/sign/item-files/${f.path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { Authorization: `Bearer ${service}`, apikey: service, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 300 }) })).json();
      if (!sign.signedURL) throw new Error(sign.message || 'sem link');
      const bin = Buffer.from(await (await fetch(`https://${ref}.supabase.co/storage/v1${sign.signedURL}`)).arrayBuffer());
      const rel = `anexos/${safe(f.bug)}-${safe(f.name)}`;
      writeFileSync(join(out, rel), bin); (saved[f.bug] = saved[f.bug] || []).push({ name: f.name, rel });
    } catch (e) { console.error(`  ! anexo ${f.name} (${f.bug}): ${e.message}`); }
  }
  const STATUS = { todo: 'A fazer', doing: 'Em andamento', review: 'Em revisão', done: 'Concluído' };
  const md = [`# Bugs — ${p.name}${p.client ? ' (' + p.client + ')' : ''}`, '', `Exportado do PMO Compass em ${new Date().toLocaleString('pt-BR')} · ${bugs.length} bug(s)${flag('--all') ? ' (leitura de todos: corrigir só os que estão em Em andamento)' : ' prontos para correção (em Em andamento)'}.`, '',
    'Os bugs vêm na ORDEM DE PRIORIDADE definida pela gestão (P1 primeiro; sem prioridade por último): corrija nessa ordem. Cada bug é filho de uma entrega do projeto. A descrição segue a ordem: caminho no sistema, gravidade, passo a passo, o que se esperava, o que aconteceu e o contexto técnico.', ''];
  for (const b of bugs) {
    md.push(`## ${b.id} — ${b.title}`, '', `- **Situação:** ${STATUS[b.status] || b.status}`, `- **Prioridade:** ${b.bug_priority ? 'P' + b.bug_priority + ' (posição ' + b.bug_priority + ' na fila; 1 = corrigir primeiro)' : 'sem prioridade definida'}`, `- **Entrega (item pai):** ${b.parent_id ? b.parent_id + ' — ' + (b.parent_title || '') : 'sem item pai (bug antigo)'}`, `- **Sprint:** ${b.sprint_name || 'fora de sprint (backlog)'}`, `- **Registrado em:** ${b.created_on || '—'}`, '', '```text', b.description || '(sem descrição)', '```', '');
    const an = saved[b.id] || [];
    if (an.length) { md.push('**Anexos:**', ''); an.forEach(a => md.push(`- [${a.name}](${a.rel})`)); md.push(''); }
    else if ((b.attachments || []).length) md.push('_(há anexos, mas não foi possível baixá-los)_', '');
  }
  if (waiting.length) md.push('## Fora da correção automática (não estão em "Em andamento")', '', 'Para corrigir, a gestão move o card para **Em andamento** no PMO Compass.', '', ...waiting.map(b => `- ${b.id} — ${b.title} (${STATUS[b.status] || b.status})`), '');
  writeFileSync(join(out, 'bugs.md'), md.join('\n'));
  if (waiting.length) console.log('Fora da correção automática (não estão em "Em andamento"): ' + waiting.map(b => b.id + ' (' + (STATUS[b.status] || b.status) + ')').join(', ') + '.');
  console.log(`${bugs.length} bug(s) de "${p.name}" ${flag('--all') ? 'exportados' : 'prontos para correção (Em andamento) exportados'} para ${out}${files.length ? ` (${Object.values(saved).flat().length}/${files.length} anexo(s))` : ''}.`);
} catch (e) { console.error('Falha: ' + String(e.message).slice(0, 300)); process.exitCode = 1; } };
await main();
