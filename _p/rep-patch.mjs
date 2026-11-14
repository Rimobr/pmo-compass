import { readFileSync, writeFileSync } from 'node:fs';
const f = 'D:/Claude/Compass/PMO_Compass_v2.html'; let s = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const rd = n => readFileSync('D:/Claude/Compass/_p/' + n, 'utf8').replace(/\r\n/g, '\n');
const once = (a, b) => { if (s.split(a).length !== 2) throw new Error('âncora ' + a.slice(0, 80) + ' x' + (s.split(a).length - 1)); s = s.replace(a, () => b); };

// 1) módulos e seção
once('<!-- ■ MODULE: services/hours-cost', rd('rep-engine.html') + rd('rep-js.html') + '<!-- ■ MODULE: services/hours-cost');
once('<!-- ■ MODULE: pages/pmoview -->', rd('rep-page.html') + '\n<!-- ■ MODULE: pages/pmoview -->');

// 2) Configurações: aba Relatórios (Construtor)
once('    <button class="settings-tab" id="stab-comunic" onclick="SettingsTabs.show(\'comunic\')">', '    <button class="settings-tab" id="stab-relat" onclick="SettingsTabs.show(\'relat\')"><i class="ti ti-tools"></i>Relatórios</button>\n    <button class="settings-tab" id="stab-comunic" onclick="SettingsTabs.show(\'comunic\')">');
once('  <div id="settings-panel-comunic" style="display:none">', `  <div id="settings-panel-relat" style="display:none">
    <div class="card">
      <div class="lbl"><i class="ti ti-tools"></i>Construtor de Relatórios</div>
      <p style="font-size:12.5px;color:var(--t2);line-height:1.65;margin-bottom:10px">Monte relatórios próprios com os campos que quiser (colunas, filtros, agrupar e somar), salve como modelo e escolha quem abre. Os modelos aparecem na <a href="#" onclick="R.go('reports');return false">Central de Relatórios</a>, junto dos relatórios padrão. O sistema só mostra a cada pessoa os campos que o perfil dela permite (custos exigem <b>ver custos</b>; horas de outras pessoas exigem <b>ver horas de todos</b>).</p>
    </div>
    <div id="rpb-root" style="margin-top:12px"></div>
  </div><!-- /settings-panel-relat -->

  <div id="settings-panel-comunic" style="display:none">`);
once("  const TABS = ['pmo','acesso','ia','comunic','dados'];", "  const TABS = ['pmo','acesso','ia','relat','comunic','dados'];");
once("comunic:['manage_settings'], dados:", "relat:['manage_settings'], comunic:['manage_settings'], dados:");
once("    if(tab === 'comunic' && typeof Messaging !== 'undefined') Messaging.render();", "    if(tab === 'comunic' && typeof Messaging !== 'undefined') Messaging.render();\n    if(tab === 'relat' && typeof Reports !== 'undefined') Reports.builderRender();");

// 3) menu: grupo só de relatórios
once('  <div class="sb-group" id="sbg-indicadores">', `  <div class="sb-group" id="sbg-relatorios">
    <button class="sb-group-hdr" onclick="Nav.toggleGroup('sbg-relatorios')" title="Relatórios padrão, modelos do Construtor e atalhos dos relatórios das telas"><i class="ti ti-file-analytics sb-gico"></i>Relatórios<i class="ti ti-chevron-right sb-gchev"></i></button>
    <div class="sb-group-body">
      <button class="si" data-p="reports" onclick="R.go('reports')"><i class="ti ti-file-analytics"></i>Central de Relatórios</button>
    </div>
  </div>

  <div class="sb-group" id="sbg-indicadores">`);

// 4) navegação, permissão, títulos
once("'help','xray','drpmo','account','sprintnow','noproject'];", "'help','xray','drpmo','account','sprintnow','noproject','reports'];");
once("    if(id === 'pmoview' && typeof PmoView !== 'undefined') PmoView.render();", "    if(id === 'pmoview' && typeof PmoView !== 'undefined') PmoView.render();\n    if(id === 'reports' && typeof Reports !== 'undefined') Reports.render();");
once("    pfkpi:'sbg-indicadores', portfolio:'sbg-indicadores', prioritization:'sbg-indicadores', report:'sbg-indicadores',", "    pfkpi:'sbg-indicadores', portfolio:'sbg-indicadores', prioritization:'sbg-indicadores', report:'sbg-indicadores', reports:'sbg-relatorios',");
once("    xray: 'view_management', drpmo: 'view_management',", "    reports: 'view_management', xray: 'view_management', drpmo: 'view_management',");
once("sbg_indicadores: 'Portfólio e Relatórios', sbg_visao:", "sbg_indicadores: 'Portfólio e Relatórios', sbg_relatorios: 'Relatórios', sbg_visao:");
once("    portfolio:'Portfólio', prioritization:", "    reports:'Central de Relatórios', portfolio:'Portfólio', prioritization:");
once("          if(typeof MyDigest !== 'undefined') MyDigest.render();", "          if(typeof MyDigest !== 'undefined') MyDigest.render();\n          if(typeof Reports !== 'undefined') Reports.render();");
writeFileSync(f, s.replace(/\n/g, '\r\n')); console.log('ok');
