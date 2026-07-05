// =====================================================
// js/modules/pontuacao.js
// Versão estável - UX de lançamento sem travamento
// =====================================================
import { db, collection, getDocs, doc, query, where, writeBatch, increment } from '../firebase.js';
import { appState } from './state.js';
import { showToast, mostrarConfirmacao } from './ui.js';

let atualizarTelasCallback = null;
let uxPontuacaoInicializada = false;
let lotesRenderizados = new Map();

export function setAtualizarTelasCallback(cb) {
  atualizarTelasCallback = cb;
}

export function setupContabilizacao() {
  const elDataTreino = document.getElementById("dataTreino");
  if (elDataTreino && !elDataTreino.value) elDataTreino.valueAsDate = new Date();

  aplicarEstilosUXPontuacao();
  setupTipoLancamentoUI();
  setupExtratoAgrupadoUI();
  setupModalEditarLote();

  const selectEvento = document.getElementById("lancarEventoSelect");
  if (selectEvento && !selectEvento.dataset.listenerAplicado) {
    selectEvento.dataset.listenerAplicado = "1";
    selectEvento.addEventListener("change", (e) => {
      const evId = e.target.value;
      if (!evId) return;

      const evento = (appState.cacheEventos || []).find(x => x.id === evId);
      if (!evento) return;

      document.getElementById("descTreino").value = evento.titulo || "";
      document.getElementById("dataTreino").value = evento.data || "";
      const kmInput = document.getElementById("kmTreino");
      if (kmInput) kmInput.value = Number(evento.km || 0) > 0 ? Number(evento.km || 0) : "";

      if (evento.modalidade && evento.modalidade !== "Ambas") {
        const modTreino = document.getElementById("modTreino");
        modTreino.value = evento.modalidade;
        modTreino.dispatchEvent(new Event("change"));
      }
    });
  }

  const modTreino = document.getElementById("modTreino");
  if (modTreino && !modTreino.dataset.listenerAplicado) {
    modTreino.dataset.listenerAplicado = "1";
    modTreino.addEventListener("change", async (e) => {
      const mod = e.target.value;
      const areaTabela = document.getElementById("areaTabelaPontuacao");
      if (areaTabela) areaTabela.style.display = "none";

      const btnSalvar = document.getElementById("btnSalvarPontuacao");
      if (btnSalvar) btnSalvar.disabled = true;
      if (!mod) return;

      try {
        const snapRegras = await getDocs(
          query(collection(db, "regras_pontuacao"), where("modalidade", "in", ["Ambas", mod]))
        );

        if (snapRegras.empty) {
          return showToast("Nenhuma regra criada ainda.", "error");
        }

        const regrasArray = [];
        const tipoAtual = getTipoLancamentoAtual();
        snapRegras.forEach(d => {
          const r = d.data();
          const tiposPermitidos = Array.isArray(r.tiposLancamento) && r.tiposLancamento.length
            ? r.tiposLancamento
            : ["treino", "evento", "avulso"];

          if (!tiposPermitidos.includes(tipoAtual)) return;

          regrasArray.push({
            id: d.id,
            descricao: r.descricao,
            pontos: r.pontos,
            regrasVinculadas: r.regrasVinculadas || [],
            tiposLancamento: tiposPermitidos
          });
        });

        if (regrasArray.length === 0) {
          return showToast("Nenhuma regra habilitada para este tipo de lançamento.", "error");
        }

        await gerarTabelaContabilizacao(mod, regrasArray);
        if (areaTabela) areaTabela.style.display = "block";
        if (btnSalvar) btnSalvar.disabled = false;
      } catch (err) {
        showToast("Erro ao carregar tabela: " + err.message, "error");
      }
    });
  }

  const btnSalvar = document.getElementById("btnSalvarPontuacao");
  if (btnSalvar && !btnSalvar.dataset.listenerAplicado) {
    btnSalvar.dataset.listenerAplicado = "1";
    btnSalvar.addEventListener("click", salvarPontuacoesEmLote);
  }

  const btnModelo = document.getElementById("btnExportarModeloExcel");
  if (btnModelo && !btnModelo.dataset.listenerAplicado) {
    btnModelo.dataset.listenerAplicado = "1";
    btnModelo.addEventListener("click", exportarModeloExcelPontuacao);
  }

  const btnImportar = document.getElementById("btnImportarExcel");
  if (btnImportar && !btnImportar.dataset.listenerAplicado) {
    btnImportar.dataset.listenerAplicado = "1";
    btnImportar.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        processarImportacaoExcel(json);
      };

      reader.readAsArrayBuffer(file);
      e.target.value = "";
    });
  }

  setTimeout(() => {
    if (getTipoLancamentoAtual() === "evento") preencherDropdownEventosDisponiveis();
    renderizarExtratoAgrupado();
  }, 600);
}

