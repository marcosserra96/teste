// =====================================================
// js/admin.js - ORQUESTRADOR PRINCIPAL
// =====================================================
import { 
  auth, db, collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, 
  onAuthStateChanged, query, where, increment 
} from "./firebase.js";

import { appState } from "./modules/state.js";
import { showToast, mostrarConfirmacao, setupSubTabs, setupConfiguracoesGerais } from "./modules/ui.js";
import * as excelUtils from "./modules/excelUtils.js";
window._excelUtils = excelUtils;
import { setupDashboard, renderGraficosETop, garantirBibliotecasPDF } from "./modules/dashboard.js";
import { setupFinanceiroPlanilha, carregarFinanceiroPlanilha } from "./modules/financeiro.js";
import { setupContabilizacao, setAtualizarTelasCallback } from "./modules/pontuacao.js";
import { setupCadastrarPessoa, setupImportacaoAtletas, setupToggleAtivos, setupLimparBase, setAtualizarTelasGestao, renderCamposExtrasCadastro } from "./modules/gestao.js";


// =====================================================
// 🎨 CONFIGURAÇÃO DE IDENTIDADE VISUAL
// =====================================================
const TEMA_PADRAO_PORTAL = {
  primary: "#009bc1",
  secondary: "#00b37e",
  accent: "#f37021",
  danger: "#e63946",
  bgLight: "#f5f7fa",
  bgDark: "#121212",
  cardDark: "#1e1e1e"
};

function normalizarTemaPortal(config = {}) {
  return {
    ...TEMA_PADRAO_PORTAL,
    ...(config || {})
  };
}

function hexToRgb(hex) {
  const limpo = String(hex || "").replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(limpo)) return null;
  return {
    r: parseInt(limpo.slice(0, 2), 16),
    g: parseInt(limpo.slice(2, 4), 16),
    b: parseInt(limpo.slice(4, 6), 16)
  };
}

function ajustarHex(hex, percentual = -12) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const fator = percentual / 100;
  const calc = (v) => Math.max(0, Math.min(255, Math.round(percentual < 0 ? v * (1 + fator) : v + (255 - v) * fator)));
  return `#${[calc(rgb.r), calc(rgb.g), calc(rgb.b)].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

function aplicarIdentidadeVisual(config = {}) {
  const tema = normalizarTemaPortal(config);
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--primary", tema.primary);
  rootStyle.setProperty("--primary-hover", ajustarHex(tema.primary, -16));
  rootStyle.setProperty("--secondary", tema.secondary);
  rootStyle.setProperty("--accent", tema.accent);
  rootStyle.setProperty("--danger", tema.danger);
  rootStyle.setProperty("--brand-bg-light", tema.bgLight);
  rootStyle.setProperty("--brand-bg-dark", tema.bgDark);
  rootStyle.setProperty("--brand-card-dark", tema.cardDark);
  rootStyle.setProperty("--brand-header-start", ajustarHex(tema.primary, -26));
  rootStyle.setProperty("--brand-header-mid", tema.primary);
  rootStyle.setProperty("--brand-header-end", tema.secondary);
  appState.configTemaPortal = tema;
  localStorage.setItem("atletasConfigTemaPortal", JSON.stringify(tema));
  return tema;
}

async function carregarIdentidadeVisual() {
  try {
    const local = localStorage.getItem("atletasConfigTemaPortal");
    if (local) aplicarIdentidadeVisual(JSON.parse(local));
  } catch (_) {}

  try {
    const snap = await getDoc(doc(db, "configuracoes", "tema"));
    if (snap.exists()) {
      aplicarIdentidadeVisual(snap.data());
    } else {
      aplicarIdentidadeVisual(TEMA_PADRAO_PORTAL);
    }
  } catch (err) {
    console.warn("Não foi possível carregar as cores do tema:", err);
    aplicarIdentidadeVisual(appState.configTemaPortal || TEMA_PADRAO_PORTAL);
  }
}

// =====================================================
// 🔒 INICIALIZAÇÃO E PERMISSÕES
// =====================================================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    appState.currentUser = user; 
    try {
      const docSnap = await getDoc(doc(db, "atletas", user.uid));
      if (docSnap.exists() && (docSnap.data().role === "admin" || docSnap.data().role === "comite")) {
        appState.userRole = docSnap.data().role;
        appState.userPermissoes = appState.userRole === "admin" ? 
          ["visao-geral", "contabilizacao", "financeiro_view", "financeiro_edit", "gestao", "configuracoes"] : 
          (docSnap.data().permissoes || ["visao-geral", "configuracoes"]);
        
        await carregarIdentidadeVisual();
        construirMenu(); 
        iniciarPainelAdmin();
      } else { window.location.href = "index.html"; }
    } catch (err) { showToast("Erro ao validar permissões: " + err.message, "error"); }
  } else { window.location.href = "index.html"; }
});

function construirMenu() {
  const menu = document.getElementById("menuNavegacao");
  menu.innerHTML = "";

  // Itens visíveis para comitê e admin
  const itensComite = [
    { id: "visao-geral",    icon: "house",        text: "Início" },
    { id: "atletas",        icon: "users",        text: "Atletas",    permCheck: ["visao-geral", "gestao"] },
    { id: "contabilizacao", icon: "pencil-line",  text: "Registrar" },
    { id: "financeiro",     icon: "wallet",       text: "Financeiro", permCheck: ["financeiro_view", "financeiro_edit"] },
    { id: "configuracoes",  icon: "sliders-horizontal", text: "Minha Conta" },
  ];

  // Itens exclusivos do admin — aparecem após separador visual
  const itensAdmin = [
    { id: "gestao", icon: "settings-2", text: "Configurar Portal", adminOnly: true },
  ];

  let abaAtiva = false;
  itensComite.forEach(item => {
    const hasAccess = item.permCheck
      ? item.permCheck.some(p => appState.userPermissoes.includes(p))
      : appState.userPermissoes.includes(item.id);
    if (hasAccess || appState.userRole === "admin") {
      const isFirst = !abaAtiva; if (isFirst) abaAtiva = true;
      menu.innerHTML += `<div class="menu-item ${isFirst ? 'active' : ''}" data-section="${item.id}" data-tooltip="${item.text}"><i data-lucide="${item.icon}"></i><span>${item.text}</span></div>`;
    }
  });

  // Separador + itens de admin
  if (appState.userRole === "admin") {
    menu.innerHTML += `<div class="sidebar-divider"><span>Administração</span></div>`;
    itensAdmin.forEach(item => {
      menu.innerHTML += `<div class="menu-item menu-item--admin" data-section="${item.id}" data-tooltip="${item.text}"><i data-lucide="${item.icon}"></i><span>${item.text}</span></div>`;
    });
  }
  
  document.querySelectorAll("main section").forEach(sec => {
    sec.classList.remove("active-section");
    const activeMenu = document.querySelector('.menu-item.active');
    if (activeMenu && sec.id === activeMenu.dataset.section) sec.classList.add("active-section"); 
  });

  // Badge de role e avatar do usuário
  const badge = document.getElementById("userGroupBadge");
  const avatar = document.getElementById("userAvatar");
  const displayName = document.getElementById("userDisplayName");
  const roleLabel = appState.userRole === "admin" ? "Admin" : "Comitê";
  if (badge) { badge.style.display = "block"; badge.textContent = roleLabel; }

  // Preenche nome e inicial do avatar com os dados do usuário logado
  const emailRaw = appState.currentUser?.email || "";
  const nomeUsuario = appState.mapAtletas?.[appState.currentUser?.uid]?.nome
    || appState.currentUser?.displayName
    || (emailRaw ? emailRaw.split("@")[0].replace(/[._]/g, " ") : "Usuário");
  const primeiroNome = nomeUsuario.split(" ")[0];
  const nomeCapitalizado = primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1).toLowerCase();
  if (displayName) displayName.textContent = nomeCapitalizado;
  if (avatar) avatar.textContent = nomeCapitalizado.charAt(0).toUpperCase();

if (appState.userRole !== "admin") { document.querySelectorAll(".admin-only-element").forEach(el => el.style.display = "none"); }

  document.querySelectorAll(".menu-item").forEach(item => {
    item.addEventListener("click", () => {
      document.querySelectorAll(".menu-item").forEach(btn => btn.classList.remove("active"));
      item.classList.add("active");
      document.querySelectorAll("main section").forEach(sec => {
        sec.classList.remove("active-section");
        if (sec.id === item.dataset.section) sec.classList.add("active-section");
      });
      // No mobile fecha a sidebar após navegar
      if (window.innerWidth <= 768) document.body.classList.remove("sidebar-open");
      if (typeof lucide !== 'undefined') lucide.createIcons();
    });
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();

  setupSidebar();
}

function setupAtalhosSectionHeader() {
  // Botão "Cadastrar atleta" no header da seção Atletas → ativa a aba Cadastrar
  document.getElementById("btnIrCadastrar")?.addEventListener("click", () => {
    const tab = document.querySelector('#atletas .sub-tab[data-target="sub-cadastrar"]');
    tab?.click();
  });
  // Botão "Registrar treino" no header da seção Registrar → garante aba correta ativa
  document.getElementById("btnIrLancar")?.addEventListener("click", () => {
    const tab = document.querySelector('#contabilizacao .sub-tab[data-target="sub-lancar"]');
    tab?.click();
  });
  // Botão "Novo gasto" no header da seção Financeiro → abre modal de despesa
  document.getElementById("btnIrGastos")?.addEventListener("click", () => {
    const tab = document.querySelector('#financeiro .sub-tab[data-target="sub-fin-planilha"]');
    tab?.click();
    setTimeout(() => document.getElementById("btnAbrirModalDespesa")?.click(), 100);
  });
}

function setupSidebar() {
  const sidebar = document.getElementById("appSidebar");
  const hamburgerBtn = document.getElementById("sidebarToggleBtn");
  const searchInput = document.getElementById("buscaGlobalAtleta");

  // Persistir estado de collapse
  const collapsed = localStorage.getItem("sidebarCollapsed") === "true";
  if (collapsed) document.body.classList.add("sidebar-collapsed");

  // Hamburger: no desktop faz collapse; no mobile abre/fecha
  hamburgerBtn?.addEventListener("click", () => {
    if (window.innerWidth <= 768) {
      document.body.classList.toggle("sidebar-open");
    } else {
      const isCollapsed = document.body.classList.toggle("sidebar-collapsed");
      localStorage.setItem("sidebarCollapsed", isCollapsed);
    }
  });

  // Atalho "/" para focar na busca
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== searchInput && !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      searchInput?.focus();
    }
  });
}

function initCustomSelects(scope = "body") {
  const root = typeof scope === "string" ? document.querySelector(scope) : scope;
  if (!root) return;

  root.querySelectorAll("select[data-custom-select]").forEach(sel => {
    if (sel.closest(".c-select")) return; // already wrapped
    const wrapper = document.createElement("div");
    wrapper.className = "c-select";

    const trigger = document.createElement("div");
    trigger.className = "c-select__trigger";
    trigger.setAttribute("tabindex", "0");

    const text = document.createElement("span");
    text.className = "c-select__trigger-text";

    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    arrow.setAttribute("viewBox", "0 0 24 24"); arrow.setAttribute("fill", "none");
    arrow.setAttribute("stroke", "currentColor"); arrow.setAttribute("stroke-width", "2");
    arrow.setAttribute("stroke-linecap", "round"); arrow.setAttribute("stroke-linejoin", "round");
    arrow.classList.add("c-select__arrow");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    path.setAttribute("points", "6 9 12 15 18 9"); arrow.appendChild(path);

    trigger.appendChild(text); trigger.appendChild(arrow);

    const menu = document.createElement("div");
    menu.className = "c-select__menu";

    const mkIcon = (name) => {
      const el = document.createElement("i");
      el.dataset.lucide = name;
      return el;
    };

    const sync = () => {
      const opt = sel.options[sel.selectedIndex];
      text.innerHTML = "";
      if (opt) {
        if (opt.dataset.icon) { const ic = mkIcon(opt.dataset.icon); text.appendChild(ic); if (window.lucide) lucide.createIcons({ el: ic }); }
        text.append(opt.text);
      }
      menu.querySelectorAll(".c-select__option").forEach((el, i) => {
        el.classList.toggle("selected", i === sel.selectedIndex);
      });
    };

    Array.from(sel.options).forEach((opt, i) => {
      const item = document.createElement("div");
      item.className = "c-select__option";
      if (opt.dataset.icon) { item.appendChild(mkIcon(opt.dataset.icon)); }
      item.append(opt.text);
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        sel.selectedIndex = i;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
        wrapper.classList.remove("open");
      });
      menu.appendChild(item);
    });

    const open = () => {
      document.querySelectorAll(".c-select.open").forEach(el => el !== wrapper && el.classList.remove("open"));
      wrapper.classList.toggle("open");
    };
    const close = () => wrapper.classList.remove("open");
    trigger.addEventListener("click", open);
    trigger.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      if (e.key === "Escape") close();
    });

    sel.parentNode.insertBefore(wrapper, sel);
    wrapper.appendChild(sel);
    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);
    sync();
    if (window.lucide) lucide.createIcons({ el: menu });
  });

  document.addEventListener("click", e => {
    if (!e.target.closest(".c-select")) {
      document.querySelectorAll(".c-select.open").forEach(el => el.classList.remove("open"));
    }
  }, { capture: true, passive: true });
}

function iniciarPainelAdmin() {
  setupSubTabs();
  setupAtalhosSectionHeader();
  setupConfiguracoesGerais();
  setupDashboard();
  setTimeout(() => garantirBibliotecasPDF().catch(() => {}), 2000);
  setupFinanceiroPlanilha();
  setupContabilizacao();
  setupCadastrarPessoa();
  setupImportacaoAtletas();
  document.querySelector('#atletas .sub-tab[data-target="sub-cadastrar"]')?.addEventListener("click", () => {
    setTimeout(() => { renderCamposExtrasCadastro(); initCustomSelects("#cadastroExtraCampos"); initCustomSelects("#sub-cadastrar"); }, 0);
  });
  initCustomSelects("#sub-cadastrar");

  // Context menu de importação
  const btnToggleImport = document.getElementById("btnToggleImportMenu");
  const importMenu = document.getElementById("importContextMenu");
  btnToggleImport?.addEventListener("click", (e) => {
    e.stopPropagation();
    importMenu?.classList.toggle("open");
  });
  document.addEventListener("click", () => importMenu?.classList.remove("open"));
  setupToggleAtivos();
  setupLimparBase();

  setAtualizarTelasCallback(atualizarTelas);
  setAtualizarTelasGestao(atualizarTelas);

  setupRelatorioConsolidado();
  setupPermissoesModal();
  setupAgenda();
  setupModalRegras();
  setupModalEditar();
  setupFichaAtleta();
  setupCamposFichaConfig();
  setupAtletasConsulta();
  setupAdminCenter();
  setupTemaTopo();
  setupExportDropdown();
  setupHeroSticky();
  setupAppearanceButtons();

  atualizarTelas();
}


function setupTemaTopo() {
  const btn = document.getElementById("btnToggleTema");
  if (!btn) return;

  const aplicarTema = (tema) => {
    document.body.setAttribute("data-theme", tema);
    localStorage.setItem("atletasTema", tema);
    btn.title = tema === "dark" ? "Usar tema claro" : "Usar tema escuro";
    btn.innerHTML = tema === "dark" ? '<i data-lucide="sun"></i>' : '<i data-lucide="moon"></i>';
    if (typeof lucide !== "undefined") lucide.createIcons();
  };

  const temaSalvo = localStorage.getItem("atletasTema") || document.body.getAttribute("data-theme") || "light";
  aplicarTema(temaSalvo === "dark" ? "dark" : "light");

  btn.addEventListener("click", () => {
    const atual = document.body.getAttribute("data-theme") === "dark" ? "dark" : "light";
    aplicarTema(atual === "dark" ? "light" : "dark");
  });
}

async function atualizarTelas() {
  if (appState.userRole === "admin" || appState.userPermissoes.includes("gestao")) setupAprovacoes();
  await carregarAgenda();

  const snapA = await getDocs(query(collection(db, "atletas"), where("status", "==", "Aprovado")));
  appState.mapAtletas = {};
  snapA.forEach(d => { appState.mapAtletas[d.id] = { id: d.id, ...d.data() }; });

  await carregarHistorico();
  await carregarCamposFichaConfig();
  await carregarFinanceiroPlanilha();
  await carregarEquipesEDashboard();
  await carregarRegras();
  renderAtletasConsulta();
  atualizarAdminCenterResumo();

  const modTreinoSelect = document.getElementById("modTreino");
  if (modTreinoSelect && modTreinoSelect.value) modTreinoSelect.dispatchEvent(new Event('change'));

  // Esconde o overlay de loading na primeira carga
  const overlay = document.getElementById("appLoadingOverlay");
  if (overlay) overlay.classList.add("hidden");
}

// =====================================================
// 📊 ORQUESTRAÇÃO DE DADOS (GETTERS) E TABELAS
// =====================================================
async function carregarEquipesEDashboard() {
  let htmlFilaBike = "", htmlFilaCorrida = "", htmlBike = "", htmlCorrida = "", htmlComite = ""; 
  let contFila = 0, contBike = 0, contCorrida = 0, contComite = 0, ptsBike = 0, ptsCorrida = 0; 
  let todosAtletas = []; 
  
  let listaOrdenada = Object.values(appState.mapAtletas); 
  const filaEspera = listaOrdenada.filter(u => u.equipe === "Fila - Bicicleta" || u.equipe === "Fila - Corrida" || u.equipe === "Fila de Espera"); 
  const titulares = listaOrdenada.filter(u => u.equipe !== "Fila - Bicicleta" && u.equipe !== "Fila - Corrida" && u.equipe !== "Fila de Espera"); 
  
  filaEspera.sort((a, b) => new Date(a.criadoEm || 0) - new Date(b.criadoEm || 0)); 
  titulares.sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""))); 
  
  const hasGestao = appState.userRole === "admin" || appState.userPermissoes.includes("gestao");
  
  let idxBike = 1, idxCorrida = 1; 
  filaEspera.forEach((u) => { 
    const strikes = u.recusas || 0; 
    const badgeStrike = strikes > 0 ? `<span class="strike-badge"><i data-lucide="triangle-alert"></i> ${strikes}/3</span>` : ''; 
    let acoesHTML = ""; 
    
    if(hasGestao) { 
      acoesHTML = `<button class="btn-acao btn-aprovar-fila" data-id="${u.id}" data-eq="${u.equipe === 'Fila - Corrida' ? 'Corrida' : 'Bicicleta'}" style="color:var(--secondary); padding:4px;"><i data-lucide="check" style="width:16px;"></i></button> 
                   <button class="btn-acao btn-pular-fila" data-id="${u.id}" data-strikes="${strikes}" style="color:#f39c12; padding:4px;"><i data-lucide="skip-forward" style="width:16px;"></i></button>`; 
    } 
    if(u.equipe === "Fila - Bicicleta" || u.equipe === "Fila de Espera") { 
      htmlFilaBike += `<tr class="fila-row" draggable="true" data-id="${u.id}" data-equipe-fila="bike"><td data-label="Atleta"><span class="drag-handle"><i data-lucide="grip-vertical"></i></span><strong>${idxBike}º - ${u.nome}</strong> ${badgeStrike}</td><td data-label="Ações" style="text-align: right; vertical-align:middle;"><div style="display:inline-flex; justify-content:flex-end; gap:5px;">${acoesHTML}</div></td></tr>`; 
      idxBike++; contFila++; 
    } 
    if (u.equipe === "Fila - Corrida") { 
      htmlFilaCorrida += `<tr class="fila-row" draggable="true" data-id="${u.id}" data-equipe-fila="corrida"><td data-label="Atleta"><span class="drag-handle"><i data-lucide="grip-vertical"></i></span><strong>${idxCorrida}º - ${u.nome}</strong> ${badgeStrike}</td><td data-label="Ações" style="text-align: right; vertical-align:middle;"><div style="display:inline-flex; justify-content:flex-end; gap:5px;">${acoesHTML}</div></td></tr>`; 
      idxCorrida++; contFila++; 
    } 
  });
  
  titulares.forEach(u => { 
    const pts = Number(u.pontuacaoTotal) || 0; 
    const ativo = u.ativo !== false; 
    
    const n = u.dataNascimento ? new Date(u.dataNascimento+"T00:00:00").toLocaleDateString('pt-BR') : 'N/D';
    const tooltipInfo = `Local: ${u.localidade || 'Local não informado'}\nNascimento: ${n}\nEntrada: ${u.anoEntrada || 'N/D'}`;

    const podeGerenciarMembro = hasGestao && (appState.userRole === 'admin' || (u.role !== 'admin' && u.role !== 'comite'));
    const switchAtivo = podeGerenciarMembro ? `<label class="switch" title="Ativar/Desativar"><input type="checkbox" class="toggle-ativo" data-id="${u.id}" ${ativo ? 'checked' : ''}><span class="slider"></span></label>` : ''; 
    const btnFicha = `<button class="btn-acao btn-ficha" data-id="${u.id}" style="color: var(--primary); border-color: var(--primary); padding: 4px; margin-left: 5px;" title="Ver ficha do atleta"><i data-lucide="clipboard-list" style="width: 16px;"></i></button>`; 
    const btnPerm = (u.role === 'comite' && appState.userRole === 'admin') ? `<button class="btn-primario btn-permissoes" data-id="${u.id}" data-nome="${u.nome}" style="background: #f39c12; padding: 6px 10px; font-size: 0.8rem; margin-left: 5px;"><i data-lucide="key" style="width: 14px;"></i></button>` : ''; 
    const btnEditar = podeGerenciarMembro ? `<button class="btn-acao btn-editar-membro" data-id="${u.id}" style="color: var(--warning); border-color: var(--warning); padding: 4px; margin-left: 5px;"><i data-lucide="edit-2" style="width: 16px;"></i></button>` : ''; 
    const btnExcluir = (auth.currentUser?.uid !== u.id && podeGerenciarMembro) ? `<button class="btn-acao btn-excluir-membro" data-id="${u.id}" style="color: red; border: 0; padding: 4px; margin-left: 5px;"><i data-lucide="x-circle" style="width: 18px;"></i></button>` : ''; 
    const displayPts = u.role === 'atleta' ? `<br><small class="points-mini"><i data-lucide="trophy"></i> ${pts} pts</small>` : ''; 
    
    // A correção definitiva da linha (retiramos o flex direto do <td> e usamos um container <div>)
    const linha = `
      <tr>
        <td data-label="Atleta" class="${!ativo ? 'inativo-txt' : ''}" style="vertical-align:middle; text-align:left;">
          <strong title="${tooltipInfo}" style="cursor:help; border-bottom: 1px dashed var(--primary); padding-bottom: 2px;">${u.nome}</strong>${displayPts}
        </td>
        <td data-label="Ações" style="text-align: right; vertical-align:middle;">
          <div style="display:inline-flex; justify-content:flex-end; align-items:center; gap:5px;">
            ${switchAtivo} ${btnFicha} ${btnPerm} ${btnEditar} ${btnExcluir}
          </div>
        </td>
      </tr>`; 
    
    if (u.role === "admin" || u.role === "comite") { htmlComite += linha; contComite++; } 
    else if (u.equipe === "Corrida") { htmlCorrida += linha; contCorrida++; ptsCorrida += pts; todosAtletas.push({nome: u.nome, pts: pts, eq: u.equipe, id: u.id, ativo: ativo}); } 
    else if (u.equipe === "Bicicleta" || u.equipe === "Bike") { htmlBike += linha; contBike++; ptsBike += pts; todosAtletas.push({nome: u.nome, pts: pts, eq: u.equipe, id: u.id, ativo: ativo}); } 
  });
  
  if(document.getElementById("listaFilaBike")) document.getElementById("listaFilaBike").innerHTML = htmlFilaBike || `<tr><td colspan='2'>Ninguém na fila.</td></tr>`; 
  if(document.getElementById("listaFilaCorrida")) document.getElementById("listaFilaCorrida").innerHTML = htmlFilaCorrida || `<tr><td colspan='2'>Ninguém na fila.</td></tr>`; 
  if(document.getElementById("listaBicicleta")) document.getElementById("listaBicicleta").innerHTML = htmlBike || `<tr><td colspan='2'>Equipe vazia.</td></tr>`; 
  if(document.getElementById("listaCorrida")) document.getElementById("listaCorrida").innerHTML = htmlCorrida || `<tr><td colspan='2'>Equipe vazia.</td></tr>`; 
  if(document.getElementById("listaComite")) document.getElementById("listaComite").innerHTML = htmlComite || `<tr><td colspan='2'>Sem membros.</td></tr>`; 
  
  if(document.getElementById("totalBike")) document.getElementById("totalBike").textContent = contBike; 
  if(document.getElementById("totalCorrida")) document.getElementById("totalCorrida").textContent = contCorrida;
  
  renderGraficosETop(ptsBike, ptsCorrida, todosAtletas, contBike, contCorrida); 
  if(typeof lucide !== 'undefined') lucide.createIcons();
  setupDragDropFilas();
  
  document.querySelectorAll(".btn-aprovar-fila").forEach(btn => { 
    btn.addEventListener("click", async (e) => { 
      mostrarConfirmacao("Aprovar Atleta", "Mover o atleta da fila para a equipe principal?", async () => {
        e.currentTarget.disabled = true; 
        try { await updateDoc(doc(db, "atletas", e.currentTarget.dataset.id), { equipe: e.currentTarget.dataset.eq, recusas: 0 }); atualizarTelas(); } 
        catch(err) { showToast("Erro ao aprovar.", "error"); } 
      });
    }); 
  }); 
  
  document.querySelectorAll(".btn-pular-fila").forEach(btn => { 
    btn.addEventListener("click", async (e) => { 
      const id = e.currentTarget.dataset.id; 
      let st = parseInt(e.currentTarget.dataset.strikes); 
      mostrarConfirmacao("Pular Fila", "Passar a vez do atleta? Ele trocará de posição com o próximo.", async () => {
        st++; 
        if(st >= 3) { 
          mostrarConfirmacao("Aviso de 3 Recusas", "O atleta atingiu 3 recusas. Remover da fila e inativar?", async () => {
            await updateDoc(doc(db, "atletas", id), { ativo: false, equipe: "Nenhuma" }); 
            showToast("Removido da fila.", "info"); atualizarTelas(); 
          }, "danger"); return;
        } 
        try { 
          const eqFila = appState.mapAtletas[id].equipe; 
          const filaAtual = Object.values(appState.mapAtletas).filter(a => a.equipe === eqFila && a.ativo !== false).sort((a, b) => new Date(a.criadoEm || 0) - new Date(b.criadoEm || 0)); 
          const idx = filaAtual.findIndex(a => a.id === id); 
          if (idx >= 0 && idx < filaAtual.length - 1) { 
            const idProximo = filaAtual[idx + 1].id; 
            await updateDoc(doc(db, "atletas", id), { recusas: st, criadoEm: appState.mapAtletas[idProximo].criadoEm }); 
            await updateDoc(doc(db, "atletas", idProximo), { criadoEm: appState.mapAtletas[id].criadoEm }); 
            showToast("Posições trocadas!", "success"); 
          } else { 
            await updateDoc(doc(db, "atletas", id), { recusas: st }); 
            showToast("Último da fila. Apenas recusa registada.", "info"); 
          } 
          atualizarTelas(); 
        } catch(err) { showToast("Erro ao pular fila.", "error"); } 
      });
    }); 
  }); 
  
  document.querySelectorAll(".btn-excluir-membro").forEach(btn => { 
    btn.addEventListener("click", (e) => { 
      mostrarConfirmacao("Excluir Definitivo", "Apagar este membro permanentemente do sistema?", async () => {
        e.currentTarget.disabled = true; 
        try { await deleteDoc(doc(db, "atletas", e.currentTarget.dataset.id)); atualizarTelas(); } 
        catch(err) { showToast("Erro ao apagar.", "error"); } 
      }, "danger");
    }); 
  }); 
  
  document.querySelectorAll(".btn-editar-membro").forEach(btn => { 
    btn.addEventListener("click", (e) => { 
      const b = e.currentTarget; 
      const u = appState.mapAtletas[b.dataset.id];
      document.getElementById("editId").value = u.id; 
      document.getElementById("editNome").value = u.nome; 
      document.getElementById("editEmail").value = u.email !== "undefined" ? (u.email || "") : ""; 
      document.getElementById("editPapel").value = u.role === "comite" ? "Comitê" : u.equipe; 
      const optComite = document.querySelector('#editPapel option[value="Comitê"]');
      if (optComite) {
        optComite.hidden = appState.userRole !== "admin";
        optComite.disabled = appState.userRole !== "admin";
      }
      const avisoPerfilAdmin = document.getElementById("avisoPerfilAdmin");
      if (avisoPerfilAdmin) avisoPerfilAdmin.style.display = appState.userRole === "admin" ? "none" : "block";
      document.getElementById("editSexo").value = u.sexo || "Masculino";
      document.getElementById("editNasc").value = u.dataNascimento || "";
      document.getElementById("editLocalidade").value = u.localidade || "";
      document.getElementById("editAnoEntrada").value = u.anoEntrada || "";
      document.getElementById("modalEditarAtleta").style.display = "flex"; 
    }); 
  }); 
  
  document.querySelectorAll(".btn-ficha").forEach(btn => btn.addEventListener("click", (e) => abrirFichaAtleta(e.currentTarget.dataset.id))); 
  
  document.querySelectorAll(".btn-permissoes").forEach(btn => { 
    btn.addEventListener("click", (e) => { 
      const b = e.currentTarget; 
      document.getElementById("permNomeUsuario").textContent = b.dataset.nome; 
      document.getElementById("permUserId").value = b.dataset.id; 
      const perfilRapido = document.getElementById("permPerfilRapido"); if (perfilRapido) perfilRapido.value = "";
      const permissoesDB = appState.mapAtletas[b.dataset.id].permissoes || ["visao-geral"]; 
      document.querySelectorAll(".chk-perm").forEach(chk => { chk.checked = permissoesDB.includes(chk.value) || (permissoesDB.includes("financeiro") && chk.value.startsWith("financeiro")); }); 
      document.getElementById("modalPermissoes").style.display = "flex"; 
    }); 
  });
}

// =====================================================
// EXTRATOS, HISTÓRICO E RELATÓRIOS
// =====================================================
async function carregarHistorico() { 
  const snap = await getDocs(collection(db, "historico_pontos")); 
  appState.historicoCompleto = []; 
  snap.forEach(d => { appState.historicoCompleto.push({ id: d.id, ...d.data() }); }); 
  appState.historicoCompleto.sort((a, b) => new Date(b.dataTreino || "1970-01-01") - new Date(a.dataTreino || "1970-01-01")); 
  filtrarHistorico(); 
}

function filtrarHistorico() {
  const mes = document.getElementById("filtroMesHistorico")?.value; 
  const eq = document.getElementById("filtroEquipeHistorico")?.value; 
  const nomeBusca = document.getElementById("filtroNomeHistorico")?.value.toLowerCase(); 
  const statusFiltro = document.getElementById("filtroStatusHistorico")?.value;
  
  const dados = appState.historicoCompleto.filter(h => { 
    const atleta = appState.mapAtletas[h.atletaId]; 
    const isAtivo = atleta ? (atleta.ativo !== false) : false; 
    if (statusFiltro === "ativos" && !isAtivo) return false; 
    const nomeFiltro = h.atletaNome || (atleta ? atleta.nome : ""); 
    const eqFiltro = h.atletaEquipe || (atleta ? atleta.equipe : ""); 
    return (!mes || (h.dataTreino||"").startsWith(mes)) && (!eq || eqFiltro === eq) && (!nomeBusca || nomeFiltro.toLowerCase().includes(nomeBusca)); 
  });
  
  const tbody = document.getElementById("listaHistorico"); 
  if(!tbody) return;
  tbody.innerHTML = "";
  
  if (dados.length === 0) { tbody.innerHTML = `<tr><td colspan='6' style='text-align:center;'>Nenhum registo encontrado.</td></tr>`; return; }
  const podeEstornar = appState.userRole === "admin" || appState.userPermissoes.includes("contabilizacao");
  
  dados.forEach(h => {
    const atleta = appState.mapAtletas[h.atletaId]; 
    let nomeDisplay = h.atletaNome || (atleta ? atleta.nome : "Desconhecido"); 
    let eqDisplay = h.atletaEquipe || (atleta ? atleta.equipe : "-");
    
    if (atleta && atleta.ativo === false) nomeDisplay += " <small style='color:var(--danger); font-weight:bold;'>(Inativo)</small>"; 
    else if (!atleta) nomeDisplay += " <small style='color:#999; font-weight:bold;'>(Excluído)</small>"; 
    
    let ptsV = Number(h.pontos) === 0 ? `<span style="color:var(--accent);">Justificada</span>` : `+${h.pontos}`;
    const btnEstorno = podeEstornar ? `<button class="btn-acao btn-estornar" aria-label="Cancelar lançamento" data-id="${h.id}" data-atleta="${h.atletaId}" data-pontos="${h.pontos}" style="color:var(--danger); border-color:var(--danger);"><i data-lucide="undo-2" style="width:16px;"></i></button>` : '';
    
    tbody.innerHTML += `
      <tr>
        <td data-label="Data">${(h.dataTreino?new Date(h.dataTreino+"T00:00:00").toLocaleDateString('pt-BR'):"-")}</td>
        <td data-label="Atleta" style="text-align: left;"><strong>${nomeDisplay}</strong></td>
        <td data-label="Eq.">${eqDisplay}</td>
        <td data-label="Motivo">${h.descTreino}<br><small style="color:var(--primary);">${h.regraDesc}</small></td>
        <td data-label="Pts" style="text-align:center; color:var(--secondary); font-weight:bold;">${ptsV}</td>
        <td data-label="Ação" style="text-align:right;">${btnEstorno}</td>
      </tr>`;
  });
  
  if(typeof lucide !== 'undefined') lucide.createIcons();
  
  document.querySelectorAll(".btn-estornar").forEach(btn => { 
    btn.addEventListener("click", (e) => { 
      const histId = e.currentTarget.dataset.id; 
      const atlId = e.currentTarget.dataset.atleta; 
      const pts = parseInt(e.currentTarget.dataset.pontos); 
      mostrarConfirmacao("Cancelar lançamento", "Confirma o cancelamento deste lançamento? Os pontos serão descontados do atleta.", async () => {
        try { 
          if (appState.mapAtletas[atlId] && pts > 0) { await updateDoc(doc(db, "atletas", atlId), { pontuacaoTotal: increment(-pts) }); } 
          await deleteDoc(doc(db, "historico_pontos", histId)); 
          showToast("Lançamento estornado!", "success"); atualizarTelas(); 
        } catch (err) { showToast("Erro ao cancelar lançamento.", "error"); } 
      }, "danger");
    }); 
  });
}

["filtroMesHistorico", "filtroEquipeHistorico", "filtroNomeHistorico", "filtroStatusHistorico"].forEach(id => { 
  document.getElementById(id)?.addEventListener("input", filtrarHistorico); 
});
document.getElementById("btnLimparFiltrosExtrato")?.addEventListener("click", () => { 
  document.getElementById("filtroMesHistorico").value = ""; document.getElementById("filtroEquipeHistorico").value = ""; document.getElementById("filtroNomeHistorico").value = ""; document.getElementById("filtroStatusHistorico").value = "ativos"; filtrarHistorico(); 
});

function setupRelatorioConsolidado() { 
  if(document.getElementById("filtroAnoRelatorio")) document.getElementById("filtroAnoRelatorio").value = new Date().getFullYear(); 
  document.querySelector('[data-target="sub-relatorio"]')?.addEventListener("click", gerarRelatorioConsolidado); 
  document.getElementById("btnGerarRelatorio")?.addEventListener("click", gerarRelatorioConsolidado); 
  
  document.getElementById("chkTodosMeses")?.addEventListener("change", (e) => { document.querySelectorAll(".chk-mes-relatorio").forEach(chk => chk.checked = e.target.checked); });
  document.querySelectorAll(".chk-mes-relatorio").forEach(chk => {
    chk.addEventListener("change", () => {
      const allChecked = document.querySelectorAll(".chk-mes-relatorio:checked").length === 12;
      document.getElementById("chkTodosMeses").checked = allChecked;
    });
  });

  document.getElementById("btnExportarExcel")?.addEventListener("click", () => { 
    const tbody = document.getElementById("listaRelatorio"); 
    if(!tbody || tbody.innerText.includes("Clique em Filtrar") || tbody.innerText.includes("Nenhum atleta")) return showToast("Gere o relatório primeiro!", "error"); 
    const rows = document.getElementById("tabelaConsolidada").querySelectorAll("tr"); 
    let csv = "\uFEFF"; 
    rows.forEach(row => { 
      const cols = row.querySelectorAll("th, td"); 
      const rowData = Array.from(cols).map(c => `"${c.innerText.replace(/"/g, '""')}"`); csv += rowData.join(";") + "\r\n"; 
    }); 
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); 
    const a = document.createElement("a"); a.href = url; a.download = `Relatorio_Consolidado.csv`; a.click(); URL.revokeObjectURL(url); 
  }); 
}

