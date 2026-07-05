const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function assertAdmin(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Usuário não autenticado."
    );
  }

  const uid = context.auth.uid;

  const meuDoc = await db.collection("atletas").doc(uid).get();

  if (!meuDoc.exists) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Seu usuário não possui documento na coleção atletas."
    );
  }

  const meuPerfil = meuDoc.data() || {};

  if (meuPerfil.role !== "admin") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Apenas usuários admin podem executar esta ação."
    );
  }

  return {
    uid,
    email: context.auth.token.email || "",
    perfil: meuPerfil
  };
}

async function listAllAuthUsers(nextPageToken, acc = []) {
  const result = await admin.auth().listUsers(1000, nextPageToken);

  const usuarios = result.users.map((u) => ({
    uid: u.uid,
    email: normalizeEmail(u.email),
    displayName: String(u.displayName || ""),
    disabled: u.disabled === true,
    emailVerified: u.emailVerified === true,
    creationTime: u.metadata?.creationTime || "",
    lastSignInTime: u.metadata?.lastSignInTime || "",
    providerIds: Array.isArray(u.providerData)
      ? u.providerData.map((p) => p.providerId)
      : []
  }));

  const final = acc.concat(usuarios);

  if (result.pageToken) {
    return listAllAuthUsers(result.pageToken, final);
  }

  return final;
}

async function listAllFirestoreAthletes() {
  const snap = await db.collection("atletas").get();

  return snap.docs.map((d) => {
    const data = d.data() || {};

    return {
      uid: d.id,
      nome: String(data.nome || data.name || ""),
      email: normalizeEmail(data.email),
      role: String(data.role || ""),
      status: String(data.status || ""),
      ativo: data.ativo === true,
      equipe: String(data.equipe || ""),
      criadoEm: data.criadoEm?.toDate
        ? data.criadoEm.toDate().toISOString()
        : "",
      atualizadoEm: data.atualizadoEm?.toDate
        ? data.atualizadoEm.toDate().toISOString()
        : ""
    };
  });
}

function buildAudit(authUsers, firestoreUsers) {
  const authByUid = new Map(authUsers.map((u) => [u.uid, u]));
  const fireByUid = new Map(firestoreUsers.map((u) => [u.uid, u]));

  const authSemFirestore = authUsers.filter((u) => !fireByUid.has(u.uid));
  const firestoreSemAuth = firestoreUsers.filter((u) => !authByUid.has(u.uid));

  const admins = firestoreUsers.filter((u) => u.role === "admin");
  const comite = firestoreUsers.filter((u) => u.role === "comite");
  const atletas = firestoreUsers.filter((u) => u.role === "atleta");

  const emails = new Map();

  [...authUsers, ...firestoreUsers].forEach((u) => {
    if (!u.email) return;

    if (!emails.has(u.email)) {
      emails.set(u.email, []);
    }

    emails.get(u.email).push({
      uid: u.uid,
      origem: authByUid.has(u.uid) && fireByUid.has(u.uid)
        ? "Auth + Firestore"
        : authByUid.has(u.uid)
          ? "Auth"
          : "Firestore"
    });
  });

  const emailsDuplicados = [...emails.entries()]
    .filter(([, lista]) => lista.length > 1)
    .map(([email, registros]) => ({
      email,
      registros
    }));

  return {
    resumo: {
      totalAuth: authUsers.length,
      totalFirestore: firestoreUsers.length,
      authSemFirestore: authSemFirestore.length,
      firestoreSemAuth: firestoreSemAuth.length,
      admins: admins.length,
      comite: comite.length,
      atletas: atletas.length,
      emailsDuplicados: emailsDuplicados.length
    },
    authSemFirestore,
    firestoreSemAuth,
    admins,
    comite,
    atletas,
    emailsDuplicados
  };
}

async function deleteFirestoreProfile(uid) {
  await db.collection("atletas").doc(uid).delete();
}

async function deleteAuthUser(uid) {
  await admin.auth().deleteUser(uid);
}

