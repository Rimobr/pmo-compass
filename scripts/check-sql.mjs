#!/usr/bin/env node
// Confere a SINTAXE de todas as migrações (e dos corpos plpgsql) com o parser real do PostgreSQL — pega erros de digitação
// antes de tocar no banco. Não substitui o ensaio no banco (node scripts/db-apply.mjs --dry-run), que valida nomes e permissões.
import { parse, loadModule, parsePlPgSQL } from '@libpg-query/parser';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
await loadModule();
let bad = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(dir + '/' + f, 'utf8');
  try {
    const r = await parse(sql);
    // valida também os corpos plpgsql das funções
    let fns = 0;
    for (const st of r.stmts) {
      const cf = st.stmt && st.stmt.CreateFunctionStmt;
      if (!cf) continue;
      const lang = (cf.options || []).find(o => o.DefElem.defname === 'language');
      const body = (cf.options || []).find(o => o.DefElem.defname === 'as');
      if (lang && lang.DefElem.arg.String.sval === 'plpgsql' && body) {
        const src = body.DefElem.arg.List.items[0].String.sval;
        const name = cf.funcname.map(n => n.String.sval).join('.');
        // função que devolve tabela (RETURN QUERY) não pode ser conferida como gatilho: o invólucro de teste ajusta o tipo de retorno
        const ret = /return\s+query/i.test(src) ? 'setof record' : 'trigger';
        await parsePlPgSQL(`create function ${'x_' + fns}() returns ${ret} language plpgsql as $b$${src}$b$`);
        fns++;
      }
    }
    console.log('ok  ', f, `${r.stmts.length} comandos, ${fns} funções plpgsql`);
  } catch (e) { bad++; console.log('ERRO', f, e.message, e.cursorPosition || ''); }
}
process.exit(bad ? 1 : 0);
