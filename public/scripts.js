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

  const grid       = $("#projects-grid");
  const empty      = $("#empty-state");
  const search     = $("#project-search");

  // modal de criação (já existente na sua tela de projetos)
  const modal      = $("#project-modal");
  const btnOpen    = $("#btn-open-modal");
  const btnClose   = $("#btn-close-modal");
  const btnCancel  = $("#btn-cancel");
  const form       = $("#project-form");

  // NOVO: modal de edição
  const editModal  = $("#project-edit-modal");
  const editForm   = $("#project-edit-form");
  const editClose  = $("#project-edit-close");
  const editCancel = $("#project-cancel");
  const editDelete = $("#project-delete");

  // campos do modal de edição
  const fId   = $("#pe-id");
  const fTit  = $("#pe-titulo");
  const fCod  = $("#pe-codigo");
  const fSta  = $("#pe-status");
  const fVI   = $("#pe-vigini");
  const fVF   = $("#pe-vigfim");
  const fInst = $("#pe-inst");
  const fGer  = $("#pe-gerente");
  const fCoord= $("#pe-coordenador");

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
      const [y, m] = d.split("-"); // YYYY-MM
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

  const card = (p) => `
    <article class="card" data-id="${esc(p.id)}">
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
        <div class="row" style="gap:8px;">
          <a class="btn btn-outline" href="/prestacao.html?id=${encodeURIComponent(p.id)}">
            Acessar Prestação de Contas
          </a>
          <button type="button" class="btn btn-secondary btn-edit" data-id="${esc(p.id)}">
            Editar
          </button>
        </div>
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

  // ---- modal helpers ----
  const openModal  = (dlg) => (dlg?.showModal ? dlg.showModal() : dlg?.setAttribute("open", ""));
  const closeModal = (dlg) => {
    if (dlg?.close) dlg.close();
    else dlg?.removeAttribute("open");
  };

  btnOpen?.addEventListener("click", () => openModal(modal));
  btnClose?.addEventListener("click", () => closeModal(modal));
  btnCancel?.addEventListener("click", () => closeModal(modal));

  // criação (POST) já existente
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
      instituicao: fd.get("instituicao"),
      coordenador: fd.get("coordenador"),
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
      closeModal(modal);
      form?.reset();
    } catch (e) {
      alert(e.message);
    }
  });

  // ===== NOVO: Abertura do modal de edição =====
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-edit");
    if (!btn) return;

    const id = btn.dataset.id;
    const proj = all.find((p) => String(p.id) === String(id));
    if (!proj) return;

    // preenche campos
    fId.value   = proj.id ?? "";
    fTit.value  = proj.titulo ?? "";
    fCod.value  = proj.codigo ?? "";
    fSta.value  = proj.status ?? "pendente";
    fVI.value   = proj.vigenciaInicio ?? "";
    fVF.value   = proj.vigenciaFim ?? "";
    fInst.value = proj.instituicao ?? "EDGE";
    fGer.value  = proj.gerente ?? (proj.responsavel ?? "");
    fCoord.value= proj.coordenador ?? "";

    openModal(editModal);
  });

  // fechar/cancelar modal edição
  editClose?.addEventListener("click", () => closeModal(editModal));
  editCancel?.addEventListener("click", () => closeModal(editModal));

  // ===== NOVO: Salvar (PUT /api/projects/:id) =====
  editForm?.addEventListener("submit", async (ev) => {
    ev.preventDefault();

    const payload = {
      titulo: fTit.value?.trim(),
      codigo: fCod.value?.trim(),
      status: fSta.value,
      vigenciaInicio: fVI.value || null,
      vigenciaFim:   fVF.value || null,
      instituicao:   fInst.value,
      gerente:       fGer.value?.trim() || null,
      coordenador:   fCoord.value?.trim() || null,
    };

    const id = fId.value;
    if (!id) return;

    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.message || "Erro ao salvar alterações");

      // atualiza no estado local
      const idx = all.findIndex((p) => String(p.id) === String(id));
      if (idx >= 0) all[idx] = j.data;
      render();
      closeModal(editModal);
    } catch (e) {
      alert(e.message);
    }
  });

  // ===== NOVO: Excluir (DELETE /api/projects/:id) =====
  editDelete?.addEventListener("click", async () => {
    const id = fId.value;
    if (!id) return;
    if (!confirm("Tem certeza que deseja excluir este projeto? Esta ação não pode ser desfeita.")) return;

    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.message || "Erro ao excluir");

      all = all.filter((p) => String(p.id) !== String(id));
      render();
      closeModal(editModal);
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