async function countAdminsExcept(uidToIgnore = "") {
  const snap = await db
    .collection("atletas")
    .where("role", "==", "admin")
    .get();

  return snap.docs.filter((d) => d.id !== uidToIgnore).length;
}

// ==============================
// LISTAGENS
// ==============================

exports.listarAuthUsuarios = functions.https.onCall(async (data, context) => {
  try {
    await assertAdmin(context);

    const usuarios = await listAllAuthUsers();

    return {
      ok: true,
      usuarios
    };
  } catch (error) {
    console.error("Erro em listarAuthUsuarios:", error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      "internal",
      error.message || "Erro interno em listarAuthUsuarios."
    );
  }
});

exports.listarFirestoreUsuarios = functions.https.onCall(async (data, context) => {
  try {
    await assertAdmin(context);

    const usuarios = await listAllFirestoreAthletes();

    return {
      ok: true,
      usuarios
    };
  } catch (error) {
    console.error("Erro em listarFirestoreUsuarios:", error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      "internal",
      error.message || "Erro interno em listarFirestoreUsuarios."
    );
  }
});

exports.auditarUsuarios = functions.https.onCall(async (data, context) => {
  try {
    await assertAdmin(context);

    const [authUsers, firestoreUsers] = await Promise.all([
      listAllAuthUsers(),
      listAllFirestoreAthletes()
    ]);

    const auditoria = buildAudit(authUsers, firestoreUsers);

    return {
      ok: true,
      ...auditoria
    };
  } catch (error) {
    console.error("Erro em auditarUsuarios:", error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      "internal",
      error.message || "Erro interno em auditarUsuarios."
    );
  }
});

// ==============================
// RECONSTRUÇÃO / EDIÇÃO
// ==============================

exports.reconstruirCadastro = functions.https.onCall(async (data, context) => {
  try {
    await assertAdmin(context);

    const uid = String(data.uid || "").trim();
    const role = String(data.role || "atleta").trim();

    if (!uid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "UID não informado."
      );
    }

    if (!["admin", "comite", "atleta"].includes(role)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Role inválido. Use admin, comite ou atleta."
      );
    }

    const authUser = await admin.auth().getUser(uid);

    const payload = {
      email: normalizeEmail(authUser.email),
      nome: String(authUser.displayName || ""),
      role,
      status: role === "admin" ? "Aprovado" : "Pendente",
      ativo: role === "admin",
      equipe: "",
      reconstruido: true,
      reconstruidoEm: admin.firestore.FieldValue.serverTimestamp(),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection("atletas").doc(uid).set(payload, { merge: true });

    return {
      ok: true,
      uid,
      email: payload.email,
      role
    };
  } catch (error) {
    console.error("Erro em reconstruirCadastro:", error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      "internal",
      error.message || "Erro interno em reconstruirCadastro."
    );
  }
});

exports.alterarPerfilUsuario = functions.https.onCall(async (data, context) => {
  try {
    const adminAtual = await assertAdmin(context);

    const uid = String(data.uid || "").trim();
    const role = String(data.role || "").trim();

    if (!uid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "UID não informado."
      );
    }

    if (!["admin", "comite", "atleta"].includes(role)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Role inválido. Use admin, comite ou atleta."
      );
    }

    if (uid === adminAtual.uid && role !== "admin") {
      const outrosAdmins = await countAdminsExcept(uid);

      if (outrosAdmins === 0) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Você não pode remover o último admin."
        );
      }
    }

    await db.collection("atletas").doc(uid).set(
      {
        role,
        status: role === "admin" ? "Aprovado" : "Pendente",
        ativo: role === "admin",
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return {
      ok: true,
      uid,
      role
    };
  } catch (error) {
    console.error("Erro em alterarPerfilUsuario:", error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      "internal",
      error.message || "Erro interno em alterarPerfilUsuario."
    );
  }
});

// ==============================
// EXCLUSÕES
// ==============================

