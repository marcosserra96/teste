// js/modules/ui.js
import { auth, signOut } from '../firebase.js';

export function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer"); 
  if (!container) return;
  const t = document.createElement("div"); 
  t.className = `toast ${type}`; 
  t.innerHTML = message;
  container.appendChild(t); 
  if(typeof lucide !== 'undefined') lucide.createIcons(); 
  setTimeout(() => t.remove(), 4000);
}

// O Novo Modal de Confirmação Customizado
export function mostrarConfirmacao(titulo, mensagem, callbackSim, tipo = "primary") {
  const modal = document.getElementById("modalConfirmacao");
  if (!modal) return; // Prevenção de erro caso o HTML ainda não tenha o modal
  
  document.getElementById("confirmTitulo").textContent = titulo;
  document.getElementById("confirmMensagem").textContent = mensagem;
  
  const btnOk = document.getElementById("btnConfirmOk");
  btnOk.style.background = tipo === "danger" ? "var(--danger)" : "var(--primary)";
  
  // Clona o botão para remover event listeners de chamadas anteriores
  const novoBtnOk = btnOk.cloneNode(true);
  btnOk.parentNode.replaceChild(novoBtnOk, btnOk);
  
  const fechar = () => modal.style.display = "none";
  
  document.getElementById("btnConfirmCancel").onclick = fechar;
  novoBtnOk.onclick = () => { fechar(); callbackSim(); };
  
  modal.style.display = "flex";
}

export function mostrarConfirmacaoDestrutiva(mensagem, palavraChave, callbackSim) {
  const modal   = document.getElementById("modalConfirmacaoDestrutiva");
  const input   = document.getElementById("confirmDestrInput");
  const btnOk   = document.getElementById("confirmDestrOk");
  const btnCancel = document.getElementById("confirmDestrCancel");
  if (!modal) return;

  document.getElementById("confirmDestrMensagem").textContent = mensagem;
  document.getElementById("confirmDestrPalavra").textContent  = palavraChave;
  input.value   = "";
  btnOk.disabled = true;

  const fechar = () => { modal.style.display = "none"; input.removeEventListener("input", onInput); };

  const onInput = () => { btnOk.disabled = input.value.trim() !== palavraChave; };
  input.addEventListener("input", onInput);

  const novoBtnOk = btnOk.cloneNode(true);
  btnOk.parentNode.replaceChild(novoBtnOk, btnOk);
  novoBtnOk.disabled = true;
  novoBtnOk.addEventListener("click", () => { fechar(); callbackSim(); });
  btnCancel.onclick = fechar;

  modal.style.display = "flex";
  setTimeout(() => input.focus(), 50);
}

export function setupSubTabs() {
  document.querySelectorAll(".sub-tab").forEach(tab => { 
    tab.addEventListener("click", () => { 
      const p = tab.closest('section'); 
      p.querySelectorAll(".sub-tab").forEach(t => t.classList.remove("active")); 
      p.querySelectorAll(".sub-content").forEach(c => c.classList.remove("active")); 
      tab.classList.add("active"); 
      document.getElementById(tab.dataset.target).classList.add("active"); 
    }); 
  });
  
  document.querySelectorAll(".t-tab").forEach(tab => { 
    tab.addEventListener("click", () => { 
      const p = tab.closest('.sub-content'); 
      p.querySelectorAll(".t-tab").forEach(t => t.classList.remove("active")); 
      p.querySelectorAll(".t-content").forEach(c => c.classList.remove("active")); 
      tab.classList.add("active"); 
      document.getElementById(tab.dataset.target).classList.add("active"); 
    }); 
  });
}

export function setupConfiguracoesGerais() {
  document.querySelectorAll(".btn-zoom").forEach(btn => { 
    btn.addEventListener("click", (e) => { 
      document.documentElement.style.fontSize = e.target.dataset.size; 
    }); 
  }); 
  
  const aplicarTema = (tema) => { 
    if(tema === "dark") { 
      document.body.setAttribute("data-theme", "dark"); 
      localStorage.setItem("theme", "dark"); 
    } else { 
      document.body.removeAttribute("data-theme"); 
      localStorage.setItem("theme", "light"); 
    } 
  }; 
  
  if (localStorage.getItem("theme") === "dark") aplicarTema("dark"); 
  
  document.getElementById("btnTemaClaro")?.addEventListener("click", () => aplicarTema("light")); 
  document.getElementById("btnTemaEscuro")?.addEventListener("click", () => aplicarTema("dark")); 
  
  document.getElementById("logoutBtn")?.addEventListener("click", () => { 
    mostrarConfirmacao("Sair do Sistema", "Deseja realmente encerrar a sessão?", async () => {
      await signOut(auth); 
      window.location.href = "index.html"; 
    });
  });
}