// =====================================================
// UX VISUAL
// =====================================================
function aplicarEstilosUXPontuacao() {
  if (document.getElementById("uxPontuacaoStyles")) return;

  const style = document.createElement("style");
  style.id = "uxPontuacaoStyles";
  style.textContent = `
    .tipo-lancamento-segmented {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-bottom: 18px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 8px;
    }

    .tipo-lancamento-btn {
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-light);
      border-radius: 14px;
      padding: 12px 14px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: .2s ease;
      cursor: pointer;
    }

    .tipo-lancamento-btn:hover {
      background: rgba(0,155,193,.07);
      color: var(--primary);
    }

    .tipo-lancamento-btn.active {
      background: linear-gradient(135deg,#009bc1,#00a693);
      color: #fff;
      box-shadow: 0 8px 22px rgba(0,155,193,.25);
    }

    .event-window-note {
      margin-top: 8px;
      font-size: .78rem;
      color: var(--text-light);
      background: rgba(142,68,173,.08);
      border: 1px solid rgba(142,68,173,.18);
      border-radius: 10px;
      padding: 8px 10px;
    }

    .extrato-tabs {
      display: flex;
      gap: 10px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .extrato-tab {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text-light);
      padding: 10px 14px;
      border-radius: 999px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

    .extrato-tab.active {
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
      box-shadow: 0 8px 18px rgba(0,155,193,.22);
    }

    .extrato-lotes-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit,minmax(280px,1fr));
      gap: 14px;
      margin-bottom: 18px;
    }

    .lote-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 20px;
      box-shadow: var(--shadow);
      overflow: hidden;
      transition: .2s ease;
      display: flex;
      flex-direction: column;
      min-height: 250px;
    }

    .lote-card:hover {
      transform: translateY(-3px);
      box-shadow: 0 14px 32px rgba(0,0,0,.12);
    }

    .lote-card-head {
      background: linear-gradient(135deg,rgba(0,155,193,.14),rgba(0,179,126,.12));
      padding: 15px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }

    .lote-title {
      font-weight: 800;
      color: var(--text);
      margin: 0 0 4px;
      font-size: .98rem;
      line-height: 1.25;
    }

    .lote-date {
      color: var(--primary);
      font-weight: 800;
      white-space: nowrap;
      font-size: .86rem;
    }

    .lote-meta {
      font-size: .78rem;
      color: var(--text-light);
      line-height: 1.35;
    }

    .lote-body {
      padding: 14px 16px;
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .lote-stats {
      display: grid;
      grid-template-columns: repeat(4,1fr);
      gap: 8px;
      margin-bottom: 12px;
    }

    .lote-stat {
      background: rgba(0,155,193,.06);
      border: 1px solid rgba(0,155,193,.12);
      border-radius: 13px;
      padding: 9px 6px;
      text-align: center;
      min-height: 54px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .lote-stat strong {
      display: block;
      color: var(--text);
      font-size: 1rem;
    }

    .lote-stat span {
      font-size: .68rem;
      color: var(--text-light);
    }

    .lote-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
    }

    .lote-action-buttons {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .lancamento-save-bar {
      margin-top: 16px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 14px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
      box-shadow: var(--shadow);
      position: sticky;
      bottom: 92px;
      z-index: 30;
    }

    .lancamento-save-bar .btn-primario {
      min-width: 220px;
      justify-content: center;
      padding: 13px 18px;
      background: var(--secondary);
    }

    .lancamento-save-bar .btn-primario:disabled {
      opacity: .45;
      cursor: not-allowed;
      filter: grayscale(.25);
    }

    .lancamento-save-bar small {
      color: var(--text-light);
      font-weight: 600;
    }

    .modal-editar-lote-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.78);
      z-index: 10050;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 18px;
    }

    .modal-editar-lote-card {
      width: min(980px, 100%);
      max-height: 92vh;
      overflow-y: auto;
      background: var(--bg-card);
      border-radius: 22px;
      border: 1px solid var(--border);
      box-shadow: 0 24px 80px rgba(0,0,0,.28);
      padding: 22px;
      animation: slideUp .22s ease;
    }

    .modal-editar-lote-card h3 {
      margin: 0 0 6px;
      color: var(--primary);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .modal-editar-lote-card p {
      margin: 0 0 18px;
      color: var(--text-light);
      font-size: .9rem;
    }

    .modal-editar-lote-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .modal-editar-lote-grid .full {
      grid-column: 1 / -1;
    }

    .modal-editar-lote-actions {
      position: sticky;
      bottom: -22px;
      z-index: 5;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin: 18px -22px -22px;
      padding: 14px 22px;
      background: var(--bg-card);
      border-top: 1px solid var(--border);
      box-shadow: 0 -10px 24px rgba(0,0,0,.08);
    }

    .lote-details {
      display: none;
      border-top: 1px solid var(--border);
      padding: 10px 16px 14px;
      background: rgba(0,0,0,.015);
      max-height: 220px;
      overflow: auto;
    }

    .lote-card.open .lote-details {
      display: block;
    }

    .lote-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      border-bottom: 1px dashed var(--border);
      padding: 7px 0;
      font-size: .82rem;
    }

    .lote-row:last-child {
      border-bottom: 0;
    }

    .lote-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border-radius: 999px;
      padding: 5px 8px;
      font-size: .7rem;
      font-weight: 800;
      background: rgba(0,155,193,.1);
      color: var(--primary);
    }

    .nome-atleta-link {
      color: var(--primary);
      font-weight: 800;
      cursor: pointer;
      text-decoration: none;
      border-bottom: 1px dashed rgba(0,155,193,.45);
    }

    .nome-atleta-link:hover {
      filter: brightness(.9);
    }

    .legacy-auditoria-hidden {
      display: none !important;
    }


    .modal-editar-lote-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 14px 0 18px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
    }

    .modal-editar-lote-tab {
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text-light);
      border-radius: 999px;
      padding: 9px 13px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .modal-editar-lote-tab.active {
      background: linear-gradient(135deg,#009bc1,#00a693);
      color: #fff;
      border-color: transparent;
      box-shadow: 0 8px 18px rgba(0,155,193,.18);
    }

    .modal-lote-section { display: none; }
    .modal-lote-section.active { display: block; }

    .lote-edit-summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }

    .lote-edit-summary div {
      background: rgba(0,155,193,.06);
      border: 1px solid rgba(0,155,193,.12);
      border-radius: 14px;
      padding: 10px;
    }

    .lote-edit-summary strong {
      display: block;
      color: var(--primary);
      font-size: 1.05rem;
    }

    .lote-edit-summary span {
      font-size: .72rem;
      color: var(--text-light);
      font-weight: 700;
      text-transform: uppercase;
    }

    .lote-atleta-edit-row {
      display: grid;
      grid-template-columns: minmax(180px,1.2fr) minmax(170px,1fr) 80px 80px auto;
      align-items: center;
      gap: 10px;
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 10px;
      margin-bottom: 8px;
      background: var(--bg);
    }

    .lote-atleta-edit-row strong { color: var(--text); }
    .lote-atleta-edit-row small { color: var(--text-light); }

    .btn-remover-atleta-lote, .btn-estornar-lote-inteiro {
      color: var(--danger) !important;
      border-color: rgba(230,57,70,.35) !important;
      background: rgba(230,57,70,.06) !important;
    }

    .lote-edit-section-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin: 0 0 10px;
    }

    .lote-edit-section-title strong {
      color: var(--text);
      font-size: .95rem;
    }

    .lote-edit-section-title small {
      color: var(--text-light);
      font-size: .78rem;
    }

    .modal-lote-add-card {
      border: 1px dashed rgba(0,155,193,.35);
      border-radius: 16px;
      padding: 14px;
      background: rgba(0,155,193,.045);
    }

    .modal-lote-add-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      align-items: end;
    }

    .modal-lote-add-grid .full { grid-column: 1 / -1; }

    .lote-impact-box {
      margin-top: 12px;
      border: 1px solid rgba(243,112,33,.25);
      background: rgba(243,112,33,.06);
      color: var(--text);
      border-radius: 14px;
      padding: 12px;
      font-size: .86rem;
      line-height: 1.45;
    }

    .lote-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(243,112,33,.12);
      color: var(--accent);
      font-size: .68rem;
      font-weight: 800;
      margin-left: 6px;
    }


    /* V19 - modal estável sem esticar a tela inteira */
    .modal-editar-lote-card {
      width: 980px !important;
      max-width: calc(100vw - 36px) !important;
      height: min(86vh, 760px) !important;
      max-height: min(86vh, 760px) !important;
      overflow: hidden !important;
      display: flex !important;
      flex-direction: column !important;
      box-sizing: border-box !important;
    }

    .modal-editar-lote-card > h3,
    .modal-editar-lote-card > p,
    .modal-editar-lote-tabs,
    .lote-edit-summary,
    .modal-editar-lote-actions {
      flex: 0 0 auto;
    }

    .modal-editar-lote-tabs {
      overflow-x: auto;
      scrollbar-width: thin;
      flex-wrap: nowrap !important;
      padding-bottom: 10px;
    }

    .modal-editar-lote-tab {
      white-space: nowrap;
      flex: 0 0 auto;
    }

    .modal-lote-section {
      min-height: 0;
      overflow-y: auto;
      padding-right: 4px;
    }

    .modal-lote-section.active {
      flex: 1 1 auto;
      display: block !important;
    }

    .modal-editar-lote-grid input,
    .modal-editar-lote-grid select,
    .modal-lote-add-grid input,
    .modal-lote-add-grid select {
      height: 46px;
      min-height: 46px;
      box-sizing: border-box;
      margin-bottom: 0 !important;
    }

    .modal-editar-lote-grid label,
    .modal-lote-add-grid label {
      min-height: 18px;
      display: flex;
      align-items: center;
      margin-bottom: 6px;
    }

    .modal-lote-add-grid textarea {
      min-height: 84px;
      box-sizing: border-box;
      margin-bottom: 0 !important;
    }

    .modal-editar-lote-actions {
      bottom: -22px;
      flex-wrap: wrap;
    }

    @media(max-width:720px) {
      .tipo-lancamento-segmented { grid-template-columns: 1fr; }
      .lote-stats { grid-template-columns: 1fr 1fr; }
      .extrato-lotes-grid { grid-template-columns: 1fr; }
      .lancamento-save-bar { position: static; flex-direction: column; align-items: stretch; }
      .lancamento-save-bar .btn-primario { width: 100%; min-width: 0; }
      .modal-editar-lote-grid { grid-template-columns: 1fr; }
      .lote-atleta-edit-row { grid-template-columns: 1fr; align-items: stretch; }
      .modal-editar-lote-actions { position: static; margin: 18px 0 0; flex-direction: column; }
    }
  `;

  document.head.appendChild(style);
}

// =====================================================
// TIPO DE LANÇAMENTO
// =====================================================
function setupTipoLancamentoUI() {
  if (uxPontuacaoInicializada) return;

  const selectEvento = document.getElementById("lancarEventoSelect");
  const desc = document.getElementById("descTreino");
  const card = selectEvento?.closest(".card");

  if (!selectEvento || !desc || !card) return;

  uxPontuacaoInicializada = true;

  const wrap = document.createElement("div");
  wrap.id = "tipoLancamentoWrap";
  wrap.innerHTML = `
    <label style="color: var(--primary); font-weight: 800; margin-bottom: 8px;">Tipo de lançamento</label>
    <div class="tipo-lancamento-segmented" role="group" aria-label="Tipo de lançamento">
      <button type="button" class="tipo-lancamento-btn active" data-tipo="treino">
        <i data-lucide="activity"></i> Treino
      </button>
      <button type="button" class="tipo-lancamento-btn" data-tipo="evento">
        <i data-lucide="calendar-check"></i> Evento
      </button>
      <button type="button" class="tipo-lancamento-btn" data-tipo="avulso">
        <i data-lucide="plus-circle"></i> Avulso
      </button>
    </div>
  `;

  card.prepend(wrap);

  selectEvento.dataset.tipoLancamento = "treino";
  selectEvento.closest("div").style.display = "none";
  desc.placeholder = "Ex: Treino de sábado / Treino especial";

  document.querySelectorAll(".tipo-lancamento-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tipo-lancamento-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      aplicarTipoLancamento(btn.dataset.tipo);
    });
  });

  if (typeof lucide !== "undefined") lucide.createIcons();
}

function aplicarTipoLancamento(tipo) {
  const selectEvento = document.getElementById("lancarEventoSelect");
  const desc = document.getElementById("descTreino");
  const data = document.getElementById("dataTreino");
  const campoEvento = selectEvento?.closest("div");

  if (!selectEvento || !desc || !campoEvento) return;

  selectEvento.dataset.tipoLancamento = tipo;

  if (tipo === "evento") {
    campoEvento.style.display = "block";
    desc.placeholder = "A descrição será preenchida com o evento selecionado";
    preencherDropdownEventosDisponiveis();
    return;
  }

  campoEvento.style.display = "none";
  selectEvento.value = "";
  desc.value = "";
  const kmInput = document.getElementById("kmTreino");
  if (kmInput && tipo === "treino") kmInput.value = "";
  desc.placeholder = tipo === "avulso"
    ? "Ex: Ajuste aprovado pelo comitê / Participação externa"
    : "Ex: Treino de sábado / Treino especial";

  if (data && tipo === "treino") data.valueAsDate = new Date();
}