function gerarRelatorioConsolidado() { 
  const ano = String(document.getElementById("filtroAnoRelatorio")?.value).trim(); 
  const eqFiltro = document.getElementById("filtroEquipeRelatorio")?.value; 
  const tbody = document.getElementById("listaRelatorio"); 
  const thead = document.getElementById("headRelatorio");

  if (!tbody || !thead) return;

  const mesesSelecionados = [];
  const nomesMeses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  document.querySelectorAll(".chk-mes-relatorio:checked").forEach(chk => { mesesSelecionados.push(parseInt(chk.value, 10)); });

  if (mesesSelecionados.length === 0) return showToast("Selecione pelo menos um mês para avaliar!", "error");

  let theadHTML = `<tr><th>Atleta</th><th>Eq</th>`;
  mesesSelecionados.forEach(m => { theadHTML += `<th>${nomesMeses[m - 1]}</th>`; });
  theadHTML += `<th style="text-align:center;">Total (${mesesSelecionados.length}m)</th></tr>`;
  thead.innerHTML = theadHTML;
  
  const histAno = appState.historicoCompleto.filter(h => h.dataTreino && h.dataTreino.startsWith(ano)); 
  let atletasRelatorio = Object.values(appState.mapAtletas).filter(a => a.role === "atleta" && !a.equipe.startsWith("Fila") && a.equipe !== "Nenhuma"); 
  if (eqFiltro) atletasRelatorio = atletasRelatorio.filter(a => a.equipe === eqFiltro); 
  
  if(atletasRelatorio.length === 0) { tbody.innerHTML = `<tr><td colspan='${mesesSelecionados.length + 3}' style='text-align:center;'>Nenhum atleta processado.</td></tr>`; return; } 
  
  let html = ""; 
  atletasRelatorio.forEach(atleta => { 
    atleta.totalPeriodo = 0; atleta.ptsMesTemp = {}; mesesSelecionados.forEach(m => atleta.ptsMesTemp[m] = 0);
    histAno.filter(h => h.atletaId === atleta.id).forEach(l => { 
      if(l.dataTreino && l.dataTreino.includes("-")) { 
        const mesInt = parseInt(l.dataTreino.split("-")[1], 10); 
        if(mesesSelecionados.includes(mesInt)) { 
          const pts = Number(l.pontos) || 0; atleta.ptsMesTemp[mesInt] += pts; atleta.totalPeriodo += pts; 
        } 
      } 
    }); 
  }); 
  
  atletasRelatorio.sort((a, b) => b.totalPeriodo - a.totalPeriodo); 
  
  atletasRelatorio.forEach(atleta => { 
    let colunas = ""; 
    mesesSelecionados.forEach(m => { 
      const p = atleta.ptsMesTemp[m]; colunas += `<td data-label="${nomesMeses[m-1]}" style="text-align: center; color: ${p > 0 ? 'var(--secondary)' : '#ccc'}; font-weight: ${p > 0 ? '600' : '400'};">${p}</td>`; 
    }); 
    html += `<tr><td data-label="Atleta" style="text-align:left;"><strong>${atleta.nome}</strong></td><td data-label="Equipa"><small>${atleta.equipe}</small></td>${colunas}<td data-label="Total" style="text-align: center; font-weight: bold; color: var(--primary);">${atleta.totalPeriodo}</td></tr>`; 
  }); 
  
  tbody.innerHTML = html; 
  if(typeof lucide !== 'undefined') lucide.createIcons();
}

// =====================================================
// 📅 AGENDA DE EVENTOS E OUTRAS CONFIGURAÇÕES
// =====================================================
function setupAgenda() {
  const modal = document.getElementById("modalEvento");
  if(!modal) return;

  const resetModalTexts = () => {
    document.querySelector("#modalEvento .pm-dialog__title").textContent = "Agendar evento";
    document.querySelector("#modalEvento .pm-dialog__desc").textContent = "Adicione um novo evento à agenda do programa.";
    delete modal.dataset.editId;
  };

  const fecharModal = () => {
    modal.style.display = "none";
    modal.classList.remove("pm-overlay--open");
    resetModalTexts();
  };

  const abrirModal = () => {
    resetModalTexts();
    modal.style.display = "flex";
    requestAnimationFrame(() => modal.classList.add("pm-overlay--open"));
  };

  document.getElementById("abrirModalEvento")?.addEventListener("click", abrirModal);
  document.getElementById("fecharModalEvento")?.addEventListener("click", fecharModal);
  document.getElementById("fecharModalEvento2")?.addEventListener("click", fecharModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) fecharModal(); });

  // Segmented control de modalidade
  document.querySelectorAll("#eventoModalidadeSeg .pm-seg__btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#eventoModalidadeSeg .pm-seg__btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("eventoModalidade").value = btn.dataset.value;
    });
  });

  document.getElementById("salvarEventoBtn")?.addEventListener("click", async (e) => {
    const titulo = document.getElementById("eventoTitulo").value.trim();
    const local  = document.getElementById("eventoLocal").value.trim();
    const mod    = document.getElementById("eventoModalidade").value;
    const data   = document.getElementById("eventoData").value;
    const km     = Number(document.getElementById("eventoKm")?.value || 0);
    if (!titulo || !data) return showToast("Título e Data são obrigatórios!", "error");
    e.target.textContent = "Salvando..."; e.target.classList.add("loading"); e.target.disabled = true;
    try {
      const modal = document.getElementById("modalEvento");
      const editId = modal?.dataset.editId;
      if (editId) {
        await setDoc(doc(db, "agenda_eventos", editId), { titulo, local, modalidade: mod, data, km }, { merge: true });
        delete modal.dataset.editId;
        document.querySelector("#modalEvento .pm-dialog__title").textContent = "Agendar evento";
        showToast("Evento atualizado!", "success");
      } else {
        await addDoc(collection(db, "agenda_eventos"), { titulo, local, modalidade: mod, data, km, criadoEm: new Date().toISOString() });
        showToast("Evento agendado com sucesso!", "success");
      }
      fecharModal();
      document.getElementById("eventoTitulo").value = "";
      document.getElementById("eventoLocal").value = "";
      if (document.getElementById("eventoKm")) document.getElementById("eventoKm").value = "";
      atualizarTelas();
    } catch (err) { showToast("Erro ao salvar: " + err.message, "error"); }
    finally { e.target.innerHTML = '<i data-lucide="check"></i> Salvar evento'; e.target.classList.remove("loading"); e.target.disabled = false; lucide.createIcons(); }
  });
}

async function carregarAgenda() { 
  try { 
    const snap = await getDocs(query(collection(db, "agenda_eventos"))); 
    appState.cacheEventos = []; snap.forEach(d => appState.cacheEventos.push({id: d.id, ...d.data()})); appState.cacheEventos.sort((a,b) => new Date(a.data) - new Date(b.data)); 
    
    const htmlDropdown = '<option value="">Nenhum (Lançamento Avulso)</option>' + appState.cacheEventos.map(e => `<option value="${e.id}">${e.titulo} (${new Date(e.data+"T00:00:00").toLocaleDateString('pt-BR')})</option>`).join(''); 
    if(document.getElementById("lancarEventoSelect")) document.getElementById("lancarEventoSelect").innerHTML = htmlDropdown; 
    
    const hoje = new Date().toISOString().split('T')[0]; 
    const futuros = appState.cacheEventos.filter(e => e.data >= hoje).slice(0, 4); 
    let html = ""; 
    const hasGestao = appState.userRole === "admin" || appState.userPermissoes.includes("gestao"); 
    
    futuros.forEach(e => { 
      const d = new Date(e.data + "T00:00:00"); const mes = d.toLocaleString('pt-BR', {month: 'short'}).replace('.',''); const dia = d.getDate().toString().padStart(2, '0'); 
      const icon = e.modalidade === "Bicicleta" ? "bike" : e.modalidade === "Corrida" ? "footprints" : "handshake";
      const kmInfo = Number(e.km || 0) > 0 ? `<span class="agenda-sep">·</span><strong>${formatarKm(e.km)} km</strong>` : "";
      const btnEditar  = hasGestao ? `<button class="btn-editar-evento agenda-action" aria-label="Editar evento" data-id="${e.id}" data-titulo="${e.titulo}" data-local="${e.local||''}" data-data="${e.data}" data-km="${e.km||0}" data-modalidade="${e.modalidade||'Ambas'}"><i data-lucide="pencil"></i></button>` : '';
      const btnExcluir = hasGestao ? `<button class="btn-excluir-evento agenda-action" aria-label="Cancelar evento" data-id="${e.id}"><i data-lucide="x"></i></button>` : '';
      const localEvento = e.local || 'Local não informado';
      html += `<div class="agenda-item">
        <div class="agenda-data"><span>${mes}</span><strong>${dia}</strong></div>
        <div class="agenda-info">
          <div class="agenda-title-row"><h4 title="${e.titulo}">${e.titulo}</h4><div class="agenda-actions">${btnEditar}${btnExcluir}</div></div>
          <p><i data-lucide="${icon}"></i><span>${localEvento}</span>${kmInfo}</p>
        </div>
      </div>`;
    });

    if(document.getElementById("listaEventosAgenda")) document.getElementById("listaEventosAgenda").innerHTML = html || `<div class="vg-empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><strong>Sem eventos próximos</strong><p>Clique em "Novo" para agendar um evento.</p></div>`;
    if(typeof lucide !== 'undefined') lucide.createIcons();

    document.querySelectorAll(".btn-editar-evento").forEach(btn => {
      btn.addEventListener("click", () => {
        const d = btn.dataset;
        const modal = document.getElementById("modalEvento");
        if (!modal) return;
        document.getElementById("eventoTitulo").value = d.titulo || '';
        document.getElementById("eventoLocal").value   = d.local   || '';
        document.getElementById("eventoData").value    = d.data    || '';
        document.getElementById("eventoKm").value      = d.km      || 0;
        const sel = document.getElementById("eventoModalidade");
        if (sel) sel.value = d.modalidade || 'Ambas';
        document.querySelectorAll("#eventoModalidadeSeg .pm-seg__btn").forEach(b => {
          b.classList.toggle("active", b.dataset.value === (d.modalidade || 'Ambas'));
        });
        modal.dataset.editId = d.id;
        document.querySelector("#modalEvento .pm-dialog__title").textContent = "Editar evento";
        document.querySelector("#modalEvento .pm-dialog__desc").textContent = "Altere os dados do evento e salve.";
        modal.style.display = "flex";
        requestAnimationFrame(() => modal.classList.add("pm-overlay--open"));
      });
    });

    document.querySelectorAll(".btn-excluir-evento").forEach(btn => {
      btn.addEventListener("click", (e) => {
        mostrarConfirmacao("Cancelar Evento", "Remover este evento da agenda?", async () => {
          await deleteDoc(doc(db, "agenda_eventos", e.currentTarget.dataset.id)); atualizarTelas();
        }, "danger");
      });
    });
  } catch (err) { console.error("Erro na agenda:", err); } 
}

function setupPermissoesModal() { 
  const modal = document.getElementById("modalPermissoes"); if(!modal) return; 
  document.getElementById("fecharModalPermissoes")?.addEventListener("click", () => modal.style.display = "none"); 

  const perfilRapido = document.getElementById("permPerfilRapido");
  if (perfilRapido && !perfilRapido.dataset.listenerAplicado) {
    perfilRapido.dataset.listenerAplicado = "1";
    perfilRapido.addEventListener("change", () => aplicarPerfilPermissao(perfilRapido.value));
  }

  document.getElementById("salvarPermissoesBtn")?.addEventListener("click", async (e) => { 
    const id = document.getElementById("permUserId").value; 
    let selecionadas = []; document.querySelectorAll(".chk-perm:checked").forEach(chk => selecionadas.push(chk.value)); 
    if(selecionadas.length === 0) return showToast("Precisa ter pelo menos uma aba marcada.", "error"); 
    
    e.target.textContent = "Salvando..."; e.target.classList.add("loading"); e.target.disabled = true; 
    try { 
      const antes = appState.mapAtletas[id]?.permissoes || [];
      await updateDoc(doc(db, "atletas", id), { permissoes: selecionadas }); 
      await registrarAuditoria("alterar_permissoes", "atletas", id, { antes, depois: selecionadas });
      showToast("Permissões atualizadas!", "success"); modal.style.display = "none"; atualizarTelas(); 
    } 
    catch(err) { showToast("Erro ao gravar permissões.", "error"); } 
    finally { e.target.textContent = "Salvar Acessos"; e.target.classList.remove("loading"); e.target.disabled = false; }
  }); 
}

function aplicarPerfilPermissao(perfil) {
  const perfis = {
    consulta: ["visao-geral", "configuracoes"],
    pontuacao: ["visao-geral", "contabilizacao", "configuracoes"],
    financeiro: ["visao-geral", "financeiro_edit", "configuracoes"],
    gestao: ["visao-geral", "gestao", "configuracoes"],
    geral: ["visao-geral", "contabilizacao", "financeiro_edit", "gestao", "configuracoes"]
  };
  const selecionadas = perfis[perfil];
  if (!selecionadas) return;
  document.querySelectorAll(".chk-perm").forEach(chk => { chk.checked = selecionadas.includes(chk.value); });
}



// =====================================================
// ↕️ DRAG AND DROP DAS FILAS - V50 COM REORDENAÇÃO DINÂMICA
// =====================================================
function setupDragDropFilas() {
  // Estado compartilhado entre renderizações.
  // Os listeners do tbody são instalados uma única vez; por isso o estado
  // não pode ficar preso à execução anterior da função.
  const dragState = window.__filaDragState || (window.__filaDragState = {
    row: null,
    id: null,
    equipe: null,
    salvando: false
  });

  const getTbodyEquipe = (tbody) => {
    if (!tbody) return "";
    if (tbody.id === "listaFilaBike") return "bike";
    if (tbody.id === "listaFilaCorrida") return "corrida";
    return "";
  };

  const animarReordenacao = (tbody, mutacao) => {
    if (!tbody) return mutacao?.();
    const itens = Array.from(tbody.querySelectorAll(".fila-row"));
    const antes = new Map(itens.map(el => [el, el.getBoundingClientRect()]));
    mutacao?.();
    const depois = Array.from(tbody.querySelectorAll(".fila-row"));
    depois.forEach(el => {
      const origem = antes.get(el);
      if (!origem) return;
      const destino = el.getBoundingClientRect();
      const dx = origem.left - destino.left;
      const dy = origem.top - destino.top;
      if (!dx && !dy) return;
      el.animate([
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: "translate(0, 0)" }
      ], {
        duration: 210,
        easing: "cubic-bezier(.2,.8,.2,1)"
      });
    });
  };

  const getAfterElement = (tbody, y) => {
    const rows = [...tbody.querySelectorAll(".fila-row:not(.dragging)")];
    return rows.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
  };

  const salvarOrdemFila = async (tbody) => {
    const equipeFila = getTbodyEquipe(tbody);
    const idsOrdenados = Array.from(tbody.querySelectorAll(".fila-row"))
      .map(row => row.dataset.id)
      .filter(Boolean);

    if (!idsOrdenados.length) return;

    const atletasFila = idsOrdenados
      .map(id => appState.mapAtletas[id])
      .filter(Boolean);

    const datasOrdenadas = atletasFila
      .map(a => a.criadoEm || new Date().toISOString())
      .sort((a, b) => new Date(a) - new Date(b));

    const idArrastado = dragState.id || idsOrdenados[0];

    try {
      await Promise.all(idsOrdenados.map((id, index) => updateDoc(doc(db, "atletas", id), {
        criadoEm: datasOrdenadas[index] || new Date(Date.now() + index * 1000).toISOString(),
        ordemFila: index + 1,
        ordemFilaAtualizadaEm: new Date().toISOString(),
        ordemFilaAtualizadaPor: auth.currentUser?.uid || ""
      })));

      await registrarAuditoria("fila_reorganizada", "atletas", idArrastado, {
        equipe: equipeFila,
        ordem: idsOrdenados
      });

      showToast("Fila reorganizada com sucesso!", "success");
      atualizarTelas();
    } catch (err) {
      showToast("Erro ao reorganizar fila: " + err.message, "error");
      atualizarTelas();
    }
  };

  document.querySelectorAll("#listaFilaBike, #listaFilaCorrida").forEach(tbody => {
    const container = tbody.closest(".tabela-container");
    if(container && !container.previousElementSibling?.classList?.contains("fila-helper")) {
      container.insertAdjacentHTML("beforebegin", `<div class="fila-helper fila-helper-v50"><i data-lucide="grip-vertical" style="width:14px;"></i> Arraste um atleta. A fila se reorganiza em tempo real antes de salvar.</div>`);
    }

    if (tbody.dataset.dragContainerSetup !== "1") {
      tbody.dataset.dragContainerSetup = "1";
      tbody.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!dragState.row || !dragState.id) return;
        if (dragState.equipe !== getTbodyEquipe(tbody)) return;

        const afterElement = getAfterElement(tbody, e.clientY);
        const atualAntes = dragState.row.nextElementSibling;
        const deveInserirAntes = afterElement;
        const jaEstaNoLugar = deveInserirAntes === dragState.row || atualAntes === deveInserirAntes;
        if (jaEstaNoLugar) return;

        animarReordenacao(tbody, () => {
          if (afterElement == null) tbody.appendChild(dragState.row);
          else tbody.insertBefore(dragState.row, afterElement);
        });
      });

      tbody.addEventListener("drop", async (e) => {
        e.preventDefault();
        tbody.classList.remove("fila-dropzone-active");
        document.querySelectorAll(".fila-row.drag-over").forEach(r => r.classList.remove("drag-over"));
        if (!dragState.row || dragState.equipe !== getTbodyEquipe(tbody) || dragState.salvando) return;
        dragState.salvando = true;
        try {
          await salvarOrdemFila(tbody);
        } finally {
          dragState.salvando = false;
        }
      });
    }
  });

  document.querySelectorAll(".fila-row").forEach(row => {
    if (row.dataset.dragSetup === "1") return;
    row.dataset.dragSetup = "1";

    row.addEventListener("dragstart", (e) => {
      dragState.row = row;
      dragState.id = row.dataset.id;
      dragState.equipe = row.dataset.equipeFila;
      row.classList.add("dragging");
      row.closest("tbody")?.classList.add("fila-dropzone-active");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragState.id || "");
    });

    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      document.querySelectorAll(".fila-dropzone-active").forEach(el => el.classList.remove("fila-dropzone-active"));
      document.querySelectorAll(".fila-row.drag-over").forEach(r => r.classList.remove("drag-over"));
      dragState.row = null;
      dragState.id = null;
      dragState.equipe = null;
    });
  });
}

// =====================================================
// 🧍 CONSULTA DE ATLETAS E BUSCA GLOBAL
// =====================================================
function setupAtletasConsulta() {
  ["filtroAtletaCards", "filtroEquipeAtletaCards", "filtroStatusAtletaCards"].forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.dataset.listenerAplicado) return;
    el.dataset.listenerAplicado = "1";
    el.addEventListener("input", renderAtletasConsulta);
    el.addEventListener("change", renderAtletasConsulta);
  });

  document.querySelectorAll("#toggleVisualAtletas .view-toggle-btn").forEach(btn => {
    if (btn.dataset.listenerAplicado) return;
    btn.dataset.listenerAplicado = "1";
    btn.addEventListener("click", () => {
      document.querySelectorAll("#toggleVisualAtletas .view-toggle-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      localStorage.setItem("atletasConsultaView", btn.dataset.view || "cards");
      renderAtletasConsulta();
    });
  });

  const viewSalva = localStorage.getItem("atletasConsultaView") || "cards";
  const btnViewSalva = document.querySelector(`#toggleVisualAtletas .view-toggle-btn[data-view="${viewSalva}"]`);
  if (btnViewSalva) {
    document.querySelectorAll("#toggleVisualAtletas .view-toggle-btn").forEach(b => b.classList.remove("active"));
    btnViewSalva.classList.add("active");
  }

  const busca = document.getElementById("buscaGlobalAtleta");
  const resultados = document.getElementById("resultadoBuscaGlobal");

  if (busca && resultados && !busca.dataset.listenerAplicado) {
    busca.dataset.listenerAplicado = "1";

    busca.addEventListener("input", () => {
      renderBuscaGlobalAtletas(busca.value);
    });

    busca.addEventListener("focus", () => {
      if (busca.value.trim()) renderBuscaGlobalAtletas(busca.value);
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".global-search")) resultados.classList.remove("active");
    });
  }
}

