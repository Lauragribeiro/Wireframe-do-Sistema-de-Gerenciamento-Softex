// src/login.js
const STORAGE_KEY = "edge.auth";

function saveAuth(profile) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...profile, savedAt: new Date().toISOString() })
    );
  } catch (e) {
    console.error("Falha ao salvar perfil:", e);
  }
}

function getEl(nameOrId) {
  return (
    document.querySelector(`[name="${nameOrId}"]`) ||
    document.getElementById(nameOrId)
  );
}

function showError(msg) {
  const box = document.getElementById("loginError");
  if (box) box.textContent = msg;
  else if (msg) alert(msg);
}

document.addEventListener("DOMContentLoaded", () => {
  const form  = document.getElementById("loginForm");
  if (!form) return;

  const email = getEl("email");
  const senha = getEl("senha");

  // ➜ NÃO redireciona automaticamente se já estiver logado.
  // Apenas mostra um aviso/atalho se você quiser:
  const auth = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch { return null; }
  })();

  const already = document.getElementById("alreadyLogged");
  if (auth && already) {
    already.hidden = false; // exibe um aviso "já logado"
    const go = already.querySelector("button[data-go]");
    go?.addEventListener("click", () => window.location.replace("/dashboard"));
  }

  // Facilitar testes
  if (email && !email.value) email.value = "admin@edge.local";

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    showError("");

    const vEmail = String(email?.value || "").trim();
    const vSenha = String(senha?.value || "").trim();

    if (!vEmail.includes("@") || vSenha.length < 4) {
      showError("E-mail ou senha inválidos.");
      return;
    }

    saveAuth({ email: vEmail, name: vEmail.split("@")[0], role: "user" });
    window.location.replace("/dashboard");
  });
});