function getTipoLancamentoAtual() {
  return document.getElementById("lancarEventoSelect")?.dataset.tipoLancamento || "treino";
}

function preencherDropdownEventosDisponiveis() {
  const select = document.getElementById("lancarEventoSelect");
  if (!select || getTipoLancamentoAtual() !== "evento") return;

  const valorAtual = select.value;
  const eventos = Array.isArray(appState.cacheEventos) ? appState.cacheEventos : [];
  const historico = Array.isArray(appState.historicoCompleto) ? appState.historicoCompleto : [];

  const eventosLancados = new Set(
    historico
      .filter(h => h.eventoId)
      .map(h => h.eventoId)
  );

  const hoje = zerarHora(new Date());
  const limite = new Date(hoje);
  limite.setDate(limite.getDate() - 7);

  const proximos = [];
  const recentes = [];

  eventos.forEach(e => {
    if (!e.id || !e.data) return;
    if (eventosLancados.has(e.id)) return;
    if (e.lancamentoRealizado === true || e.statusLancamento === "lancado") return;

    const dataEvento = zerarHora(new Date(e.data + "T00:00:00"));

    if (dataEvento >= hoje) {
      proximos.push(e);
    } else if (dataEvento >= limite) {
      recentes.push(e);
    }
  });

  proximos.sort((a, b) => String(a.data).localeCompare(String(b.data)));
  recentes.sort((a, b) => String(b.data).localeCompare(String(a.data)));

  select.innerHTML = `<option value="">Selecione um evento</option>`;

  adicionarGrupoEventos(select, "Eventos de hoje e próximos", proximos);
  adicionarGrupoEventos(select, "Eventos realizados nos últimos 7 dias", recentes);

  if (proximos.length === 0 && recentes.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Nenhum evento disponível para lançamento";
    opt.disabled = true;
    select.appendChild(opt);
  }

  if (valorAtual && [...select.options].some(o => o.value === valorAtual)) {
    select.value = valorAtual;
  }

  let note = document.getElementById("eventWindowNote");
  if (!note) {
    note = document.createElement("div");
    note.id = "eventWindowNote";
    note.className = "event-window-note";
    select.insertAdjacentElement("afterend", note);
  }

  note.textContent = "Eventos realizados ficam disponíveis por 7 dias. Eventos já lançados são ocultados para evitar duplicidade.";
}

function adicionarGrupoEventos(select, label, eventos) {
  if (!eventos.length) return;

  const group = document.createElement("optgroup");
  group.label = label;

  eventos.forEach(e => {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.textContent = `${e.titulo || "Evento sem título"} (${formatarData(e.data)})`;
    group.appendChild(opt);
  });

  select.appendChild(group);
}

// =====================================================
// TABELA DE PONTUAÇÃO
// =====================================================
async function gerarTabelaContabilizacao(modalidade, regras) {
  const tabela = document.getElementById("tabelaPontuacao");
  let atletas = Object.values(appState.mapAtletas).filter(
    a => a.equipe === modalidade && a.ativo !== false && a.status === "Aprovado"
  );

  atletas.sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));

  if (atletas.length === 0) {
    tabela.innerHTML = `<tr><td style='text-align:center; padding:20px;'>Nenhum atleta ativo na equipe.</td></tr>`;
    return;
  }

  let html = `
    <thead>
      <tr>
        <th style="vertical-align:middle; position:sticky; left:0; background:var(--table-header); z-index:20;">
          Nome do Atleta
        </th>
  `;

  regras.forEach(r => {
    html += `
      <th style="text-align:center; min-width: 100px;">
        <div style="display:flex; flex-direction:column; align-items:center; gap:5px;">
          <span style="font-size:0.75rem;">${escapeHtml(r.descricao)}</span>
          <strong style="color:var(--primary);">+${Number(r.pontos) || 0}</strong>
        </div>
      </th>
    `;
  });

  html += `
        <th style="text-align:center; color:var(--accent); min-width: 90px; border-left: 2px solid var(--border);">
          <div style="display:flex; flex-direction:column; align-items:center; gap:5px;">
            <span style="font-weight:bold; font-size: 0.8rem;">Falta Justificada</span>
            <label style="font-size:0.75rem; cursor:pointer;">
              <input type="checkbox" id="checkMasterFalta"> Todo Time
            </label>
          </div>
        </th>
        <th style="text-align:left; min-width: 180px; border-left: 1px solid var(--border);">Observação</th>
      </tr>
    </thead>
    <tbody>
  `;

  atletas.forEach(a => {
    html += `
      <tr>
        <td style="font-weight:500; position:sticky; left:0; background:var(--bg-card); z-index:10;">
          ${escapeHtml(a.nome)}
        </td>
    `;

    regras.forEach(r => {
      html += `
        <td style="text-align:center;">
          <input 
            type="checkbox" 
            class="check-ponto" 
            data-atleta-id="${escapeAttr(a.id)}" 
            data-atleta-nome="${escapeAttr(a.nome)}" 
            data-atleta-equipe="${escapeAttr(a.equipe)}" 
            data-regra-id="${escapeAttr(r.id)}" 
            data-regra-desc="${escapeAttr(r.descricao)}" 
            data-pontos="${Number(r.pontos) || 0}" 
            data-exclui="${escapeAttr((r.regrasVinculadas || []).join(","))}"
          >
        </td>
      `;
    });

    html += `
        <td style="text-align:center; background: rgba(243,112,33,0.05); border-left: 2px solid var(--border);">
          <input 
            type="checkbox" 
            class="check-falta" 
            data-atleta-id="${escapeAttr(a.id)}" 
            data-atleta-nome="${escapeAttr(a.nome)}" 
            data-atleta-equipe="${escapeAttr(a.equipe)}"
          >
        </td>
        <td style="border-left: 1px solid var(--border);">
          <input 
            type="text" 
            class="input-obs" 
            data-atleta-id="${escapeAttr(a.id)}" 
            placeholder="Lesão, atestado..." 
            style="display:none; margin:0; padding:8px; font-size:0.8rem;"
          >
        </td>
      </tr>
    `;
  });

  html += `</tbody>`;
  tabela.innerHTML = html;

  const updateObsVisibility = (tr) => {
    const hasChecked = tr.querySelectorAll(".check-ponto:checked, .check-falta:checked").length > 0;
    const obsInput = tr.querySelector(".input-obs");

    if (!obsInput) return;

    if (hasChecked) {
      obsInput.style.display = "block";
    } else {
      obsInput.style.display = "none";
      obsInput.value = "";
    }
  };

  document.querySelectorAll(".check-ponto").forEach(chk => {
    chk.addEventListener("change", (e) => {
      const tr = e.target.closest("tr");

      if (e.target.checked) {
        const idClicado = e.target.dataset.regraId;
        const excluiClicado = e.target.dataset.exclui ? e.target.dataset.exclui.split(",") : [];

        tr.querySelectorAll(".check-ponto").forEach(other => {
          if (other === e.target) return;

          const outroId = other.dataset.regraId;
          const outroExclui = other.dataset.exclui ? other.dataset.exclui.split(",") : [];

          if (excluiClicado.includes(outroId) || outroExclui.includes(idClicado)) {
            other.checked = false;
          }
        });
      }

      updateObsVisibility(tr);
    });
  });

  document.getElementById("checkMasterFalta")?.addEventListener("change", (e) => {
    document.querySelectorAll(".check-falta").forEach(chk => {
      chk.checked = e.target.checked;
      chk.dispatchEvent(new Event("change"));
    });
  });

  document.querySelectorAll(".check-falta").forEach(chk => {
    chk.addEventListener("change", (e) => {
      const tr = e.target.closest("tr");

      tr.querySelectorAll(".check-ponto").forEach(p => {
        p.disabled = e.target.checked;
        if (e.target.checked) p.checked = false;
      });

      updateObsVisibility(tr);
    });
  });
}