function renderAtletasConsulta() {
  const grid = document.getElementById("gridAtletasConsulta");
  if (!grid) return;

  const termo = (document.getElementById("filtroAtletaCards")?.value || "").toLowerCase();
  const equipe = document.getElementById("filtroEquipeAtletaCards")?.value || "";
  const status = document.getElementById("filtroStatusAtletaCards")?.value || "ativos";

  let atletas = Object.values(appState.mapAtletas || {})
    .filter(a => a.role !== "admin" && a.status === "Aprovado")
    .filter(a => {
      const ativo = a.ativo !== false;
      if (status === "ativos" && !ativo) return false;
      if (status === "inativos" && ativo) return false;
      if (equipe && (a.equipe || "Nenhuma") !== equipe) return false;

      const busca = `${a.nome || ""} ${a.equipe || ""} ${a.localidade || ""}`.toLowerCase();
      return !termo || busca.includes(termo);
    });

  atletas.sort((a, b) => {
    const scoreA = Number(a.pontuacaoTotal) || 0;
    const scoreB = Number(b.pontuacaoTotal) || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return String(a.nome || "").localeCompare(String(b.nome || ""));
  });

  atualizarResumoKmAtletas(atletas);

  if (atletas.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <i data-lucide="users"></i>
        <p>Nenhum atleta encontrado com os filtros selecionados.</p>
      </div>
    `;
    if(typeof lucide !== "undefined") lucide.createIcons();
    return;
  }

  const view = document.querySelector("#toggleVisualAtletas .view-toggle-btn.active")?.dataset.view || localStorage.getItem("atletasConsultaView") || "cards";

  if (view === "lista") {
    grid.classList.add("athlete-list-mode");
    grid.innerHTML = criarTabelaAtletasConsulta(atletas);
    grid.querySelectorAll(".athlete-list-row").forEach(row => {
      row.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        abrirFichaAtleta(row.dataset.id);
      });
    });
    grid.querySelectorAll(".btn-ficha-lista-atleta").forEach(btn => {
      btn.addEventListener("click", () => abrirFichaAtleta(btn.dataset.id));
    });
  } else {
    grid.classList.remove("athlete-list-mode");
    grid.innerHTML = atletas.map(a => criarCardAtleta(a)).join("");

    grid.querySelectorAll(".athlete-card-premium").forEach(card => {
      card.addEventListener("click", (e) => {
        e.preventDefault();
        abrirFichaAtleta(card.dataset.id);
      });
    });
  }

  if(typeof lucide !== "undefined") lucide.createIcons();
}

function criarTabelaAtletasConsulta(atletas) {
  const linhas = atletas.map(a => {
    const ativo = a.ativo !== false;
    const equipe = a.equipe || "Nenhuma";
    const hist = (appState.historicoCompleto || []).filter(h => h.atletaId === a.id);
    const eventos = new Set(hist.map(h => h.eventoId || h.loteId || `${h.dataTreino}|${h.descTreino}`)).size;
    const kmTotal = calcularKmAtleta(a.id);
    const ultimo = hist.length > 0 ? hist[0].dataTreino : "";
    return `<tr class="athlete-list-row" data-id="${escapeAttr(a.id)}">
      <td><strong>${escapeHtml(a.nome || "Sem nome")}</strong><small>${escapeHtml(a.email || a.localidade || "")}</small></td>
      <td><span class="status-badge ${equipe === "Corrida" ? "run" : "bike"}">${escapeHtml(equipe)}</span></td>
      <td>${Number(a.pontuacaoTotal) || 0}</td>
      <td>${formatarKm(kmTotal)} km</td>
      <td>${eventos}</td>
      <td>${ultimo ? formatarDataCurta(ultimo) : "-"}</td>
      <td><span class="status-badge ${ativo ? "active" : "inactive"}">${ativo ? "Ativo" : "Inativo"}</span></td>
      <td><button type="button" class="btn-acao btn-compact btn-ficha-lista-atleta" data-id="${escapeAttr(a.id)}"><i data-lucide="id-card"></i> Ficha</button></td>
    </tr>`;
  }).join("");

  return `<div class="athlete-list-wrapper tabela-container"><table class="tabela-simples athlete-list-table">
    <thead><tr><th>Atleta</th><th>Equipe</th><th>Pontos</th><th>KM</th><th>Eventos</th><th>Último</th><th>Status</th><th>Ações</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table></div>`;
}

function criarCardAtleta(a) {
  const ativo = a.ativo !== false;
  const equipe = a.equipe || "Nenhuma";
  const isFila = equipe.startsWith("Fila");
  const tipoHero = isFila ? "wait" : (equipe === "Corrida" ? "run" : "bike");
  const modalidade = isFila ? "Fila" : (equipe === "Corrida" ? "Corrida" : equipe === "Bicicleta" || equipe === "Bike" ? "Bike" : equipe);
  const hist = (appState.historicoCompleto || []).filter(h => h.atletaId === a.id);
  const eventos = new Set(hist.map(h => h.eventoId || h.loteId || `${h.dataTreino}|${h.descTreino}`)).size;
  const kmTotal = calcularKmAtleta(a.id);
  const ultimo = hist.length > 0 ? hist[0].dataTreino : "";
  const iniciais = getIniciais(a.nome);

  return `
    <article class="athlete-card-premium ${ativo ? "" : "inativo"}" data-id="${escapeAttr(a.id)}">
      <div class="athlete-card-hero ${tipoHero}">
        <div class="athlete-card-status">${ativo ? "Ativo" : "Inativo"}</div>
        <div class="athlete-card-avatar">${iniciais}</div>
      </div>

      <div class="athlete-card-body">
        <div class="athlete-card-title">
          <h3>${escapeHtml(a.nome || "Sem nome")}</h3>
          <span>${modalidade}</span>
        </div>

        <p class="athlete-card-meta">${escapeHtml(a.localidade || "Localidade não informada")} • Entrada ${escapeHtml(a.anoEntrada || "-")}</p>

        <div class="athlete-card-stats">
          <div>
            <strong>${Number(a.pontuacaoTotal) || 0}</strong>
            <span>pontos</span>
          </div>
          <div>
            <strong>${formatarKm(kmTotal)}</strong>
            <span>km</span>
          </div>
          <div>
            <strong>${eventos}</strong>
            <span>eventos</span>
          </div>
          <div>
            <strong>${ultimo ? formatarDataCurta(ultimo) : "-"}</strong>
            <span>último</span>
          </div>
        </div>

        <button type="button" class="athlete-card-button">Ver ficha completa</button>
      </div>
    </article>
  `;
}

function renderBuscaGlobalAtletas(valor) {
  const resultados = document.getElementById("resultadoBuscaGlobal");
  if (!resultados) return;

  const termo = (valor || "").trim().toLowerCase();

  if (!termo) {
    resultados.classList.remove("active");
    resultados.innerHTML = "";
    return;
  }

  const encontrados = Object.values(appState.mapAtletas || {})
    .filter(a => a.status === "Aprovado")
    .filter(a => `${a.nome || ""} ${a.equipe || ""} ${a.localidade || ""}`.toLowerCase().includes(termo))
    .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")))
    .slice(0, 8);

  if (encontrados.length === 0) {
    resultados.innerHTML = `<div class="empty-state" style="padding:16px;"><p>Nenhum atleta encontrado.</p></div>`;
    resultados.classList.add("active");
    return;
  }

  resultados.innerHTML = encontrados.map(a => `
    <div class="search-result-item" data-id="${escapeAttr(a.id)}">
      <div class="search-result-avatar">${getIniciais(a.nome)}</div>
      <div class="search-result-body">
        <strong>${escapeHtml(a.nome || "Sem nome")}</strong>
        <small>${escapeHtml(a.equipe || "-")} • ${Number(a.pontuacaoTotal) || 0} pts • ${formatarKm(calcularKmAtleta(a.id))} km</small>
      </div>
    </div>
  `).join("");

  resultados.querySelectorAll(".search-result-item").forEach(item => {
    item.addEventListener("click", () => {
      resultados.classList.remove("active");
      const busca = document.getElementById("buscaGlobalAtleta");
      if (busca) busca.value = "";
      abrirFichaAtleta(item.dataset.id);
    });
  });

  resultados.classList.add("active");
}


function calcularKmAtleta(atletaId) {
  const vistos = new Set();
  let total = 0;

  (appState.historicoCompleto || [])
    .filter(h => h.atletaId === atletaId)
    .forEach(h => {
      const km = Number(h.kmPercorrido || h.km || 0);
      if (!km || km <= 0) return;

      const chave = h.loteId || h.eventoId || `${h.dataTreino || ""}|${h.descTreino || ""}`;
      if (vistos.has(chave)) return;
      vistos.add(chave);
      total += km;
    });

  return total;
}

function atualizarResumoKmAtletas(atletas = []) {
  let totalKm = 0;
  let kmBike = 0;
  let kmCorrida = 0;
  let totalParticipacoes = 0;

  atletas.forEach(a => {
    const km = calcularKmAtleta(a.id);
    const hist = (appState.historicoCompleto || []).filter(h => h.atletaId === a.id);
    const eventos = new Set(hist.map(h => h.eventoId || h.loteId || `${h.dataTreino}|${h.descTreino}`)).size;

    totalKm += km;
    totalParticipacoes += eventos;

    if (a.equipe === "Bicicleta" || a.equipe === "Bike") kmBike += km;
    if (a.equipe === "Corrida") kmCorrida += km;
  });

  const setText = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };

  setText("totalKmAtletas", `${formatarKm(totalKm)} km`);
  setText("totalKmBike", `${formatarKm(kmBike)} km`);
  setText("totalKmCorrida", `${formatarKm(kmCorrida)} km`);
  setText("totalAtletasConsulta", atletas.length);
  setText("totalEventosConsulta", `${totalParticipacoes} participações`);
}

function formatarKm(valor) {
  const n = Number(valor) || 0;
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: n % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1
  });
}

function getIniciais(nome = "") {
  const partes = String(nome).trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "AT";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function formatarDataCurta(dataStr) {
  if (!dataStr) return "-";
  try {
    return new Date(dataStr + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  } catch {
    return dataStr;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

async function registrarAuditoria(acao, entidade, entidadeId, dados = {}) {
  try {
    await addDoc(collection(db, "auditoria"), {
      acao,
      entidade,
      entidadeId: entidadeId || "",
      dados,
      criadoEm: new Date().toISOString(),
      criadoPor: auth.currentUser?.uid || "",
      criadoPorNome: appState.mapAtletas?.[auth.currentUser?.uid]?.nome || "Usuário"
    });
  } catch (err) {
    console.warn("Falha ao registrar auditoria:", err);
  }
}


// =====================================================
// 🛡️ CENTRO DO ADMIN, BACKUP E AUDITORIA
// =====================================================
function setupAdminCenter() {
  const btnBackup = document.getElementById("btnExportarBackupJson");
  if (btnBackup && !btnBackup.dataset.listenerAplicado) {
    btnBackup.dataset.listenerAplicado = "1";
    btnBackup.addEventListener("click", exportarBackupJson);
  }

  const btnAuditoria = document.getElementById("btnCarregarAuditoria");
  if (btnAuditoria && !btnAuditoria.dataset.listenerAplicado) {
    btnAuditoria.dataset.listenerAplicado = "1";
    btnAuditoria.addEventListener("click", carregarAuditoriaAdmin);
  }

  setupExportacoesOperacionais();
  setupAdminInformativoPadrao();
  setupAdminChecklist();
  setupIdentidadeVisualAdmin();
  setupManutencaoSensivelAdmin();

  atualizarAdminCenterResumo();
  atualizarChecklistAdmin();
  carregarAuditoriaAdmin();
}

function setupIdentidadeVisualAdmin() {
  const campos = {
    primary: document.getElementById("brandCorPrincipal"),
    secondary: document.getElementById("brandCorSecundaria"),
    accent: document.getElementById("brandCorDestaque"),
    danger: document.getElementById("brandCorAlerta"),
    bgLight: document.getElementById("brandFundoClaro"),
    bgDark: document.getElementById("brandFundoEscuro"),
    cardDark: document.getElementById("brandCardEscuro")
  };
  const btnSalvar = document.getElementById("btnSalvarIdentidadeVisual");
  const btnPadrao = document.getElementById("btnRestaurarIdentidadeVisual");
  const preview = document.getElementById("brandPreviewTema");
  const codigo = document.getElementById("brandCodigoTemaAtual");

  if (!btnSalvar || !campos.primary) return;

  const preencherCampos = (tema) => {
    const normalizado = normalizarTemaPortal(tema);
    Object.entries(campos).forEach(([k, el]) => { if (el) el.value = normalizado[k]; });
    atualizarPreviewIdentidade(normalizado, preview, codigo);
  };

  const lerCampos = () => normalizarTemaPortal(Object.fromEntries(
    Object.entries(campos).map(([k, el]) => [k, el?.value || TEMA_PADRAO_PORTAL[k]])
  ));

  preencherCampos(appState.configTemaPortal || TEMA_PADRAO_PORTAL);

  Object.values(campos).forEach(el => {
    if (!el || el.dataset.listenerAplicado) return;
    el.dataset.listenerAplicado = "1";
    el.addEventListener("input", () => {
      const tema = lerCampos();
      aplicarIdentidadeVisual(tema);
      atualizarPreviewIdentidade(tema, preview, codigo);
    });
  });

  if (!btnSalvar.dataset.listenerAplicado) {
    btnSalvar.dataset.listenerAplicado = "1";
    btnSalvar.addEventListener("click", async () => {
      const tema = lerCampos();
      btnSalvar.disabled = true;
      btnSalvar.textContent = "Salvando...";
      try {
        await setDoc(doc(db, "configuracoes", "tema"), {
          ...tema,
          atualizadoEm: new Date().toISOString(),
          atualizadoPor: auth.currentUser?.uid || ""
        }, { merge: true });
        aplicarIdentidadeVisual(tema);
        await registrarAuditoria("identidade_visual_atualizada", "configuracoes", "tema", tema);
        showToast("Cores do portal atualizadas com sucesso.", "success");
      } catch (err) {
        showToast("Erro ao salvar identidade visual: " + err.message, "error");
      } finally {
        btnSalvar.disabled = false;
        btnSalvar.textContent = "Salvar cores do portal";
      }
    });
  }

  if (btnPadrao && !btnPadrao.dataset.listenerAplicado) {
    btnPadrao.dataset.listenerAplicado = "1";
    btnPadrao.addEventListener("click", () => {
      preencherCampos(TEMA_PADRAO_PORTAL);
      aplicarIdentidadeVisual(TEMA_PADRAO_PORTAL);
      showToast("Prévia restaurada para o padrão Energisa. Clique em salvar para gravar.", "info");
    });
  }
}

function atualizarPreviewIdentidade(tema, preview, codigo) {
  if (preview) {
    preview.style.setProperty("--preview-primary", tema.primary);
    preview.style.setProperty("--preview-secondary", tema.secondary);
    preview.style.setProperty("--preview-accent", tema.accent);
    preview.style.setProperty("--preview-danger", tema.danger);
    preview.style.setProperty("--preview-bg", tema.bgDark);
    preview.style.setProperty("--preview-card", tema.cardDark);
  }
  if (codigo) {
    codigo.textContent = `Principal ${tema.primary} • Secundária ${tema.secondary} • Destaque ${tema.accent}`;
  }
}


function setupManutencaoSensivelAdmin() {
  const acoes = [
    ["btnApagarLancamentos", "Lançamentos", ["historico_pontos"]],
    ["btnApagarEventos", "Eventos", ["agenda_eventos"]],
    ["btnApagarAtletas", "Atletas", ["atletas"], { preservarAdmins: true }],
    ["btnApagarRegras", "Regras de pontuação", ["regras_pontuacao"]],
    ["btnApagarFinanceiro", "Financeiro", ["financeiro", "despesas"]],
    ["btnApagarComentarios", "Comentários", ["comentarios_atletas"]]
  ];

  acoes.forEach(([id, rotulo, colecoes, opcoes]) => {
    const btn = document.getElementById(id);
    if (!btn || btn.dataset.listenerAplicado) return;
    btn.dataset.listenerAplicado = "1";
    btn.addEventListener("click", () => apagarDadosPorGrupo(rotulo, colecoes, opcoes || {}));
  });
}

async function apagarDadosPorGrupo(rotulo, colecoes, opcoes = {}) {
  if (appState.userRole !== "admin") {
    return showToast("Apenas administradores podem apagar dados.", "error");
  }

  mostrarConfirmacao(
    `Apagar ${rotulo}`,
    `Essa ação vai apagar os dados de ${rotulo.toLowerCase()} e não poderá ser desfeita. Exporte um backup antes de continuar.`,
    async () => {
      const termo = `APAGAR ${rotulo.toUpperCase()}`;
      const digitado = prompt(`Para confirmar, digite exatamente: ${termo}`);
      if (digitado !== termo) {
        return showToast("Confirmação não realizada. Nada foi apagado.", "info");
      }

      try {
        showToast(`Apagando ${rotulo.toLowerCase()}...`, "info");
        const resumo = {};

        for (const nomeColecao of colecoes) {
          const snap = await getDocs(collection(db, nomeColecao));
          let apagados = 0;

          for (const documento of snap.docs) {
            const dados = documento.data();
            if (opcoes.preservarAdmins && (dados.role === "admin" || dados.perfil === "admin")) continue;
            await deleteDoc(doc(db, nomeColecao, documento.id));
            apagados++;
          }

          resumo[nomeColecao] = apagados;
        }

        await registrarAuditoria("apagar_dados_admin", "sistema", rotulo, { colecoes, resumo });
        showToast(`${rotulo} apagado com sucesso.`, "success");
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        showToast(`Erro ao apagar ${rotulo.toLowerCase()}: ${err.message}`, "error");
      }
    },
    "danger"
  );
}

function atualizarAdminCenterResumo() {
  const atletas = Object.values(appState.mapAtletas || {});
  const historico = appState.historicoCompleto || [];
  const eventos = appState.cacheEventos || [];
  const hoje = new Date();
  const mesAtual = String(hoje.getMonth() + 1).padStart(2, "0");
  const anoAtual = String(hoje.getFullYear());
  const lancMes = historico.filter(h => String(h.dataTreino || "").startsWith(`${anoAtual}-${mesAtual}`) && h.estornado !== true).length;
  const ativos = atletas.filter(a => a.ativo !== false && a.role !== "admin" && a.status === "Aprovado").length;
  const inativos = atletas.filter(a => a.ativo === false).length;
  const comite = atletas.filter(a => a.role === "admin" || a.role === "comite" || a.equipe === "Comitê").length;

  setTexto("adminQtdAtletas", atletas.length);
  setTexto("adminQtdAtivos", ativos);
  setTexto("adminQtdInativos", inativos);
  setTexto("adminQtdComite", comite);
  setTexto("adminQtdLancMes", lancMes);
  setTexto("adminQtdLancamentos", historico.length);
  setTexto("adminQtdEventos", eventos.length);
  renderResumoAcessosAdmin(atletas);
  atualizarChecklistAdmin();
}

function setupAdminChecklist() {
  const btn = document.getElementById("btnAtualizarChecklistAdmin");
  if (btn && !btn.dataset.listenerAplicado) {
    btn.dataset.listenerAplicado = "1";
    btn.addEventListener("click", () => {
      atualizarChecklistAdmin();
      showToast("Checklist recalculado.", "success");
    });
  }
}

function atualizarChecklistAdmin() {
  const alvo = document.getElementById("adminChecklistBase");
  if (!alvo || appState.userRole !== "admin") return;

  const atletas = Object.values(appState.mapAtletas || {});
  const historico = appState.historicoCompleto || [];
  const eventos = appState.cacheEventos || [];
  const hoje = new Date();
  const mesAtual = String(hoje.getMonth() + 1).padStart(2, "0");
  const anoAtual = String(hoje.getFullYear());
  const prefixoMes = `${anoAtual}-${mesAtual}`;
  const equipesValidas = ["Bicicleta", "Corrida", "Comitê", "Fila - Bicicleta", "Fila - Corrida"];

  const atletasAtivos = atletas.filter(a => a.role !== "admin" && a.status === "Aprovado" && a.ativo !== false && !String(a.equipe || "").startsWith("Fila"));
  const atletasSemEquipe = atletas.filter(a => a.role !== "admin" && (!a.equipe || !equipesValidas.includes(a.equipe)));
  const atletasSemAtividadeMes = atletasAtivos.filter(a => !historico.some(h => h.atletaId === a.id && String(h.dataTreino || "").startsWith(prefixoMes) && h.estornado !== true));
  const eventosSemData = eventos.filter(e => !e.data || !e.titulo);
  const lancSemAtleta = historico.filter(h => h.atletaId && !appState.mapAtletas?.[h.atletaId]);
  const lancSemData = historico.filter(h => !h.dataTreino);
  const lancCancelados = historico.filter(h => h.estornado === true || h.cancelado === true);

  const checks = [
    { label: "Atletas ativos sem treino no mês", valor: atletasSemAtividadeMes.length, tipo: atletasSemAtividadeMes.length ? "warn" : "ok", detalhe: atletasSemAtividadeMes.slice(0, 4).map(a => a.nome).filter(Boolean).join(", ") },
    { label: "Atletas sem equipe/modalidade válida", valor: atletasSemEquipe.length, tipo: atletasSemEquipe.length ? "warn" : "ok", detalhe: atletasSemEquipe.slice(0, 4).map(a => a.nome).filter(Boolean).join(", ") },
    { label: "Eventos sem título ou data", valor: eventosSemData.length, tipo: eventosSemData.length ? "warn" : "ok" },
    { label: "Lançamentos sem atleta localizado", valor: lancSemAtleta.length, tipo: lancSemAtleta.length ? "danger" : "ok" },
    { label: "Lançamentos sem data", valor: lancSemData.length, tipo: lancSemData.length ? "danger" : "ok" },
    { label: "Lançamentos cancelados/ajustados", valor: lancCancelados.length, tipo: "info" }
  ];

  alvo.innerHTML = checks.map(c => {
    const icon = c.tipo === "ok" ? "check-circle-2" : c.tipo === "danger" ? "x-octagon" : c.tipo === "warn" ? "triangle-alert" : "info";
    return `<div class="admin-check-item ${c.tipo}">
      <i data-lucide="${icon}"></i>
      <div><strong>${escapeHtml(c.label)}</strong>${c.detalhe ? `<small>${escapeHtml(c.detalhe)}${c.valor > 4 ? "..." : ""}</small>` : ""}</div>
      <span>${c.valor}</span>
    </div>`;
  }).join("");

  if (typeof lucide !== "undefined") lucide.createIcons();
}

function renderResumoAcessosAdmin(atletas = Object.values(appState.mapAtletas || {})) {
  const alvo = document.getElementById("adminResumoAcessos");
  if (!alvo) return;
  const totalAdmin = atletas.filter(a => a.role === "admin").length;
  const totalComite = atletas.filter(a => a.role === "comite" || a.equipe === "Comitê").length;
  const totalAtleta = atletas.filter(a => (a.role || "atleta") === "atleta" && a.equipe !== "Comitê").length;
  const comPermPersonalizada = atletas.filter(a => a.role === "comite" && Array.isArray(a.permissoes) && a.permissoes.length > 0).length;

  alvo.innerHTML = `
    <div><span>Administradores</span><strong>${totalAdmin}</strong></div>
    <div><span>Comitê</span><strong>${totalComite}</strong></div>
    <div><span>Atletas/consulta</span><strong>${totalAtleta}</strong></div>
    <div><span>Com permissão definida</span><strong>${comPermPersonalizada}</strong></div>`;
}

const CHAVE_PADRAO_INFORMATIVO = "atletasInformativoPadraoV1";
const CONFIG_DOC_INFORMATIVO = ["configuracoes", "informativo"];

function padraoInformativoBase() {
  return {
    modalidade: "todos",
    limite: "28",
    mostrarKpis: true,
    mostrarLegenda: true,
    mostrarTop3: true,
    mostrarAlertas: true,
    mostrarDemais: true,
    abrirEmNovaAba: true,
    paginasSeparadas: true,
    alertaCriterio: "sem_treino_mes",
    alertaValor: 30
  };
}

function normalizarPadraoInformativo(config = {}) {
  const base = padraoInformativoBase();
  return {
    ...base,
    ...(config || {}),
    limite: String((config && config.limite) || base.limite),
    alertaValor: Number((config && config.alertaValor) ?? base.alertaValor),
    mostrarKpis: (config && config.mostrarKpis) !== false,
    mostrarLegenda: (config && config.mostrarLegenda) !== false,
    mostrarTop3: (config && config.mostrarTop3) !== false,
    mostrarAlertas: (config && config.mostrarAlertas) !== false,
    mostrarDemais: (config && config.mostrarDemais) !== false,
    abrirEmNovaAba: (config && config.abrirEmNovaAba) !== false,
    paginasSeparadas: (config && config.paginasSeparadas) !== false
  };
}

function obterPadraoInformativo() {
  let local = {};
  try { local = JSON.parse(localStorage.getItem(CHAVE_PADRAO_INFORMATIVO) || "{}"); } catch (_) {}
  return normalizarPadraoInformativo({ ...local, ...(appState.configInformativoPadrao || {}) });
}

async function carregarPadraoInformativoRemoto() {
  try {
    const snap = await getDoc(doc(db, ...CONFIG_DOC_INFORMATIVO));
    if (snap.exists()) {
      appState.configInformativoPadrao = normalizarPadraoInformativo(snap.data());
      localStorage.setItem(CHAVE_PADRAO_INFORMATIVO, JSON.stringify(appState.configInformativoPadrao));
    } else {
      appState.configInformativoPadrao = obterPadraoInformativo();
    }
  } catch (err) {
    console.warn("Não foi possível carregar o padrão remoto do informativo:", err);
    appState.configInformativoPadrao = obterPadraoInformativo();
  }
  aplicarPadraoInformativoNoAdmin();
  aplicarPadraoInformativoNoModal();
}

function setupAdminInformativoPadrao() {
  aplicarPadraoInformativoNoAdmin();
  carregarPadraoInformativoRemoto();

  const btnSalvar = document.getElementById("btnSalvarPadraoInformativo");
  if (btnSalvar && !btnSalvar.dataset.listenerAplicado) {
    btnSalvar.dataset.listenerAplicado = "1";
    btnSalvar.addEventListener("click", salvarPadraoInformativoAdmin);
  }

  const btnAbrir = document.getElementById("btnAbrirInformativoPadrao");
  if (btnAbrir && !btnAbrir.dataset.listenerAplicado) {
    btnAbrir.dataset.listenerAplicado = "1";
    btnAbrir.addEventListener("click", abrirModalInformativoRanking);
  }
}

function aplicarPadraoInformativoNoAdmin() {
  const cfg = obterPadraoInformativo();
  const setValue = (id, valor) => { const el = document.getElementById(id); if (el) el.value = valor; };
  const setCheck = (id, valor) => { const el = document.getElementById(id); if (el) el.checked = valor !== false; };
  setValue("cfgInfoModalidadePadrao", cfg.modalidade);
  setValue("cfgInfoLimitePadrao", cfg.limite);
  setValue("cfgInfoAlertaCriterio", cfg.alertaCriterio || "sem_treino_mes");
  setValue("cfgInfoAlertaValor", cfg.alertaValor ?? 30);
  setCheck("cfgInfoKpisPadrao", cfg.mostrarKpis);
  setCheck("cfgInfoLegendaPadrao", cfg.mostrarLegenda);
  setCheck("cfgInfoTop3Padrao", cfg.mostrarTop3);
  setCheck("cfgInfoAlertasPadrao", cfg.mostrarAlertas);
  setCheck("cfgInfoDemaisPadrao", cfg.mostrarDemais);
  setCheck("cfgInfoAbrirPadrao", cfg.abrirEmNovaAba);
  setCheck("cfgInfoPaginasPadrao", cfg.paginasSeparadas);
}

async function salvarPadraoInformativoAdmin() {
  const valor = id => document.getElementById(id)?.value;
  const marcado = id => document.getElementById(id)?.checked !== false;
  const cfg = normalizarPadraoInformativo({
    modalidade: valor("cfgInfoModalidadePadrao") || "todos",
    limite: valor("cfgInfoLimitePadrao") || "28",
    alertaCriterio: valor("cfgInfoAlertaCriterio") || "sem_treino_mes",
    alertaValor: Number(valor("cfgInfoAlertaValor") || 0),
    mostrarKpis: marcado("cfgInfoKpisPadrao"),
    mostrarLegenda: marcado("cfgInfoLegendaPadrao"),
    mostrarTop3: marcado("cfgInfoTop3Padrao"),
    mostrarAlertas: marcado("cfgInfoAlertasPadrao"),
    mostrarDemais: marcado("cfgInfoDemaisPadrao"),
    abrirEmNovaAba: marcado("cfgInfoAbrirPadrao"),
    paginasSeparadas: marcado("cfgInfoPaginasPadrao")
  });
  appState.configInformativoPadrao = cfg;
  localStorage.setItem(CHAVE_PADRAO_INFORMATIVO, JSON.stringify(cfg));
  try {
    await setDoc(doc(db, ...CONFIG_DOC_INFORMATIVO), {
      ...cfg,
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: auth.currentUser?.uid || ""
    }, { merge: true });
    await registrarAuditoria("alterar_padrao_informativo", "configuracoes", "informativo", cfg);
    showToast("Padrão do informativo salvo para o portal.", "success");
  } catch (err) {
    showToast("Padrão salvo neste navegador, mas não foi possível salvar no Firebase.", "error");
    console.warn("Erro ao salvar padrão do informativo:", err);
  }
  aplicarPadraoInformativoNoAdmin();
  aplicarPadraoInformativoNoModal();
}

function aplicarPadraoInformativoNoModal() {
  const cfg = obterPadraoInformativo();
  const setValue = (id, valor) => { const el = document.getElementById(id); if (el) el.value = valor; };
  setValue("filtroInformativoModalidade", cfg.modalidade);
  setValue("filtroInformativoFormato", "html");
  const resumo = document.getElementById("resumoPadraoInformativoModal");
  if (resumo) {
    const limite = cfg.limite === "todos" ? "Todos" : `Até ${cfg.limite} linhas`;
    const alertas = {
      sem_treino_mes: "sem treino no mês",
      sem_treino_30d: `sem treino há mais de ${cfg.alertaValor || 30} dias`,
      ate_x_treinos: `até ${cfg.alertaValor || 0} treinos no mês`,
      ate_x_pontos: `até ${cfg.alertaValor || 0} pontos no mês`
    };
    resumo.innerHTML = `<i data-lucide="settings-2"></i><span>Usando padrão do Admin: ${escapeHtml(limite)}, alerta por ${escapeHtml(alertas[cfg.alertaCriterio] || "critério configurado")}, ${cfg.paginasSeparadas ? "equipes separadas em páginas" : "equipes no mesmo comunicado"}.</span>`;
    if (typeof lucide !== "undefined") lucide.createIcons();
  }
}

async function carregarAuditoriaAdmin() {
  const lista = document.getElementById("listaAuditoriaAdmin");
  if (!lista || appState.userRole !== "admin") return;

  try {
    const snap = await getDocs(collection(db, "auditoria"));
    const itens = [];
    snap.forEach(d => itens.push({ id: d.id, ...d.data() }));
    itens.sort((a,b) => new Date(b.criadoEm || "1970-01-01") - new Date(a.criadoEm || "1970-01-01"));
    setTexto("adminQtdAuditoria", itens.length);

    if (itens.length === 0) {
      lista.innerHTML = `<div class="empty-state" style="padding:18px;"><p>Nenhum registro de auditoria encontrado.</p></div>`;
      return;
    }

    lista.innerHTML = itens.slice(0, 30).map(item => {
      const data = item.criadoEm ? new Date(item.criadoEm).toLocaleString('pt-BR') : "-";
      return `<div class="admin-audit-item">
        <small>${data}</small>
        <div><strong>${escapeHtml(item.acao || "ação")}</strong><br><small>${escapeHtml(item.entidade || "-")} ${item.entidadeId ? "• " + escapeHtml(item.entidadeId) : ""}</small></div>
        <small>${escapeHtml(item.criadoPorNome || "Usuário")}</small>
      </div>`;
    }).join("");
  } catch (err) {
    lista.innerHTML = `<div class="empty-state" style="padding:18px;"><p>Sem permissão ou erro ao carregar auditoria.</p></div>`;
  }
}

async function exportarBackupJson() {
  if (appState.userRole !== "admin") return showToast("Apenas admin pode exportar backup.", "error");
  showToast("Montando backup JSON...", "info");

  const colecoes = ["atletas", "historico_pontos", "agenda_eventos", "regras_pontuacao", "financeiro", "campos_ficha", "auditoria"];
  const backup = { geradoEm: new Date().toISOString(), geradoPor: auth.currentUser?.uid || "", colecoes: {} };

  for (const nome of colecoes) {
    try {
      const snap = await getDocs(collection(db, nome));
      backup.colecoes[nome] = [];
      snap.forEach(d => backup.colecoes[nome].push({ id: d.id, ...d.data() }));
    } catch (err) {
      backup.colecoes[nome] = { erro: err.message };
    }
  }

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup_atletas_energisa_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  await registrarAuditoria("exportar_backup", "sistema", "backup", { colecoes });
  showToast("Backup exportado.", "success");
}


// =====================================================
// 📤 EXPORTAÇÕES OPERACIONAIS SEGURAS
// =====================================================
function setupExportacoesOperacionais() {
  const acoes = [
    ["btnExportarListaAtletas", exportarListaAtletasCsv],
    ["btnExportarListaEventos", exportarListaEventosCsv],
    ["btnExportarParticipacaoAtletas", exportarParticipacaoAtletasCsv],
    ["btnGerarInformativoRanking", abrirModalInformativoRanking],
    ["btnModoApresentacao", gerarModoApresentacao]
  ];

  acoes.forEach(([id, fn]) => {
    const btn = document.getElementById(id);
    if (!btn || btn.dataset.listenerAplicado) return;
    btn.dataset.listenerAplicado = "1";
    btn.addEventListener("click", fn);
  });

  const btnFechar = document.getElementById("btnFecharModalInformativo");
  const btnCancelar = document.getElementById("btnCancelarInformativoRanking");
  const btnGerar = document.getElementById("btnConfirmarInformativoRanking");
  const modal = document.getElementById("modalInformativoRanking");

  [btnFechar, btnCancelar].forEach(btn => {
    if (!btn || btn.dataset.listenerAplicado) return;
    btn.dataset.listenerAplicado = "1";
    btn.addEventListener("click", fecharModalInformativoRanking);
  });

  if (btnGerar && !btnGerar.dataset.listenerAplicado) {
    btnGerar.dataset.listenerAplicado = "1";
    btnGerar.addEventListener("click", () => gerarInformativoRankingHtml(coletarOpcoesInformativoRanking()));
  }

  if (modal && !modal.dataset.listenerAplicado) {
    modal.dataset.listenerAplicado = "1";
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) fecharModalInformativoRanking();
    });
  }
}

function exportarListaAtletasCsv() {
  const atletas = Object.values(appState.mapAtletas || {})
    .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));

  if (atletas.length === 0) return showToast("Nenhum atleta carregado para exportar.", "error");

  const linhas = atletas.map(a => ({
    Nome: a.nome || "",
    Email: a.email || "",
    Equipe: a.equipe || "",
    Status: a.status || "",
    Ativo: a.ativo === false ? "Não" : "Sim",
    Role: a.role || "atleta",
    Pontos: Number(a.pontuacaoTotal) || 0,
    Localidade: a.localidade || a.cidade || "",
    Sexo: a.sexo || "",
    Nascimento: a.dataNascimento || a.nascimento || "",
    Entrada: a.anoEntrada || a.entrada || "",
    CamposComplementares: a.camposFicha ? JSON.stringify(a.camposFicha) : ""
  }));

  baixarCsv("lista_atletas", linhas);
  showToast("Lista de atletas exportada.", "success");
}

function exportarListaEventosCsv() {
  const eventos = (appState.cacheEventos || [])
    .slice()
    .sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));

  if (eventos.length === 0) return showToast("Nenhum evento carregado para exportar.", "error");

  const linhas = eventos.map(e => ({
    Data: e.data || "",
    Titulo: e.titulo || "",
    Modalidade: e.modalidade || e.equipe || "",
    Tipo: e.tipo || "",
    Local: e.local || e.localidade || "",
    KM: Number(e.km || e.kmPrevisto || 0),
    Link: e.link || "",
    Status: e.status || e.statusLancamento || ""
  }));

  baixarCsv("lista_eventos", linhas);
  showToast("Lista de eventos exportada.", "success");
}

function exportarParticipacaoAtletasCsv() {
  const atletas = Object.values(appState.mapAtletas || {});
  const historico = (appState.historicoCompleto || []).filter(h => h.estornado !== true);

  if (atletas.length === 0) return showToast("Nenhum atleta carregado para exportar.", "error");

  const resumo = new Map();

  atletas.forEach(a => {
    resumo.set(a.id, {
      Nome: a.nome || "",
      Equipe: a.equipe || "",
      Ativo: a.ativo === false ? "Não" : "Sim",
      Pontos: 0,
      Participacoes: 0,
      KM: 0,
      UltimaParticipacao: "",
      LancamentosJustificados: 0
    });
  });

  const participacoesPorAtleta = new Map();
  const kmPorAtletaELancamento = new Map();

  historico.forEach(h => {
    const aId = h.atletaId;
    if (!resumo.has(aId)) return;

    const item = resumo.get(aId);
    const pontos = Number(h.pontos) || 0;
    const km = Number(h.kmPercorrido || h.km || 0) || 0;
    const data = h.dataTreino || "";
    const chaveLancamento = h.loteId || [h.eventoId || "sem-evento", h.dataTreino || "", h.descTreino || ""].join("|");

    item.Pontos += pontos;
    if (pontos === 0 && String(h.regraId || "").includes("falta")) item.LancamentosJustificados += 1;
    if (data && (!item.UltimaParticipacao || data > item.UltimaParticipacao)) item.UltimaParticipacao = data;

    const chavePart = `${aId}|${chaveLancamento}`;
    participacoesPorAtleta.set(chavePart, true);

    const chaveKm = `${aId}|${chaveLancamento}`;
    if (!kmPorAtletaELancamento.has(chaveKm) || km > kmPorAtletaELancamento.get(chaveKm)) {
      kmPorAtletaELancamento.set(chaveKm, km);
    }
  });

  participacoesPorAtleta.forEach((_, chave) => {
    const aId = chave.split("|")[0];
    if (resumo.has(aId)) resumo.get(aId).Participacoes += 1;
  });

  kmPorAtletaELancamento.forEach((km, chave) => {
    const aId = chave.split("|")[0];
    if (resumo.has(aId)) resumo.get(aId).KM += km;
  });

  const linhas = Array.from(resumo.values())
    .sort((a, b) => (b.Pontos - a.Pontos) || String(a.Nome).localeCompare(String(b.Nome)))
    .map(item => ({
      ...item,
      KM: Number(item.KM || 0).toFixed(2).replace(".", ",")
    }));

  baixarCsv("participacao_atletas", linhas);
  showToast("Participação dos atletas exportada.", "success");
}



// =====================================================
// 🏆 INFORMATIVO DO RANKING - HTML SEGURO
// =====================================================
function abrirModalInformativoRanking() {
  const modal = document.getElementById("modalInformativoRanking");
  if (!modal) return gerarInformativoRankingHtml(obterPadraoInformativo());
  aplicarPadraoInformativoNoModal();
  modal.style.display = "flex";
  document.body.classList.add("modal-open");
  document.documentElement.classList.add("modal-open");
}

function fecharModalInformativoRanking() {
  const modal = document.getElementById("modalInformativoRanking");
  if (modal) modal.style.display = "none";
  document.body.classList.remove("modal-open");
  document.documentElement.classList.remove("modal-open");
}

function coletarOpcoesInformativoRanking() {
  const valor = id => document.getElementById(id)?.value;
  const cfg = obterPadraoInformativo();
  return {
    ...cfg,
    modalidade: valor("filtroInformativoModalidade") || cfg.modalidade || "todos",
    formato: valor("filtroInformativoFormato") || "html"
  };
}

function gerarInformativoRankingHtml(opcoes = {}) {
  const atletas = Object.values(appState.mapAtletas || {});
  const historico = (appState.historicoCompleto || []).filter(h => h.estornado !== true);

  if (atletas.length === 0) return showToast("Nenhum atleta carregado para gerar o informativo.", "error");

  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth() + 1;
  const mesLabel = hoje.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const diasUteis = calcularDiasUteisMes(ano, mes);

  const filtros = {
    modalidade: opcoes.modalidade || "todos",
    limite: opcoes.limite || "28",
    formato: opcoes.formato || "html",
    paginasSeparadas: opcoes.paginasSeparadas !== false,
    mostrarKpis: opcoes.mostrarKpis !== false,
    mostrarLegenda: opcoes.mostrarLegenda !== false,
    mostrarTop3: opcoes.mostrarTop3 !== false,
    mostrarAlertas: opcoes.mostrarAlertas !== false,
    mostrarDemais: opcoes.mostrarDemais !== false,
    abrirEmNovaAba: opcoes.abrirEmNovaAba !== false,
    alertaCriterio: opcoes.alertaCriterio || "sem_treino_mes",
    alertaValor: Number(opcoes.alertaValor ?? 30)
  };

  const resumo = calcularResumoRanking(atletas, historico, ano, mes);
  let bike = resumo.filter(a => normalizarEquipe(a.equipe) === "bicicleta").sort(ordenarRanking);
  let corrida = resumo.filter(a => normalizarEquipe(a.equipe) === "corrida").sort(ordenarRanking);

  if (filtros.modalidade === "bicicleta") corrida = [];
  if (filtros.modalidade === "corrida") bike = [];

  const baseSelecionada = [...bike, ...corrida];
  const totalPontos = baseSelecionada.reduce((s, a) => s + a.pontosMes, 0);
  const totalKm = baseSelecionada.reduce((s, a) => s + a.kmMes, 0);
  const totalTreinos = baseSelecionada.reduce((s, a) => s + a.treinosMes, 0);

  let html = montarHtmlInformativoRanking({
    mesLabel,
    diasUteis,
    totalPontos,
    totalKm,
    totalTreinos,
    bike,
    corrida,
    opcoes: filtros
  });

  const sufixoModalidade = filtros.modalidade === "todos" ? "geral" : filtros.modalidade === "bicicleta" ? "bike" : "corrida";
  const nomeArquivo = `informativo_ranking_atletas_${sufixoModalidade}`;

  if (filtros.formato === "pdf") {
    abrirHtmlNovaAba(html, true);
    fecharModalInformativoRanking();
    showToast("Informativo aberto para salvar como PDF.", "success");
    return;
  }

  if (filtros.abrirEmNovaAba) abrirHtmlNovaAba(html, false);
  baixarHtml(nomeArquivo, html);
  fecharModalInformativoRanking();
  showToast("Informativo do ranking gerado em HTML.", "success");
}

function calcularResumoRanking(atletas, historico, ano, mes) {
  const porAtleta = new Map();

  atletas.forEach(a => {
    porAtleta.set(a.id, {
      id: a.id,
      nome: a.nome || "Sem nome",
      equipe: a.equipe || "",
      pontosMes: 0,
      kmMes: 0,
      treinosMes: 0,
      ultimaData: "",
      ativo: a.ativo !== false
    });
  });

  const participacoes = new Set();
  const kmPorAtletaLancamento = new Map();

  historico.forEach(h => {
    if (!h.atletaId || !porAtleta.has(h.atletaId)) return;
    const data = h.dataTreino || "";
    const item = porAtleta.get(h.atletaId);
    if (data && (!item.ultimaData || data > item.ultimaData)) item.ultimaData = data;
    if (!data.startsWith(`${ano}-${String(mes).padStart(2, "0")}`)) return;
    const pontos = Number(h.pontos) || 0;
    item.pontosMes += pontos;

    const chaveLancamento = h.loteId || [h.eventoId || "sem-evento", h.dataTreino || "", h.descTreino || ""].join("|");
    const chavePart = `${h.atletaId}|${chaveLancamento}`;
    participacoes.add(chavePart);

    const km = Number(h.kmPercorrido || h.km || 0) || 0;
    if (!kmPorAtletaLancamento.has(chavePart) || km > kmPorAtletaLancamento.get(chavePart)) {
      kmPorAtletaLancamento.set(chavePart, km);
    }
  });

  participacoes.forEach(chave => {
    const atletaId = chave.split("|")[0];
    if (porAtleta.has(atletaId)) porAtleta.get(atletaId).treinosMes += 1;
  });

  kmPorAtletaLancamento.forEach((km, chave) => {
    const atletaId = chave.split("|")[0];
    if (porAtleta.has(atletaId)) porAtleta.get(atletaId).kmMes += km;
  });

  return Array.from(porAtleta.values()).filter(a => a.ativo);
}


const LOGO_ATLETAS_REPORT_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPEAAAB8CAIAAAA3h8FYAAABCGlDQ1BJQ0MgUHJvZmlsZQAAeJxjYGA8wQAELAYMDLl5JUVB7k4KEZFRCuwPGBiBEAwSk4sLGHADoKpv1yBqL+viUYcLcKakFicD6Q9ArFIEtBxopAiQLZIOYWuA2EkQtg2IXV5SUAJkB4DYRSFBzkB2CpCtkY7ETkJiJxcUgdT3ANk2uTmlyQh3M/Ck5oUGA2kOIJZhKGYIYnBncAL5H6IkfxEDg8VXBgbmCQixpJkMDNtbGRgkbiHEVBYwMPC3MDBsO48QQ4RJQWJRIliIBYiZ0tIYGD4tZ2DgjWRgEL7AwMAVDQsIHG5TALvNnSEfCNMZchhSgSKeDHkMyQx6QJYRgwGDIYMZAKbWPz9HbOBQAABlN0lEQVR42uz9WbMlWXYeiH1rrb3d/cx3vjfmzMjIuSpRWVWoKgBEASRIAmxOIiUjqSbVJplkMpoe9SDTk/6A+rGt9aKWqZvWIlsijTROIAGQBFCFmlGVlfOcGXPEne8Z3X3vtZYe/EZWgeJDs2hlFi2LbWGeN/JeP+eE37XXXsO3vo/wzF+AGiQDGQ4QnlyfXB+7KwEAnEEGMsDgAc7ICRLgBBiiwNpqOQ+7X/7yqj9Uq0EZT9aT9Vgu72wabGROCoBcxFjchNgMSdBWRa9dVR+8Gy58+fNn61tNr2jlyaN7sh7HxQ5yfmTcZqwOkAs7synMAURQrywG7bLu9UKzNphN+qfMWfjJ43uyHksvDXJmBwCQKWcQ4AFgdid3BqmbsRj6KfbDkecjSy4F3J88vSfr8bRpd3cHOTs9Cq7Z4W4MZGdhyuBsRdbCKTQAlQUQnECOJ9cn18ftCgLAnbcmAMwOOAUwAAMsGzETO7O5Jw09qhoq65xA7A4QnlyfXB+3KwAHzBwEKEAGNgBgIIgTqXpkkIDcQlDSOksQA0AM2JPrk+tjdXUAcl77IIBdDOQQANAM7rx4m8DqxEzM2QowOQMMpyfXJ9fH7trF0MQAsxM5szOMYAIKIIETQgGQirQAA6DPksPuqyfXJ9fH69oZqJ0bKYwd4oAbzr9pXUnEyZQtOMEYoPyorP1kPVmP2aLP/ssE486CHQDMDCCHAgQYKDspK8HInhj0k/U/geYLjPynHTYYIBj5uTfvvgjG6mTwgCdm/WQ9rvXp86vDCQaGs4MdZGByZ3Niz9a1Zij81J1P+ohP1uMZe9i5WYMd5sRGcFCHcKJH1ssOdjbnIG7iltme+Okn67EOqd20a7JQZ6vnhesuoJbP8Hpk/NMFjyfryXpcww/7iXF/Bj3FZ1Zr9lmUDQQ4P4k6nqzH3U07A3D8lKHauVVTV8imLoXsUsnzn3ti1k/WY1zx8HMf/ZOs0c+D6S7E6Ap3Tk9M+cn6/8sN8OQRPFlPbPrJerKe2PST9WQ9sekn68l6YtNP1pP1xKafrCc2/WQ9WU9s+sl6sp7Y9JP1ZD2x6SfryXpi00/WE5t+sp6s/0mt8DPeRwBABsDOkX6fQfw6zBTZf+AmZwcI2QnkwUEEd7L/X/adP3nX+Us5/fubkLz7P3b+MfDv4WY/eyF/9Fd/9MHs0Q/T+fvCnT5D4Z6/zqP7H81rOj9ij/2pn/z3lvMjilmQk3fo9e5Nz7/16CP99CPqPjZ1Mx2GR+hKcTiZ/RSx56Of/Kl7P/vaQc7BLJqxm7groxHJxOdPj7u37bjn2MicATcxBmDETo9ezQ1gQOAg+E+ewGfP4T/4K/6ph0/ntwgAuP8H7eFx8tMECMOMXKMQrEZeITCYQBFcgBnO5IAp3OHOcJiTBnJhGJOLB2gUDzDyrDAPDHIjV6FubzCDyM01wbKQMznMhQJDoCBHoCBggQQ2aCMUyAUWhEpYgBfwEl4AAghZQR7JmdygiYgYhaBHWkFj5ICcCInQcRYLubAJO3F3CwAjeAB3ppFYDJYZxCByMIOI4AEeyYVc2Auyglwe0XISLMJLeAkVGBE5EcGZOUK7XwiDjMgDBVEqs5W5m5R+NMcBIidyIzf6zL45gRM4i+qg1a2mvdbUr5bypUl/M4K9ZWRwhiRwDmZl5qgkdk7nHAxRmU0AAQNs8ExEoApWCFgcaBsIAAULsoMjmCgQVOFODgaRExyAMIuAoABV8AIehQJcYRlM4PBY+mlVMFvOqsoxOhR5RpqC1j12sRa5YWZm1m735yQoCJVrcjpzAtsIFC01zMQCmFnOZgawEzhUqsqOEJhZLaecM8AshWdyJyJic9VkZiGweTJDgbEbZ21Zuc2ZSEQiYCAFwCYAwA2gENbWPJFQJERmJs9qq877mvfgwg6CMbTjPGYW89KUPCtxhrdqqaSeJXZ3AE7ZwEwlM8MSAfAIwElB2bpBZi8JQuxmrWlD6oQoELNuI4Ws1CCoDOAMFyf+iR/pZpb0pxySQ8Hn89GslHUNtp7rX7t+9ZdfeObGJg6B/+a7n3zzk0/roqfnZyucYAQn6GcbjYwBI3p0ihgEpKsSjXhTas3itbBDVwhgsqJCTrDMBXkUM3jKLhKInVmhZpmAIpStZyhA7gY6P6cNZvh5Tgr+TDbtgEGElVhhASGk1SAdbpfzDTnaKOrSV9DMMUCKlbGzFO7kMCNQw3FuUE89oCKYe8dVae4aQsEUzDwrERHMiV3IzFpQFpGkBIrwKCLClrVRW4qIcNE0ylS6O3GOUc7tzP2RTRNbBQDIRubEqkmkISLSCl4kNWZmcTg7IsCEFqTsBjLXbAaQANwxDgY28xyp1AymIoSQfaloAVNk5u6oieehERngcHGLZg7SztkCwbUgV+alMMH6p7l/U/sP88aUgxXrrhmQjkMcnAFAz8dKndic4AHWvUUTbHY12t/86uf+4pXtTUCAGrh98cL+7fvvJ2qpcmQQsnDmnzAJwC0FffT3jjyDEUTywQU+GIVj1qWbLHQ4X60VtDNvYaEHQulAm1IMcA9lCTV4AhlCC1VrI7uBGQy2gu0cwJ8pAw6En18u97PYNDkCgqmDA7wJebXmp9f6+y9urm6sNWthJXlJmhFiRrNy5yCkWYhNGZS4nANuOTMlIs45kzvIzDJzYCrNzN1jjKZIKQWGBLgnI7g7cWFKqioMCQAlIncLmomoJXJHTQx312wiAnLA2Bm+BBjIANTFOcfYmBlbQ6jarCLi57G7PNoJ1k1YRJaUEgeJoVQjVWUyJiJLmkEoiShjCckczKEKhfNP2fSjyTkXd2cYpOMrZLeKSJ1nQiyqc5WPU/H2dPHe9PBh02oYggo4/STJIMDBHn4Sn3a0Q8SF4oW9ra9f2d4EJmip9aoov7RT/X6km62zifJ5oA+icza6nyQFCusi8gDAk41FX9nLN9YoACm1Z8vp0dIezPT2cvggrVF/XTrGGM0V+Vo97WsTs64CDnvSShE4OkEkKZEjmhEcQsxw+8kc+GMUezCMVTP6FLQdpeNnJ2df2Di4MTrprY6qpibNACRFg46kEUarSbhwVGbZV0vzbDYQKdjZ3QMTC5klTU6omEHcIplbAFiohCJpq5qITYScAGICW2uWlYjARCTCEciqC3cvZAAiy9YdK3xuYQCZAZ1T9pRybqNUIqKaGHDP+PczRYFzJM45WyIiMgNgwsrM7EIoCFFVlWqYWkbOSSI7AR7hTLAuEu/ODWYWctXkWc2MqaIi1LokR5GLwvvDsL27vreJ/MOj09u8m2UNba9LY8+N2pkNDEviQOp2BrJVmXnJFeCAIMRCE9LFMn7+ma3v/vg+ATAGG+lnCTfEA8AaWkCCAR4yRTgXnvtWj9PdLT2scBZjDuvcjkf7g803zzb+aNaeUFgiF0VPEu+k+Uvz96/zamLFg5X8qB3fLddWITbi6gDYGQ6Ble5GnS9//Gy6m2okZkgz3eSjF9ZWzw5ON9LtgpYCQ1EQmLRRTW7ZUiqCpLxyuAiRGAtB2pxacnEjS0ZEVRR3spxY4GiyNsJFkCrXqqq9GEIUM3XL7goORKLq7JACaq25eTJmONWkHDTmRCKCLkKHPwpFDUCrTdXraZeaZs/NMhKInNiBzHAjwAWPbrS87JcBZKpJRIjIVT2RpRADA6aeKWZiM8sW3LRxArwlZ5AyjNwAZhdPZIYIZo5MwQ3tMsW+kFhBTWpWMZ1d7tV5sDqe9/dzL/tY3Mg5d/G0/8lsnRzQLmVk52lr+zWuVt3BkEsKA+Dp3R3GnY7jFgYGyN2hjyozDC8AOxcDcrBDshWkA7Qjnld2EtuZWFYt1/pXOMo9Hi7nxzmXQsW4Xlyc3/4VefCSTvtW3U+0QZN7ND1uB/cRD4vBMffryJABEAAzS4A/djmik4EJpGSIvrwwOLjUW4zSETczD1qDjEQzoWn6YVjyZqohDm8zScWuTbvvYSXBtE5MsV+umUpqLVJJFFPrACRk1raIFSDatFE4ujTzFXO/iNEMqVViLoNnrPJqBSYIyCAs5CUsRmwgBU7hUbHPf7r4VVAriRfzs15vUBbDZd3GwASxpqsOGtF5ZcoJoJa4IaSsCyfnwKlFqsteWCOPZDGlxigF8baetV5XVQS4CzcYSp470gmyoE2MshZlPYZhEYdBipTSKp8tVwfLdMhFDkUyzMpw90I/Pb9++Z17dWPc1drg6oBBGXDy80oZmUMd5mSrgA9mZ9/+6OiVlzcjGImEnQM2+xNQ61yLVwARtCt3GJgRDQIXkCkrGcQ0eCoZ7JQTcgKIgsfKKmFpmsO9qv/MaO3eKRFfrVbtM+3+q+nWV9Kta81honLL6fM5tLmaUvUhrX07X/1x2P6YaFUFsl5H/+XgnyuZzM/qp1lhWZUq0Z1BvcYnYTXrB06cnaDExnFYDa/vvXhp+xeRe4CqpRjKs8X9T25/b7q6HWMtMfbLvWee/uJa/3JqOFBwh2XvFaUj55xJRN3cvazivD758KO3VfXa1Wc2J3s5wV0TpvcP3795902jRgIZ2M1cMeptXr/0S1vj65a44y7+qVoYA+rcnM0efHz7ja2tvYs7n9MUq6LQZIHCT1WR3ciczDh5XO6ffHjz7g8Xq0NTIu/trj93/doXCxmWoTQ0YMu++uTe23ce/Eh1SdTVhJlg7IGMyCpY//L2jd3NZ7c3nqmwDghBAGsx3W/eevvDb8+ntynCqc5t6hPtDPaiKbEYAedUcQCgBIh9VgWOnqMn9tyztFqsHjy82zyzCQEIGooGOKgtU1AG3IKh1CZ4GzwZ8VL6LRfwEmTwXGA5sFVfV0HrDbrTs6PgdRQjhWaAyCgztZuVDX2pIYbZ/Hqx+kKBCyerddS1N+OcB/WqWFEKvd3yYgqjM+vdt8EK6lA4EQU6HwN/vGzaFBkMKJMiYFVwIwJ1M7hIME2SiorGL+39csQNyFjghpaA0drmYnqwmB4Y1YQourbVf2mM6172z/n8ykdvEgkIBieoYdmrDm/7Q9Vmb/zMgC5S0QNSwtEx3Q5kyq1qG6hwI0LUZby8/lKJqyLD7oUAVWQ+p503QkbxQbCPKh5vxRc5bhGIAwEZIHgABSAblMCGlDFvKvb0ZiCG5Uj9jeELO/0vBPRCd6Qig4j3tm5/+k4xSjnXYAshInNAv57zha2XLu+9cnXzc8CQMSSE7ErkDCoQhAftqhnEKrdNqCqFsjfRmxCrZIEK8ZTFKMQyq0C6VobBOWjbz6sx6cjzZqSdzeFXrmytRwDaSLjp9T958+a/u3+2Cn2OA1uuKGIL7VefvvTyxe3vv/n2d0/OTnmQlKFa0XQdh5fiwU5xdGFYX5u0W+FsRFNtZxILKFqEKVczHlCMVUEnq0Wf0zBPKZ8dqhexJ7kpBU5iWWNejfjselz8aLnfi7vwEsgIJXnPNIG1K7A+Zn1EYyDAKSgTzDmrqxEsayAijRfWni2xy5i499xduA9oQJoMLsYwVl5qNuF+wASYAIPuQDJtGAQTdKEwQ5EAjxgQCriR9sBjwsDRMhryAggGdsDOSXoYLsAAmKhVbpEBkLIYYOYqJEAmH3piRgkMsvUDsYPgmUigoYsbiBxEQCJIwCRy6RTcnb0Y9y5U2COInT9EB+IgNDvrz5yu3omFt7rMuSEtoLK1/vS1i1/ZWX+ZsemounSPKBHUAYXnNlnWjGwMssggIZNzeQfy3IC9kMoM8BzKHlJdaFM0eWL6wvrkc5f3ntlevzju7/ZoDxgA2qRWpFFbLRaro8MyF7Oc4/o6L076af7XX33mOeDa6Bc/+ca36jrFdn+taHd7B7vx8MZgdW3UDum4TEcVNexJwK6WoVb1FrT7xoNwu21P2pHFggym5X7ba4rLt3XRo7MLRX1d56XPQ86FZ29mYj1hAzPcgASHwO3nqYj1M9n0eVbBALOVbCVboazsLTiilUBBbHBl8wuMbYCIUlYjLgBxVKPJpbK3MU9HSm2jTUKTURtCdxabR5bzeCtl50JbLB0LQbtMCyFRYkdwRIUroiIaSsXAziusIIKSKdgB5kdNSaiiBXIiAoyQM7QxU2YDiNWRFC5dg51gBjgSkhApaiAlbZpUt9YGjuPBeGN9FxBGUE0QFoTWQ0Wbl/ZePn7/tkdTNM45UHQrtnavb6w/G7Bt6KWsEhpCC2SHtbCAnNo5i2bOSkouZHAmYnJkEWU3d181LRGBskyna6vZ1X71zPr4F69c/tXrF6+Wj3w30P1ishQF+FqI/4sXXv7ac6/83r39f/rWe7dOjoeBBk09AXrAIImkUOlyB/dfHJ4+v31/Kx734ZXkSMumnhFHZA5Swl05Tz1+Ul/60UF8SHtntKboEdM9351K2VZFzosqHX6ZT7bqD9eaKQCVMKX+IgySKHgFJYDANXX592NVn8YjJwYP5EweyNlAxixEREIWe8X6+vgK8gikYHT1ByAAVT/srE8unz18H+IU64XdYQZjVLc8KLaZ+2alKziAi/lCD01mipljQbE2rR4dE/xTfx611QhOEDenLoyW7ApooFzb8aK+h5CEIxGl3MzTQ65SY8cn9h5sIMTRe33ZjBSIAgWAcpOOWztBqIHc6mFRClJlubc5udaTsTkHkgCc+91sHOPm5GoRNhZpwTEQnFmK2F8b70asZYtMCIEci9sH7xyc3lKrwbK92z+Z3VFpclRzD+pibBzcyTW7JyWPMUJtyD6xZpwXf/HVV772zNXrA6wBE8cgQegnXHJOMGYGKuCZYXkxYGvjIgf+b7/3Jnk0hOkSvT7aw0/l5O0X94ovjJfXekeb9Elhx26FtWbcBnJBzBxJqhrSVv179d4bB+N7aWPV221QwnRO5S2eBAkLCoHijq3mPmsyzAwSlrF3WIyPdFA7I7WswsyOfK5l8fjZtHUAl87nAXAfGJQsMbNpGE62uSjhQTMLB6bscHcw9QImG2tXPrnPEuuT+fvff/2eLoV9GGzt1c/9xpX1rxBKMED18fLd7735z2fNbcSmV5Splq3Bs3/yMyioBTXdH4IQwIjkzCgIZSBx1Iz5wfHrb33wbxs/LCtu21a4JNZVe7y89/HNB6+bimjcHD/31Rf/58AErEDb2tkHn37j3un3WzsmRBFt9ZgsIm9sDp8rsCZUwsDMMAW5UGLoIGxujq6tzu7FUlJq1RFjb9hbEzCYCOZYHM0+fO/jPzyefzwco8mLOycplLG2BXG2bMEQqMhUwmMpRQyxadtGc7TlJNV/YXfnf/trv3aF0QMMiEAgeOxwXB1cSLuy1LkCSkAfeBr4C8/t/dEHNz+aro61eu9w/vmrw5Pbf/RLW+9vbevTvbbMB7k9NjLic7mUEEJOKXOcW3lrXpz0bnyw3H1/ubUI60bMmoQqD/GWSlla0cyetvnLzclzetTXOlHIHA9j9Z5Ud2WSMShzEU1dreag/FM9/8eoN97BrKjzvto9Tnam7AwEGm2tX+wqTSTB3EyXIpERHQDKyWiv31tv7KwoTe0EpQWudVFzmAOaUiIPXLRFb+V8EPvHSstWi6LYBregrnYB/hPYB5CDyd2J3MlBTkzcCSJ0nZacVoYVrFCribN7KgdQNK3OSCTnSHKxbRtmi2JEVrApnzV2L/MxewEOUcy11y8vrI2vAuLuROY5paRFr2RxgAJG25tPPZz+CLYgL0gllr2A0OntpJwl+Kg/vrBz2flkZftOcyl91c4pEkAEIQIRuZGRJ60TWq4qaVeXC/nff/3P/NX16gJQAdlRE2rgVFFkXC0RAOREkYXA5A7rNrkA5tgDnlsb7J+eEjmLBvjlzVxZDblXLE+DNyKBJCrYspszseScuZQ20d0zevuo+CQPpzRppeKci9xMKMV2QTrbiekS5i/L6Svh+Dk7myABaNxWKS+XNUWdUNuj+VY7NfhNmZyVgxZQerz8tJFngB3ByZ3MuXU0ZG00j1b0i7Wt8UUCAeqM1Wo6PbuztbVVhEAIhFDx2vbmU5/efwhKYBc2Fk1eOwyQILFDhapmg0KM2EHetkujn7gjkAACD3BhK5WUDIRMyIzEUHKDC7wgGfeLa1f2fkkxF4kZNYf6ZHb7eHEbQVkCQUgKN2HqCVd4lMS4OxFJQeSarbFUkxWXdi8UmDhIqRE0R9PDtpaL/avuTAiMwdp4d9BfmzYn4oVQ3zO1TeqXWTUXoTIUBV156lJvPL708Oz9k+mHi3yP4xlH9yxkwpzVVT0bm4VcVbycLiZ18+dffOa31qt1QIBTYEb4KOH1Wwef3Pv0S1cv/Y1rF8fZIAWsVU8kTB3M1ULbWqx4Qvjlpy8/vPPpbHX23DoNcLLR17PjKeIisAYKppyzGWWRwjVoQmQCUy/G/mBt/2H/RCZJJABlDpO8upYfXsz72+39Z8Lqqby8xsst3V+zRd9y8szOg5yeozzPZw/hO55+pb2Vwf9GbrxNeyexp1I8brFH5xsV1DWTQciAswRoLOPasNgQCCwz26I9fnD8wWjDIwbuA6YYMdkc3/j05jtczZ1TnZJ6C6lc2HCO5QQsmwGcc1ZqBr0iZQWl8/KGwykAHTl8PO/A/gmA9bmSjRABcX10dTLedE7ZXShnHN88+OH89rFJVpimHLg6712DQGbnSSY6kIkjkThTKGy4sXHZUQFiaAnLk9ndZsV7l7bVESgQiipMxoPN+eoOgwBq22WTZygzC7K6CAUejYteb3O8t/n0afPi3YMf3zr4oedF0zRBnEUUcKeuYdmsVr04GLU+mC83gQh8dDL/5s17b55OP5i3D1fL2epU+tVfvnZxzAQoiESiwzOyqpYSpOIVIMCvXV7zV569eefm5/sjwafiyx61DiXvhOhFJIIoUW8la0ao6MSblqjZGVaDA9vmjPqwn/NaTnvN2Qt29GJvsRsPdtvT7dXZmq88n0UYIZJzT7CN5kuyaBvXkLcCXgxT4viBL26m6UyK85T2McJ7eEVELsk0kYOU4OREDUmI5WTrcsQYOcCVODd6fH/63nod+8VFpkHTaFkOLo5feYN+0PgHilbKvlkvWwkpDS0hgRxITME8cuiBmpRqEJO3TIkBMxB3zKzU5iZWppbB0T0aqQIGVs9MRMRuxlQGHmdkJmO0EX2xT7VVVBls2XMZ3dGCWnAD5MCq54kWDBAiTR5p2IvbFyc3BENDwaCMw4dHH8JjYxcq3nYIIw5kfWO4s39QSYHVspby7ObDt9eu3wjoObF7EQimVMjY0dstd7cvP3Nx/cYP3/3dmm5J1LxKzAWH0i1Gk+DBKKxSHgwGGVgArx2e/P03P70lveNgiGVhG3eOawXA2SkriToTBYO7cAMc1n7U6O4k7AJ/5fmnFzcujbCIMHejnGMhCrRJ4QwWC7wKW+/O9g5Ozz63R3uD2s6W2zL76vbGxzff2F7qNWqfpukVn1/S5eB4Hq3uU+63tSDnWLWqps5Mrss1P3w5v92We7fi4KS1g2zjfihR9/JM0JVeHqN4ms8hNc7szB7YA5/DBYoQJxtrlwV9UAlC62cHJ3dW6eT47MHVcSZ4FQNcClq/tPPChwcfhFLMYUYi0bJySQR/NO1yLvxooC4hjVKwh272xT0bZWKtytDkFnQutE4QkODcmpM7uRsxmbdMpEhA7ry4CGWoe4fI80fbtQPlyWe5OXf+myJytbV9TTBkdOUXX6ajaX3PlKar69VgzVG6krHsbDz98Z0fr5pTCdbadP/4g1vjH13d+lJkB0qHiAgsmAoRh1DuDPzZK9M3757mfBiDsASDqSZXOFEXQK1yrUADPMzYD8P9ot/GBLImy8NFagBNCWUEiJzZIBIyqAEO2/xf/7N/+Z//jb/6uQJbgddDv8UZkHJawVOrbeIixxHCeIXeWcMP2+1v3R8sVyEOeyzTNZtt8NkXw+EVzK+xXSDr+WmZVwUVoRpoy207HznEVIUBYiYmj0Dw5SilZ4rqGZ9/PG9O2hkV/VhKocaPG4aJYExGLmSRtSSTc2yDISQe9dbWy4uGvnhAsLN2dro61pRPHx7p5ZZywxzhLtK7cfmF2we/5zYjOGmO5KRZwLAOQNeBmB9FERB4qSmalpCqK6E5mpynqZlJDBQIMCd3JzO01pasgclcmeFYzZq7ZcmtJyY0+bTODziou4K4iybhEdaDRXhEEKA5L6M6C4xRMI0ubj/L6D+Kb5qjo09SOmCKi/m+D54TRDALDQu5MB5crdOUoxq0Tvvvfvq7R6efXLvwpbXepR6PHIOUqqocAqamgbeu73zl4dl7905Oc8xKywThkMFkQGZNhe8vjhpgCexPF0vz7OfDYBTkuJ4ugBz7gBegkIEMlGChBBw1+kZL/+W//sP/05/58ucHPT1bbk36s9y09UwKzxKW3Fvwxgw795ajj097txfje/WoEH/97DjK8deGq836aPdoVuU0qTNi73Y5+bjYOsRGvag3efb5SVudfbretpytJESo+WeU/r5hy681B5NFQ14vSYDCkzx2MwFOZshEThYAcjIlMBhWBp/sTq72MSGUHjijRSi3Nq9sjHpiEV4QySO5Rh5V65PxztHiUEoYGTyT23l99VFk7D+ptQRH4VI5gpm5MbNHSK/s93qDZXtCZmYtkYCDMDMzulkAIkM+mN364NM/kH69Wq04SK8K08UDpZrg3kmQZQNTBwkl6nYoPhNIhZtmGvUurvWuOgo3mLsIAg8uX3k+SBniqM0IsCCclIJsbW8+9/Dk/TYlLihW3rb7D09WJ6cP1keXtydXNibXN3ovOky9BaHNQcJkfXTx/uHbXpohESuTEnXnhyrxg+lyCjTA8WKVmZ2pi4Kz46xuPz5sr24VrFTyIwQ4WAEFbp7N9pkPzg5+50e/s/HqC89MLjrmFOa1niiaTL0D3/toOrk9699bDvbb7RnW2zjsFfh4EUqzvbgzsrSX7k4Wx3sp3FsN3i36bw9GD3uXZrHdyidKZ7tFb6QzeD6f7nATCg3FVTlYZb/iZ72AI7ITJLFEKOjn2Eb8GfuI5qxOgGuWlEOTJZOWZpFs/eLms9SVlaAK6vPG1d0vBs6elWlCoXwETiag2t258fDDTxgtMbIpCTuYuAOGmhKUocRGQSFOZMQaYGym7lAFp6ZYLSD9YNw6QOwpt5E1OxKRmUcmwKb10f2Tt0Ka5txQCPnYWNSLhQcYDG6G2oMqNypguKNVrEwa52SUmWBGG5PrAVtA4QxVJ/Qu7vzi7s7nBWKIEeuO4ABLYVgbjq9RGJudmXtuaglIdtrkaZo/OJm9Pzj46NUXxlW4BAoRhTEAieWaea+AOTdgN13BlQAoEfX2l/oAiMBZvdRu54NBhhBNivfu3PtTW0/1CXAoIAWy6wJyAPz4/u0moFeuIPvv3Xw3XnlpbVR8cu+HKZxEyINV74fTnR+ebpzqeopbCENDNMFCTXnn4yX/7n3V7dHXL0mxPFsc+1LGt4q9N2xn3zbTsLyPtWL10ZdiuZvJNAY4mbpTRJzR4KZsrRxXdXUd7Ybanfr4g8FWDNXPdeT2P6WP2CUlqqxO5sTwsgq7672rUIGbsRFLhX7JlcIpQC0LaVeGY4BQbq1f7xW72e4xWXZyFgMzAX6ukk7uhJ+IKuXcuitBQ4wESV5SmoS8mxfRpGJBiN7WR1aoUBAU8fwEzGzC1Mv13FBAPXARCmu8Ic8Mti6wRWbkR+V2fTSfYuxMxqVMtiZXCX32QITAYDAwIQwAFwSH5KzgLnktRnFnfXTpcHZCaJmlX67N5/MqOJQWq9Xq9HB1bdUfsyACiMwGAyyE4GZQl0jsAd51aogJi9bvzbDdQ103ZsX5/AwzhHMp7x7cn+GpAQOGxq0gBokCH2S8fXwkPRmUTb9/Ol988tp7nw56IdPZKh2NqiJoqBgDCTMvEhXqMYNAAlKVcur4YJn7J0V/NP3iVYt0v9XeupSbiaa2MNMkfqZ6Cq4lsGdxMyGnWMvwYdz4Vl63UJZycjnn9Xq11Dqo6s9Z5O1nrnswzOEgmBgTECyz0bVLLxM2QBXAJQV3J1WQuYDgxrWDmftq7nCDDMLF7ckzD04eEquQkEoXcBCMYJ12o3kGVKAwjaLsrUAtG0h6snF9+8s7k6ch5pyyN3W+9+HN30cuQtcQ0g5GX2wNrn/u6m9lWkgI5g1k3uSDWw/fSO0ZgpqZUISauEuH6ux6cEpBAxBFe1uDS2v9LUEgnA/p5rwKIRLcHEyApzIQdSQIoD4Gl7eePtz/gAu9sP30lb2vLaZ6cvRgtZyX4/766Ore+IZZCTAzGMkxOz27LbIkVVN2FLEYgQqHsINM1fPpVK8MZVT1iwQiEvKsCZzPfPnJanYHWAcKRxFYAFJkwQ/uPbilq3leXl3TkqeFnAZpp/N5LKwsaNHUa732T/cPr47Sj0+ad06X+7YVq52kZMaGVePqsvXamR/P5sd7k69cjsOTg2dnN0d6cqvanfU3FqqD9rQ1LLjX9zOQgn3JxWkxfp22fjdcy71e5ltfavWF1FTm2aS16D+/St5/Qt2jw3ukzpuKcdAgVuztPO1ekgHcgnLdnnmaMtOKSFkjJ0ExDFeZO3B6wRhtjC/dPxKQi0R3Nxi5EQACO8RNYebGlB2Z/Xxslrl753JUXRgN9jqFUyCd5fdv0ffqnFidBURwAyNOhnuT4XpGI4gZK8b8sH77/sHNtp2JKBzCTEbnw7DnyAkmZ3KCFaSD8fBCIf0u0nerIfNaj3LbSGR3Zw6WeNjbJOqrMYGYeW/jasXjNreFjHd7L0pvU3YbRRJEs8jou4sIma+M5glH9/ffa+msF2PkovVgyo7gToCLW0U55nqHBpc2t/x0XzWzeIerXo+yN+ytfUZUIXBHSjgBXr91d6r1mOcTOx4WydLC0EhhHfFEFavUzEZYPF/tlnvloKI3TvRhm+uwvbIYytgQFJF6xUcNy8Htan3y0nra61Hv9GRAbW8MQrmcpXCmTSxLOEyBopH+fRm/Y8Pbk6cPIOJtW4r7oInrB+XGyseJwmNn00TBm0SRiyCuOTgVPtgeXeqFjdZQBHIsG9z//sf/2tJ+ygtIP2VECcNy7wsv/OVIu2osXESMh4PNQX+8qFeqCoEiRYabd712jsHdSDQpBSYIg8m6mITJHSSVW3IiopDNAnpucPfYoaY6rCg5HE4lo3AYoSNZuKCpYArErVtKbaRhNMBhIDGYg80ppVRWUWQ0HF4oZZhdA2WP9YOTNz+49b1sJxRSk1OQXl6Vr7zw6xcnX3KUDmMgYrK3c+PT+0cikTEw9BgFIQMsHACIeAdZaXD0x+/9vvIxZNUgUyxzUvWcvYPLlDo/fGZr8qVrgzFwZX29jEcQjsFo1UwyPtfr/d1f/dWrQFU7CgKsIW8ruXm4und4tFHF3Tzfbu4FrUlIqQVAGLEHyZmFs7u0J3vB+lu746L80cOT9xsqB9ebZgUJHsNitSp4fOxbP3rwsNpZx1YzHOXNo+N49/5mi8LiieZVkDUqxEHaS2F8GMcPbTzj6qRa/6EVB7r7oRwTxzfD5qGPGpHHLp52Iy4LeN20rXNMKtrYtRvPEMw4KdSwPMHN/cXbpg9iVGsiPK5aaVazo9OP9tYGwgNF62gHg/7aeH21OlRXkpaxSjiLXDhW2dqkbXYlJiJ2pmzZKDsakpVDVDUA3dQogYlz0pqISLDUs4GcifQBB5pHEy5k3aQTPLuREODuSkSQkDS7rBJmgsLRGlYUPRTRSYtq1B+PFSnRzCGKk+Plx6f1R8mOpExqJijNe/dONnYmzzKvE1yRBeWVSzc+vf/HQQqCEdCalVwSzJDNkpOCmoSTd25+82T+ofGKC8/aurtJz5jcyZ1Sk8ehfPXVX5gALbByy3AOVNf10LHL/FsvvvJCxEDBkaytvSDisgXeu3dntlqOLoye3XxmO+Vl/jjIWrDTIJwyXC2ykjtzLJGFjgpfoT+RixfrB8e36n6DEVBCDWWPXFLu7T79zFIevINFyFinYm+YR/M6L5ql+djPh3GceMXV/bj+EJtLGTQ8ekjFnIen1C9IDnkyt9IeOz9NgKu5s6gSt1RREUtrhsM+MGOYgTNOT+f3W1soNU7KXAtFaAFM5/VtxwVGYjih7sFHg/FDBPWc0xmqU4YqyLFUWcWyyNZ3JlVX1VhCaZpxQlgQOj4mBqFFWyAAOeHQowoh4wQ4McwZABpAO+XILuNM0MQHUq48t9mUqQixdMpGC8ORQBy5xSmFhoTqtrm0t9aPhWHGiIZc4+FpfbPBUSg1U1Y0WVcSlvtn781wdwhhIKNlYK23tbmxE8vQ4LBEjFwCKaNmmHBWLO+cvnXz/hsns48aP/KY2Il9ZWQoRjkJEZE6iKisvvHm+89dfXUEfPfOzbknI4BRgC/H3i9emVSAWcMxukOYV8j7K7198GBezw4Plmmef+HSRaHsTussbnNlQw9KBstFlsAMTSXyVkixrFZ1mR/mW8XnaumjWUBAIVe9ul+dLZN+7/76yXxz2/1yxJVJ6te3noonu1gwMrxNCGdCN+PkNtaX0gMLrKpNH9CYIaYjpqiuP7/Sx8+6XUSQGzA79x7Oe8cb6HN644Mfpub1wBVT8JjOmjuGtuwVwFKCkyU1a/Tsg5vf2j+6re0QIIRWimWyhyQIRfro1o/vyYNVzWCikDPmJ7N9qVpiJ3IKdu/ww5QSe1+zdM0/BptZjKVZdrQZJ7PmIZxfe//fsv0QxuwG6ubv2chA5kAoYmNn09UDig2IwKSez5b7P3jrd8krYSZSZ13WB0q1FHzv4JPZcuWJiSQETjo7mn1i3JhQNuWCiYhcTxd3Xn//dyiPczaAmdl5NW9Obt6dnZ7O++VewKhfDiXk5epsOj09XTxctPfq9rA/9Eqo1mgWQXAZLLD+YBnqHI0lBpq2zbtn6f/2797YXh++fjptueeppRi51strG5sFOuY/89yllAzZ7YXf+NKXdXPjBzc/Ws3OXvvh3aMtvLC30+un1MzLKhgyBbfWFA1bAQKpllgM9MGru5ODM31QH9bFhDgGraU9NL/jg/vD9fWV9I/Dei5jq42ENEoPXohhZFoQ3N0C1RwPMDjGMBEDEIZzsXIAzBZAbNDHLZ4GOblHVwWvP1hsfzJfDtdO6vk7QykkqVrDFBpFiEwOzZbI3YmFJDbL+naqT3LDMZSesq5qFnUkBD9efMh0152MybMzM1WrUHn2pJaYlXr5LDWpdncXEXUjDwSmJWVtXBLHloqGKTxcvK2NxBgJzmgfUbMY4EbIc4WY87wIZLlLDZfJkraNZpgpyMyMRVkaY6gdTo8fMlJHFmVmUsQgpXqrDuIS5GrOVb53+n1NVlWVSNBW6nbVH8Sz5fRg/l4Z+kiVOznVRMQoXcAxFwVSSmTSZkYROQ4XPrmzuvDx8aTBeix6TT6lkqbV+I/2j3F4XBRDsig5u4MUG6NJ79zPBHdjDgowaOj46rj3+S+8fPT5l1/75O5rtz587fjeDz79aHKtenp9Ky2ngZxcxZXJkyNZBS6iW2H1WvvJ82t7H+/PUzMFFyEvtjC7SLNhmm3HwbVRfTa/z1iPQuXZ2ZWsT4dmV1c9I0NBVCpXdQ4plmwMTcZKZCbubio1PJwThT5e8XSuQ1HkbG0YHvPOu2dH4+H6pVGj6VSoJngQuPYVSB4o9tUN1IEfSYtclpKoIUpE4s5MhXO/czPuBriTZQWskDDMZKoBkkMocmKoeyAiUFAzg6Moqtwqc+QojVoyhwcpYzXsr9qaYAQ6Z/LsmhRwCaW7g6oVPEHJSQJRkGWjFAIRSxBVDaFwRFUVqlRS1StTXrRGWUMRhtOmKYpeKy2Zmxk7D/pVaubFJEyXc+HoRaAiLqREXAeWNRyZyJyEmLk1T2ruCBwRYgyFF2WSXu3F/Wb05nTtg8WwjYPcVQdFFrMlxhtwatsE9xgkaTbi/cXZCbZ2z2NCVvXachnL4Kgca4Z1wsUbl37xxqV/c/f0+6//9v0H93d6A06zwaDQto0UgqNZWV6pRMQhheCrev/aePTU7EF71pahmgzt6lCvlL3LBfcxvTHq798/y6ZX+5OnTo6/PKat2aJIC3dvwTUVCw9nLk0orJDu+HAYTB6phNufpJ99LOLpjJgQDKZz4gWv1Qtrb/uza/3ra/NeOIkBDqMYLGVSE5JMCmZ2NgcHKgKnak4Mtgguc+oSOJbgTjWzkQRTyW1gZkILTkRKLpBIEonEXTNWzmru4gEsRGSawI4YzFkzofUoHddhBgKsBASUDPCkcI4xOpMVraN11ACX/RG8yDkTeWvLiABkCmQqYJ4mU20IIAlClZY09SwlHMmNYGGlscnzAKKCATMylrJZBREBr1wt0siJyBtYBpsJCELCqglgpniaevdWmzeXa2/Ny/voGxHaWRH7qW775bhdZBBnEFhTYFDM7m88vPPm4cWnt3oGYhYGKhEAbfIoBPZINgFF4G9eWvvlyZ/73e8fn57d3B7MKM+iV0XSsk7xNPfPlMrGndqxj3r9WqfPlO9NxsXOeDiuihh9LSyr9swXZ5e5eHWsp+3JjWb6cv3BU/l0mKeKlDmsOC4lnDgdgGZlzFHQTUp4ZO+mNTqsx2PYRyTk1ICEQnSXuRcfLorZKt69P98oiypIXS+LkogKygwgw1XEqDBDAcBXql5VpWUmirUKQpk6WsTsFcNTDiyqwWNsuGBo4UnaRC4CIpFsIO5xhFprCqCvRIkzyKIJO4iEyTm3Hb2SQdxLpZC5UgIzqzpTNDPizNSAg8DRcMGExKVwbmIoQ2twCQkBoWxSKotR6S2ptTXFXr+xmkupszhJwQNLudAY2dxa8tbIzTPRJFNQKZzJcyQJjhLeRqQAAyhbDiE0WZ3pNBX71juk0b71rT8GR9QZQBl6adb2ijKrchHaKMgNU+nenMyPDo4f8tZTCicgZ5wXygpKHXwFKtAxgqqPhlvrv/63Prrz7bOH/zbMl2uguMjF3OzMaNpq35ZjQi8uYJnt2uXNHR5Kq+30JM33fb3f9nY8m6hf2yyL/bZ/enadF+vLo6LjmmUWEoKzrkI+rbCcG8MLGBhCRG5O550EfvxyRGcEQVZvGqYCqA5tjeOQlsVqNqWkIpIjqyppYg6tmVbDGQ2MMOGM1SlhKQLy6NKfatWUcRnBjLho1gn9tiXNXhZTlv0iMPN4Md0kl6buxdBmqJEUozo1jDnFIvu4CcWi8NQsdtjLlEy9CiG0jUJzUS6BTEUbihlLG4VE2jYDVeDoeRlYhdrCUmxswhKbZi2EHnE7TSuRE81nMeRqsHCK87xt86LN8J7P4oJTLsqGyxawrH3GMKV+TgNOgwKOmqR/PA9nFn2tf1yvyn5vvlpKVUhK43o5keBQyyvi1otyrsO59JflqKYoIViTEAwsyZSNQ+wnd6bkZlAGl5YQVF+5uPfVZ5+SjmjMEQXWqpeyAhqAQD0UBQDkFhYhl2nz6pU/dSekN/7wbn/xcCu3PM+FhwA/rZdcV5rCvCyasPHxfHxrPjx42FZt/dUrQy0nbze7n95+8PKO7PV7w0FrDx4W2UMmIgiLJy6hHJeXwvzzYXo4v3N3/PTKpJcosNbRlAwemQuz9Pj1xpWJzqf/uAPNx6pfFH/71391W52MUs4mxIHck5KylAcq/+0fvD6r689d2/rKs5fXhckTPNTOt+f6L3/4wweUlfjyqPqll17+wnbJtaaC3zyd/sP3Pp7WzcYg/flf/sqlikPbqqKoBoslYgWR3AIzDf/iO28eL6YvvXztN29c2mEwoxSUihBwknCW8PBk+tbdu+8dn9xt0lxiipF5REnHA69nJ1ulX9sYvXzpylMbk+s7cbNjS3CsAj4+wZvH0z++/eD+wdm4hz/9hWefXx8j8YpwyPh//c4fHmuBKP2i3qiKX7x87aWd7as7sh4RgDlwYvidH0//2bvvLIfFql3JQFxC35tXr2782V94oSTAlaxeUHhzf/nbr705R8xO0akQJLOuadtNOYgrUXbOMGGJQqFn+Mq1py4RIkDuufUYiQu5u2q+cef2IvYpy0ZVbeji2sZobzTKTao4gsuLo6t3wmbR3CtyI1lKh/Cq36Y0JR+unVp5f5ner/PdOlFLly5dHe2sPWzztz4tD6cXGp/f6OvFbDuCqDkSDO7uZB6RS7PLmP9iPqhl+IfL0WF5MXhIlhIMkaFsOf9cNVd+Nq5eJmdWzpTBlpHE2oHbZbK/tIHdc2La0PEVJpRdu/kA+MehzSE9syG/tV3sAX0EBWrgYFtmd/sPb9/TYrBG+cu75W9MMIAkYLMc/cGbrbVpmFdfv1g+AwwQHRCg3UQECKEGpsDb4Wy/OXt2+PyvTXDl0QRuAAKQSwBI6+P718d//PD073/nBz9cJu+tRUAs+8N7X7m0+RvXr/zSUxd2K0zOeZk9BHKgBl7awBc3xun49M7947Jtf2Vn7WsDFMACeA/411gtIzFWv3Zl/beeu/7LG+MNQIDOEbXAgvFWbMnbFUWUlTJIfZTzr1/a+WtbiEAJEQwWwHcn5Y/fsKkjS2VGDDg3j3gfzC1lZFAGJULLlsSqCcnL61sXgB4gLh3p64LwO2+/+d+8/u7DMFw22GR5qcD/7s98fXOIYREBBaW2aRpXmlgBlKtyNWsrtOReHSdAQm/czqqaq0L0+cnp8zs01d6P76b95uos9N9p59befS7evuRzSdPsSyoCGwdlVnduLrSnX8+3BiiOdfAmj09o1EgA28+VJu8/DT8NgN3IAHJimJlpsDR03gQ2MhDQwhmUgRYd1M0C2FNN1lQ6WwPWFEOHZViFIfDnn7/2b2/dXFpbuhdNGiOOXDPJpK77Zn0iTm0JjIExQEBr6DMMyEDR2a5lWi3LZrmJzQ0AMIMbpDUrzftBSDER7OyuDf/s1/8v//Kb93PWerop9MVru3/7l1/96pC2gBJwt0TJIYZgwAQpIDKwOHjImkOqtwkbQAkUQB+QdlGJX7+w9de+8OKvVOUmUMAV1AAtQEANnJwccBnRcfFoFrPtInzx8sYWEIEKsIQq4rkCn9uefLo/b2KEc7YMYaBjtnVwOp+CdyaCZw2Wd8aDIaHwzoW4gYzszPbvnbw+XFvkynttOUHx61/++oUL40jIOeeQFIs3br9jG+Uq9WIRUt1vT5aVc+Hl/LRKy0GvsadzbouV9fjFTZAtfn+/uLlcX8ha9n6uU2hsKy726kVpjQibmTtl7ubBLPjqCh81PPjVwYbWvdckLwYbkHDOVinsjx1+mrOzOxzqoACKjqCG5J4AiAksQlbADGiBFijAR0A5GMZpS5ZCB7lXMIFbjAt8YXvytWsX/+jDm3Gw3hHcCUkLZBNmbnXlkToYqLuCJDNOH5U4G+Ae0A53KcyCeQEQUuM5Ue8QAPOIQcCIMDAH0xcGxcu7O9O7xw5+ut//u7/2xS+VGAKS2hCKlniJcgVkdE40zoB7DQ7ahQXmrARjcJeGJaAIccPtl65c/lJVbgCW5ikOH2Q8bDEV5BIJOKp6K5vBAGrAqMyvbW/sDREBgSoyRVaEDdBXr1/5wzuvt1ETBByABLVgACyH3Bk0LCCLqFac10ahPy6UkAGlbOKE+eHZt7f7r/3WFhouczO6tPbSb1wqRwAMFniJ9lsf/NH9xafE07XJYEmrOIo6GQmKZjU64LXBip6ho19tzr64uttYyUXvndON/eXWSRisSHt6eKN58MV09FR9vL2shy4CRXIVyT0xlLxSMUTYdjr4jfoTblaHQ5pZf5UGZkUwMHki88eu7uEdiJOACDATkySHGZBJBXDQj+8e/vb3X1+UAwuFW3sq8e7ZAtrmnAUo4iOTVIhjg/CXX33lo/c/4rY+JwXtfJNKoJDb1krqKFqEYMCDxfL/8fvfW8a+K1LoTfvDdx8cpo4HFWD3wouG8M9//NEf/OC1Fy9c/s//9Fc/1wNpHngcEV66eumPP765O1j/cy89+/kSPVdo8lgdAh/O8YM7d9+9e7CofVSGqxuDC8889cZisc8hxWD1PKVkXpKDGAZEwmZZPruxsQkMYIj9GfD7r938pz94425uddQfbm88bG2RHD0BEWszSOkXrr44BMiTIhOxwoDcR/z8pc0LVZy2tUWxbsjTOZgByJ0WlgeYGCQSl7rqh7xWPeLW5qJFOsHyzf27dU9ATb/Ne73J127sbWJZIIJ9hdXrB3/84wfvtgFc9ELVrlIdomp/7bhduznt38sbG6l1ObmO+gqWWPnx/WK9zDdCb46j07IYp/lX/MFX4/HlejrKbQBqD21/eBLL2XjdKY7Olv1mNfBZkedXV/derfgdbB41xf2825brwp5zQngMOWvciYKDoedkyAYoYwU0UIHUwK3Wfv/Te4tyQ8t+0yx03D8pe+u9UQx9BVpABFCYAIQI/FI//vjaU6/dOu70fcxcjCqXYChCJGTqYowkq4j9xv7g03vH1USSa+ytyrPa2vGgRwWrQ4zFpCbczHSzN7h96/buhxevff7KmJGbJlZlvxJZTV/a3P2zz4z6QCRJQR4A/+Lu6f/nB2++f7K0YmwZvZDKB4fL197xne0HyyRFNYmlhCISkFAVGAK2XBYUR0VRAlgxHI1giuYwNrOqtyzKm8dT64049kyBAlyvLhXxC3uTMVAQ5uYNdfzSHIHdAp+/tHPv9n4NMnQSRx3RXNenYFiEMwKQ64G31zaGgy7ediTCA+i37zz4zsP+1G/MV+1E/S9dv9GjpwJGyRunxQcP33jrk+/Opf3urfnWuNwbjkY8h2Nq4x/PLv3xdHRIO4M4P8iLX1uvXs2HW4vTUZtesrNRvP2CLV6b133kL+Pd5+hgmE7FFUSz2Ls93Hkvjj8dXAoorjQPrtPRRWv7dlbl1SWfftlunbTtoqwOMTImY/u5CnP+jHouMIki6jB1d4Nnh7mbAAWCQgHsTEa/8OwNmlw8XDXlsPfJcnrr+KTJ6o+kSYxgEUxQ84JpA/hzz7344OF3emQOZkbBIPemaUQiecKjMW4GBmXx0rNPtZNdTtZwccD8we1PF/UsdZElhW6MsBRum+XA82Tc7+aAQxkzcLKYjQbl5y5sbjs6Xq4EfLBM/+Tt937Y5sVok0Mvppw0RRcajBfLujcYq5dtPtNkgGQ/hywIMYdyuVIddTMr6AX88pefo93h9z7Zf2//9IHaIrUsJbl7qyOjFzcmF89hr3Kieufe/tO7u5MYGRgAz13Y/O69O8d4JEhIeGQEnQofsxtbXbSzXWm/dOliR27cEs6Ab9+690/++MP7JgvtlRhXZXFp99U+dpZIRPnD/Tc+OXyL4+m9Dz+oigtb6+tuZzGKEU9b+WQxuYsLzdqetgdnfr+5uH7zdHio9y5IGjbNs4uHF8u8o1ZGeyXd38snknIibmL5oL/+g7D5A6zfbDYihWc4z/pBXfdgcZkn6fTlxg+DfBqunKalsYhEdXvc+PI4sFg2AoQ1k4kY1VpARkChzsIE++JG7/qf/poVSAEJ+P39+o3f+xZXIpDPZJ+yI2nuB7ihQnhxc/Tq5fUqHQm2FAoUGluPoqsEd+kGqigz5KlB8X/8s1/NLAIsgHeA//LmW61EKLePtDkLx/M9avYmT61Nvn5tMwDqoo5a8NbNm1TGS+uTdUHsCEYJH97dv72YLziCOXhat/lm9F50wJX4uF49yOjHis0dyKXNwS2QKSwav3Vaz3YG/QBDQ8g3QFeuXPjNKxffPlh+6+b93/v41odYthoj0ZYXLw3WnqtQOWrno1B944P7w97WZBMMFMCze2vbFe5lX+YECRSjegYF5FBI0doySJ5Yvd6c/fUv/8Kr47ICuvLRd+6c/pPvf3wzr029XR8Wm6vp15994emNyw47wfH33v3GwexDjme9OH/lIrXhdH3YjNJpbldaRY3hZMWIA9fZKBx9bjuHgX1zfnHB1Rfj2Ssyvb48WZvdXi8PKbeTfFxqdhucSHG6Nn5T1r4dLn8QLze9NW2btpicre6c1c0vjcqB3uuvTp+HzXtrP6L5SU8f5pSkC1kfN7wHOs1ZeyQp0vlvEoCNIR6gQ/CgDwVWjkTYC1SZsrKrnUvJMmaNL5bzvbVBASLHRoEv37iYqWVYx+uf2excTcfOIUhkARiCL3HHj2lT8CFQpTajYg4EdCIRg4A//fy1rz9/bQIMAMteB5oB/+rjg4+Op5FjUXIFlI5AOANOZsvTRYPJmDzGevGVp3b/sy/f2GMsG3iBP3hn/5+9c1dn2cwcUGhXZXUK92bptftH7z41kAIlqAQGoBF03WVnu39j+5m1jfW/99b7d9vsTR5H+fzl3SFAGSni7Yf5tbvHX3i6ubTerwg9wpWBPD0ZvfVgUY5GbVI3AxGIytDT1WIozaA++8re9v/yz/3ql0fYBgh5iXAH+Mff//7tVdJhfx0xnB78yovXf/OlV3rAJ2cffe+TH91b3d9frTSf3lhb7W0MPS9sdRwCecGKsMzUhlAvZhtx9tKub20M7p7WP2jGUx5P9WDlZSnt9bjYaA5Kzmp5yb3Z8PLDsneyGc76O0ertTMaUCgy+Dj2M6kjc/sg9JY3mId1fVFXV6n5aDmb9yan/vMt6f1sXAjIHTevmZOAWAlKYhQUMAg7jPwzbhgjKIBQlibeOPs5uVFtWIJe/3QfNy7tjQYFIMgvXtg8W84E0YAGaDkCxq6dTTOgySDnGlt2PuGFEuhJb9aoZycgOJJDgElH2as1OYpQPQT+0f7s//7ajw+9d7UsEGILDBSBERgBPpDqLAfNXqzSFcYXGZcBKXEKvE8ryQviTDF2W7kTiguh8PHGt+8f2jdn/8XXX/5iKPoo+kA0UKtrlTDw569v3Jpe+VdvvddE2ZgMruwNYGBBBj48Of1kvnpv/8FLT6131NEXgVf2Lv+rO++2qxbMwqzKALI2Q/aLqP/qF1/62y9euQoIwGgVqYH8aHr6Xn3qoyE3B3u+/KVnr/zNL311jPz28Q/f+vS1Odr7q9U7p6OqKDfsZOSnQRfDfj9Zkz0o9xcNZnlVML7YP/zi+tpMJz88CreWk7ramPGFafuAo6n4xVnalFwLfUJr746fuhVj1Wvy9lgezAaJFGuBCrY4l8F7w2vTZSRyL6qn8r0o7W6oR8ujslqHlpDHjgvh/I+BqSOi7kT6Ou1BBhyJ6NOmef3uLZRlkqKl3lsHy0SxIjDOyxqZsBS8df+hTIb90WAAj5rHEvr9tU6E4tGAujtn61S4gcClEx23+Pan99qyZ6ynRDepmAkpAZ5CR5PHyA4iMNCTgmFLS6/f2f8H3/rhXVQpVEkldXKaAlMtWMZFWWYr2oxYlOxlW4+B9a4cDpRtE3LNcHNSIIADUABt266i1qH49v2Do9/+5td2175+49lrk/KSYKMUpMRkF0P5xauXvvvmu6fN8sbu5c2AAAM4AelofzOGNF/UdbYKDJ2g/PzFC1fWH5w0uQXMDGZlhKd2nZs/8/TFv/PilWeAKkNDOsPyfm5+cHj773//rUXwDUnPXlj/lb1n/tyzLw6xnOrD19755pms7i71Tls90IEsZMzTcTXepHlOUxbP2kpkyatB83BvsvPybhnM3nwQ3zvbnBY7Xm0vWIPZVbp1YbCNSveb1TGPPsD662H7iNIVqic+uzjkuFpmapY0XOXxHOW8t67w19Jq3XmLj2JeXbTpdg73ckLsDMges7qHBZhzp0HrcFaQdl1yYodTA/zwZP5f/eF3Z0V/GXpGxcqKVRz0KTPCOYEsYQ4ckP/R/f2d6xdvgHpcklFwGMMJEQjKoFY5NeTteaJELeOdaft//daP7oWIQmrxM4Fx2uyFEJ0BV+PAqrh9dDZcm+yWzOpR/Nqlreu7e/f361PlpHYyW9hetSC45AC5sbf11PrDw9PVXDNIFd44akL3aaP0oglpInIHObijaAgRscAi4kyK19v2/Q8f/O6t/a9cuvDXP/f8nxrxIEoJMDDpYV0kNunL1y4XgGKe4CMM/9qL1/7aS8+Wqb1QhYAkYAZ2Clwd9d45u5/7Q1VDEAleYPr8aPC3XnnuIsAKD3mKwx89uPsPX//o3QYnoYpir65N/saXv/R8NazQOGYffPzHvZ59cDh9d9Y/KUZpOLIc72n7NLBdndjiQYVQqrGmXSy+0vPRZMxh8M4Rf3CydUzbqziAowCcZdbrH1yKrfY/uXNyy6/th+1THvbCMZWHvfbey8NqGa3F7KBdv12Hpqbs0WR0J1z4tOWv8f56nl9uD58hfjetqNr8ueLyfubck34K0919ZeeKafSorGGoV9bUyAlNakHOYpZa9p+0SDVgFeO3b91+c6oJ8E6EXUF+LuYgbnD2TrS8eydCBlrzVWqWuV00Td20rlZyQck69RcTBWHl+N7Hn/z4zn4LQISBbSl/83OfX6vraJqQPzo4OgFmcFAU4MWtwW8+9/SrfdltjndtsYEcrTvfUQNZtVNEcPnJv9+BnCySVUhjrYvlAsDpsvnhj3700a1Pl9YJfrUAQgDndLksXp6UJRARA0KE3VgfvLAeb+wMIsAgAYtir8RXnro8sQaWEAIR2+nJXlr81VdfeK5ABTRi93z/tU++9YMPv/PRankv88ykiPzqtc3nq2oILdEmnKxNeHH2aT8st9eLPq+2wmx7kALseDqr21xVlaoWIbK260X6hR26PMz3p8t3jtK+jdtq08GeG3fjkjAKq7Xhnf7GG7L+4/LSh73LB8W47VWxX4x6vhlmV6uzp3tHTw1PLgznQz4rbWHE02L9AY3qWAVLO/X+DZmP82mRa/7sGH6csKYK6kgLSEHUBQbG3bmvQAQ+N5r8H776yxp7XsaG8z7JP379w3oxJboSHikWErCA3l3W33n3/T//lRfVrJsQADIQGMTIYkG0jPYoRxQIcH0t/N1ffiVVA1dbkpwWg2/96N0Hs1PORQvUgghbRr4f47uf3vr8UztXBDAbM76+Xb3z7NN/76NP6iK+fXr0TouvFRRADt8E/RfPbv/i9trbJwezk/1fWJtcERTAwhAYVIjH4JostYxSkCOiZfSLCdRe2Bn+r7/wBTo5eu/OwWo2fe76pVc3N0fckd+oAcdnrTb1L7/00kVAAPJegIKYCRlIQIRXCGQwQyH4woXhLtJB2+hwUDRpK+e/cuPyb+4OHZjD38s33/zgG2X7/iw3C3t2paKLNvby6en79ZVyhO0Ir4DV8sHupOlZG1a65aVLNV+ssuWRGpu2CJm04EgJPbIc5m1cPbDqrpfLmHKsYS3EjDjbIhS1Iy5TXPmolX4SZm9brVPOxbi01bykljmthbhL+/clNGqK9aYI05ZPkl6VZrM5uF6sX8D0Ez1THj1m/NNdC4AyAHIBGcGMrHOyrnDyAHpmFK5/8UbX4mqBO8A33//4/pl1HEfqSiQEpGw2Gn/jvQ8//PwLwx6HrlkIp47m3s8r4p13V8DcQL5V8F95+UYXl62AQ+D2m3HmVMWi00JsXZ34jMM3P/z4l178/NrFckJl5b5D9Je/fON3b318z5sPTmff+OTu889fCkCZaRhQKX5xLT63dtGevrgOlMAqWYicgUZz47kQSFF2zJQOFAFNk6zQ3Uq+shYurO3mp3cJKIAxIMBSLcv4GHjtvY/g+gtPXx0AEWgJR408bPI0esseWco2XS6rrQB2CHAj4EsXd+7dPZ7PT0eN/cJ4+Hd+5ZUe0AJvLo//n7/zzzY251/abWw6lz5K6+U2OeYni8O3P02//tSvGZBRn07PGjUqw2YxHvFI4nA2n3NIPZxF95yziWT3ACW15eIE1R5XkxxHjRXuCZ4liJrVlrmTeuJIoW9I5k0pLXKar2yVYgEiOFuSYEVJEoySukNFVmWxn2jRl/VpvWeLqzj9IJ3UUjVSEdqOCfGRJqV/pmH5qJZm3fls/zGiAj+jTkAXaSgFhjOL5VYCPHS86hAihjq44/LvGGaHgC5WAENCAkDiQHD0wvAkzYui/Aff//Hlr39hDKyByBBYFACC+4qkMTcCKkCcjWqBjRAJURxMOAMITQhtbucRmyVCJBwZpBhOQ/X3v/+9Z/7qr5aEUaYQcLXAX//Fr/6973xrXuCf/vh7u5Pf+LN74xsCyo8aOgDBSgDOIfISaIAsBQpN2hh1wWAnUQh3rQKNqjAA1rvtCvQdodt+Em4Dv3dz9t6dg53NjRsbMQIEnAH/w3v7/+C731kMw4ocXgxX8//NV1/8Gy+/UApKYAj81vPPv/XJv3MJz62N/9avf3ULqIF/d7b6R9/6wZ1F+eIGL+xQKq0XU+lluGpO+8305jQftAcXivVlWmUMzuTCrenqzozaECXEYTnZoNOyMPJWkKgj8WaY61oVj1MSL+E95z60KNxRJ5WCwqBtRLzgQI1OizgiAaXZqCcum9PVdFzUAIN4larbTTjz9exrwsMYuGY87Pfvc6+cNkU7f2Ewf7/Z3y/35gAjESwbgSJ7NG8h1hEqnFNckin9BDf38+bLA0iIBEbkwggZaWY4AUruKh+dRSKcI05xBKDse+tnQfa72AKoCWcW2zioI33j9t0vn77y9TVugcBFx8pxXEpdVavc5t7wFDgGEmOBqrtdACYsgAWwiDJlX5bVGRCBCMwZR5BZNXhnlf7FrdnfvjrKAS0wA37hmckf3nrq+0c35yz/3be+d3Djhb9y7fIzA0Q+l/R2cA2AsAJOgQ8y7jdag4tYHCYcAD2EDqSV+r0GicteDSwABxiYEwxoiD/N+N3bZ7/74/ePav38y59vgCmgwD7wzZP5x+X6IqBmCtKbhOr37+x/6eUX9oAeoMALF9f+9i99tdfrvbC5fnEEBV6b1n/vm3/81lFdlbuH9b5zOajanqSD+bGgn0N5r+HhLD91fFzsrRdxJ5fr794/uJ0HU9qer3ptlpj2L4Q7xYV2Z61fazYuixCsnkuB9f5glqg+PPGmCAUyUSdpCOLWZJmL1mNV5EnVznhV9cd9mZTenNZ0a+Y6zEMuGLKfRvfbwdSGiXpK1OZmjnq51quxfZYFbXVFT663/KHOjr3PRICAGO5ORiD/jEj2MzvuIlT83P00wzvEo5ATKQOlmh1q/B9u6Vq7UmmcshHgLNYpzfkRZJ/Kk6g/PJna7UGFZaByvhp82hZLGTjrzXz2D994+9ZTN0K7oqCtufPo02V7h8ppsXZX5V98bG+ZlrZclHUSFROxEHLZSDztxfczDvujH5zNqztrg7QSt2koXjtdnvUGi9z8k7ffy/5M2ayUyxyHUytpvLs4OmjJa9X/93sfv/bR3S9cvnRxY7QxqoaDMjBywrRp7k6ndxarjw5PPp0uzxoeh9E3bp7cGgX1WQrlg7p8iDCX+NG0+e0HdjHyoIIIjHA414+P77zz8PDtw/pgnobl8I7Kf//paYl6rrQoh985OZ0Px1mMgJRzTeG7D8/+3odH2wUNNVUL+5XPXfiLL14cAg60wA8U/9Xvfee9JraDK63OjxcnuaYh6EKQ6Upr6c21vC82P57Nlp/eW9FXnn66t/fs9N7yyGmG8TL2OPacqeD9fm+YmO6d6RzV9trgQoilT2d5cbrc93ZtzJNWlysRJSRmMLUqR9Y7zXaBpxf7zUGTGjPharH0o3p4EIvbFvuFlRpmbTiwSY3KBK0tErdWJV+LUx4cHutIsa3TLxD/OD98aIMWQw0loGBzanBOrgwnU4BQsNOjQnaHbf4f52wv/de/fbK12UrI/B8TT7uDiF2gzh6JPXk9CbTWNKUmk3R+ZIDEAjksq/f6B+BVbses/YisjaD0um/l8CG3HvMwL8u2GVMZ4Jna5AYZrrg40oRyEBdph3mUkqBZxTazE8DKokGZV5Hn5pmFsm1G5tQK6crprOytzCO8p82mZUktpACV2avU69+3pZWByGmxHLd55HkYqBJEclczo8y8MJ+ptUXZcGHUl5T3yEpbrWxJZWyovzResZdmO5rG8LJgd583uQ08k3yaUgqjWA55pWNCnxYsunSsqJhaZbHSnEDEpGJaKQ3YB76qNA2S/a2vfPl/9dz6UGGC28D/+Z9+4/tznxbrc7MypN309l+/9P7Ta/nWcv31h8XNfLGRMetiHLS3OrtQpK9dHcuw968/Pn6A/tKLRkksbPj+L4zef+lCL+voo/uzA5Rl5GtFvVnVsbfM/b1P6udefzB586BchokiOTlCJc3RFbrz1d3lV8b3l8v5Nw7X77frIa43WYxYCmrtNAQrMsPLxH3nUlU1nbEfPb/Z/PL2opotPvmQtqbpz/hxU4z+e3/6O8X1O+HSvByD3RlAgjucH6niMTySByCDnL1rJ7OTnXtxC+eZHbl1qGWzrdT6N77xs8Ye3A21s5ny+SvzQq3hwEzKwc6VMYiI2SHimpT7PWZaeZrDchyyxUBRMkLFSb0GN1QsPHZcFU5wCckAqUopyqqc1fWKCqfQUqlkAFjAxACUXAtyBCMciGRlBqjgRIRgBs9x+LBdFcXAQE2bIWibhfR6lt1NvRy3A7q9OIukBBOCxBic3YQkaCkLS0ZM7CGEu6ktYl+98MjLtg1VsGQUwgOzA1PK7iToDxq3Vlyjw4KmHBhToqMsBqZYtHVT9oqcFeoUhQhJ0SvWD6dnJ5yqyOD0727f/J89tz4QZOB3vvP2u0f1fLA9a5o4GbTenubivVl/azNcGs5Pp8d3jiuOa5RKklgPiv1054P9d0btYJEHLUSwnLj1ka6uza/v1BT4o4MLb0y37nO1yD6yuFnVF9ZO1tZHJ6k4WOkqDDJVcAMymFSqfd25Nd9/ZUDbw/jUMs3r2WFeW3KvLELrirjVuK7EhGLw0jPgaeyrS3T/lUHZI/l42f9BuLwV2xv1m09p/oofel00ZdVISVRC2AmtdxhU6Shz4cHJIAlkqkzOP+eeCxHMTAxk5pmJCWZOdQig8BMCh+5Kxu7mJlnNPZOYMyQaBRpWmjSbAaYsXJWGkpmz1u4ZxBCgTc1cDcKBVxAnUYpO3cSHk4DdXNRUYS24UI4oo3ZwjFRDXD0v1ShWNYm5oQpwl6K01pAUIRJkOZ1iOEiBoA3UQNypmbIFpkBFAWQmQgw1WYpR2xbJ0O9nBtpWJVpZgaixDBZQQEpd2kRBPCULtASsGqDNkEJG/aZuAzHKaO7qBmDaNOVoosq1JIrx09PjU2ACPASm4+1ZcbaQQAWnPAdpimsf1ttbp80ra8vnLvSOqb67vNuG/nxhFni0vs6D2spQ9Hu9FsOKx1yv+dHFUVOW5f1peP9scDfvHUpMcXDSFvv1fP+04uN53c7aYkslwvycwFYNVC69f39Vfnhcji5U1zdJPb+9nLqZa0wKWD8bEytA1C4kL0ex3itPvrAmu4PwYFm+PeWP6NIy1rfmH1/C6efiqWSdSxUbPODNuhyeBxmd+CURHITs/LNQkMn4L/6dut9XZvuPApZQJ95KIHMyZ2cHE4wIhE4TnB2AEgxQp4wgiMIiJNEVIIGppcYKgrUQFhEFeU5mGonMDWwkFAmBrRsGSaRGfo6aokfTMqSAiTCH4EIwAQucoAmRQskUugcmrgYiRIE3romylzFaziGIMSFG1C2cQIE4EEuXMMBA5paScza00OwsTFGKaKkFMsxNVdVdgpOABO6IBUvhScXVrLEIh4Ij1JA1ErRZkcDIPScEQYzQHMpguaGcSvNrg+IvPXu5Bb597P/w9fc+zt5EpiKBDEqQ/kp7y0ZHstwb2dW4KNO9BnXLpi4Fh6z5dKmrlksxqY92i5MXBgcbPXtYb795sPXe6fp+O/JqxFKawjik2JvZYGUji0OATVNgJhfKHbe7uuVVLUGKi8V0K55VNC95wUiqJlkkc6ne9zSixVY8uj6498z47PIknNbFHx9uvT3fPqGtmPOldHQ5rK6k/T09XvdEnu/F3klRqTjEQAlQeIRDaHU+mmfhM5gcPvvtOz+KPeAdfa173xS3bv3MdQ+BGYTBgCUnJwJ3A03G7GA37c6KLgASAsFTUiNwARc2NjcUgCjUOPa1rgFIVWmbzExA6u4pq3uM0ayxDsbxGfv1eVURDjCRqgJOHDy3AIOZJbi3uW5ghlghOZU9N0XbIgYyI3KzTMSWk4SgqwYk7HBzTwoCcYQAhkBinp3cA8AEh2W1BihKaMNCLK7OHR4QUWAKdVElQ4xBPUMIREiJih6lZFmLXpVMnQxlQAZIUXLTzgIjOkdNOxs7GXjzaPrf/eGbb9Weqh73xOZnKCvimFpLYeteTm+dniA3L26EZ3YrtM0W6pOjdrWolc6YbKcYlRLWNnm9X4zL9aNaXnvQe/dsfBa2uLeVsqlCyiLDcuuQftkLdVuHAPIkHsyRtQMXV8s8uZkDHxyXGp6aDJ7epq3s9+azBydT5bpNBNIq2qjS9V7eHMiwnDxcFm8fFq+fDff5Uo4jr6cuVWSJy7Nt9ihVVt6vIyGdlZOZFJnZKQAKYjjESZ3hxOD/8Tniz8qprgSqKGfnTv/XlOCG8zk9ByBKeh4CUdegMEgBElgQIORsRIkVZpBoWSEFHNYoAQY+j1kIRtaYn3NUdA0Yd3RDmn5OqOUGgjixO4iJHXCDupOAKjAoMwjeKgigiNwCUCF9xFBN2YQCOUj9J0eAu1Mnc+RMMXtC7gQxEiSSMSeACiPN9GgomiJy91GMHWCuzSDFZ6SH3LQEOLi1jqAISF2c5ogKUTiQc9C0u7GxAL71/kcf182sHCbKaDN6IySLVCirIs249/Zq7ySVJ643NtqLg3tP0YlXpTY18nHJVFHDVOaIGU/enF9587D4ZDo+pbUcBurOVICgyCBASjKoqVDInlkizIDgkRIYFsBFw1VSWRz58zp7fm12oVrujBYWWqUzJzNunFRi0DA6y5OPV9vfv833dHM/rBsNYN5n2hHddETvsdZrzdkr0UTT03n23Xztk2J7FoarICoZxMgVdZy+53NUP+/eeDdx4mxmLl1Cem6I3be0U3ghdCXOc0GdnwIYkrGQZ4e7AQZnGAPGDuv0dzyIAw4V+8wl/4lrN8vkf3KzPfouAXBmkLmw/4T1R893WZfZ8rkwjYHx6Ew7x9OaPYIfdhnxOYDqPCs3EDsxWeiECM65rbsQxxDcO24x++wtHHCInXdsjLjr2sBwrpTLdL5RYS7eJNw8me5j44CrY4REEaJQhTssJFKHgz1zdaJbzapY1qe3j1cvX+hvFTYqqrJfRQrsrO1glavjOn1wTD88Cw9sK8etHHrm5Aalz8R/7fzqDIIjPJIdy6DYeU0AKMfzJB8kPjvEyWz67BBPjUdbQ0JuICkLlDC36njR++hIPjjND8LTJ9gARQSBWkPhDgY/9smVtRfL5sxRt7E3qYaX4nBTeve8WJzXOtrzB0PM/h8dT//MvfEMY3JjuNp5aP8ZFVpm7o4LUDcTal0825Hvn2uVswEQY/fzZ/foJXBuBCAyJodBnAzEXYcJQHcvnYfsDMDO9aG7YQVTMup0BiyGR6bvpE5Gj2Q8zbm7FQ561IzNfM4Uec5A0Pl7sLLgszfo9gVlEDsFcnZiQGFdD0yo+zyUM3cbu8A5bMBBGbAu3ejiNHEDoDBmMXM43D2JrEr8+Hj2jz5evHPctKiIYlDKagSiQOr6iC5DhAcm5aGPp2nr5u3ZOOa1SH1JEuaOsMprc62OlqszjSvZRG/sTtq2cKfYO6f56sJENmd364xbnFXREEDe/VoUZGgFHKzceJjicjX6aLWazDAqco/mRUk5hnmiaR2Xdcypqr23sMH5bjdmswMZ/Zv+c6/bxXXKvbjs+zJKQBwc8eQj3zix3ioMFAgZTlklKdiM/2MFQn9GLTmgwzueq5s8wuWdm+N5UeK8q8lybvSdH8ggNvJ8Lub92ZSMMeWure/nNv2TsqGB4cadEhCZ4vxkgOOR4m3n2jvNW+tiHbVHeBEYYE7noBTy/2CrvztL+JGt/PSB8Nm/DoCJmRGcFGRGP5mrI3TyrK4M7gAw5877XKLg/B+M7iS1c8Hcz24mQzYQnJEAhOrusv3n338DRhb65JwBgggI5mBRAjzDDBqNQk39OUbA9pFqv2kCVsZjZ2l91HjZOqMowREKstwNVKgZJJ9/ftIu8zH/7LB1ZbB3+EMnmKObuGFw9GJjxuuL3B60rbSrAkteaubYWkzeJ1Qsck7TxWT/3/auLUeS3AZGkMqqnvEu4F1/+Ez2HXxS38UfPoABYzzT05Uiwx+UsrLmgZ1dY+w2oPgQCl3dLWWKkkiKDMIRyMz37fo3++Pf9fPWX37w/a32TYjM57y896fn7c1uDQQqEYodTMkSv06sf2u8BxOq9K15AwNAGHpPRZyUBzlH7JFYHP1VMAVhVesITLNxHHfBUMEyRTtrYUJd38zFk6eNHGGVPwbxiKxKWAIq+Q7m+AvWMQowlfWa0TXWngz9Xl0076I+VyYladQBpeCChESvNB8woGLhQGcvc+O0LOeYLeuEGYsEUY4hMEFHlsufIhFAu6DHv+SX1sCW0eGmzTxerKPlNc1ftgBh3CEGtkxiax/BtE683f0tSWZPvVwuvyeu2WO/3Qxq15ZsEQkK3NH6cL/WpcdQ1SheYxxNkFoVcUd27BWqc2XbHM309KyfRKvJb8w073REenYLT15AwUI08y2ie7u+i3juEHXbopsRLaoYG6yXZNdcsFsxo373eA8BzKQZDKd4aCjL3zKrhZdCcafrOOKfhrhkEy2QfFCbsnRrETFtL8nuAQCH2stHZu7R6UnJLuE9VBoczMd2NzGri7SpbBjnctW94njRyBtoQqNA0ICwmHM+HnOuLgMaNBWY2uY5tNXHyPXaBYgQaMPljiSo1tpT2/eOfBnltBAJurM2sqYNoBgwAzcMBllLvKGQvoHp9uyp/eXm5s3dny4991t2wWjNss6TvPuGx9urvaqdziuHqioJaQ1JIXvPyFTZE20zGKJn3GAdV8N1yw9Rl2KjVJQV0YB95EUmbxSVW8ISKWQgO9WG9aKqKmb/FX163qcIFvNUHYGCw/bPqYQdu2y9KQfSFYk+LdkylTYhPaP8JwA8QKBb3knWEmHzMilHSbfRo+Bpw7IEqEtZlWGQH4sHHo1CWAIW45/a3DKnh3I4Ipkj7VJzCflcSS1oFPx411NGOy9TLAARck9QFT8JDbuw4b7Exq4PGeHZc/MW2dO9igAb+t7fQeHubltUlWZuMuZVSHA3ZpXoVMWxgwFBvTFhPdMQfErSr973vd9uuDiurHw1ZLTdAb9pUwtYH29e6BUfl3YkcAQgsumiKgHpafGcbmgb6LRQ/5DS1q6X61sAL7Hrwwf4JceoEtahVDpA5QYnnI6eEciAOcw8onjHBGRW3sAlgXJsfd99usorzSqJ09ug4eioEpiHpouHOgeGOuFyfDz9/DC9T+PnY27NtENnuNaD2l2S6jk0ZhOijtFz9zqkv/rSockcLg/IDAgmdS+MfVqEdqrccKjLc0c/vpNRSXFEKQAmO/jEVSdDsdUISoF0977vSIKu7GKvYGojQoEU/AJa9hus6uk1Z4N71jNyXPGauQ8SzBQcZO87DWibKvNGpSRrmto2DH0BY+6Kzgrj80GMJahHmoHZDKyTKENxA4K0PffeJZhb8HLtIUBIgQEFSHMQrbxPoZ7oRPFclBrtw+gY02NThuzb071+KxfCOFDqKI/7QT8dEfd097Nnsbwfo5BzDTIPD1tyehvm7g7Y/UF07vGQp/npLnDDiD+pMaPrPNSYYp1DlAZ11mQSSDfTGI/mV2I89Mg5Ln2F9V4GxBxJntQMu69w1vOX7yzhfMkb3AZvmxHwsiO7MCyNFBSou1IAhhiUY+UMLZlAZ+bgkFB5UmBUbQks584YTLcELBkQkMODlBzzO4RrGO5no14AItuYZWrk2QGwug5TAso4iHcAAtucjbthfeilZX0lcbrProQ98WzkfN/46c9F9tt+WeeA1btC+eho5icu51/o8aB2wie1b/Sl//mllXb6nRmH/kUr4gsj/MUn/cTH8g0j11nnnkb/oZefrIWHr05HSvArPT4cjLX+8/zV+S098nCcR5j3fe2zgH197dkfpjI/zYjV5z2envHX+D2+J7f1wsL/AkumF5ZMLywsmV5YWDK9sLBkemFhyfTCkumFhSXTCwtLphcWlkwvLCyZXlgyvbDwfybTJlD2XWsRLCz8h8gRJDwDg08RiCIoq3y9ykNtp8S5JdYLr3TnHWHW7LjTMOUM6KXLDYI6od1VKRuGEzXHalf76lry2HptZAzdJZ4iNUsLiC0MwarVvt7dal9jO/P1WOnPIwUhMSgGqiSyBJgnXbAoTvT1+lb7etsBHsnJHInoQ6s+JchsiRY8UtCW3rbwih10g/2n8s1sEAcgQYZBRKoDQchAFTvRwsIrRVGjzAKc4yePG3hOzgwKzZSGDEzypIWF1yjWCc1k44OBY3AA3akzRBNoLbNNjkasdrWvsR1cUAef+iHlDw5oGcSgtUvf32R/T4viU8RqV/vq2hLuKv95Iruq4vYSDfsOg4zatvam324fP9pFN1u6x8JrxKSMyy0B4GYhsjh4Il7oZm0T5anr/pJxa3+gvcl42T92W3biwmtEjquTbAnIunnCDEmlbcjofbeI3Mx+2G//iOf2lz/9WT/9zi7Ll7fwamW6nHmDZq8bsojMiFvP7cky0F/w449oz/jru3/+G0HiY+nGD8LDAAAAAElFTkSuQmCC";


function iconSvgInformativo(nome, classe = "report-svg-icon") {
  const attrs = `class="${classe}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const icons = {
    bike: `<svg ${attrs}><circle cx="5.5" cy="17.5" r="3.5"></circle><circle cx="18.5" cy="17.5" r="3.5"></circle><path d="M15 6h2l-3.5 6.5M8 6h3l2.5 6.5M8 6 5.5 17.5M13.5 12.5 18.5 17.5M5.5 17.5h6l2-5"></path></svg>`,
    run: `<svg ${attrs}><circle cx="13" cy="4" r="2"></circle><path d="M4 17l5-5 2 2-3 6"></path><path d="M12 8l-3 4"></path><path d="M14 8l3 3 3 1"></path><path d="M11 14l4 2 1 5"></path></svg>`,
    trophy: `<svg ${attrs}><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"></path><path d="M5 5H3v3a4 4 0 0 0 4 4"></path><path d="M19 5h2v3a4 4 0 0 1-4 4"></path></svg>`,
    alert: `<svg ${attrs}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>`,
    calendar: `<svg ${attrs}><path d="M8 2v4"></path><path d="M16 2v4"></path><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M3 10h18"></path></svg>`,
    medal1: `<svg ${attrs}><circle cx="12" cy="14" r="5"></circle><path d="M8 2l4 7 4-7"></path><path d="M12 14h.01"></path></svg>`,
    medal2: `<svg ${attrs}><circle cx="12" cy="14" r="5"></circle><path d="M8 2l4 7 4-7"></path><path d="M10.5 14h3"></path></svg>`,
    medal3: `<svg ${attrs}><circle cx="12" cy="14" r="5"></circle><path d="M8 2l4 7 4-7"></path><path d="M10.5 13h2a1 1 0 0 1 0 2h-2"></path></svg>`
  };
  return icons[nome] || icons.trophy;
}

