// =====================================================
// js/modules/gestao.js
// =====================================================
import { db, collection, addDoc, doc, updateDoc, deleteDoc, getDocs, query, where, writeBatch } from '../firebase.js';
import { appState } from './state.js';
import { showToast, mostrarConfirmacao, mostrarConfirmacaoDestrutiva } from './ui.js';

let atualizarTelasCallback = null;
export function setAtualizarTelasGestao(cb) { atualizarTelasCallback = cb; }

function escapeHtml(s) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function escapeAttr(s) { return String(s ?? "").replace(/"/g,"&quot;"); }

function renderCampoExtraCadastro(campo) {
  const base = `data-campo-id="${escapeAttr(campo.id)}"`;
  const label = `<label>${escapeHtml(campo.label || "Campo")}</label>`;
  let input = "";
  if (campo.tipo === "numero") {
    input = `<input type="number" ${base} />`;
  } else if (campo.tipo === "data") {
    input = `<input type="date" ${base} />`;
  } else if (campo.tipo === "simnao") {
    input = `<select ${base}><option value="">Selecione</option><option value="Sim">Sim</option><option value="Não">Não</option></select>`;
  } else if (campo.tipo === "selecao") {
    const opcoes = Array.isArray(campo.opcoes) ? campo.opcoes : [];
    input = `<select ${base}><option value="">Selecione</option>${opcoes.map(op => `<option value="${escapeAttr(op)}">${escapeHtml(op)}</option>`).join("")}</select>`;
  } else {
    input = `<input type="text" ${base} />`;
  }
  return `<div class="cadastro-field${campo.obrigatorio ? ' cadastro-field--required' : ''}">${label}${input}</div>`;
}

export function renderCamposExtrasCadastro() {
  const container = document.getElementById("cadastroExtraCampos");
  if (!container) return;
  const campos = Array.isArray(appState.camposFichaConfig) ? appState.camposFichaConfig : [];
  if (!campos.length) { container.innerHTML = ""; return; }

  let html = `<div class="cadastro-section-label">Campos adicionais</div><div class="cadastro-grid">`;
  let grupoAtual = null;
  for (const campo of campos) {
    const grupo = campo.grupo || null;
    if (grupo && grupo !== grupoAtual) {
      grupoAtual = grupo;
      html += `</div><div class="cadastro-section-label cadastro-section-label--sub">${escapeHtml(grupo)}</div><div class="cadastro-grid">`;
    }
    html += renderCampoExtraCadastro(campo);
  }
  html += `</div>`;
  container.innerHTML = html;
}

export function setupCadastrarPessoa() {
  document.getElementById("btnCadastrarPessoa")?.addEventListener("click", async (e) => {
    const nome = document.getElementById("novoNome")?.value.trim();
    const email = document.getElementById("novoEmail")?.value.trim();
    const sexo = document.getElementById("novoSexo")?.value;
    const dataNasc = document.getElementById("novaDataNasc")?.value;
    const localidade = document.getElementById("novaLocalidade")?.value.trim();
    const anoEntrada = document.getElementById("novoAnoEntrada")?.value.trim();
    const papel = document.getElementById("novoPapel")?.value;
    const btn = e.currentTarget;

    if (!nome) return showToast("Preencha o nome obrigatório!", "error");

    const camposFicha = {};
    document.querySelectorAll("#cadastroExtraCampos [data-campo-id]").forEach(el => {
      camposFicha[el.dataset.campoId] = String(el.value || "").trim();
    });

    try {
      btn.textContent = "Salvando..."; btn.classList.add("loading"); btn.disabled = true;

      await addDoc(collection(db, "atletas"), {
        nome, email: email || "", sexo: sexo || "Masculino", dataNascimento: dataNasc || "",
        localidade: localidade || "", anoEntrada: anoEntrada || new Date().getFullYear(),
        role: "atleta", equipe: papel, status: "Aprovado", ativo: true,
        pontuacaoTotal: 0, recusas: 0, camposFicha, criadoEm: new Date().toISOString()
      });

      document.querySelectorAll("#sub-cadastrar input").forEach(i => i.value = "");
      document.querySelectorAll("#sub-cadastrar select").forEach(s => s.selectedIndex = 0);
      showToast(`${nome} adicionado com sucesso!`, "success");

      document.querySelector('[data-target="sub-equipes"]')?.click();
      if(atualizarTelasCallback) atualizarTelasCallback();
    } catch (error) {
      showToast("Erro ao adicionar: " + error.message, "error");
    } finally {
      btn.innerHTML = '<i data-lucide="user-plus"></i> Adicionar atleta'; btn.classList.remove("loading"); btn.disabled = false;
      if (window.lucide) lucide.createIcons();
    }
  });
}

export function setupImportacaoAtletas() {
  document.getElementById("btnExportarModeloAtletas")?.addEventListener("click", async () => {
    if (!window._excelUtils?.gerarModeloAtletas) return showToast("Módulo Excel não carregado.", "error");
    try {
      await window._excelUtils.gerarModeloAtletas();
    } catch (err) {
      showToast("Erro ao gerar modelo: " + err.message, "error");
    }
  });

  document.getElementById("btnImportarAtletasExcel")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
      await processarImportacaoAtletas(json);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ""; 
  });
}

