// js/modules/financeiro.js
import { db, collection, getDocs, doc, addDoc, updateDoc, deleteDoc } from '../firebase.js';
import { appState } from './state.js';
import { showToast, mostrarConfirmacao } from './ui.js';

export function setupFinanceiroPlanilha() { 
  const modal = document.getElementById("modalLinhaVerba"); 
  const canEdit = appState.userRole === "admin" || appState.userPermissoes.includes("financeiro_edit"); 
  
  if(document.getElementById("areaAcoesFinanceiro")) {
    document.getElementById("areaAcoesFinanceiro").style.display = canEdit ? "block" : "none"; 
  }
  
  const chkAvulso = document.getElementById("checkAvulso"); 
  const areaProposto = document.getElementById("areaProposto"); 
  
  if(chkAvulso) { 
    chkAvulso.addEventListener("change", (e) => { 
      if(e.target.checked) { 
        areaProposto.style.opacity = "0.3"; 
        areaProposto.style.pointerEvents = "none"; 
        document.getElementById("vPropInsc").value = ""; 
        document.getElementById("vPropTransp").value = ""; 
        document.getElementById("vPropHosp").value = ""; 
        document.getElementById("vPropAlim").value = ""; 
        document.getElementById("vPropDemais").value = ""; 
      } else { 
        areaProposto.style.opacity = "1"; 
        areaProposto.style.pointerEvents = "auto"; 
      } 
    }); 
  } 
  
  if (document.getElementById("btnAbrirModalDespesa")) { 
    document.getElementById("btnAbrirModalDespesa").addEventListener("click", () => { 
      document.getElementById("verbaEditId").value = ""; 
      document.getElementById("verbaCategoria").value = "Provas / Inscrições"; 
      document.getElementById("verbaEquipe").value = "Corrida e Bike"; 
      document.getElementById("verbaEvento").value = ""; 
      
      if(chkAvulso) { 
        chkAvulso.checked = false; 
        chkAvulso.dispatchEvent(new Event('change')); 
      } 
      document.getElementById("vPropInsc").value = ""; 
      document.getElementById("vPropTransp").value = ""; 
      document.getElementById("vPropHosp").value = ""; 
      document.getElementById("vPropAlim").value = ""; 
      document.getElementById("vPropDemais").value = ""; 
      document.getElementById("vRealizadoTotal").value = ""; 
      modal.style.display = "flex"; 
    }); 
  } 
  
  document.getElementById("fecharModalVerba")?.addEventListener("click", () => modal.style.display = "none"); 
  
  document.getElementById("salvarVerbaBtn")?.addEventListener("click", async (e) => { 
    const idEdit = document.getElementById("verbaEditId").value; 
    const cat = document.getElementById("verbaCategoria").value; 
    const eq = document.getElementById("verbaEquipe").value; 
    const ev = document.getElementById("verbaEvento").value.trim(); 
    
    if(!ev) return showToast("Informe o Título/Evento!", "error"); 
    
    const p = (id) => parseFloat(document.getElementById(id).value) || 0; 
    let propInsc = 0, propTransp = 0, propHosp = 0, propAlim = 0, propDemais = 0, totalProp = 0; 
    
    if(chkAvulso && !chkAvulso.checked) { 
      propInsc = p("vPropInsc"); 
      propTransp = p("vPropTransp"); 
      propHosp = p("vPropHosp"); 
      propAlim = p("vPropAlim"); 
      propDemais = p("vPropDemais"); 
      totalProp = propInsc + propTransp + propHosp + propAlim + propDemais; 
    } 
    
    const totalRealizado = p("vRealizadoTotal"); 
    const desvio = totalProp - totalRealizado; 
    
    const dados = { 
      categoria: cat, 
      equipe: eq, 
      evento: ev, 
      avulso: chkAvulso ? chkAvulso.checked : false, 
      propInsc: propInsc, 
      propTransp: propTransp, 
      propHosp: propHosp, 
      propAlim: propAlim, 
      propDemais: propDemais, 
      totalProposto: totalProp, 
      totalRealizado: totalRealizado, 
      desvio: desvio, 
      atualizadoEm: new Date().toISOString() 
    }; 
    
    e.target.textContent = "Salvando..."; 
    e.target.disabled = true; 
    
    try { 
      if(idEdit) { 
        await updateDoc(doc(db, "despesas", idEdit), dados); 
        showToast("Linha atualizada!", "success"); 
      } else { 
        dados.criadoEm = new Date().toISOString(); 
        await addDoc(collection(db, "despesas"), dados); 
        showToast("Linha adicionada!", "success"); 
      } 
      modal.style.display = "none"; 
      carregarFinanceiroPlanilha(); 
    } catch(err) { 
      showToast("Erro ao gravar financeiro.", "error"); 
    } 
    e.target.textContent = "Salvar na Planilha"; 
    e.target.disabled = false; 
  }); 
  
  document.getElementById("btnExportarFinExcel")?.addEventListener("click", exportarFinanceiroPlanilha); 
}