exports.excluirFirestoreUsuario = functions.https.onCall(async (data, context) => {
  try {
    const adminAtual = await assertAdmin(context);

    const uid = String(data.uid || "").trim();

    if (!uid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "UID não informado."
      );
    }

    if (uid === adminAtual.uid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Você não pode excluir seu próprio perfil do Firestore."
      );
    }

    const alvoDoc = await db.collection("atletas").doc(uid).get();

    if (alvoDoc.exists && alvoDoc.data()?.role === "admin") {
      const outrosAdmins = await countAdminsExcept(uid);

      if (outrosAdmins === 0) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Você não pode excluir o último admin."
        );
      }
    }

    await deleteFirestoreProfile(uid);

    return {
      ok: true,
      uid
    };
  } catch (error) {
    console.error("Erro em excluirFirestoreUsuario:", error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      "internal",
      error.message || "Erro interno em excluirFirestoreUsuario."
    );
  }
});

exports.excluirAuthUsuario = functions.https.onCall(async (data, context) => {
  try {
    const adminAtual = await assertAdmin(context);

    const uid = String(data.uid || "").trim();

    if (!uid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "UID não informado."
      );
    }

    if (uid === adminAtual.uid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Você não pode excluir seu próprio login."
      );
    }

    await deleteAuthUser(uid);

    return {
      ok: true,
      uid
    };
  } catch (error) {
    console.error("Erro em excluirAuthUsuario:", error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      "internal",
      error.message || "Erro interno em excluirAuthUsuario."
    );
  }
});

exports.excluirUsuarioCompleto = functions.https.onCall(async (data, context) => {
  try {
    const adminAtual = await assertAdmin(context);

    const uid = String(data.uid || "").trim();

    if (!uid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "UID não informado."
      );
    }

    if (uid === adminAtual.uid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Você não pode excluir seu próprio usuário."
      );
    }

    const alvoDoc = await db.collection("atletas").doc(uid).get();

    if (alvoDoc.exists && alvoDoc.data()?.role === "admin") {
      const outrosAdmins = await countAdminsExcept(uid);

      if (outrosAdmins === 0) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Você não pode excluir o último admin."
        );
      }
    }

    await deleteFirestoreProfile(uid);

    try {
      await deleteAuthUser(uid);
    } catch (authError) {
      if (authError.code !== "auth/user-not-found") {
        throw authError;
      }
    }

    return {
      ok: true,
      uid
    };
  } catch (error) {
    console.error("Erro em excluirUsuarioCompleto:", error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      "internal",
      error.message || "Erro interno em excluirUsuarioCompleto."
    );
  }
});

exports.excluirUsuarioPorEmail = functions.https.onCall(async (data, context) => {
  try {
    const adminAtual = await assertAdmin(context);

    const email = normalizeEmail(data.email);

    if (!email) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "E-mail não informado."
      );
    }

    const authUser = await admin.auth().getUserByEmail(email);

    if (authUser.uid === adminAtual.uid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Você não pode excluir seu próprio usuário."
      );
    }

    const alvoDoc = await db.collection("atletas").doc(authUser.uid).get();

    if (alvoDoc.exists && alvoDoc.data()?.role === "admin") {
      const outrosAdmins = await countAdminsExcept(authUser.uid);

      if (outrosAdmins === 0) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Você não pode excluir o último admin."
        );
      }
    }

    if (alvoDoc.exists) {
      await deleteFirestoreProfile(authUser.uid);
    }

    await deleteAuthUser(authUser.uid);

    return {
      ok: true,
      uid: authUser.uid,
      email
    };
  } catch (error) {
    console.error("Erro em excluirUsuarioPorEmail:", error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    if (error.code === "auth/user-not-found") {
      throw new functions.https.HttpsError(
        "not-found",
        "Nenhum usuário encontrado no Authentication com esse e-mail."
      );
    }

    throw new functions.https.HttpsError(
      "internal",
      error.message || "Erro interno em excluirUsuarioPorEmail."
    );
  }
});