async function processarImportacaoAtletas(linhas) {
  const { parseDateImport } = window._excelUtils || {};

  // Aceita tanto o formato novo ("Equipe *") quanto o antigo para retrocompatibilidade
  const getEquipe = l =>
    l["Equipe *"] || l["Equipe (Bicicleta / Corrida / Fila - Bicicleta / Fila - Corrida)"] || "";

  const cadastrosValidos = linhas.filter(l => l["Nome Completo"] && getEquipe(l));
  if (cadastrosValidos.length === 0) return showToast("Nenhum atleta válido encontrado na planilha.", "error");

  mostrarConfirmacao("Importar Atletas", `Deseja adicionar ${cadastrosValidos.length} novos membros ao sistema?`, async () => {
    try {
      showToast("Processando cadastros...", "info");
      const batch = writeBatch(db);

      cadastrosValidos.forEach(l => {
        const ativoRaw = String(l["Ativo"] || "Sim").trim().toLowerCase();
        const ativo    = ativoRaw !== "não" && ativoRaw !== "nao" && ativoRaw !== "false";
        const dataNasc = parseDateImport
          ? parseDateImport(l["Data Nascimento"] || l["Data Nascimento (AAAA-MM-DD)"])
          : (l["Data Nascimento"] || l["Data Nascimento (AAAA-MM-DD)"] || "");

        const novoRef = doc(collection(db, "atletas"));
        batch.set(novoRef, {
          nome:           String(l["Nome Completo"]).trim(),
          email:          l["E-mail Corporativo"] || "",
          sexo:           l["Sexo"] || l["Sexo (Masculino/Feminino)"] || "",
          dataNascimento: dataNasc,
          localidade:     String(l["Localidade"] || "").trim(),
          anoEntrada:     l["Ano Entrada"] || new Date().getFullYear(),
          equipe:         String(getEquipe(l)).trim(),
          role: "atleta", status: "Aprovado", ativo,
          pontuacaoTotal: 0, recusas: 0,
          criadoEm: new Date().toISOString()
        });
      });

      await batch.commit();
      showToast("Atletas importados com sucesso!", "success");
      if (atualizarTelasCallback) atualizarTelasCallback();
    } catch (err) {
      showToast("Erro ao importar: " + err.message, "error");
    }
  });
}

export function setupToggleAtivos() {
  document.addEventListener("change", async (e) => { 
    if(e.target.classList.contains("toggle-ativo")) {
      const isAtivo = e.target.checked; 
      const id = e.target.dataset.id;

      if (!isAtivo) {
        const motivo = prompt("Qual o motivo da saída/desligamento do atleta do programa?"); 
        try { 
          await updateDoc(doc(db, "atletas", id), { 
            ativo: false, dataSaida: new Date().toISOString(), motivoSaida: motivo || "Não informado"
          }); 
          showToast("Atleta Inativado.", "info"); 
        } catch(err) { showToast("Erro ao inativar.", "error"); }
      } else {
        try { 
          await updateDoc(doc(db, "atletas", id), { ativo: true, dataSaida: null, motivoSaida: null }); 
          showToast("Atleta Reativado!", "success"); 
        } catch(err) { showToast("Erro ao ativar.", "error"); }
      }
      
      const td = e.target.closest('tr').querySelector('td'); 
      if(isAtivo) td.classList.remove('inativo-txt'); else td.classList.add('inativo-txt'); 
    }
  }); 
}

export function setupLimparBase() { 
  document.getElementById("btnLimparBase")?.addEventListener("click", () => { 
    if (appState.userRole !== "admin") return; 
    
    mostrarConfirmacaoDestrutiva("Isso apagará permanentemente todos os atletas, histórico de pontos, regras e despesas. Essa ação não pode ser desfeita.", "LIMPAR", async () => {
      
      const btn = document.getElementById("btnLimparBase"); 
      btn.innerHTML = "Apagando base..."; btn.disabled = true; 
      
      try { 
        const colunas = ["historico_pontos", "regras_pontuacao", "despesas", "comentarios_atletas"]; 
        for (let c of colunas) { 
          const snap = await getDocs(collection(db, c)); 
          snap.forEach(async (d) => await deleteDoc(doc(db, c, d.id))); 
        } 
        
        const snapA = await getDocs(collection(db, "atletas")); 
        snapA.forEach(async (d) => { 
          if (d.data().role !== "admin") {
            await deleteDoc(doc(db, "atletas", d.id)); 
          }
        }); 
        
        showToast("Base Limpa permanentemente!", "success"); 
        setTimeout(() => window.location.reload(), 2000); 
      } catch(err) { 
        showToast("Erro durante a exclusão.", "error"); 
        btn.disabled = false; btn.innerHTML = "Zerar Todo o Banco de Dados";
      }
    }, "danger");
  }); 
}
