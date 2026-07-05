// =====================================================
// js/login.js - AUTENTICAÇÃO E SOLICITAÇÃO DE ACESSO
// =====================================================
import {
  auth, db,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  getDoc, doc, setDoc, signOut, sendPasswordResetEmail
} from "./firebase.js";

const TEMA_PADRAO_LOGIN = {
  primary: "#009bc1",
  secondary: "#00b37e",
  accent: "#f37021",
  danger: "#e63946"
};

function aplicarCoresLogin(config = {}) {
  const tema = { ...TEMA_PADRAO_LOGIN, ...(config || {}) };
  const root = document.documentElement.style;
  root.setProperty("--azul", tema.primary);
  root.setProperty("--verde", tema.secondary);
  root.setProperty("--destaque", tema.accent);
  root.setProperty("--vermelho", tema.danger);
}

async function carregarCoresLogin() {
  try {
    const local = localStorage.getItem("atletasConfigTemaPortal");
    if (local) aplicarCoresLogin(JSON.parse(local));
  } catch (_) {}

  try {
    const snap = await getDoc(doc(db, "configuracoes", "tema"));
    if (snap.exists()) {
      const data = snap.data();
      aplicarCoresLogin(data);
      localStorage.setItem("atletasConfigTemaPortal", JSON.stringify(data));
    }
  } catch (err) {
    console.warn("Não foi possível carregar as cores do login:", err);
  }
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = message;
  container.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function alternarTela(modo) {
  const boxLogin = document.getElementById("boxLogin");
  const boxSolicitar = document.getElementById("boxSolicitar");
  if (!boxLogin || !boxSolicitar) return;

  const solicitando = modo === "solicitar";
  boxLogin.style.display = solicitando ? "none" : "block";
  boxSolicitar.style.display = solicitando ? "block" : "none";

  const primeiroCampo = document.getElementById(solicitando ? "regNome" : "email");
  setTimeout(() => primeiroCampo?.focus(), 80);
}

const fazerLogin = async () => {
  const email = document.getElementById("email")?.value.trim();
  const pass = document.getElementById("password")?.value.trim();
  const btn = document.getElementById("loginBtn");

  if (!email || !pass) {
    return showToast("Preencha e-mail e senha.", "error");
  }

  btn.textContent = "Verificando...";
  btn.classList.add("loading");
  btn.disabled = true;

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    const user = auth.currentUser;
    const docSnap = await getDoc(doc(db, "atletas", user.uid));

    if (docSnap.exists()) {
      const data = docSnap.data();

      if (data.status === "Pendente") {
        showToast("Sua solicitação ainda está aguardando aprovação do administrador.", "info");
        await signOut(auth);
      } else if (data.role === "atleta") {
        showToast("Este acesso é restrito ao comitê.", "error");
        await signOut(auth);
      } else {
        showToast("Acesso liberado! Redirecionando...", "success");
        setTimeout(() => window.location.href = "admin.html", 800);
        return;
      }
    } else {
      showToast("Perfil de acesso não encontrado na base.", "error");
      await signOut(auth);
    }
  } catch (error) {
    console.error("Erro no login:", error);
    showToast("E-mail ou senha incorretos.", "error");
  }

  btn.textContent = "Entrar no sistema";
  btn.classList.remove("loading");
  btn.disabled = false;
};

const solicitarAcesso = async () => {
  const nome = document.getElementById("regNome")?.value.trim();
  const email = document.getElementById("regEmail")?.value.trim();
  const senha = document.getElementById("regPassword")?.value.trim();
  const btn = document.getElementById("registerBtn");

  if (!nome || !email || !senha) {
    return showToast("Preencha nome, e-mail e senha para enviar a solicitação.", "error");
  }
  if (senha.length < 6) {
    return showToast("A senha precisa ter pelo menos 6 caracteres.", "error");
  }

  btn.textContent = "Enviando...";
  btn.classList.add("loading");
  btn.disabled = true;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, senha);
    await setDoc(doc(db, "atletas", cred.user.uid), {
      nome,
      email,
      role: "comite",
      status: "Pendente",
      equipe: "Comitê",
      ativo: false,
      permissoes: ["visao-geral"],
      criadoEm: new Date().toISOString(),
      origemCadastro: "solicitacao_login"
    }, { merge: true });

    await signOut(auth);
    showToast("Solicitação enviada. Aguarde a aprovação do administrador.", "success");
    document.getElementById("regNome").value = "";
    document.getElementById("regEmail").value = "";
    document.getElementById("regPassword").value = "";
    alternarTela("login");
  } catch (error) {
    console.error("Erro ao solicitar acesso:", error);

    let msg;
    switch (error?.code) {
      case "auth/email-already-in-use":
        msg = "Este e-mail já possui cadastro. Tente fazer login ou peça aprovação ao administrador.";
        break;
      case "auth/invalid-email":
        msg = "E-mail inválido. Confira o endereço digitado.";
        break;
      case "auth/weak-password":
        msg = "Senha muito fraca. Use ao menos 6 caracteres.";
        break;
      case "auth/operation-not-allowed":
        msg = "Cadastro por e-mail/senha está desativado no Firebase (Authentication → Sign-in method).";
        break;
      case "permission-denied":
      case "firestore/permission-denied":
        msg = "Sem permissão para gravar a solicitação. Ajuste as regras do Firestore para permitir o autocadastro.";
        break;
      default:
        msg = "Não foi possível enviar a solicitação: " + (error?.code || error?.message || "erro desconhecido");
    }

    // Se o Auth chegou a criar a conta mas a gravação falhou, desloga
    // para não ficar preso como usuário "órfão" (sem documento na base).
    try { await signOut(auth); } catch (_) {}

    showToast(msg, "error");
  } finally {
    btn.textContent = "Enviar Solicitação";
    btn.classList.remove("loading");
    btn.disabled = false;
  }
};

document.getElementById("loginBtn")?.addEventListener("click", fazerLogin);
document.getElementById("registerBtn")?.addEventListener("click", solicitarAcesso);
document.getElementById("linkSolicitar")?.addEventListener("click", (e) => { e.preventDefault(); alternarTela("solicitar"); });
document.getElementById("linkLogin")?.addEventListener("click", (e) => { e.preventDefault(); alternarTela("login"); });
document.getElementById("linkEsqueceuSenha")?.addEventListener("click", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email")?.value.trim();
  if (!email) return showToast("Digite seu e-mail antes de redefinir a senha.", "info");
  try {
    await sendPasswordResetEmail(auth, email);
    showToast("E-mail de redefinição enviado. Verifique sua caixa de entrada.", "success");
  } catch {
    showToast("Não foi possível enviar o e-mail. Verifique o endereço digitado.", "error");
  }
});

document.getElementById("password")?.addEventListener("keypress", (e) => {
  if (e.key === "Enter") fazerLogin();
});
document.getElementById("regPassword")?.addEventListener("keypress", (e) => {
  if (e.key === "Enter") solicitarAcesso();
});

carregarCoresLogin();