// =====================================================
// SALVAR LANÇAMENTO
// =====================================================
async function salvarPontuacoesEmLote() {
  const tipoLancamento = getTipoLancamentoAtual();
  const desc = document.getElementById("descTreino").value.trim();
  const data = document.getElementById("dataTreino").value;
  const kmPercorrido = Number(String(document.getElementById("kmTreino")?.value || "0").replace(",", ".")) || 0;
  const hoje = new Date().toISOString().split("T")[0];

  if (data > hoje) {
    return showToast("Não é permitido lançar dados em datas futuras!", "error");
  }

  const eventoIdSelecionado = tipoLancamento === "evento"
    ? document.getElementById("lancarEventoSelect").value
    : "";

  const checksPontos = document.querySelectorAll(".check-ponto:checked");
  const checksFaltas = document.querySelectorAll(".check-falta:checked");
  const observacoes = document.querySelectorAll(".input-obs");

  if (tipoLancamento === "evento" && !eventoIdSelecionado) {
    return showToast("Selecione um evento para continuar.", "error");
  }

  if (checksPontos.length === 0 && checksFaltas.length === 0) {
    return showToast("Nenhum atleta foi selecionado na tabela!", "error");
  }

  if (!desc || !data) {
    return showToast("Preencha a descrição e a data do lançamento!", "error");
  }

  const totalPontos = Array.from(checksPontos).reduce(
    (s, c) => s + (Number(c.dataset.pontos) || 0),
    0
  );

  const resumo = [
    `Confirmar gravação de ${checksPontos.length + checksFaltas.length} registros?`,
    ``,
    `Tipo: ${rotuloTipo(tipoLancamento)}`,
    `Descrição: ${desc}`,
    `Data: ${formatarData(data)}`,
    `KM por atleta: ${kmPercorrido > 0 ? formatarKm(kmPercorrido) + " km" : "não informado"}`,
    `Pontos totais: ${totalPontos}`
  ].join("\n");

  mostrarConfirmacao("Gravar Lançamentos", resumo, async () => {
    const btn = document.getElementById("btnSalvarPontuacao");
    btn.innerHTML = "Gravando na Base...";
    btn.disabled = true;

    try {
      const batch = writeBatch(db);
      const pontosPorAtleta = {};
      const meuNome = appState.mapAtletas[appState.currentUser?.uid]
        ? appState.mapAtletas[appState.currentUser.uid].nome
        : "Comitê Gestor";

      const loteId = gerarLoteId(tipoLancamento);
      const modalidade = document.getElementById("modTreino")?.value || "";

      const dadosLote = {
        loteId,
        tipoLancamento,
        tituloLancamento: desc,
        modalidade,
        criadoPor: appState.currentUser?.uid || "",
        criadoPorNome: meuNome,
        criadoEm: new Date().toISOString()
      };

      for (const f of checksFaltas) {
        batch.set(doc(collection(db, "historico_pontos")), {
          atletaId: f.dataset.atletaId,
          atletaNome: f.dataset.atletaNome,
          atletaEquipe: f.dataset.atletaEquipe,
          regraId: "falta_just",
          regraDesc: "Falta Justificada",
          pontos: 0,
          descTreino: desc,
          dataTreino: data,
          eventoId: eventoIdSelecionado,
          kmPercorrido: 0,
          ...dadosLote
        });
      }

      for (const check of checksPontos) {
        const aId = check.dataset.atletaId;
        const pts = Number(check.dataset.pontos) || 0;

        batch.set(doc(collection(db, "historico_pontos")), {
          atletaId: aId,
          atletaNome: check.dataset.atletaNome,
          atletaEquipe: check.dataset.atletaEquipe,
          regraId: check.dataset.regraId,
          regraDesc: check.dataset.regraDesc,
          pontos: pts,
          descTreino: desc,
          dataTreino: data,
          eventoId: eventoIdSelecionado,
          kmPercorrido,
          ...dadosLote
        });

        if (!pontosPorAtleta[aId]) pontosPorAtleta[aId] = 0;
        pontosPorAtleta[aId] += pts;
      }

      for (const aId in pontosPorAtleta) {
        batch.update(doc(db, "atletas", aId), {
          pontuacaoTotal: increment(pontosPorAtleta[aId])
        });
      }

      for (const obs of observacoes) {
        if (obs.value.trim() === "" || obs.style.display === "none") continue;

        const tr = obs.closest("tr");
        const hasLancamento = tr.querySelector(".check-ponto:checked") || tr.querySelector(".check-falta:checked");

        if (hasLancamento) {
          batch.set(doc(collection(db, "comentarios_atletas")), {
            atletaId: obs.dataset.atletaId,
            texto: `[Ref: ${data.split("-").reverse().join("/")} - ${desc}] ${obs.value.trim()}`,
            autorNome: meuNome,
            criadoEm: new Date().toISOString()
          });
        }
      }

      await batch.commit();
      showToast("Lançamentos gravados com sucesso!", "success");

      document.getElementById("areaTabelaPontuacao").style.display = "none";
      document.getElementById("descTreino").value = "";
      document.getElementById("lancarEventoSelect").value = "";
      document.getElementById("modTreino").value = "";
      document.getElementById("kmTreino").value = "";
      document.getElementById("btnSalvarPontuacao").disabled = true;
      if (document.getElementById("kmTreino")) document.getElementById("kmTreino").value = "";

      if (atualizarTelasCallback) atualizarTelasCallback();

      setTimeout(() => {
        preencherDropdownEventosDisponiveis();
        renderizarExtratoAgrupado();
      }, 800);
    } catch (error) {
      showToast("Erro ao processar lote: " + error.message, "error");
    } finally {
      btn.innerHTML = "Gravar Lançamentos na Base";
      btn.disabled = false;
    }
  });
}

// =====================================================
// IMPORTAÇÃO / EXPORTAÇÃO
// =====================================================
async function exportarModeloExcelPontuacao() {
  const mod = document.getElementById("modTreino").value;

  if (!mod) {
    return showToast("Selecione uma equipe para baixar o modelo.", "error");
  }

  const atletasAlvo = Object.values(appState.mapAtletas).filter(
    a => a.equipe === mod && a.ativo !== false
  );

  if (atletasAlvo.length === 0) {
    return showToast("Nenhum atleta ativo nesta equipe.", "error");
  }

  if (!window._excelUtils?.gerarModeloLancamentos) return showToast("Módulo Excel não carregado.", "error");
  try {
    await window._excelUtils.gerarModeloLancamentos(atletasAlvo, mod);
  } catch (err) {
    showToast("Erro ao gerar modelo: " + err.message, "error");
  }
}

async function processarImportacaoExcel(linhas) {
  const lancamentosValidos = linhas.filter(
    l => l["Pontos a Adicionar"] !== "" && l["Pontos a Adicionar"] !== undefined
  );

  if (lancamentosValidos.length === 0) {
    return showToast("A planilha não contém pontos preenchidos.", "error");
  }

  mostrarConfirmacao("Confirmar Importação", `Foram encontrados ${lancamentosValidos.length} lançamentos. Gravar no sistema?`, async () => {
    try {
      showToast("Processando importação...", "info");

      const batch = writeBatch(db);
      const pontosPorAtleta = {};
      const loteId = gerarLoteId("importacao");
      const meuNome = appState.mapAtletas[appState.currentUser?.uid]
        ? appState.mapAtletas[appState.currentUser.uid].nome
        : "Comitê Gestor";

      lancamentosValidos.forEach(l => {
        const aId = l["ID_Oculto (NÃO ALTERAR)"];
        const pts = Number(l["Pontos a Adicionar"]) || 0;
        const kmImportado = Number(String(l["KM Percorridos"] || "0").replace(",", ".")) || 0;
        const desc = l["Descrição / Evento"] || "Lançamento via Planilha";
        const dataRaw = l["Data"] || l["Data (AAAA-MM-DD)"] || "";
        const { parseDateImport } = window._excelUtils || {};
        const dataStr = parseDateImport ? parseDateImport(dataRaw) : dataRaw || new Date().toISOString().split("T")[0];

        if (!appState.mapAtletas[aId]) return;

        batch.set(doc(collection(db, "historico_pontos")), {
          atletaId: aId,
          atletaNome: appState.mapAtletas[aId].nome,
          atletaEquipe: appState.mapAtletas[aId].equipe,
          regraId: "import",
          regraDesc: "Importação via Planilha",
          pontos: pts,
          descTreino: desc,
          dataTreino: dataStr,
          kmPercorrido: kmImportado,
          loteId,
          tipoLancamento: "importacao",
          tituloLancamento: desc,
          modalidade: appState.mapAtletas[aId].equipe,
          criadoPor: appState.currentUser?.uid || "",
          criadoPorNome: meuNome,
          criadoEm: new Date().toISOString()
        });

        if (!pontosPorAtleta[aId]) pontosPorAtleta[aId] = 0;
        pontosPorAtleta[aId] += pts;
      });

      for (const aId in pontosPorAtleta) {
        batch.update(doc(db, "atletas", aId), {
          pontuacaoTotal: increment(pontosPorAtleta[aId])
        });
      }

      await batch.commit();
      showToast("Importação concluída com sucesso!", "success");

      if (atualizarTelasCallback) atualizarTelasCallback();

      setTimeout(renderizarExtratoAgrupado, 800);
    } catch (err) {
      showToast("Erro ao importar: " + err.message, "error");
    }
  });
}

