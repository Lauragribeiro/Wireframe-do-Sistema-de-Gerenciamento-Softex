// public/scripts.js
// ===== Auth (módulo) =========================================================
const STORAGE_KEY = "edge.auth";

export function getAuth() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

export function requireAuth() {
  const auth = getAuth();
  const path = (location.pathname || "").toLowerCase();
  const isLogin = path === "/" || path === "/login" || path.endsWith("/index.html");
  if (!isLogin && !auth) {
    window.location.replace("/login");
    return null;
  }
  return auth;
}

export function logout() {
  localStorage.removeItem(STORAGE_KEY);
  window.location.replace("/login");
}

// Auto-guard: só redireciona quando NÃO estiver na página de login
(function autoGuard() {
  const path = (location.pathname || "").toLowerCase();
  const isLogin = path === "/" || path === "/login" || path.endsWith("/index.html");
  if (!isLogin) requireAuth();
})();


// ===== UI genérica (rodar só quando existir no DOM) ==========================
document.addEventListener("DOMContentLoaded", () => {
  // ---- Troca de abas (login <-> signup) ----
  const tabs  = document.querySelectorAll(".auth-tab");
  const panes = document.querySelectorAll(".auth-pane");
  if (tabs.length && panes.length) {
    tabs.forEach((btn) =>
      btn.addEventListener("click", () => {
        tabs.forEach((b) => b.classList.toggle("is-active", b === btn));
        panes.forEach((p) => p.classList.toggle("is-active", p.dataset.pane === btn.dataset.tab));
      })
    );
  }

  // ===== Dashboard / Lista de Projetos (só executa se existir a grid) =======
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (t = "") =>
    String(t).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

  const grid     = $("#projects-grid");
  const empty    = $("#empty-state");
  const search   = $("#project-search");
  const modal    = $("#project-modal");
  const btnOpen  = $("#btn-open-modal");
  const btnClose = $("#btn-close-modal");
  const btnCancel= $("#btn-cancel");
  const form     = $("#project-form");

  // Se não existe a grid, estamos em outra página — não roda a parte de projetos
  if (!grid) return;

  // ---- estado ----
  let all = [];
  let filter = "all";
  let term = "";

  // ---- helpers UI ----
  const fmtVig = (a, b) => {
    const f = (d) => {
      if (!d) return "";
      const [y, m] = d.split("-");
      return `${m}/${y}`;
    };
    return `${f(a)} - ${f(b)}`;
  };

  const badge = (s) => {
    const map = {
      em_andamento: { t: "Em andamento", cls: "badge badge--warn" },
      finalizado:   { t: "Finalizado",   cls: "badge badge--ok" },
      pendente:     { t: "Pendente",     cls: "badge badge--neutral" },
    };
    const it = map[s] || map.pendente;
    return `<span class="${it.cls}">${it.t}</span>`;
  };
  function cardProjetoHTML(p) {
  const badge =
    p.instituicao === "VERTEX"
      ? '<span class="badge badge--vertex">VERTEX</span>'
      : '<span class="badge badge--edge">EDGE</span>';

  return `
    <article class="project-card" data-status="${p.status}">
      <header class="project-card__head">
        <h3 class="project-card__title">${p.titulo}</h3>
        ${badge}
      </header>
      <div class="project-card__meta">
        <div><strong>Código:</strong> ${p.codigo}</div>
        <div><strong>Gerente:</strong> ${p.gerente || p.responsavel || "—"}</div>
        <div><strong>Período:</strong> ${p.vigenciaInicio} → ${p.vigenciaFim}</div>
        <div><strong>Status:</strong> ${String(p.status || "").replace("_"," ")}</div>
      </div>
      <!-- ... seus botões/ações -->
    </article>
  `;
}

  const card = (p) => `
    <article class="card">
      <div class="card__header">
        <h3 class="card__title">${esc(p.titulo)}</h3>
        <span class="card__code">${esc(p.codigo || p.id)}</span>
      </div>
      <div class="card__meta">
        <div><strong>Vigência:</strong> ${esc(fmtVig(p.vigenciaInicio, p.vigenciaFim))}</div>
        <div><strong>Responsável:</strong> ${esc(p.responsavel || p.gerente || "")}</div>
      </div>
      <div class="card__footer">
        ${badge(p.status)}
        <a class="btn btn-outline" href="/prestacao.html?id=${encodeURIComponent(p.id)}">
          Acessar Prestação de Contas
        </a>
      </div>
    </article>
  `;

  const applyFilters = (arr) => {
    const t = (term || "").trim().toLowerCase();
    return arr.filter((p) => {
      const okStatus = filter === "all" || p.status === filter;
      const hay = `${p.titulo} ${p.codigo} ${p.id}`.toLowerCase();
      const okTerm = !t || hay.includes(t);
      return okStatus && okTerm;
    });
  };

  const render = () => {
    const data = applyFilters(all);
    grid.innerHTML = data.map(card).join("");
    if (empty) empty.hidden = data.length > 0;
  };

  // ---- data ----
  async function load() {
    try {
      const r = await fetch("/api/projects");
      if (!r.ok) throw new Error("Falha ao carregar projetos");
      const j = await r.json();
      all = j?.data || [];
      render();
    } catch (e) {
      console.error(e);
      grid.innerHTML = "<p>Erro ao carregar projetos.</p>";
    }
  }

  // ---- modal ----
  const openModal  = () => (modal?.showModal ? modal.showModal() : modal?.setAttribute("open", ""));
  const closeModal = () => {
    if (modal?.close) modal.close();
    else modal?.removeAttribute("open");
    form?.reset();
  };

  btnOpen?.addEventListener("click", openModal);
  btnClose?.addEventListener("click", closeModal);
  btnCancel?.addEventListener("click", closeModal);

  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const payload = {
      titulo: fd.get("titulo"),
      codigo: fd.get("codigo"),
      vigenciaInicio: fd.get("vigenciaInicio"),
      vigenciaFim: fd.get("vigenciaFim"),
      status: fd.get("status"),
      gerente: fd.get("gerente"),
      instituicao: fd.get("instituicao")
    };

    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.message || "Erro ao salvar");

      all.unshift(j.data);
      render();
      closeModal();
    } catch (e) {
      alert(e.message);
    }
  });

  // ---- filtros e busca ----
  $$(".filter-btn").forEach((b) => {
    b.addEventListener("click", () => {
      $$(".filter-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      filter = b.dataset.filter || "all";
      render();
    });
  });

  search?.addEventListener("input", (e) => {
    term = e.target.value || "";
    render();
  });

  // ---- start ----
  load();
});