function montarHtmlInformativoRanking({ mesLabel, diasUteis, totalPontos, totalKm, totalTreinos, bike, corrida, opcoes = {} }) {
  const limite = opcoes.limite === "todos" ? 999 : Number(opcoes.limite || 28);
  const listas = [];
  if (bike.length) listas.push({ titulo: "Bike", dados: bike, icone: iconSvgInformativo("bike") });
  if (corrida.length) listas.push({ titulo: "Corrida", dados: corrida, icone: iconSvgInformativo("run") });

  const todos = [...bike, ...corrida];
  const modalidadeLabel = listas.length === 2 ? "Bike e Corrida" : (listas[0]?.titulo || "Bike e Corrida");
  const tituloSecao = listas.length === 1 ? `RANKING DO MÊS - ${listas[0].titulo.toUpperCase()}` : "RANKING DO MÊS";
  const usarPaginasSeparadas = opcoes.paginasSeparadas !== false && listas.length === 2;

  const estilos = montarCssInformativoRanking();

  const montarPagina = (listaPagina, idx = 0) => {
    const dadosPagina = listaPagina.flatMap(item => item.dados || []);
    const pontosPagina = dadosPagina.reduce((s, a) => s + a.pontosMes, 0);
    const kmPagina = dadosPagina.reduce((s, a) => s + a.kmMes, 0);
    const treinosPagina = dadosPagina.reduce((s, a) => s + a.treinosMes, 0);
    const totalRankingPagina = dadosPagina.length;
    const totalAlertasPagina = dadosPagina.filter(a => atletaEstaEmAlerta(a, opcoes)).length;
    const labelPagina = listaPagina.length === 2 ? modalidadeLabel : listaPagina[0]?.titulo || modalidadeLabel;
    const secaoPagina = listaPagina.length === 1 ? `RANKING DO MÊS - ${String(listaPagina[0].titulo || "").toUpperCase()}` : tituloSecao;
    const classeTabela = listaPagina.length === 1 ? "tables single" : "tables";
    const iconeSecao = listaPagina.length === 1 ? (listaPagina[0].icone || iconSvgInformativo("trophy")) : iconSvgInformativo("trophy");
    const tabelas = listaPagina.map(item => montarTabelaRankingInformativo(item.titulo, item.dados, { ...opcoes, limite })).join("");
    const classePagina = usarPaginasSeparadas ? "sheet page-break" : "sheet";

    return `<section class="${classePagina}">
      <div class="top">
        <div class="brand"><img src="${LOGO_ATLETAS_REPORT_DATA_URL}" alt="Atletas Energisa"></div>
        <div class="title">
          <h1>Ranking de Pontos do<br>Time de Atletas Energisa</h1>
          <p>${escapeHtml(labelPagina)} | Mês: ${escapeHtml(capitalizar(mesLabel))} | ${diasUteis} dias úteis</p>
        </div>
        ${opcoes.mostrarLegenda === false ? "" : `<div class="legend">
          <div><span style="background:var(--green)"></span> Top 3 do Ranking</div>
          <div><span style="background:var(--orange)"></span> Atletas em Alerta</div>
        </div>`}
      </div>

      ${opcoes.mostrarKpis === false ? "" : `<div class="kpis">
        <div class="kpi"><small>Pontos totais do mês</small><strong>${formatarNumero(pontosPagina, 0)} pts</strong></div>
        <div class="kpi"><small>KM acumulados</small><strong>${formatarNumero(kmPagina, 1)} km</strong></div>
        <div class="kpi"><small>Quantidade de treinos</small><strong>${formatarNumero(treinosPagina, 0)}</strong></div>
        <div class="kpi"><small>Atletas no ranking</small><strong>${formatarNumero(totalRankingPagina, 0)}</strong></div>
        <div class="kpi"><small>Atletas em alerta</small><strong>${formatarNumero(totalAlertasPagina, 0)}</strong></div>
      </div>`}

      <div class="section-title"><span>${escapeHtml(secaoPagina)}</span><span class="section-icon">${iconeSecao}</span></div>
      <div class="${classeTabela}">
        ${tabelas || `<table><tbody><tr class="normal"><td style="height:80px;text-align:center;">Nenhum atleta encontrado.</td></tr></tbody></table>`}
      </div>
      <div class="footer"><span>Informativo gerado pelo Portal Atletas Energisa</span><span>${new Date().toLocaleString("pt-BR")}</span></div>
    </section>`;
  };

  const conteudo = usarPaginasSeparadas
    ? listas.map((item, idx) => montarPagina([item], idx)).join("\n")
    : montarPagina(listas);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Informativo do Ranking - Atletas Energisa</title>
<style>${estilos}</style>
</head>
<body>${conteudo}</body>
</html>`;
}

function montarCssInformativoRanking() {
  return `
  :root {
    --navy:#07192d;
    --navy-2:#0a2642;
    --cyan:#00a9c8;
    --cyan-2:#18afd4;
    --green:#6faf42;
    --orange:#f27928;
    --line:rgba(255,255,255,.48);
    --muted:#c5d1de;
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family: Arial, Helvetica, sans-serif; background:#111; color:#fff; }
  .sheet {
    width:1500px;
    height:860px;
    min-height:860px;
    margin:0 auto 18px;
    background:radial-gradient(circle at 18% 0%, rgba(0,169,200,.18), transparent 30%), var(--navy);
    position:relative;
    overflow:hidden;
    border-top:6px solid var(--orange);
    padding:14px 34px 34px;
  }
  .top {
    display:grid;
    grid-template-columns:174px minmax(0, 1fr) 252px;
    gap:16px;
    align-items:start;
  }
  .brand {
    height:78px;
    background:linear-gradient(135deg,#00a8c5,#00916b);
    display:flex;
    align-items:center;
    justify-content:center;
    overflow:hidden;
    border-radius:2px;
  }
  .brand img { width:100%; height:100%; object-fit:contain; display:block; background:linear-gradient(135deg,#00a8c5,#00916b); }
  .title h1 { margin:0; font-size:26px; line-height:1.1; letter-spacing:.25px; }
  .title p { margin:6px 0 0; color:var(--muted); font-size:14px; }
  .legend { justify-self:end; padding-top:8px; font-size:13px; }
  .legend div { display:flex; align-items:center; gap:10px; margin-bottom:9px; white-space:nowrap; font-weight:700; }
  .legend span { display:block; width:82px; height:9px; border-radius:2px; }
  .kpis { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); gap:9px; margin:9px 0 9px; }
  .kpi {
    height:54px;
    border:2px solid rgba(0,169,200,.62);
    padding:6px 10px;
    text-align:center;
    background:rgba(0,0,0,.12);
    display:flex;
    flex-direction:column;
    justify-content:center;
  }
  .kpi:first-child { border-color:rgba(255,209,72,.75); }
  .kpi small { display:block; color:var(--muted); font-weight:700; letter-spacing:.35px; font-size:12px; }
  .kpi strong { display:block; color:#fff; font-size:24px; margin-top:2px; line-height:1; }
  .section-title {
    width:100%;
    height:34px;
    background:var(--cyan-2);
    display:flex;
    align-items:center;
    gap:12px;
    padding:0 18px;
    font-weight:900;
    font-size:20px;
    letter-spacing:.9px;
    margin:8px 0 10px;
    overflow:hidden;
  }
  .section-title span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .section-icon { margin-left:auto; line-height:1; opacity:.95; flex:0 0 auto; display:inline-flex; align-items:center; }
  .report-svg-icon { width:24px; height:24px; display:block; }
  .tables { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-left:0; align-items:start; align-content:start; }
  .tables.single { grid-template-columns:minmax(0, 1fr); max-width:1080px; margin:0 auto; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:15px; align-self:start; height:auto !important; }
  tbody tr { height:27px !important; max-height:27px !important; }
  th {
    height:34px;
    background:#00a7bd;
    color:white;
    padding:5px 6px;
    border:2px solid var(--line);
    font-weight:900;
  }
  td {
    height:27px !important;
    max-height:27px !important;
    padding:3px 7px;
    border:2px solid var(--line);
    color:#e8eef5;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
    line-height:1;
    vertical-align:middle;
  }
  th:nth-child(1), td:nth-child(1){ width:38px; text-align:center; }
  th:nth-child(3), td:nth-child(3), th:nth-child(4), td:nth-child(4), th:nth-child(5), td:nth-child(5){ width:96px; text-align:center; }
  .top3 td { background:rgba(111,175,66,.95); color:#fff; font-weight:700; }
  .alert td { background:rgba(242,121,40,.95); color:#fff; }
  .normal td { background:rgba(7,25,45,.92); }
  .footer { position:absolute; bottom:12px; left:34px; right:34px; display:flex; justify-content:space-between; color:#8fa6ba; font-size:12px; }
  @page { size: landscape; margin: 0; }
  @media print {
    body { background:white; }
    .sheet { margin:0; width:100vw; height:100vh; min-height:100vh; page-break-after:always; break-after:page; }
    .sheet:last-child { page-break-after:auto; break-after:auto; }
  }
  `;
}

function atletaEstaEmAlerta(atleta, opcoes = {}) {
  const criterio = opcoes.alertaCriterio || "sem_treino_mes";
  const valor = Number(opcoes.alertaValor ?? 30);
  if (criterio === "ate_x_treinos") return Number(atleta.treinosMes || 0) <= valor;
  if (criterio === "ate_x_pontos") return Number(atleta.pontosMes || 0) <= valor;
  if (criterio === "sem_treino_30d") {
    if (!atleta.ultimaData) return true;
    const ultima = new Date(`${atleta.ultimaData}T00:00:00`);
    if (Number.isNaN(ultima.getTime())) return true;
    const diff = Math.floor((Date.now() - ultima.getTime()) / 86400000);
    return diff > (valor || 30);
  }
  return Number(atleta.treinosMes || 0) <= 0;
}

function montarTabelaRankingInformativo(titulo, lista, opcoes = {}) {
  const limite = opcoes.limite === 999 ? 999 : Number(opcoes.limite || 28);
  const filtrada = lista.filter((a, idx) => {
    const ehTop3 = idx < 3;
    const ehAlerta = atletaEstaEmAlerta(a, opcoes);
    if (ehTop3) return opcoes.mostrarTop3 !== false;
    if (ehAlerta) return opcoes.mostrarAlertas !== false;
    return opcoes.mostrarDemais !== false;
  }).slice(0, limite);

  const linhas = filtrada.map((a, idx) => {
    const posicaoReal = lista.findIndex(item => item.id === a.id) + 1;
    const classe = posicaoReal <= 3 ? "top3" : (atletaEstaEmAlerta(a, opcoes) ? "alert" : "normal");
    return `<tr class="${classe}">
      <td>${posicaoReal}</td>
      <td title="${escapeAttr(a.nome)}">${escapeHtml(a.nome)}</td>
      <td>${formatarNumero(a.pontosMes, 0)}</td>
      <td>${formatarNumero(a.treinosMes, 0)}</td>
      <td>${formatarNumero(a.kmMes, 1)}</td>
    </tr>`;
  }).join("");

  const vazio = `<tr class="normal"><td colspan="5" style="text-align:center; padding:22px; height:70px;">Nenhum atleta encontrado para os filtros escolhidos.</td></tr>`;

  return `<table>
    <thead><tr><th>ID</th><th>Atletas Energisa - ${escapeHtml(titulo)}</th><th>Pontos</th><th>Treinos</th><th>KM</th></tr></thead>
    <tbody>${linhas || vazio}</tbody>
  </table>`;
}

function gerarModoApresentacao() {
  const atletas = Object.values(appState.mapAtletas || {});
  const historico = (appState.historicoCompleto || []).filter(h => h.estornado !== true);
  if (atletas.length === 0) return showToast("Nenhum atleta carregado para montar a apresentação.", "error");

  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth() + 1;
  const mesLabel = hoje.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const cfg = obterPadraoInformativo();
  const resumo = calcularResumoRanking(atletas, historico, ano, mes);
  const bike = resumo.filter(a => normalizarEquipe(a.equipe) === "bicicleta").sort(ordenarRanking);
  const corrida = resumo.filter(a => normalizarEquipe(a.equipe) === "corrida").sort(ordenarRanking);
  const todos = [...bike, ...corrida];
  const totalPontos = todos.reduce((s, a) => s + a.pontosMes, 0);
  const totalKm = todos.reduce((s, a) => s + a.kmMes, 0);
  const totalTreinos = todos.reduce((s, a) => s + a.treinosMes, 0);
  const alertas = todos.filter(a => atletaEstaEmAlerta(a, cfg));
  const eventos = (appState.cacheEventos || []).slice(0, 5);
  const blocoTop = (titulo, lista, icone) => `<div class="slide-card"><h3>${iconSvgInformativo(icone, "slide-svg-icon")}<span>${titulo}</span></h3>${lista.slice(0,3).map((a,i)=>`<div class="rank-row"><span class="rank-medal">${iconSvgInformativo(`medal${i+1}`, "slide-medal-icon")}</span><strong>${escapeHtml(a.nome)}</strong><em>${formatarNumero(a.pontosMes,0)} pts</em></div>`).join("") || "<p>Sem dados.</p>"}</div>`;
  const logoApresentacao = new URL("assets/logos/logo-comite-branca.png", window.location.href).href;
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Modo apresentação - Atletas Energisa</title><style>
  :root{--navy:#07192d;--cyan:#00a9c8;--green:#00b37e;--orange:#f37021;--card:rgba(255,255,255,.085);--line:rgba(255,255,255,.15)}
  *{box-sizing:border-box} body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#041321;color:#fff;scroll-snap-type:y mandatory;overflow-y:auto} section{min-height:100vh;padding:46px 64px;scroll-snap-align:start;display:flex;flex-direction:column;justify-content:center;background:radial-gradient(circle at top left,rgba(0,169,200,.30),transparent 35%),linear-gradient(135deg,#07192d,#061222 68%)}
  .brand{display:flex;align-items:center;gap:18px;margin-bottom:34px}.brand img{width:190px;max-height:76px;object-fit:contain}.brand span{color:#bdd4e3;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.hero h1{font-size:56px;line-height:1;margin:0 0 12px}.hero p{font-size:22px;color:#c6d8e5;margin:0}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:34px}.kpi,.slide-card{background:var(--card);border:1px solid var(--line);border-radius:26px;padding:24px;box-shadow:0 24px 60px rgba(0,0,0,.28);backdrop-filter:blur(10px)}.kpi span{color:#aac3d4;font-weight:800;text-transform:uppercase;font-size:13px}.kpi strong{display:block;font-size:42px;margin-top:10px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.slide-card h3{font-size:30px;margin:0 0 18px;color:var(--cyan);display:flex;align-items:center;gap:10px}.slide-svg-icon{width:30px;height:30px}.slide-medal-icon{width:26px;height:26px}.rank-medal{display:inline-flex;align-items:center;justify-content:center}.rank-row{display:grid;grid-template-columns:44px minmax(0,1fr) 86px;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--line);font-size:20px}.rank-row strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rank-row em{text-align:right;font-style:normal;color:var(--cyan);font-weight:900}.alert-list{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.alert-list div{background:rgba(243,112,33,.14);border:1px solid rgba(243,112,33,.35);border-radius:14px;padding:12px 14px;color:#ffd3bd;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.event{padding:16px;border-bottom:1px solid var(--line);font-size:20px}.footer{margin-top:24px;color:#89a8bc;font-size:14px}@media(max-width:900px){section{padding:32px 22px}.hero h1{font-size:38px}.grid,.kpis,.alert-list{grid-template-columns:1fr}.brand img{width:150px}}</style></head><body>
  <section class="hero"><div class="brand"><img src="${logoApresentacao}" onerror="this.style.display='none'" alt="Atletas Energisa"><div><span>Modo apresentação</span><h1>Resumo do mês</h1><p>${escapeHtml(capitalizar(mesLabel))} · Comitê Atletas Energisa</p></div></div><div class="kpis"><div class="kpi"><span>Pontos</span><strong>${formatarNumero(totalPontos,0)}</strong></div><div class="kpi"><span>Treinos</span><strong>${formatarNumero(totalTreinos,0)}</strong></div><div class="kpi"><span>KM</span><strong>${formatarNumero(totalKm,1)}</strong></div><div class="kpi"><span>Alertas</span><strong>${alertas.length}</strong></div></div></section>
  <section><div class="grid">${blocoTop("Top 3 Bike", bike, "bike")}${blocoTop("Top 3 Corrida", corrida, "run")}</div></section>
  <section><div class="slide-card"><h3>${iconSvgInformativo("alert", "slide-svg-icon")}<span>Atletas em alerta</span></h3><div class="alert-list">${alertas.slice(0,20).map(a=>`<div>${escapeHtml(a.nome)} · ${formatarNumero(a.treinosMes,0)} treinos</div>`).join("") || "<p>Nenhum atleta em alerta pelo critério atual.</p>"}</div></div></section>
  <section><div class="slide-card"><h3>${iconSvgInformativo("calendar", "slide-svg-icon")}<span>Próximos eventos</span></h3>${eventos.map(e=>`<div class="event"><strong>${escapeHtml(e.titulo || "Evento")}</strong><br><span>${escapeHtml(e.data || "Sem data")} · ${escapeHtml(e.local || e.localidade || "Local não informado")}</span></div>`).join("") || "<p>Nenhum evento cadastrado.</p>"}<div class="footer">Use Page Down / barra de espaço ou role a tela para avançar.</div></div></section>
</body></html>`;
  abrirHtmlNovaAba(html, false);
  showToast("Modo apresentação aberto em nova aba.", "success");
}

function abrirHtmlNovaAba(html, imprimir = false) {
  const htmlFinal = imprimir
    ? html.replace("</body>", "<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},700);});<\/script></body>")
    : html;
  const blob = new Blob([htmlFinal], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const janela = window.open(url, "_blank", "noopener,noreferrer");
  if (!janela) showToast("O navegador bloqueou a abertura em nova aba.", "error");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function baixarHtml(nomeArquivo, html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nomeArquivo}_${new Date().toISOString().slice(0,10)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ordenarRanking(a, b) {
  return (b.pontosMes - a.pontosMes) || (b.treinosMes - a.treinosMes) || (b.kmMes - a.kmMes) || String(a.nome).localeCompare(String(b.nome));
}

function normalizarEquipe(equipe) {
  return String(equipe || "").trim().toLowerCase();
}

function calcularDiasUteisMes(ano, mes) {
  let count = 0;
  const ultimo = new Date(ano, mes, 0).getDate();
  for (let dia = 1; dia <= ultimo; dia++) {
    const d = new Date(ano, mes - 1, dia).getDay();
    if (d !== 0 && d !== 6) count++;
  }
  return count;
}

function formatarNumero(valor, casas = 0) {
  return Number(valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function capitalizar(txt) {
  return String(txt || "").replace(/^./, c => c.toUpperCase());
}

function baixarCsv(nomeArquivo, linhas) {
  if (!Array.isArray(linhas) || linhas.length === 0) return;

  const colunas = Object.keys(linhas[0]);
  const csv = [
    colunas.map(valorCsv).join(";"),
    ...linhas.map(linha => colunas.map(c => valorCsv(linha[c])).join(";"))
  ].join("\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nomeArquivo}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function valorCsv(valor) {
  const texto = String(valor ?? "").replaceAll('"', '""');
  return `"${texto}"`;
}

function setTexto(id, valor) {
  const el = document.getElementById(id);
  if (el) el.textContent = valor;
}

function setupTabsFichaAtleta() {
  document.querySelectorAll(".ficha-tab").forEach(btn => {
    if (btn.dataset.listenerAplicado) return;
    btn.dataset.listenerAplicado = "1";
    btn.addEventListener("click", () => ativarAbaFicha(btn.dataset.fichaTab));
  });
}

function ativarAbaFicha(tab) {
  document.querySelectorAll(".ficha-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.fichaTab === tab);
  });
  document.querySelectorAll(".ficha-tab-content").forEach(panel => {
    panel.classList.toggle("active", panel.id === `ficha-tab-${tab}`);
  });
  if(typeof lucide !== 'undefined') lucide.createIcons();
}

function fecharFichaAtleta() {
  const modal = document.getElementById("modalFichaAtleta");
  if (modal) {
    modal.style.display = "none";
    const shell = modal.querySelector(".ficha-modal-shell");
    if (shell) { shell.style.width = ""; shell.style.height = ""; }
  }
  document.body.classList.remove("modal-open");
  document.documentElement.classList.remove("modal-open");
}

function abrirModalFichaAtletaSeguro() {
  const modal = document.getElementById("modalFichaAtleta");
  if (!modal) return;
  document.body.classList.add("modal-open");
  document.documentElement.classList.add("modal-open");
  // Mover para body (garante que escapa do grid-context)
  if (modal.parentElement !== document.body) document.body.appendChild(modal);
  modal.style.cssText = "display:flex; position:fixed; top:0; left:0; width:100%; height:100%;";
  const shell = modal.querySelector(".ficha-modal-shell");
  if (shell) {
    const w = Math.min(window.innerWidth * 0.9, 1400);
    const h = Math.min(window.innerHeight * 0.88, 900);
    shell.style.width = w + "px";
    shell.style.height = h + "px";
  }
}

function setupFichaAtleta() {
  const modal = document.getElementById("modalFichaAtleta");
  const btnFechar = document.getElementById("fecharModalFicha");
  if(btnFechar && !btnFechar.dataset.listenerAplicado) {
    btnFechar.dataset.listenerAplicado = "1";
    btnFechar.addEventListener("click", fecharFichaAtleta);
  }

  if(modal && !modal.dataset.backdropListenerAplicado) {
    modal.dataset.backdropListenerAplicado = "1";
    modal.addEventListener("click", (e) => {
      if(e.target === modal) fecharFichaAtleta();
    });
  }

  if(!document.body.dataset.fichaEscListenerAplicado) {
    document.body.dataset.fichaEscListenerAplicado = "1";
    document.addEventListener("keydown", (e) => {
      if(e.key === "Escape" && document.getElementById("modalFichaAtleta")?.style.display === "flex") {
        fecharFichaAtleta();
      }
    });
  }

  setupTabsFichaAtleta();

  const btnComentario = document.getElementById("btnSalvarComentario");
  if(btnComentario && !btnComentario.dataset.listenerAplicado) {
    btnComentario.dataset.listenerAplicado = "1";
    btnComentario.addEventListener("click", async () => {
      const aId = document.getElementById("fichaAtletaId")?.value;
      const txt = document.getElementById("novoComentarioFicha")?.value.trim();
      if(!aId || !txt) return;

      const meuNome = appState.mapAtletas[auth.currentUser?.uid]
        ? appState.mapAtletas[auth.currentUser.uid].nome
        : "Comitê Gestor";

      btnComentario.disabled = true;
      btnComentario.textContent = "Salvando...";
      try {
        await addDoc(collection(db, "comentarios_atletas"), {
          atletaId: aId,
          texto: txt,
          autorNome: meuNome,
          criadoEm: new Date().toISOString()
        });
        document.getElementById("novoComentarioFicha").value = "";
        await carregarComentarios(aId);
        showToast("Comentário salvo!", "success");
      } catch(e) {
        showToast("Erro ao salvar comentário.", "error");
      } finally {
        btnComentario.disabled = false;
        btnComentario.textContent = "Adicionar Comentário";
      }
    });
  }

  const btnStatus = document.getElementById("btnSalvarStatusFicha");
  if(btnStatus && !btnStatus.dataset.listenerAplicado) {
    btnStatus.dataset.listenerAplicado = "1";
    btnStatus.addEventListener("click", salvarStatusFichaAtleta);
  }

  const btnCampos = document.getElementById("btnSalvarCamposFichaModelo");
  if(btnCampos && !btnCampos.dataset.listenerAplicado) {
    btnCampos.dataset.listenerAplicado = "1";
    btnCampos.addEventListener("click", salvarCamposModeloFicha);
  }
}

async function abrirFichaAtleta(id) { 
  const a = appState.mapAtletas[id]; 
  if(!a) return; 

  ativarAbaFicha("resumo");
  const avatarMini = document.getElementById("fichaAvatarMini");
  if(avatarMini) avatarMini.textContent = getIniciais(a.nome);

  document.getElementById("fichaNome").textContent = a.nome; 
  document.getElementById("fichaEquipe").textContent = a.equipe; 
  document.getElementById("fichaPontos").textContent = a.pontuacaoTotal || 0; 
  if(document.getElementById("fichaKm")) document.getElementById("fichaKm").textContent = `${formatarKm(calcularKmAtleta(id))} km`; 

  const renderCampo = (idEl, val, fallback) => { if(document.getElementById(idEl)) document.getElementById(idEl).textContent = val || fallback; };
  renderCampo("fichaEquipeInfo", a.equipe, "Não informada");
  renderCampo("fichaLocalidade", a.localidade, "Não informada");
  renderCampo("fichaNasc", a.dataNascimento ? new Date(a.dataNascimento+"T00:00:00").toLocaleDateString('pt-BR') : "Não informada", ""); 
  renderCampo("fichaSexo", a.sexo, "Não informado"); 
  renderCampo("fichaAnoEntrada", a.anoEntrada, "-");

  const statusEl = document.getElementById("fichaStatus"); 
  const ativo = a.ativo !== false;
  if(statusEl) {
    if(ativo) { statusEl.textContent = "Ativo"; statusEl.style.color = "var(--secondary)"; } 
    else { statusEl.textContent = `Inativo`; statusEl.style.color = "var(--danger)"; } 
  }

  const toggleAtivo = document.getElementById("fichaToggleAtivo");
  if(toggleAtivo) toggleAtivo.checked = ativo;
  const motivo = document.getElementById("fichaMotivoStatus");
  if(motivo) motivo.value = a.motivoSaida || a.motivoStatus || "";
  document.getElementById("fichaAtletaId").value = id; 

  renderHistoricoStatusFicha(a);
  renderCamposModeloFicha(a);

  const hist = appState.historicoCompleto.filter(h => h.atletaId === id); 
  let htmlH = ""; 
  if(hist.length === 0) htmlH = "<p style='color:#999; margin-top: 10px;'>Nenhum registro encontrado.</p>"; 
  hist.forEach(h => { 
    const dataF = new Date(h.dataTreino+"T00:00:00").toLocaleDateString('pt-BR'); 
    const isFalta = Number(h.pontos) === 0; 
    const cor = isFalta ? "var(--accent)" : "var(--secondary)"; 
    const ptsStr = isFalta ? "Falta Justificada" : `+${h.pontos} pts`; 
    const kmInfo = Number(h.kmPercorrido || 0) > 0 ? `<br><small style="color:var(--primary);">${formatarKm(h.kmPercorrido)} km</small>` : "";
    htmlH += `<div style="border-bottom: 1px solid var(--border); padding: 8px 0; display:flex; justify-content:space-between; align-items:center; gap:10px;"><div><strong>${dataF}</strong> - ${escapeHtml(h.descTreino || "-")}<br><small style="color:#666;">${escapeHtml(h.regraDesc || "-")}</small>${kmInfo}</div><div style="color:${cor}; font-weight:bold; text-align:right; white-space:nowrap;">${ptsStr}</div></div>`; 
  }); 
  document.getElementById("fichaHistorico").innerHTML = htmlH; 
  await carregarComentarios(id); 
  await carregarAuditoriaFicha(id);
  abrirModalFichaAtletaSeguro(); 
  if(typeof lucide !== 'undefined') lucide.createIcons();
}

function renderHistoricoStatusFicha(atleta) {
  const div = document.getElementById("fichaHistoricoStatus");
  if(!div) return;
  const hist = Array.isArray(atleta.historicoStatus) ? [...atleta.historicoStatus] : [];
  hist.sort((a,b) => new Date(b.data || "1970-01-01") - new Date(a.data || "1970-01-01"));
  const ultimos = hist.slice(0, 4);
  if(ultimos.length === 0) {
    div.innerHTML = `<small style="color:var(--text-light);">Nenhuma alteração de status registrada ainda.</small>`;
    return;
  }
  div.innerHTML = `<strong style="font-size:.78rem; color:var(--text);">Histórico de status</strong>` + ultimos.map(h => {
    const data = h.data ? new Date(h.data).toLocaleDateString('pt-BR') + " " + new Date(h.data).toLocaleTimeString('pt-BR').slice(0,5) : "-";
    return `<div class="ficha-status-history-item"><strong>${h.ativo ? "Ativado" : "Desativado"}</strong> · ${data}<br>${escapeHtml(h.motivo || "Sem justificativa registrada")}</div>`;
  }).join("");
}

function renderCamposModeloFicha(atleta) {
  const lista = document.getElementById("fichaCamposModeloLista");
  if(!lista) return;

  const campos = Array.isArray(appState.camposFichaConfig) ? appState.camposFichaConfig : [];
  const valores = atleta.camposFicha || {};

  if(campos.length === 0) {
    lista.innerHTML = `<small style="color:var(--text-light); grid-column:1/-1;">Nenhum campo adicional foi configurado. Vá em Ajustes > Modelo da ficha para definir a estrutura da ficha.</small>`;
    return;
  }

  let grupoAtual = null;
  let html = "";
  campos.forEach(campo => {
    const grupo = campo.grupo || "Informações adicionais";
    if(grupo !== grupoAtual) {
      grupoAtual = grupo;
      html += `<div class="ficha-modelo-grupo">${escapeHtml(grupo)}</div>`;
    }
    html += renderCampoModeloInput(campo, valores[campo.id]);
  });

  lista.innerHTML = html;
}

function renderCampoModeloInput(campo, valorAtual) {
  const required = campo.obrigatorio ? "required" : "";
  const base = `data-campo-id="${escapeAttr(campo.id)}" data-campo-label="${escapeAttr(campo.label || '')}"`;
  const label = `<label>${escapeHtml(campo.label || "Campo")}</label>`;
  const valor = valorAtual ?? "";
  let input = "";

  if(campo.tipo === "numero") {
    input = `<input type="number" ${base} value="${escapeAttr(valor)}" ${required} />`;
  } else if(campo.tipo === "data") {
    input = `<input type="date" ${base} value="${escapeAttr(valor)}" ${required} />`;
  } else if(campo.tipo === "simnao") {
    input = `<select ${base} ${required}><option value="">Selecione</option><option value="Sim" ${valor === 'Sim' ? 'selected' : ''}>Sim</option><option value="Não" ${valor === 'Não' ? 'selected' : ''}>Não</option></select>`;
  } else if(campo.tipo === "selecao") {
    const opcoes = Array.isArray(campo.opcoes) ? campo.opcoes : [];
    input = `<select ${base} ${required}><option value="">Selecione</option>${opcoes.map(op => `<option value="${escapeAttr(op)}" ${String(valor) === String(op) ? 'selected' : ''}>${escapeHtml(op)}</option>`).join("")}</select>`;
  } else {
    input = `<input type="text" ${base} value="${escapeAttr(valor)}" ${required} />`;
  }

  return `<div class="ficha-modelo-field ${campo.obrigatorio ? 'required' : ''}">${label}${input}</div>`;
}

async function salvarCamposModeloFicha() {
  const id = document.getElementById("fichaAtletaId")?.value;
  if(!id) return;

  const campos = Array.isArray(appState.camposFichaConfig) ? appState.camposFichaConfig : [];
  const valores = {};

  for(const campo of campos) {
    const el = document.querySelector(`#fichaCamposModeloLista [data-campo-id="${CSS.escape(campo.id)}"]`);
    const valor = el ? String(el.value || "").trim() : "";
    if(campo.obrigatorio && !valor) return showToast(`Preencha o campo obrigatório: ${campo.label}`, "error");
    valores[campo.id] = valor;
  }

  try {
    const anteriores = appState.mapAtletas[id]?.camposFicha || {};
    await updateDoc(doc(db, "atletas", id), { camposFicha: valores, atualizadoEm: new Date().toISOString() });
    await registrarAuditoria("campos_ficha_atualizados", "atletas", id, { antes: anteriores, depois: valores });
    if(appState.mapAtletas[id]) appState.mapAtletas[id].camposFicha = valores;
    showToast("Campos da ficha salvos.", "success");
  } catch(err) {
    showToast("Erro ao salvar campos da ficha: " + err.message, "error");
  }
}

async function salvarStatusFichaAtleta() {
  const id = document.getElementById("fichaAtletaId")?.value;
  const ativo = document.getElementById("fichaToggleAtivo")?.checked;
  const motivo = document.getElementById("fichaMotivoStatus")?.value.trim() || "";
  if(!id) return;

  if(ativo === false && !motivo) {
    return showToast("Informe uma justificativa para desativar o atleta.", "error");
  }

  try {
    const antes = appState.mapAtletas[id]?.ativo !== false;
    const historicoStatus = Array.isArray(appState.mapAtletas[id]?.historicoStatus) ? [...appState.mapAtletas[id].historicoStatus] : [];
    const registroStatus = {
      ativo,
      motivo: motivo || (ativo ? "Reativação" : "Desativação"),
      data: new Date().toISOString(),
      responsavel: auth.currentUser?.uid || ""
    };
    historicoStatus.push(registroStatus);

    await updateDoc(doc(db, "atletas", id), {
      ativo,
      motivoSaida: ativo ? "" : motivo,
      motivoStatus: motivo,
      statusAtualizadoEm: registroStatus.data,
      statusAtualizadoPor: auth.currentUser?.uid || "",
      historicoStatus
    });
    await registrarAuditoria("status_atleta_atualizado", "atletas", id, { antes, depois: ativo, motivo });
    if(appState.mapAtletas[id]) {
      appState.mapAtletas[id].ativo = ativo;
      appState.mapAtletas[id].motivoSaida = ativo ? "" : motivo;
      appState.mapAtletas[id].motivoStatus = motivo;
      appState.mapAtletas[id].historicoStatus = historicoStatus;
    }
    showToast("Status atualizado.", "success");
    await abrirFichaAtleta(id);
    atualizarTelas();
  } catch(err) { showToast("Erro ao atualizar status: " + err.message, "error"); }
}


async function carregarAuditoriaFicha(id) {
  const lista = document.getElementById("fichaAuditoriaLista");
  if(!lista) return;

  try {
    const snap = await getDocs(collection(db, "auditoria"));
    const itens = [];
    snap.forEach(d => {
      const item = { id: d.id, ...d.data() };
      const dados = item.dados || {};
      const relacionado =
        item.entidadeId === id ||
        dados.atletaId === id ||
        dados.atleta === id ||
        dados.atletaIdRemovido === id ||
        dados.atletaIdAdicionado === id ||
        (dados.antes && dados.antes.atletaId === id) ||
        (dados.depois && dados.depois.atletaId === id);
      if(relacionado) itens.push(item);
    });

    itens.sort((a,b) => new Date(b.criadoEm || "1970-01-01") - new Date(a.criadoEm || "1970-01-01"));

    if(itens.length === 0) {
      lista.innerHTML = `<div class="empty-state" style="padding:18px;"><p>Nenhuma auditoria relacionada a este atleta.</p></div>`;
      return;
    }

    lista.innerHTML = itens.slice(0, 25).map(item => {
      const data = item.criadoEm ? new Date(item.criadoEm).toLocaleString('pt-BR') : "-";
      return `<div class="ficha-audit-item">
        <small>${escapeHtml(data)}</small>
        <div><strong>${escapeHtml(item.acao || "ação")}</strong><br><small>${escapeHtml(item.entidade || "-")} ${item.entidadeId ? "• " + escapeHtml(item.entidadeId) : ""}</small></div>
        <small>${escapeHtml(item.criadoPorNome || "Usuário")}</small>
      </div>`;
    }).join("");
  } catch(err) {
    lista.innerHTML = `<div class="empty-state" style="padding:18px;"><p>Sem permissão ou erro ao carregar auditoria.</p></div>`;
  }
}


async function carregarComentarios(id) { 
  try { 
    const snap = await getDocs(query(collection(db, "comentarios_atletas"), where("atletaId", "==", id))); 
    let coments = []; snap.forEach(d => coments.push(d.data())); coments.sort((a,b) => new Date(b.criadoEm) - new Date(a.criadoEm)); 
    let html = ""; 
    coments.forEach(c => { 
      const d = new Date(c.criadoEm).toLocaleDateString('pt-BR') + " às " + new Date(c.criadoEm).toLocaleTimeString('pt-BR').substring(0,5); 
      html += `<div class="comentario-box"><div class="comentario-header"><span class="comentario-autor">${c.autorNome}</span> <span>${d}</span></div><div style="margin-top: 4px;">${c.texto}</div></div>`; 
    }); 
    document.getElementById("fichaComentariosLista").innerHTML = html || "<p style='color:#999; font-size:0.85rem;'>Nenhum comentário registado.</p>"; 
  } catch(e) { document.getElementById("fichaComentariosLista").innerHTML = "<p style='color:red; font-size:0.85rem;'>Sem permissão para ler.</p>"; } 
}

async function setupAprovacoes() { 
  const tbody = document.getElementById("listaAprovacoes"); if (!tbody) return; 
  const snap = await getDocs(query(collection(db, "atletas"), where("status", "==", "Pendente"))); 
  tbody.innerHTML = ""; 
  if (snap.empty) { tbody.innerHTML = "<tr><td colspan='4'>Nenhuma pendência.</td></tr>"; return; } 
  snap.forEach(d => { 
    const u = d.data(); 
    tbody.innerHTML += `<tr><td data-label="Nome"><strong>${u.nome}</strong></td><td data-label="E-mail">${u.email}</td><td data-label="Ação"><button class="btn-acao btn-aprovar" data-id="${d.id}" style="color:var(--secondary); border-color:var(--secondary); margin-right:5px;">Aprovar</button><button class="btn-acao btn-rejeitar" data-id="${d.id}" style="color:var(--danger); border-color:var(--danger);">Rejeitar</button></td></tr>`; 
  }); 
  
  document.querySelectorAll(".btn-aprovar").forEach(btn => btn.addEventListener("click", async (e) => { 
    mostrarConfirmacao("Aprovar Acesso", "Confirmar o acesso administrativo deste membro?", async () => {
      e.currentTarget.disabled = true; await updateDoc(doc(db, "atletas", e.currentTarget.dataset.id), { status: "Aprovado" }); atualizarTelas(); 
    });
  })); 
  document.querySelectorAll(".btn-rejeitar").forEach(btn => btn.addEventListener("click", async (e) => { 
    mostrarConfirmacao("Rejeitar Pedido", "Negar e excluir o pedido de acesso?", async () => {
      e.currentTarget.disabled = true; await deleteDoc(doc(db, "atletas", e.currentTarget.dataset.id)); atualizarTelas(); 
    }, "danger");
  })); 
}

function setupModalEditar() { 
  const modal = document.getElementById("modalEditarAtleta"); 
  document.getElementById("fecharModalEdit")?.addEventListener("click", () => modal.style.display = "none"); 
  document.getElementById("salvarEditBtn")?.addEventListener("click", async (e) => { 
    const id = document.getElementById("editId").value; const nome = document.getElementById("editNome").value.trim(); const email = document.getElementById("editEmail").value.trim(); const papel = document.getElementById("editPapel").value; 
    const sexo = document.getElementById("editSexo").value; const nasc = document.getElementById("editNasc").value; const localidade = document.getElementById("editLocalidade").value.trim(); const anoEntrada = document.getElementById("editAnoEntrada").value;
    
    if (!nome) return; 
    const cadastroAtual = appState.mapAtletas[id] || {};
    if (appState.userRole !== "admin" && (papel === "Comitê" || cadastroAtual.role === "admin" || cadastroAtual.role === "comite")) {
      showToast("Apenas administradores podem alterar perfis de acesso ou membros do comitê.", "error");
      return;
    }

    let role = "atleta"; 
    let equipe = papel; 
    if (papel === "Comitê") { role = "comite"; equipe = "Nenhuma"; } 
    e.target.textContent = "Salvando..."; e.target.classList.add("loading"); e.target.disabled = true; 
    
    try { 
      await updateDoc(doc(db, "atletas", id), { nome, email, role, equipe, sexo, dataNascimento: nasc, localidade, anoEntrada }); 
      showToast("Cadastro do atleta atualizado com sucesso!", "success"); modal.style.display = "none"; atualizarTelas(); fecharFichaAtleta();
    } catch (err) { showToast("Erro ao editar dados.", "error"); } 
    finally { e.target.textContent = "Salvar Alterações"; e.target.classList.remove("loading"); e.target.disabled = false; }
  }); 
}


// =====================================================
// 🧩 MODELO CONFIGURÁVEL DA FICHA DO ATLETA
// =====================================================
function setupCamposFichaConfig() {
  const btn = document.getElementById("btnAdicionarCampoFichaConfig");
  if(btn && !btn.dataset.listenerAplicado) {
    btn.dataset.listenerAplicado = "1";
    btn.addEventListener("click", criarCampoFichaConfig);
  }
}

async function carregarCamposFichaConfig() {
  try {
    const snap = await getDocs(collection(db, "campos_ficha"));
    appState.camposFichaConfig = [];
    snap.forEach(d => appState.camposFichaConfig.push({ id: d.id, ...d.data() }));
    appState.camposFichaConfig.sort((a,b) => (Number(a.ordem) || 999) - (Number(b.ordem) || 999) || String(a.label || "").localeCompare(String(b.label || "")));
    renderConfigCamposFicha();
  } catch(err) {
    console.warn("Erro ao carregar campos da ficha:", err);
    appState.camposFichaConfig = [];
  }
}

async function criarCampoFichaConfig() {
  const label = document.getElementById("cfgCampoFichaLabel")?.value.trim();
  const tipo = document.getElementById("cfgCampoFichaTipo")?.value || "texto";
  const grupo = document.getElementById("cfgCampoFichaGrupo")?.value.trim() || "Informações adicionais";
  const opcoesTexto = document.getElementById("cfgCampoFichaOpcoes")?.value.trim() || "";
  const obrigatorio = document.getElementById("cfgCampoFichaObrigatorio")?.checked || false;

  if(!label) return showToast("Informe o nome do campo.", "error");
  if(tipo === "selecao" && !opcoesTexto) return showToast("Informe as opções para campos do tipo Seleção.", "error");

  const ordem = (appState.camposFichaConfig || []).length + 1;
  const opcoes = opcoesTexto ? opcoesTexto.split(",").map(x => x.trim()).filter(Boolean) : [];

  try {
    const refCampo = await addDoc(collection(db, "campos_ficha"), {
      label,
      tipo,
      grupo,
      opcoes,
      obrigatorio,
      ordem,
      ativo: true,
      criadoEm: new Date().toISOString(),
      criadoPor: auth.currentUser?.uid || ""
    });
    await registrarAuditoria("campo_ficha_criado", "campos_ficha", refCampo.id, { label, tipo, grupo, obrigatorio });
    document.getElementById("cfgCampoFichaLabel").value = "";
    document.getElementById("cfgCampoFichaGrupo").value = "";
    document.getElementById("cfgCampoFichaOpcoes").value = "";
    document.getElementById("cfgCampoFichaObrigatorio").checked = false;
    await carregarCamposFichaConfig();
    showToast("Campo adicionado ao modelo da ficha.", "success");
  } catch(err) {
    showToast("Erro ao adicionar campo: " + err.message, "error");
  }
}

function renderConfigCamposFicha() {
  const lista = document.getElementById("listaCamposFichaConfig");
  if(!lista) return;
  const campos = appState.camposFichaConfig || [];

  if(campos.length === 0) {
    lista.innerHTML = `<div class="empty-state" style="padding:20px;"><i data-lucide="clipboard-list"></i><p>Nenhum campo configurado ainda.</p></div>`;
    if(typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  lista.innerHTML = campos.map(campo => {
    const opcoes = Array.isArray(campo.opcoes) && campo.opcoes.length ? campo.opcoes.join(", ") : "-";
    return `
      <div class="config-ficha-item">
        <div><strong>${escapeHtml(campo.label || "Campo")}</strong><br><small>${campo.obrigatorio ? "Obrigatório" : "Opcional"}</small></div>
        <span class="campo-tipo-badge">${escapeHtml(rotuloTipoCampo(campo.tipo))}</span>
        <small>${escapeHtml(campo.grupo || "Informações adicionais")}</small>
        <small>${escapeHtml(opcoes)}</small>
        <div style="display:flex; gap:6px; justify-content:flex-end;">
          <button class="btn-acao btn-campo-up" data-id="${campo.id}" title="Subir" style="padding:6px;"><i data-lucide="arrow-up" style="width:15px;"></i></button>
          <button class="btn-acao btn-campo-down" data-id="${campo.id}" title="Descer" style="padding:6px;"><i data-lucide="arrow-down" style="width:15px;"></i></button>
          <button class="btn-acao btn-campo-del" data-id="${campo.id}" title="Excluir" style="padding:6px; color:var(--danger);"><i data-lucide="trash-2" style="width:15px;"></i></button>
        </div>
      </div>`;
  }).join("");

  lista.querySelectorAll(".btn-campo-del").forEach(btn => {
    btn.addEventListener("click", () => {
      mostrarConfirmacao("Excluir campo", "Remover este campo do modelo da ficha? Os valores já preenchidos nos atletas não serão apagados, mas deixarão de aparecer.", async () => {
        try {
          await deleteDoc(doc(db, "campos_ficha", btn.dataset.id));
          await registrarAuditoria("campo_ficha_excluido", "campos_ficha", btn.dataset.id, {});
          await carregarCamposFichaConfig();
          showToast("Campo removido do modelo.", "success");
        } catch(err) { showToast("Erro ao remover campo: " + err.message, "error"); }
      }, "danger");
    });
  });

  lista.querySelectorAll(".btn-campo-up").forEach(btn => btn.addEventListener("click", () => moverCampoFicha(btn.dataset.id, -1)));
  lista.querySelectorAll(".btn-campo-down").forEach(btn => btn.addEventListener("click", () => moverCampoFicha(btn.dataset.id, 1)));

  if(typeof lucide !== 'undefined') lucide.createIcons();
}

async function moverCampoFicha(id, direcao) {
  const campos = [...(appState.camposFichaConfig || [])];
  const idx = campos.findIndex(c => c.id === id);
  const novoIdx = idx + direcao;
  if(idx < 0 || novoIdx < 0 || novoIdx >= campos.length) return;
  const atual = campos[idx];
  const outro = campos[novoIdx];
  const ordemAtual = Number(atual.ordem) || idx + 1;
  const ordemOutro = Number(outro.ordem) || novoIdx + 1;
  try {
    await updateDoc(doc(db, "campos_ficha", atual.id), { ordem: ordemOutro });
    await updateDoc(doc(db, "campos_ficha", outro.id), { ordem: ordemAtual });
    await registrarAuditoria("campo_ficha_reordenado", "campos_ficha", atual.id, { trocouCom: outro.id, direcao });
    await carregarCamposFichaConfig();
  } catch(err) { showToast("Erro ao reordenar campo: " + err.message, "error"); }
}

function rotuloTipoCampo(tipo) {
  return { texto: "Texto", numero: "Número", data: "Data", selecao: "Seleção", simnao: "Sim/Não" }[tipo] || "Texto";
}

// =====================================================
// ⚙️ GESTÃO DE REGRAS DE PONTUAÇÃO
// =====================================================
function setupModalRegras() {
  const modal = document.getElementById("modalRegra");
  if (!modal) return;

  document.getElementById("abrirModalRegra")?.addEventListener("click", () => {
    document.getElementById("regraEditId").value = "";
    document.getElementById("regraDescricao").value = "";
    document.getElementById("regraModalidade").value = "Ambas";
    document.getElementById("regraPontos").value = "";
    document.querySelectorAll(".chk-tipo-regra").forEach(chk => chk.checked = true);
    renderizarVinculosRegras([]);
    modal.style.display = "flex";
  });

  document.getElementById("fecharModalRegra")?.addEventListener("click", () => modal.style.display = "none");

  document.getElementById("salvarRegraBtn")?.addEventListener("click", async (e) => {
    const id = document.getElementById("regraEditId").value;
    const desc = document.getElementById("regraDescricao").value.trim();
    const mod = document.getElementById("regraModalidade").value;
    const pts = Number(document.getElementById("regraPontos").value);

    if (!desc || isNaN(pts)) return showToast("Preencha a descrição e defina os pontos!", "error");

    const vinculadas = [];
    document.querySelectorAll(".chk-vinculo-regra:checked").forEach(chk => vinculadas.push(chk.value));

    const tiposLancamento = [];
    document.querySelectorAll(".chk-tipo-regra:checked").forEach(chk => tiposLancamento.push(chk.value));
    if (tiposLancamento.length === 0) return showToast("Selecione pelo menos um tipo de lançamento para a regra.", "error");

    e.target.disabled = true;
    e.target.textContent = "Salvando...";
    e.target.classList.add("loading");

    try {
      const dados = {
        descricao: desc,
        modalidade: mod,
        pontos: pts,
        regrasVinculadas: vinculadas,
        tiposLancamento,
        atualizadoEm: new Date().toISOString()
      };

      if (id) {
        await updateDoc(doc(db, "regras_pontuacao", id), dados);
        await registrarAuditoria("regra_pontuacao_atualizada", "regras_pontuacao", id, dados);
        showToast("Regra atualizada com sucesso!", "success");
      } else {
        dados.criadoEm = new Date().toISOString();
        const refRegra = await addDoc(collection(db, "regras_pontuacao"), dados);
        await registrarAuditoria("regra_pontuacao_criada", "regras_pontuacao", refRegra.id, dados);
        showToast("Nova regra criada!", "success");
      }

      modal.style.display = "none";
      await carregarRegras();
    } catch (err) {
      showToast("Erro ao salvar regra: " + err.message, "error");
    } finally {
      e.target.disabled = false;
      e.target.textContent = "Salvar Regra";
      e.target.classList.remove("loading");
    }
  });
}

async function carregarRegras() {
  try {
    const snap = await getDocs(query(collection(db, "regras_pontuacao")));
    appState.listaTodasRegras = [];
    snap.forEach(d => appState.listaTodasRegras.push({ id: d.id, ...d.data() }));

    const tbody = document.getElementById("listaRegras");
    if (!tbody) return;

    let html = "";

    if (appState.listaTodasRegras.length === 0) {
      html = "<tr><td colspan='5' style='text-align:center;'>Nenhuma regra cadastrada.</td></tr>";
    } else {
      appState.listaTodasRegras.forEach(r => {
        const tipos = Array.isArray(r.tiposLancamento) && r.tiposLancamento.length ? r.tiposLancamento : ["treino", "evento", "avulso"];
        const tiposTxt = tipos.map(t => ({treino:"Treino", evento:"Evento", avulso:"Avulso"}[t] || t)).join(", ");
        html += `
          <tr>
            <td data-label="Regra"><strong>${escapeHtml(r.descricao)}</strong></td>
            <td data-label="Modalidade">${escapeHtml(r.modalidade || "-")}</td>
            <td data-label="Tipos"><small>${escapeHtml(tiposTxt)}</small></td>
            <td data-label="Pontos" style="color:var(--primary); font-weight:bold;">+${Number(r.pontos) || 0}</td>
            <td data-label="Ações" style="text-align:right;">
              <button class="btn-acao btn-edit-regra" aria-label="Editar Regra" data-id="${r.id}" style="color:var(--primary); padding:6px; margin-right:5px;"><i data-lucide="edit-2" style="width:16px;"></i></button>
              <button class="btn-acao btn-del-regra" aria-label="Excluir Regra" data-id="${r.id}" style="color:var(--danger); padding:6px;"><i data-lucide="trash" style="width:16px;"></i></button>
            </td>
          </tr>`;
      });
    }

    tbody.innerHTML = html;
    if(typeof lucide !== 'undefined') lucide.createIcons();

    document.querySelectorAll(".btn-del-regra").forEach(btn => {
      btn.addEventListener("click", (e) => {
        mostrarConfirmacao("Apagar Regra", "Deseja realmente excluir esta regra? Isso pode afetar lançamentos futuros.", async () => {
          await deleteDoc(doc(db, "regras_pontuacao", e.currentTarget.dataset.id));
          await registrarAuditoria("regra_pontuacao_excluida", "regras_pontuacao", e.currentTarget.dataset.id, {});
          await carregarRegras();
          showToast("Regra removida", "info");
        }, "danger");
      });
    });

    document.querySelectorAll(".btn-edit-regra").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const r = appState.listaTodasRegras.find(x => x.id === e.currentTarget.dataset.id);
        if(!r) return;

        document.getElementById("regraEditId").value = r.id;
        document.getElementById("regraDescricao").value = r.descricao || "";
        document.getElementById("regraModalidade").value = r.modalidade || "Ambas";
        document.getElementById("regraPontos").value = r.pontos || 0;

        const tipos = Array.isArray(r.tiposLancamento) && r.tiposLancamento.length ? r.tiposLancamento : ["treino", "evento", "avulso"];
        document.querySelectorAll(".chk-tipo-regra").forEach(chk => chk.checked = tipos.includes(chk.value));

        renderizarVinculosRegras(r.regrasVinculadas || [], r.id);
        document.getElementById("modalRegra").style.display = "flex";
      });
    });
  } catch (err) {
    console.error("Erro ao carregar regras:", err);
  }
}

function renderizarVinculosRegras(selecionadas = [], idIgnorado = null) {
  const div = document.getElementById("listaVinculosRegras");
  if (!div) return;

  let html = "";
  (appState.listaTodasRegras || []).forEach(r => {
    if (r.id === idIgnorado) return;
    const checked = selecionadas.includes(r.id) ? "checked" : "";
    html += `<label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;"><input type="checkbox" class="chk-vinculo-regra" value="${r.id}" ${checked}> <span style="color:var(--text);">${escapeHtml(r.descricao || "-")}</span></label>`;
  });

  div.innerHTML = html || "<small style='color:var(--text-light);'>Nenhuma outra regra cadastrada ainda.</small>";
}

// ── Dropdown de exportação ────────────────────────────
function setupExportDropdown() {
  const drop = document.getElementById("vgExportDrop");
  const btn  = document.getElementById("btnExportarDropdown");
  if (!drop || !btn) return;

  const toggle = (force) => {
    const open = force !== undefined ? force : drop.dataset.open !== "true";
    drop.dataset.open = open;
    btn.setAttribute("aria-expanded", open);
  };

  btn.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });

  // Fecha ao clicar fora
  document.addEventListener("click", () => toggle(false));
  drop.addEventListener("click", (e) => e.stopPropagation());

  // Fecha ao pressionar Escape
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggle(false); });

  // Redireciona botão PDF2 para o handler original do PDF (listener em dashboard.js)
  document.getElementById("btnExportarPDF2")?.addEventListener("click", () => {
    toggle(false);
    document.getElementById("btnExportarPDF")?.click();
  });

  // Fecha o dropdown após qualquer item ser clicado
  drop.querySelectorAll(".vg-export-drop__item").forEach(item => {
    item.addEventListener("click", () => toggle(false));
  });

  // Redireciona btnGerarInformativoRanking2 → btnGerarInformativoRanking (span oculto)
  document.getElementById("btnGerarInformativoRanking2")?.addEventListener("click", () => {
    document.getElementById("btnGerarInformativoRanking")?.click();
  });
}

// ── Hero sticky desativado — barra rola com o conteúdo ──
function setupHeroSticky() {}

// ── Botões de aparência com estado ativo ─────────────
function setupAppearanceButtons() {
  const markActive = () => {
    const isDark = document.body.getAttribute("data-theme") === "dark";
    document.getElementById("btnTemaClaro")?.classList.toggle("active", !isDark);
    document.getElementById("btnTemaEscuro")?.classList.toggle("active", isDark);
    const size = document.documentElement.style.fontSize || "16px";
    document.querySelectorAll(".btn-zoom").forEach(b => {
      b.classList.toggle("active", b.dataset.size === size);
    });
  };
  markActive();
  document.getElementById("btnTemaClaro")?.addEventListener("click", () => setTimeout(markActive, 50));
  document.getElementById("btnTemaEscuro")?.addEventListener("click", () => setTimeout(markActive, 50));
  document.querySelectorAll(".btn-zoom").forEach(b => b.addEventListener("click", () => setTimeout(markActive, 50)));
}