// =====================================================
// EXTRATO AGRUPADO
// =====================================================
function setupExtratoAgrupadoUI() {
  const tbody = document.getElementById("listaHistorico");
  if (!tbody || document.getElementById("extratoUxWrap")) return;

  const tabelaContainer = tbody.closest(".tabela-container");
  if (!tabelaContainer) return;

  const wrap = document.createElement("div");
  wrap.id = "extratoUxWrap";
  wrap.innerHTML = `
    <div class="extrato-tabs">
      <button type="button" class="extrato-tab active" data-view="lotes">
        <i data-lucide="layers-3"></i> Por lançamento
      </button>
      <button type="button" class="extrato-tab" data-view="auditoria">
        <i data-lucide="list"></i> Histórico de alterações
      </button>
    </div>
    <div id="extratoLotes" class="extrato-lotes-grid"></div>
  `;

  tabelaContainer.parentNode.insertBefore(wrap, tabelaContainer);
  tabelaContainer.classList.add("legacy-auditoria-hidden");

  wrap.querySelectorAll(".extrato-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".extrato-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const view = btn.dataset.view;
      const lotes = document.getElementById("extratoLotes");

      if (lotes) lotes.style.display = view === "lotes" ? "grid" : "none";
      tabelaContainer.classList.toggle("legacy-auditoria-hidden", view !== "auditoria");
    });
  });

  ["filtroMesHistorico", "filtroEquipeHistorico", "filtroNomeHistorico", "filtroStatusHistorico"].forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.dataset.uxFiltroAplicado) return;

    el.dataset.uxFiltroAplicado = "1";
    el.addEventListener("input", () => setTimeout(renderizarExtratoAgrupado, 80));
  });

  const btnLimpar = document.getElementById("btnLimparFiltrosExtrato");
  if (btnLimpar && !btnLimpar.dataset.uxFiltroAplicado) {
    btnLimpar.dataset.uxFiltroAplicado = "1";
    btnLimpar.addEventListener("click", () => setTimeout(renderizarExtratoAgrupado, 120));
  }

  if (typeof lucide !== "undefined") lucide.createIcons();
}

function renderizarExtratoAgrupado() {
  const container = document.getElementById("extratoLotes");
  if (!container) return;

  const dados = filtrarHistoricoParaUX();

  if (dados.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <i data-lucide="clipboard-list"></i>
        <p>Nenhum lançamento encontrado para os filtros selecionados.</p>
      </div>
    `;
    if (typeof lucide !== "undefined") lucide.createIcons();
    return;
  }

  const grupos = agruparLancamentos(dados);
  lotesRenderizados = new Map(grupos.map(g => [g.id, g]));
  container.innerHTML = grupos.map(g => criarCardLote(g)).join("");

  container.querySelectorAll(".btn-toggle-lote").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.closest(".lote-card")?.classList.toggle("open");
    });
  });

  container.querySelectorAll(".btn-editar-lote").forEach(btn => {
    btn.addEventListener("click", () => abrirModalEditarLote(btn.dataset.loteKey));
  });

  container.querySelectorAll(".nome-atleta-link").forEach(el => {
    el.addEventListener("click", () => tentarAbrirFichaAtleta(el.dataset.atletaId));
  });

  if (typeof lucide !== "undefined") lucide.createIcons();
}

function filtrarHistoricoParaUX() {
  const mes = document.getElementById("filtroMesHistorico")?.value;
  const eq = document.getElementById("filtroEquipeHistorico")?.value;
  const nomeBusca = (document.getElementById("filtroNomeHistorico")?.value || "").toLowerCase();
  const statusFiltro = document.getElementById("filtroStatusHistorico")?.value;

  return (appState.historicoCompleto || []).filter(h => {
    if (h.estornado === true) return false;
    const atleta = appState.mapAtletas[h.atletaId];
    const isAtivo = atleta ? atleta.ativo !== false : false;

    if (statusFiltro === "ativos" && !isAtivo) return false;

    const nomeFiltro = h.atletaNome || (atleta ? atleta.nome : "");
    const eqFiltro = h.atletaEquipe || (atleta ? atleta.equipe : "");

    return (
      (!mes || (h.dataTreino || "").startsWith(mes)) &&
      (!eq || eqFiltro === eq) &&
      (!nomeBusca || String(nomeFiltro).toLowerCase().includes(nomeBusca))
    );
  });
}

function agruparLancamentos(dados) {
  const mapa = new Map();

  dados.forEach(h => {
    const chave = h.loteId || [
      h.eventoId || "sem-evento",
      h.dataTreino || "sem-data",
      h.descTreino || "Sem descrição",
      (h.criadoEm || "").slice(0, 16)
    ].join("|");

    if (!mapa.has(chave)) {
      mapa.set(chave, {
        id: chave,
        dataTreino: h.dataTreino,
        titulo: h.tituloLancamento || h.descTreino || "Lançamento sem descrição",
        tipo: h.tipoLancamento || (h.eventoId ? "evento" : "treino"),
        equipe: h.modalidade || h.atletaEquipe || "-",
        criadoPorNome: h.criadoPorNome || "Comitê",
        criadoEm: h.criadoEm,
        itens: []
      });
    }

    mapa.get(chave).itens.push(h);
  });

  return Array.from(mapa.values())
    .map(g => {
      g.qtdAtletas = new Set(g.itens.map(i => i.atletaId)).size;
      g.qtdRegistros = g.itens.length;
      g.totalPontos = g.itens.reduce((s, i) => s + (Number(i.pontos) || 0), 0);
      g.faltas = g.itens.filter(i => Number(i.pontos) === 0).length;
      g.totalKm = calcularKmGrupo(g.itens);
      return g;
    })
    .sort((a, b) => {
      const da = new Date(a.dataTreino || a.criadoEm || "1970-01-01");
      const db = new Date(b.dataTreino || b.criadoEm || "1970-01-01");
      return db - da;
    });
}

function criarCardLote(g) {
  const detalhes = g.itens.map(i => {
    const nome = escapeHtml(i.atletaNome || appState.mapAtletas[i.atletaId]?.nome || "Atleta não encontrado");
    const regra = escapeHtml(i.regraDesc || "-");
    const pontos = Number(i.pontos) === 0 ? "Justificada" : `+${Number(i.pontos) || 0}`;
    const kmInfo = Number(i.kmPercorrido || 0) > 0 ? ` • ${formatarKm(i.kmPercorrido)} km` : "";
    const cor = Number(i.pontos) === 0 ? "var(--accent)" : "var(--secondary)";

    return `
      <div class="lote-row">
        <span>
          <a class="nome-atleta-link" data-atleta-id="${escapeAttr(i.atletaId || "")}">${nome}</a>
          <br>
          <small style="color:var(--text-light);">${regra}${kmInfo}</small>
        </span>
        <strong style="color:${cor};">${pontos}</strong>
      </div>
    `;
  }).join("");

  return `
    <div class="lote-card">
      <div class="lote-card-head">
        <div>
          <p class="lote-title">${escapeHtml(g.titulo)}</p>
          <div class="lote-meta">
            <span class="lote-badge">${rotuloTipo(g.tipo)}</span>
            ${escapeHtml(g.equipe || "-")} · ${escapeHtml(g.criadoPorNome || "Comitê")}
          </div>
        </div>
        <div class="lote-date">${formatarData(g.dataTreino)}</div>
      </div>

      <div class="lote-body">
        <div class="lote-stats">
          <div class="lote-stat"><strong>${g.qtdAtletas}</strong><span>atletas</span></div>
          <div class="lote-stat"><strong>${g.totalPontos}</strong><span>pontos</span></div>
          <div class="lote-stat"><strong>${formatarKm(g.totalKm)}</strong><span>km</span></div>
          <div class="lote-stat"><strong>${g.faltas}</strong><span>faltas</span></div>
        </div>

        <div class="lote-actions">
          <small style="color:var(--text-light);">${g.qtdRegistros} registros no lançamento</small>
          <div class="lote-action-buttons">
            <button type="button" class="btn-acao btn-editar-lote" data-lote-key="${escapeAttr(g.id)}">
              <i data-lucide="edit-3"></i> Editar
            </button>
            <button type="button" class="btn-acao btn-toggle-lote">
              <i data-lucide="chevron-down"></i> Detalhes
            </button>
          </div>
        </div>
      </div>

      <div class="lote-details">${detalhes}</div>
    </div>
  `;
}


function setupModalEditarLote() {
  if (document.getElementById("modalEditarLote")) return;

  const modal = document.createElement("div");
  modal.id = "modalEditarLote";
  modal.className = "modal-editar-lote-backdrop";
  modal.innerHTML = `
    <div class="modal-editar-lote-card">
      <h3><i data-lucide="edit-3"></i> Editar lançamento completo</h3>
      <p>Use esta tela para ajustar o lançamento: alterar dados gerais, remover atletas lançados por engano, adicionar atletas esquecidos e registrar tudo no histórico de alterações.</p>
      <input type="hidden" id="editLoteKey" />

      <div id="editLoteResumo" class="lote-edit-summary"></div>

      <div class="modal-editar-lote-tabs">
        <button type="button" class="modal-editar-lote-tab active" data-lote-tab="dados"><i data-lucide="file-pen-line"></i> Dados gerais</button>
        <button type="button" class="modal-editar-lote-tab" data-lote-tab="atletas"><i data-lucide="users"></i> Remover/validar atletas</button>
        <button type="button" class="modal-editar-lote-tab" data-lote-tab="adicionar"><i data-lucide="user-plus"></i> Adicionar atleta esquecido</button>
      </div>

      <div id="loteTabDados" class="modal-lote-section active">
        <div class="modal-editar-lote-grid">
          <div class="full">
            <label>Descrição</label>
            <input type="text" id="editLoteDescricao" placeholder="Descrição do lançamento" />
          </div>
          <div>
            <label>Data</label>
            <input type="date" id="editLoteData" />
          </div>
          <div>
            <label>KM por atleta</label>
            <input type="number" id="editLoteKm" min="0" step="0.01" placeholder="Ex: 5 ou 21.1" />
          </div>
        </div>
        <div class="lote-impact-box">
          Alterar o KM por atleta atualiza apenas registros com pontuação positiva. Faltas justificadas continuam com 0 km.
        </div>
      </div>

      <div id="loteTabAtletas" class="modal-lote-section">
        <div class="lote-edit-section-title">
          <div>
            <strong>Atletas incluídos neste lançamento</strong><br>
            <small>Remova quem foi lançado por engano. O histórico não é apagado; ele é estornado.</small>
          </div>
        </div>
        <div id="editLoteAtletasLista"></div>
        <div class="lote-impact-box">
          Ao remover um atleta, os pontos são subtraídos do total dele e os registros são marcados como estornados, sem apagar o histórico.
        </div>
      </div>

      <div id="loteTabAdicionar" class="modal-lote-section">
        <div class="modal-lote-add-card">
          <div class="modal-lote-add-grid">
            <div>
              <label>Atleta</label>
              <select id="editAddAtleta"></select>
            </div>
            <div>
              <label>Regra aplicada</label>
              <select id="editAddRegra"></select>
            </div>
            <div>
              <label>Pontos</label>
              <input type="number" id="editAddPontos" min="0" step="1" />
            </div>
            <div>
              <label>KM</label>
              <input type="number" id="editAddKm" min="0" step="0.01" />
            </div>
            <div class="full">
              <label>Observação</label>
              <input type="text" id="editAddObs" placeholder="Ex: Atleta esquecido no lançamento original" />
            </div>
          </div>
          <div style="display:flex; justify-content:flex-end; margin-top:12px;">
            <button type="button" id="btnAdicionarAtletaLote" class="btn-primario"><i data-lucide="user-plus"></i> Adicionar ao lançamento</button>
          </div>
        </div>
      </div>

      <div class="modal-editar-lote-actions">
        <button type="button" id="btnEstornarLoteInteiro" class="btn-acao btn-estornar-lote-inteiro"><i data-lucide="rotate-ccw"></i> Cancelar lançamento inteiro</button>
        <div style="display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
          <button type="button" id="btnCancelarEditLote" class="btn-acao">Fechar</button>
          <button type="button" id="btnSalvarEditLote" class="btn-primario"><i data-lucide="save"></i> Salvar dados gerais</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById("btnCancelarEditLote")?.addEventListener("click", fecharModalEditarLote);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) fecharModalEditarLote();
  });
  document.getElementById("btnSalvarEditLote")?.addEventListener("click", salvarEdicaoLote);
  document.getElementById("btnAdicionarAtletaLote")?.addEventListener("click", adicionarAtletaAoLote);
  document.getElementById("btnEstornarLoteInteiro")?.addEventListener("click", estornarLoteInteiro);

  document.querySelectorAll(".modal-editar-lote-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".modal-editar-lote-tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".modal-lote-section").forEach(sec => sec.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`loteTab${capitalizar(btn.dataset.loteTab)}`)?.classList.add("active");
    });
  });

  document.getElementById("editAddRegra")?.addEventListener("change", () => {
    const opt = document.getElementById("editAddRegra")?.selectedOptions?.[0];
    const pontos = Number(opt?.dataset?.pontos || 0);
    document.getElementById("editAddPontos").value = pontos;
  });

  if (typeof lucide !== "undefined") lucide.createIcons();
}

