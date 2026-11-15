// Ciclo no banco real: conflitos entre os gatilhos (épico, fila de bugs, comentário só de inclusão, item pai do bug). Usa linhas ZZ-* e apaga tudo.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const env = Object.fromEntries(readFileSync(ROOT + '.env.deploy','utf8').split(/\r?\n/).map(l=>l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^["']|["']$/g,'')]));
const ref = readFileSync(ROOT + 'supabase/.temp/project-ref','utf8').trim();
const q = async sql => { const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method:'POST', headers:{Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'}, body: JSON.stringify({query: sql}) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { ok: r.ok, body: t, j }; };
// P = projeto descartável só do teste: nunca toca nos projetos e quadros reais, e é apagado no fim
const P = 'zzciclo', res = [];  const ok = (c, m, x) => { res.push(c); console.log(c ? 'OK   ' : 'FALHA', m, c ? '' : (x || '')); };
const lit = s => `'${String(s).replace(/'/g, "''")}'`;
const row = async id => (await q(`select kind,status,assignee,points,sprint_id,epic_id,parent_id,bug_priority,history from public.backlog_items where project_id='${P}' and id='${id}'`)).j[0];
try {
  await q(`delete from public.projects where id='${P}'`);
  await q(`insert into public.projects(id,name,methodology) values ('${P}','ZZ teste do ciclo (apagado no fim)','quadro')`);
  await q(`insert into public.backlog_items(project_id,id,title,kind,status) values ('${P}','ZZ-EP','epico ciclo','epico','todo'),('${P}','ZZ-H1','historia ciclo','historia','todo')`);
  await q(`update public.backlog_items set epic_id='ZZ-EP' where project_id='${P}' and id='ZZ-H1'`);
  // 1) fila de bugs convive com o épico
  const bug = (id, p) => q(`insert into public.backlog_items(project_id,id,title,kind,status,parent_id,bug_priority) values ('${P}','${id}','bug ciclo','bug','todo','ZZ-H1',${p})`);
  await bug('ZZ-B1', 1); await bug('ZZ-B2', 1); await bug('ZZ-B3', 2);
  let r = (await q(`select id, bug_priority from public.backlog_items where project_id='${P}' and id like 'ZZ-B%' order by bug_priority`)).j.map(x => x.id + ':' + x.bug_priority).join();
  ok(r === 'ZZ-B2:1,ZZ-B3:2,ZZ-B1:3', 'fila de bugs encaixa e empurra com épico no projeto', r);
  r = await row('ZZ-EP'); ok(r.bug_priority === null && r.kind === 'epico', 'o épico nunca entra na fila de bugs');
  // 2) bug com ÉPICO como item pai: não deve ser permitido (o bug se liga a uma entrega)
  r = await q(`insert into public.backlog_items(project_id,id,title,kind,status,parent_id) values ('${P}','ZZ-B4','bug no epico','bug','todo','ZZ-EP')`);
  ok(!r.ok, 'bug não pode ter o ÉPICO como item pai (o banco recusa)', 'o banco ACEITOU');
  // 3) comentário só de inclusão convive com troca de épico e com a exclusão do épico
  const c1 = { at: '2026-11-11T10:00:00Z', by: 'Teste', field: '', from: '', to: 'Comentário: primeiro' };
  r = await q(`update public.backlog_items set history=${lit(JSON.stringify([c1]))}::jsonb where project_id='${P}' and id='ZZ-H1'`); ok(r.ok, 'acrescentar comentário na história');
  await q(`insert into public.backlog_items(project_id,id,title,kind,status) values ('${P}','ZZ-EP2','epico dois','epico','todo')`);
  r = await q(`update public.backlog_items set epic_id='ZZ-EP2' where project_id='${P}' and id='ZZ-H1'`); ok(r.ok && (await row('ZZ-H1')).epic_id === 'ZZ-EP2', 'trocar a história de épico (sem mexer no histórico) é permitido');
  r = await q(`update public.backlog_items set epic_id='ZZ-EP', history='[]'::jsonb where project_id='${P}' and id='ZZ-H1'`); ok(!r.ok && (await row('ZZ-H1')).epic_id === 'ZZ-EP2', 'apagar o comentário junto com a troca de épico: recusado e nada muda');
  await q(`delete from public.backlog_items where project_id='${P}' and id='ZZ-EP2'`);
  r = await row('ZZ-H1'); ok(r.epic_id === null && r.history.length === 1, 'excluir o épico solta a história sem tocar nos comentários');
  // 4) conversão por SQL (história -> épico) zera o que não vale e preserva comentários
  r = await q(`update public.backlog_items set kind='epico', assignee='Leandro R', points=5 where project_id='${P}' and id='ZZ-H1'`); const h1 = await row('ZZ-H1');
  ok(r.ok && h1.kind === 'epico' && h1.assignee === null && h1.points === null && h1.history.length === 1, 'história convertida em épico: campos zerados e comentário preservado', JSON.stringify(h1));
  // 5) sprint no épico e prioridade em história são ignoradas
  r = await q(`update public.backlog_items set bug_priority=3 where project_id='${P}' and id='ZZ-H1'`); ok(r.ok && (await row('ZZ-H1')).bug_priority === null, 'prioridade de bug em item que não é bug é descartada');
  // 6) pessoa única: logado, colaborador só entra com nome e conta ativa (sem sessão, a manutenção direta segue livre)
  const UID = (await q(`select id from public.profiles where active order by created_at limit 1`)).j[0].id;
  const asUser = sql => q(`select set_config('request.jwt.claims', '{"sub":"${UID}","role":"authenticated"}', true), set_config('request.jwt.claim.sub', '${UID}', true); ${sql}`);
  r = await asUser(`insert into public.team_members(id,project_id,name) values ('ZZ-TM1','${P}','Fulano Digitado')`); ok(!r.ok, 'colaborador sem conta é recusado pelo banco', 'o banco ACEITOU');
  r = await asUser(`insert into public.team_members(id,project_id,name,user_id) values ('ZZ-TM2','${P}','Pessoa Com Conta','${UID}')`); ok(r.ok, 'colaborador ligado a uma conta ativa entra', JSON.stringify(r));
  r = await asUser(`insert into public.team_members(id,project_id,name) values ('ZZ-TM2','${P}','Pessoa Com Conta') on conflict (id) do update set role='QA'`); ok(r.ok, 'regravar (upsert) quem já tem conta não perde o vínculo', JSON.stringify(r));
  r = await asUser(`update public.team_members set user_id = null where id = 'ZZ-TM2'`); ok(!r.ok, 'não dá para desligar a conta de um colaborador', 'o banco ACEITOU');
  r = await q(`insert into public.team_members(id,project_id,name) values ('ZZ-TM3','${P}','Manutenção direta')`); ok(r.ok, 'manutenção direta (sem sessão) segue livre');
} catch (e) { ok(false, 'ERRO inesperado: ' + e.message); }
finally { await q(`delete from public.projects where id='${P}'`); await q(`delete from public.team_members where id like 'ZZ-TM%'`); await q(`delete from public.backlog_items where project_id='${P}' and id like 'ZZ-%'`); console.log('limpo:', JSON.stringify((await q(`select count(*) from public.backlog_items where project_id='${P}' and id like 'ZZ-%'`)).j)); }
const f = res.filter(x => !x).length; console.log('\nRESULTADO banco: ' + (res.length - f) + ' de ' + res.length + ' OK' + (f ? ' — ' + f + ' FALHA(S)' : ''));