export async function carregarFinanceiroPlanilha() { 
  try { 
    const snap = await getDocs(collection(db, "despesas")); 
    let tempDocs = []; 
    snap.forEach(d => tempDocs.push({id: d.id, ...d.data()})); 
    
    tempDocs.sort((a, b) => new Date(a.criadoEm || a.dataBase || 0) - new Date(b.criadoEm || b.dataBase || 0)); 
    appState.historicoFinanceiro = tempDocs; 
    
    let htmlMaster = ""; 
    let resumoEquipes = { Corrida: { prop: 0, real: 0 }, Bike: { prop: 0, real: 0 }, Ambas: { prop: 0, real: 0 } }; 
    let resumoCategorias = { 
      "Provas / Inscrições": { prop: 0, real: 0, color: "var(--secondary)" }, 
      "Mensalidade Treinador": { prop: 0, real: 0, color: "#3498db" }, 
      "Encontros e Eventos": { prop: 0, real: 0, color: "#f39c12" }, 
      "Uniformes e Materiais": { prop: 0, real: 0, color: "var(--primary)" }, 
      "Outros": { prop: 0, real: 0, color: "#95a5a6" } 
    }; 
    
    let globalProp = 0; 
    let globalReal = 0; 
    const canEdit = appState.userRole === "admin" || appState.userPermissoes.includes("financeiro_edit"); 
    const num = (v) => (v||0).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2}); 
    const moneyStr = (v) => v.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}); 
    
    appState.historicoFinanceiro.forEach(v => { 
      const equipe = v.equipe || "Ambas"; 
      const categoria = v.categoria || "Outros"; 
      const evento = v.evento || v.descricao || "Custo Antigo"; 
      const totalProp = v.totalProposto || v.orcadoTotal || 0; 
      const totalReal = v.totalRealizado || 0; 
      const desvio = v.desvio !== undefined ? v.desvio : (totalProp - totalReal); 
      
      globalProp += totalProp; 
      globalReal += totalReal; 
      
      if(equipe === "Corrida") { 
        resumoEquipes.Corrida.prop += totalProp; resumoEquipes.Corrida.real += totalReal; 
      } else if(equipe === "Bicicleta" || equipe === "Bike") { 
        resumoEquipes.Bike.prop += totalProp; resumoEquipes.Bike.real += totalReal; 
      } else { 
        resumoEquipes.Ambas.prop += totalProp; resumoEquipes.Ambas.real += totalReal; 
      } 
      
      if(resumoCategorias[categoria]) { 
        resumoCategorias[categoria].prop += totalProp; 
        resumoCategorias[categoria].real += totalReal; 
      } else { 
        resumoCategorias["Outros"].prop += totalProp; 
        resumoCategorias["Outros"].real += totalReal; 
      } 
      
      const isAvulso = v.avulso ? `<span title="Lançamento Não Previsto" style="color:var(--accent); font-size:0.75rem; font-weight:bold;">[AVULSO]</span>` : ""; 
      const corDesvio = desvio < 0 ? "color: var(--danger); font-weight:bold;" : "color: var(--secondary);"; 
      const bgReal = totalReal > 0 ? "background: rgba(39, 174, 96, 0.05);" : ""; 
      
      let btnAcoes = ""; 
      if(canEdit) { 
        btnAcoes = `<button class="btn-acao btn-edit-verba" data-id="${v.id}" style="color:var(--primary); padding:4px;"><i data-lucide="edit-2" style="width:14px;"></i></button> 
                    <button class="btn-acao btn-del-verba" data-id="${v.id}" style="color:var(--danger); padding:4px;"><i data-lucide="trash" style="width:14px;"></i></button>`; 
      } 
      
      htmlMaster += `
        <tr>
          <td><small style="font-weight:600;">${equipe}</small></td>
          <td><span style="font-size:0.75rem; color:var(--text-light); background:var(--border); padding:2px 6px; border-radius:4px;">${categoria}</span></td>
          <td><strong>${evento}</strong> ${isAvulso}</td>
          <td>${v.propInsc > 0 ? num(v.propInsc) : '-'}</td>
          <td>${v.propTransp > 0 ? num(v.propTransp) : '-'}</td>
          <td>${v.propHosp > 0 ? num(v.propHosp) : '-'}</td>
          <td>${v.propAlim > 0 ? num(v.propAlim) : '-'}</td>
          <td>${v.propDemais > 0 ? num(v.propDemais) : '-'}</td>
          <td style="font-weight:600; background: rgba(0,0,0,0.02);">${num(totalProp)}</td>
          <td style="font-weight:600; color: #27ae60; ${bgReal}">${num(totalReal)}</td>
          <td style="${corDesvio}">${num(desvio)}</td>
          <td style="text-align:right; white-space:nowrap;">${btnAcoes}</td>
        </tr>`; 
    }); 
    
    if(document.getElementById("tabelaMasterFin")) document.getElementById("tabelaMasterFin").innerHTML = htmlMaster || `<tr><td colspan='12' style='text-align:center;'>Nenhum planejamento registado.</td></tr>`; 
    
    appState.gastoTotalGlobal = globalReal || 0; 
    
    if(document.getElementById("totalInvestimento")) document.getElementById("totalInvestimento").textContent = moneyStr(globalReal); 
    if(document.getElementById("dashFinOrcadoTotal")) document.getElementById("dashFinOrcadoTotal").textContent = moneyStr(globalProp); 
    if(document.getElementById("dashFinRealizadoTotal")) document.getElementById("dashFinRealizadoTotal").textContent = moneyStr(globalReal); 
    
    if(document.getElementById("dashFinSaldoTotal")) { 
      const desvioTotal = globalProp - globalReal; 
      const el = document.getElementById("dashFinSaldoTotal"); 
      el.textContent = moneyStr(desvioTotal); 
      el.style.color = desvioTotal < 0 ? 'var(--danger)' : 'var(--secondary)'; 
      if (el.parentElement) el.parentElement.style.borderLeftColor = desvioTotal < 0 ? 'var(--danger)' : 'var(--secondary)'; 
    } 
    
    let htmlResumo = ""; 
    const arrResumo = [{nome: "Corrida", data: resumoEquipes.Corrida}, {nome: "Bicicleta", data: resumoEquipes.Bike}, {nome: "Equipa Geral (Ambas)", data: resumoEquipes.Ambas}]; 
    
    arrResumo.forEach(r => { 
      if(r.data.prop > 0 || r.data.real > 0) { 
        const desvioEquipe = r.data.prop - r.data.real; 
        const cor = desvioEquipe < 0 ? "color:var(--danger);" : "color:var(--secondary);"; 
        htmlResumo += `<tr><td><strong>${r.nome}</strong></td><td>R$ ${num(r.data.prop)}</td><td style="color:var(--danger); font-weight:bold;">R$ ${num(r.data.real)}</td><td style="font-weight:bold; ${cor}">R$ ${num(desvioEquipe)}</td></tr>`; 
      } 
    }); 
    
    if(document.getElementById("tabelaResumoEquipes")) document.getElementById("tabelaResumoEquipes").innerHTML = htmlResumo || `<tr><td colspan='4'>Sem dados processados.</td></tr>`; 
    
    let htmlCategorias = ""; 
    Object.keys(resumoCategorias).forEach(nomeCat => { 
      const c = resumoCategorias[nomeCat]; 
      if(c.prop > 0 || c.real > 0) { 
        const perc = c.prop > 0 ? Math.min((c.real / c.prop) * 100, 100) : 100; 
        const corBarra = (c.real > c.prop && c.prop > 0) || (c.prop === 0 && c.real > 0) ? "var(--danger)" : c.color; 
        htmlCategorias += `
          <div class="card" style="margin:0; padding:15px; border-left: 4px solid ${c.color}; animation: none;">
             <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
               <strong style="color:var(--text); font-size:0.9rem;">${nomeCat}</strong>
             </div>
             <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:5px;">
               <span style="color:#666;">Proposto: ${moneyStr(c.prop)}</span>
               <span style="color:${c.color}; font-weight:bold;">Real: ${moneyStr(c.real)}</span>
             </div>
             <div class="progress-bar-bg" style="height:6px; margin-bottom:5px;">
               <div class="progress-bar-fill" style="width: ${perc}%; background: ${corBarra};"></div>
             </div>
             <div style="text-align:right; font-size:0.75rem; color:#999;">
               Desvio: <strong style="${c.prop - c.real < 0 ? 'color:var(--danger)' : ''}">${moneyStr(c.prop - c.real)}</strong>
             </div>
          </div>`; 
      } 
    }); 
    
    if(document.getElementById("listaPotesOrcamento")) document.getElementById("listaPotesOrcamento").innerHTML = htmlCategorias || `<p style='color:#999; font-size:0.85rem;'>Sem desdobramento orçamentário.</p>`; 
    
    if(typeof lucide !== 'undefined') lucide.createIcons(); 
    
    document.querySelectorAll(".btn-del-verba").forEach(btn => { 
      btn.addEventListener("click", (e) => { 
        mostrarConfirmacao("Excluir Verba", "Excluir linha orçamental permanentemente?", async () => {
          e.currentTarget.disabled = true; 
          await deleteDoc(doc(db, "despesas", e.currentTarget.dataset.id)); 
          carregarFinanceiroPlanilha(); 
        }, "danger");
      }); 
    }); 
    
    document.querySelectorAll(".btn-edit-verba").forEach(btn => { 
      btn.addEventListener("click", (e) => { 
        const id = e.currentTarget.dataset.id; 
        const v = appState.historicoFinanceiro.find(x => x.id === id); 
        if(!v) return; 
        
        document.getElementById("verbaEditId").value = v.id; 
        document.getElementById("verbaCategoria").value = v.categoria || "Outros"; 
        document.getElementById("verbaEquipe").value = v.equipe || "Corrida e Bike"; 
        document.getElementById("verbaEvento").value = v.evento || v.descricao || ""; 
        
        const chkAvulso = document.getElementById("checkAvulso"); 
        if(chkAvulso) { 
          chkAvulso.checked = v.avulso === true; 
          chkAvulso.dispatchEvent(new Event('change')); 
        } 
        
        document.getElementById("vPropInsc").value = v.propInsc || ""; 
        document.getElementById("vPropTransp").value = v.propTransp || ""; 
        document.getElementById("vPropHosp").value = v.propHosp || ""; 
        document.getElementById("vPropAlim").value = v.propAlim || ""; 
        document.getElementById("vPropDemais").value = v.propDemais || ""; 
        document.getElementById("vRealizadoTotal").value = v.totalRealizado || ""; 
        document.getElementById("modalLinhaVerba").style.display = "flex"; 
      }); 
    }); 
  } catch(err) { 
    showToast("Erro ao carregar ficheiro financeiro.", "error"); 
  } 
}

async function exportarFinanceiroPlanilha() {
  if (appState.historicoFinanceiro.length === 0) return showToast("Nenhuma linha para exportar.", "error");
  if (!window._excelUtils?.exportarFinanceiroXlsx) return showToast("Módulo Excel não carregado.", "error");
  try {
    await window._excelUtils.exportarFinanceiroXlsx(appState.historicoFinanceiro);
  } catch (err) {
    showToast("Erro ao exportar: " + err.message, "error");
  }
}