async function abrirModalEditarLote(loteKey) {
  const lote = lotesRenderizados.get(loteKey);
  if (!lote) {
    showToast("Não foi possível localizar este lançamento.", "error");
    return;
  }

  const modal = document.getElementById("modalEditarLote");
  if (!modal) return;

  const kmReferencia = lote.itens.find(i => Number(i.kmPercorrido || 0) > 0)?.kmPercorrido || 0;

  document.getElementById("editLoteKey").value = loteKey;
  document.getElementById("editLoteDescricao").value = lote.titulo || "";
  document.getElementById("editLoteData").value = lote.dataTreino || "";
  document.getElementById("editLoteKm").value = kmReferencia ? String(kmReferencia).replace(".", ",") : "";

  preencherResumoEdicaoLote(lote);
  preencherListaAtletasDoLote(lote);
  preencherSelectAtletasParaAdicionar(lote);
  await preencherSelectRegrasParaAdicionar(lote);

  modal.style.display = "flex";
  if (typeof lucide !== "undefined") lucide.createIcons();
}

function fecharModalEditarLote() {
  const modal = document.getElementById("modalEditarLote");
  if (modal) modal.style.display = "none";
}

function preencherResumoEdicaoLote(lote) {
  const resumo = document.getElementById("editLoteResumo");
  if (!resumo) return;

  resumo.innerHTML = `
    <div><span>Atletas</span><strong>${lote.qtdAtletas}</strong></div>
    <div><span>Pontos</span><strong>${lote.totalPontos}</strong></div>
    <div><span>KM</span><strong>${formatarKm(lote.totalKm)}</strong></div>
    <div><span>Tipo</span><strong>${rotuloTipo(lote.tipo)}</strong></div>
  `;
}

function preencherListaAtletasDoLote(lote) {
  const lista = document.getElementById("editLoteAtletasLista");
  if (!lista) return;

  const porAtleta = new Map();
  lote.itens.filter(i => i.estornado !== true).forEach(item => {
    const atual = porAtleta.get(item.atletaId) || {
      atletaId: item.atletaId,
      nome: item.atletaNome || appState.mapAtletas[item.atletaId]?.nome || "Atleta não encontrado",
      equipe: item.atletaEquipe || appState.mapAtletas[item.atletaId]?.equipe || "-",
      regras: [],
      pontos: 0,
      km: 0,
      ids: []
    };

    atual.regras.push(item.regraDesc || "-");
    atual.pontos += Number(item.pontos) || 0;
    atual.km = Math.max(atual.km, Number(item.kmPercorrido || 0));
    if (item.id) atual.ids.push(item.id);
    porAtleta.set(item.atletaId, atual);
  });

  const atletas = Array.from(porAtleta.values()).sort((a,b) => a.nome.localeCompare(b.nome));
  if (!atletas.length) {
    lista.innerHTML = `<div class="empty-state" style="padding:14px;"><p>Nenhum atleta ativo neste lançamento.</p></div>`;
    return;
  }

  lista.innerHTML = atletas.map(a => `
    <div class="lote-atleta-edit-row">
      <div><strong>${escapeHtml(a.nome)}</strong><br><small>${escapeHtml(a.equipe)}</small></div>
      <div><small>${escapeHtml(a.regras.join(" + "))}</small></div>
      <div><strong>${a.pontos}</strong><br><small>pts</small></div>
      <div><strong>${formatarKm(a.km)}</strong><br><small>km</small></div>
      <button type="button" class="btn-acao btn-remover-atleta-lote" data-atleta-id="${escapeAttr(a.atletaId)}">
        <i data-lucide="undo-2"></i> Remover
      </button>
    </div>
  `).join("");

  lista.querySelectorAll(".btn-remover-atleta-lote").forEach(btn => {
    btn.addEventListener("click", () => removerAtletaDoLote(btn.dataset.atletaId));
  });
}

function preencherSelectAtletasParaAdicionar(lote) {
  const select = document.getElementById("editAddAtleta");
  if (!select) return;

  const idsJaNoLote = new Set(lote.itens.filter(i => i.estornado !== true).map(i => i.atletaId));
  const equipe = normalizarEquipeLote(lote.equipe);

  let atletas = Object.values(appState.mapAtletas || {}).filter(a => {
    if (!a || a.role !== "atleta" || a.ativo === false || a.status !== "Aprovado") return false;
    if (idsJaNoLote.has(a.id)) return false;
    if (!equipe || equipe === "Ambas" || equipe === "Comitê") return a.equipe === "Bicicleta" || a.equipe === "Corrida";
    return a.equipe === equipe;
  });

  atletas.sort((a,b) => String(a.nome || "").localeCompare(String(b.nome || "")));

  select.innerHTML = atletas.length
    ? `<option value="">Selecione um atleta</option>` + atletas.map(a => `<option value="${escapeAttr(a.id)}">${escapeHtml(a.nome)} · ${escapeHtml(a.equipe || "-")}</option>`).join("")
    : `<option value="">Nenhum atleta disponível para adicionar</option>`;
}

async function preencherSelectRegrasParaAdicionar(lote) {
  const select = document.getElementById("editAddRegra");
  if (!select) return;

  const equipe = normalizarEquipeLote(lote.equipe);
  const tipo = lote.tipo || "treino";

  try {
    const snap = await getDocs(query(collection(db, "regras_pontuacao")));
    const regras = [];
    snap.forEach(d => {
      const r = { id: d.id, ...d.data() };
      const modalidadeOk = !r.modalidade || r.modalidade === "Ambas" || !equipe || equipe === "Comitê" || r.modalidade === equipe;
      const tipos = r.tiposLancamento || r.tipos || [];
      const tipoOk = tipos.length === 0 || tipos.includes(tipo) || tipos.includes("todos") || tipos.includes("Todos");
      if (modalidadeOk && tipoOk) regras.push(r);
    });

    regras.sort((a,b) => String(a.descricao || "").localeCompare(String(b.descricao || "")));

    select.innerHTML = regras.length
      ? `<option value="">Selecione uma regra</option>` + regras.map(r => `<option value="${escapeAttr(r.id)}" data-pontos="${Number(r.pontos) || 0}" data-desc="${escapeAttr(r.descricao || "")}">${escapeHtml(r.descricao || "Regra")} · ${Number(r.pontos) || 0} pts</option>`).join("")
      : `<option value="">Nenhuma regra disponível</option>`;

    document.getElementById("editAddPontos").value = "";
  } catch (err) {
    select.innerHTML = `<option value="">Erro ao carregar regras</option>`;
  }
}

async function salvarEdicaoLote() {
  const loteKey = document.getElementById("editLoteKey")?.value;
  const lote = lotesRenderizados.get(loteKey);
  if (!lote) return showToast("Lançamento não localizado.", "error");

  const novaDescricao = document.getElementById("editLoteDescricao")?.value.trim();
  const novaData = document.getElementById("editLoteData")?.value;
  const novoKm = Number(String(document.getElementById("editLoteKm")?.value || "0").replace(",", ".")) || 0;

  if (!novaDescricao || !novaData) {
    return showToast("Preencha descrição e data.", "error");
  }

  const btn = document.getElementById("btnSalvarEditLote");
  btn.disabled = true;
  btn.innerHTML = "Salvando...";

  try {
    const batch = writeBatch(db);
    const agora = new Date().toISOString();
    const usuario = getUsuarioAuditoria();

    lote.itens.filter(i => i.estornado !== true).forEach(item => {
      if (!item.id) return;
      const pontos = Number(item.pontos) || 0;
      batch.update(doc(db, "historico_pontos", item.id), {
        descTreino: novaDescricao,
        tituloLancamento: novaDescricao,
        dataTreino: novaData,
        kmPercorrido: pontos > 0 ? novoKm : 0,
        atualizadoEm: agora,
        atualizadoPor: usuario.uid,
        atualizadoPorNome: usuario.nome,
        loteEditado: true
      });
    });

    registrarAuditoriaNoBatch(batch, "lote_dados_atualizados", "historico_pontos", lote.id, {
      descricaoAnterior: lote.titulo,
      descricaoNova: novaDescricao,
      dataAnterior: lote.dataTreino,
      dataNova: novaData,
      kmNovo: novoKm
    });

    await batch.commit();

    appState.historicoCompleto = (appState.historicoCompleto || []).map(h => {
      if (!lote.itens.some(i => i.id === h.id) || h.estornado === true) return h;
      const pontos = Number(h.pontos) || 0;
      return {
        ...h,
        descTreino: novaDescricao,
        tituloLancamento: novaDescricao,
        dataTreino: novaData,
        kmPercorrido: pontos > 0 ? novoKm : 0,
        atualizadoEm: agora,
        atualizadoPor: usuario.uid,
        atualizadoPorNome: usuario.nome,
        loteEditado: true
      };
    });

    renderizarExtratoAgrupado();
    const loteAtualizado = lotesRenderizados.get(loteKey) || lote;
    preencherResumoEdicaoLote(loteAtualizado);
    preencherListaAtletasDoLote(loteAtualizado);
    showToast("Dados gerais do lançamento atualizados.", "success");
  } catch (err) {
    showToast("Erro ao editar lançamento: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="save"></i> Salvar dados gerais`;
    if (typeof lucide !== "undefined") lucide.createIcons();
  }
}

async function removerAtletaDoLote(atletaId) {
  const loteKey = document.getElementById("editLoteKey")?.value;
  const lote = lotesRenderizados.get(loteKey);
  if (!lote || !atletaId) return;

  const itensAtleta = lote.itens.filter(i => i.atletaId === atletaId && i.estornado !== true);
  if (!itensAtleta.length) return showToast("Este atleta não possui registros ativos neste lançamento.", "error");

  const nome = itensAtleta[0].atletaNome || appState.mapAtletas[atletaId]?.nome || "Atleta";
  const pontos = itensAtleta.reduce((s,i) => s + (Number(i.pontos) || 0), 0);
  const motivo = prompt(`Informe o motivo para remover ${nome} deste lançamento:`);

  if (!motivo || !motivo.trim()) {
    return showToast("Motivo obrigatório para remover atleta do lançamento.", "error");
  }

  mostrarConfirmacao("Remover atleta do lançamento", `Remover ${nome} deste lançamento?\n\nImpacto: -${pontos} ponto(s) no total do atleta.\nA ação ficará registrada na auditoria.`, async () => {
    try {
      const batch = writeBatch(db);
      const agora = new Date().toISOString();
      const usuario = getUsuarioAuditoria();

      itensAtleta.forEach(item => {
        if (!item.id) return;
        batch.update(doc(db, "historico_pontos", item.id), {
          estornado: true,
          estornadoEm: agora,
          estornadoPor: usuario.uid,
          estornadoPorNome: usuario.nome,
          motivoEstorno: motivo.trim(),
          tipoAjuste: "remocao_lote"
        });
      });

      if (pontos !== 0) {
        batch.update(doc(db, "atletas", atletaId), { pontuacaoTotal: increment(-pontos) });
      }

      registrarAuditoriaNoBatch(batch, "lote_atleta_removido", "historico_pontos", lote.id, {
        atletaId,
        atletaNome: nome,
        pontosRemovidos: pontos,
        motivo: motivo.trim()
      });

      await batch.commit();

      appState.historicoCompleto = (appState.historicoCompleto || []).map(h => {
        if (!itensAtleta.some(i => i.id === h.id)) return h;
        return {
          ...h,
          estornado: true,
          estornadoEm: agora,
          estornadoPor: usuario.uid,
          estornadoPorNome: usuario.nome,
          motivoEstorno: motivo.trim(),
          tipoAjuste: "remocao_lote"
        };
      });

      if (appState.mapAtletas[atletaId] && pontos !== 0) {
        appState.mapAtletas[atletaId].pontuacaoTotal = Number(appState.mapAtletas[atletaId].pontuacaoTotal || 0) - pontos;
      }

      renderizarExtratoAgrupado();
      const loteAtualizado = lotesRenderizados.get(loteKey);
      if (loteAtualizado) {
        preencherResumoEdicaoLote(loteAtualizado);
        preencherListaAtletasDoLote(loteAtualizado);
        preencherSelectAtletasParaAdicionar(loteAtualizado);
      }

      showToast("Atleta removido do lançamento.", "success");
    } catch (err) {
      showToast("Erro ao remover atleta: " + err.message, "error");
    }
  }, "danger");
}

async function adicionarAtletaAoLote() {
  const loteKey = document.getElementById("editLoteKey")?.value;
  const lote = lotesRenderizados.get(loteKey);
  if (!lote) return showToast("Lançamento não localizado.", "error");

  const atletaId = document.getElementById("editAddAtleta")?.value;
  const regraSelect = document.getElementById("editAddRegra");
  const regraId = regraSelect?.value;
  const regraOpt = regraSelect?.selectedOptions?.[0];
  const regraDesc = regraOpt?.dataset?.desc || regraOpt?.textContent?.split(" · ")[0] || "Ajuste manual";
  const pontos = Number(document.getElementById("editAddPontos")?.value || 0) || 0;
  const km = Number(String(document.getElementById("editAddKm")?.value || "0").replace(",", ".")) || 0;
  const obs = document.getElementById("editAddObs")?.value.trim() || "Inclusão posterior no lançamento";

  if (!atletaId) return showToast("Selecione um atleta para adicionar.", "error");
  if (!regraId) return showToast("Selecione uma regra para o atleta.", "error");

  const atleta = appState.mapAtletas[atletaId];
  if (!atleta) return showToast("Atleta não localizado.", "error");

  const jaExiste = lote.itens.some(i => i.atletaId === atletaId && i.estornado !== true);
  if (jaExiste) return showToast("Este atleta já está ativo neste lançamento.", "error");

  mostrarConfirmacao("Adicionar atleta ao lançamento", `Adicionar ${atleta.nome} ao lançamento?\n\nImpacto: +${pontos} ponto(s).\nA ação ficará registrada na auditoria.`, async () => {
    try {
      const batch = writeBatch(db);
      const agora = new Date().toISOString();
      const usuario = getUsuarioAuditoria();
      const loteId = lote.itens[0]?.loteId || lote.id;
      const novoRef = doc(collection(db, "historico_pontos"));

      const novoRegistro = {
        atletaId,
        atletaNome: atleta.nome,
        atletaEquipe: atleta.equipe,
        regraId,
        regraDesc,
        pontos,
        descTreino: lote.titulo,
        tituloLancamento: lote.titulo,
        dataTreino: lote.dataTreino,
        eventoId: lote.itens[0]?.eventoId || "",
        loteId,
        tipoLancamento: lote.tipo || "treino",
        modalidade: lote.equipe || atleta.equipe,
        kmPercorrido: pontos > 0 ? km : 0,
        criadoEm: agora,
        criadoPor: usuario.uid,
        criadoPorNome: usuario.nome,
        tipoAjuste: "inclusao_posterior",
        observacaoAjuste: obs
      };

      batch.set(novoRef, novoRegistro);

      if (pontos !== 0) {
        batch.update(doc(db, "atletas", atletaId), { pontuacaoTotal: increment(pontos) });
      }

      registrarAuditoriaNoBatch(batch, "lote_atleta_adicionado", "historico_pontos", lote.id, {
        atletaId,
        atletaNome: atleta.nome,
        regraId,
        regraDesc,
        pontosAdicionados: pontos,
        km,
        observacao: obs
      });

      await batch.commit();

      appState.historicoCompleto = [
        ...(appState.historicoCompleto || []),
        { id: novoRef.id, ...novoRegistro }
      ];

      if (appState.mapAtletas[atletaId] && pontos !== 0) {
        appState.mapAtletas[atletaId].pontuacaoTotal = Number(appState.mapAtletas[atletaId].pontuacaoTotal || 0) + pontos;
      }

      document.getElementById("editAddAtleta").value = "";
      document.getElementById("editAddRegra").value = "";
      document.getElementById("editAddPontos").value = "";
      document.getElementById("editAddKm").value = "";
      document.getElementById("editAddObs").value = "";

      renderizarExtratoAgrupado();
      const loteAtualizado = lotesRenderizados.get(loteKey) || lotesRenderizados.get(loteId);
      if (loteAtualizado) {
        document.getElementById("editLoteKey").value = loteAtualizado.id;
        preencherResumoEdicaoLote(loteAtualizado);
        preencherListaAtletasDoLote(loteAtualizado);
        preencherSelectAtletasParaAdicionar(loteAtualizado);
        await preencherSelectRegrasParaAdicionar(loteAtualizado);
      }

      showToast("Atleta adicionado ao lançamento.", "success");
    } catch (err) {
      showToast("Erro ao adicionar atleta: " + err.message, "error");
    }
  });
}


async function estornarLoteInteiro() {
  const loteKey = document.getElementById("editLoteKey")?.value;
  const lote = lotesRenderizados.get(loteKey);
  if (!lote) return showToast("Lançamento não localizado.", "error");

  const itensAtivos = lote.itens.filter(i => i.estornado !== true);
  if (!itensAtivos.length) return showToast("Este lançamento não possui registros ativos.", "info");

  const pontosPorAtleta = {};
  itensAtivos.forEach(i => {
    const pts = Number(i.pontos) || 0;
    if (!pontosPorAtleta[i.atletaId]) pontosPorAtleta[i.atletaId] = 0;
    pontosPorAtleta[i.atletaId] += pts;
  });

  const totalPontos = itensAtivos.reduce((s, i) => s + (Number(i.pontos) || 0), 0);
  const motivo = prompt("Informe o motivo para cancelar o lançamento inteiro:");
  if (!motivo || !motivo.trim()) {
    return showToast("Motivo obrigatório para cancelar o lançamento.", "error");
  }

  mostrarConfirmacao(
    "Cancelar lançamento inteiro",
    `Cancelar todo o lançamento ${lote.titulo}?\n\nRegistros afetados: ${itensAtivos.length}\nPontos removidos: ${totalPontos}\n\nA ação ficará registrada na auditoria.`,
    async () => {
      try {
        const batch = writeBatch(db);
        const agora = new Date().toISOString();
        const usuario = getUsuarioAuditoria();

        itensAtivos.forEach(item => {
          if (!item.id) return;
          batch.update(doc(db, "historico_pontos", item.id), {
            estornado: true,
            estornadoEm: agora,
            estornadoPor: usuario.uid,
            estornadoPorNome: usuario.nome,
            motivoEstorno: motivo.trim(),
            tipoAjuste: "estorno_lote_inteiro"
          });
        });

        Object.entries(pontosPorAtleta).forEach(([atletaId, pontos]) => {
          if (pontos !== 0) batch.update(doc(db, "atletas", atletaId), { pontuacaoTotal: increment(-pontos) });
        });

        registrarAuditoriaNoBatch(batch, "lote_estornado_inteiro", "historico_pontos", lote.id, {
          titulo: lote.titulo,
          registrosAfetados: itensAtivos.length,
          pontosRemovidos: totalPontos,
          motivo: motivo.trim()
        });

        await batch.commit();

        appState.historicoCompleto = (appState.historicoCompleto || []).map(h => {
          if (!itensAtivos.some(i => i.id === h.id)) return h;
          return {
            ...h,
            estornado: true,
            estornadoEm: agora,
            estornadoPor: usuario.uid,
            estornadoPorNome: usuario.nome,
            motivoEstorno: motivo.trim(),
            tipoAjuste: "estorno_lote_inteiro"
          };
        });

        Object.entries(pontosPorAtleta).forEach(([atletaId, pontos]) => {
          if (appState.mapAtletas[atletaId] && pontos !== 0) {
            appState.mapAtletas[atletaId].pontuacaoTotal = Number(appState.mapAtletas[atletaId].pontuacaoTotal || 0) - pontos;
          }
        });

        renderizarExtratoAgrupado();
        fecharModalEditarLote();
        showToast("Lote estornado com sucesso.", "success");
      } catch (err) {
        showToast("Erro ao cancelar lançamento: " + err.message, "error");
      }
    },
    "danger"
  );
}

function normalizarEquipeLote(equipe) {
  if (!equipe) return "";
  if (equipe === "Bike") return "Bicicleta";
  if (String(equipe).includes("Bicicleta")) return "Bicicleta";
  if (String(equipe).includes("Corrida")) return "Corrida";
  return equipe;
}

function getUsuarioAuditoria() {
  const uid = appState.currentUser?.uid || "";
  const usuario = appState.mapAtletas?.[uid];
  return { uid, nome: usuario?.nome || "Comitê Gestor" };
}

function registrarAuditoriaNoBatch(batch, acao, entidade, entidadeId, dados = {}) {
  const usuario = getUsuarioAuditoria();
  batch.set(doc(collection(db, "auditoria")), {
    acao,
    entidade,
    entidadeId,
    dados,
    usuarioId: usuario.uid,
    usuarioNome: usuario.nome,
    criadoEm: new Date().toISOString()
  });
}

function capitalizar(txt = "") {
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function tentarAbrirFichaAtleta(atletaId) {
  if (!atletaId) return;

  let btn = null;
  try {
    btn = document.querySelector(`.btn-ficha[data-id="${CSS.escape(atletaId)}"]`);
  } catch {
    btn = null;
  }

  if (btn) {
    btn.click();
  } else {
    showToast("Abra a ficha pela tela de Equipes para ver todos os detalhes deste atleta.", "info");
  }
}

// =====================================================
// HELPERS
// =====================================================

function calcularKmGrupo(itens = []) {
  const vistos = new Set();
  let total = 0;

  itens.forEach(i => {
    const km = Number(i.kmPercorrido || i.km || 0);
    if (!km || km <= 0) return;

    const chave = `${i.atletaId || ""}|${i.loteId || i.eventoId || `${i.dataTreino || ""}|${i.descTreino || ""}`}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    total += km;
  });

  return total;
}

function formatarKm(valor) {
  const n = Number(valor) || 0;
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: n % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1
  });
}

function gerarLoteId(tipo) {
  return `${tipo}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function rotuloTipo(tipo) {
  return {
    treino: "Treino",
    evento: "Evento",
    avulso: "Avulso",
    importacao: "Importação"
  }[tipo] || "Lançamento";
}

function zerarHora(data) {
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatarData(dataStr) {
  if (!dataStr) return "-";

  try {
    return new Date(dataStr + "T00:00:00").toLocaleDateString("pt-BR");
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
