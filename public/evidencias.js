// public/evidencias.js
document.addEventListener("DOMContentLoaded", () => {
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  // ===== Querystring
  const url = new URL(location.href);
  const projectId = url.searchParams.get("id");

  // ===== Refs
  const pNome = $("#p-nome"), pCodigo = $("#p-codigo"), pGerente = $("#p-gerente"), pStatus = $("#p-status");
  const cronInicio = $("#cron-inicio"), cronFim = $("#cron-fim"), qtdMetas = $("#qtd-metas");
  const inputCron = $("#file-cronograma");
  const tbody = $("#tbl-evidencias tbody");
  const tabEvid   = $("#tab-evidencias");
  const tabDoc    = $("#tab-docfin");
  const tabBolsas = $("#tab-bolsas");

  // ===== State
  let project = null;
  // rows: {etapa, nome, mes:'YYYY-MM', entrega:'YYYY-MM-05', status, acao, fileName}
  let rows = [];
  const LS_KEY = (id) => `ev_${id}`;

  // ===== Helpers
  const PT_ABBR = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const PT_MONTHS = {
    "jan":1,"janeiro":1,"fev":2,"fevereiro":2,"mar":3,"março":3,"marco":3,
    "abr":4,"abril":4,"mai":5,"maio":5,"jun":6,"junho":6,"jul":7,"julho":7,
    "ago":8,"agosto":8,"set":9,"setembro":9,"out":10,"outubro":10,"nov":11,"novembro":11,"dez":12,"dezembro":12
  };
  const pad2 = (n) => String(n).padStart(2,"0");
  const escapeHtml = (t="") => String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const formatBR = (iso) => (!iso ? "" : (()=>{ const [y,m,d]=iso.split("-"); return `${d}/${m}/${y}`; })());
  const ymToLabel = (ym) => {
    const [y,m] = ym.split("-").map(Number);
    return `${PT_ABBR[m-1]}/${y}`;
  };

  const norm = (s="") => String(s)
    .toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu,"")
    .replace(/[^\p{L}\p{N}]+/gu,"")
    .trim();

  const isNomeCol = (k) => {
    const n = norm(k);
    return n==="indicador" || n==="nome" || n==="nomedaevidencia" || n==="evidencia" || n==="nomeevidencia";
  };
  const isEtapaCol = (k) => norm(k) === "etapa";
  const isMesCol = (k) => {
    const n = norm(k);
    return n==="mes" || n==="mesreferencia" || n==="mescompetencia" || n==="competencia" ||
           n==="periodo" || n==="data" || n==="month";
  };
  const isMesNCol = (k) => /^m[eê]s\s*\d{1,2}$/i.test(String(k).trim());

  function parseToYYYYMM(v) {
    if (v == null || v === "") return null;

    if (typeof v === "number" && isFinite(v)) {
      const epoch = new Date(Date.UTC(1899,11,30));
      const d = new Date(epoch.getTime() + Math.round(v*86400000));
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}`;
    }

    let s = String(v).trim();

    // YYYY-MM / YYYY/MM
    let m = s.match(/^(\d{4})[-/](\d{1,2})$/);
    if (m) return `${m[1]}-${pad2(+m[2])}`;

    // MM/YYYY
    m = s.match(/^(\d{1,2})[-/](\d{4})$/);
    if (m) return `${m[2]}-${pad2(+m[1])}`;

    // Data completa
    const d1 = new Date(s);
    if (!isNaN(d1)) return `${d1.getFullYear()}-${pad2(d1.getMonth()+1)}`;

    // "Julho/2025"
    const s2 = s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"");
    m = s2.match(/([a-z]+)\s*[/\s-]*\s*(\d{4})/i);
    if (m) {
      const mm = PT_MONTHS[m[1]];
      const yy = +m[2];
      if (mm && yy) return `${yy}-${pad2(mm)}`;
    }

    return null;
  }

  const entregaFromYYYYMM = (ym) => `${ym}-05`;
  const option = (val, curr) => `<option value="${val}" ${val===curr?'selected':''}>${val}</option>`;

  function addMonthsISO(isoStart, n) {
    if (!isoStart) return null;
    const [y,m] = isoStart.split("-").map(Number);
    const d = new Date(Date.UTC(y, m-1, 1));
    d.setUTCMonth(d.getUTCMonth() + n);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}`;
  }

  function saveLS() {
    if (!projectId) return;
    localStorage.setItem(LS_KEY(projectId), JSON.stringify({ rows, qtdMetas: qtdMetas.value || "" }));
  }
  function loadLS() {
    if (!projectId) return;
    try {
      const raw = localStorage.getItem(LS_KEY(projectId));
      if (!raw) return;
      const j = JSON.parse(raw);
      rows = Array.isArray(j.rows) ? j.rows : [];
      if (j.qtdMetas) qtdMetas.value = j.qtdMetas;
    } catch {}
  }

  function renderTable() {
    tbody.innerHTML = rows.map((r, i) => `
      <tr>
        <td>${escapeHtml(r.etapa || "")}</td>
        <td>${escapeHtml(r.nome || "")}</td>
        <td>${escapeHtml(ymToLabel(r.mes))}</td>
        <td>${formatBR(r.entrega)}</td>
        <td>
          <label class="btn btn-light btn-upload-sm">
            <input type="file" data-row="${i}" class="up-evid hidden-input" />
            Enviar arquivo
          </label>
          ${r.fileName ? `<div class="muted tiny">${escapeHtml(r.fileName)}</div>` : ""}
        </td>
        <td>
          <select class="chip-select status" data-row="${i}">
            ${option("Entregue", r.status)}
            ${option("Em atraso", r.status)}
            ${option("Não iniciada", r.status)}
          </select>
        </td>
        <td>
          <select class="chip-select action" data-row="${i}">
            ${option("Enviada para o gerente de projeto", r.acao)}
            ${option("Aceita", r.acao)}
            ${option("Em análise", r.acao)}
          </select>
        </td>
      </tr>
    `).join("");

    // binds
    $$(".chip-select.status").forEach(el => el.addEventListener("change", (e)=>{
      const idx = +e.target.dataset.row;
      rows[idx].status = e.target.value;
      saveLS();
    }));
    $$(".chip-select.action").forEach(el => el.addEventListener("change", (e)=>{
      const idx = +e.target.dataset.row;
      rows[idx].acao = e.target.value;
      saveLS();
    }));
    $$(".up-evid").forEach(el => el.addEventListener("change", (e)=>{
      const idx = +e.target.dataset.row;
      const file = e.target.files?.[0];
      if (file) {
        rows[idx].fileName = file.name;
        saveLS();
        renderTable();
      }
    }));
  }

  async function loadProject() {
    const r = await fetch("/api/projects");
    const j = await r.json();
    const list = j?.data || [];
    project = list.find(p => String(p.id) === String(projectId));
    if (!project) return;

    pNome.textContent    = project.titulo || "—";
    pCodigo.textContent  = project.codigo || project.id || "—";
    pGerente.textContent = project.responsavel || "—";
    pStatus.textContent  = (project.status || "—").replace("_"," ");

    cronInicio.value = project.vigenciaInicio || "";
    cronFim.value    = project.vigenciaFim || "";
  }

  function wireTabs() {
    const qs = projectId ? `?id=${encodeURIComponent(projectId)}` : "";
    tabEvid.href = `/prestacao.html${qs}`;
    tabDoc.href  = `/docfin.html${qs}`; // próxima página
    if (tabBolsas) tabBolsas.href = `/bolsas.html${qs}`;
    tabEvid.classList.add("active");
  }

  // Upload do cronograma
  inputCron?.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });

      if (!json.length) {
        alert("Planilha vazia.");
        return;
      }

      const headers = Object.keys(json[0]);

      // “Mês 1 … Mês 12”
      const mesNCols = headers.filter(h => /^m[eê]s\s*\d{1,2}$/i.test(String(h).trim()))
                              .sort((a,b) => (parseInt(a.replace(/\D/g,""))||0) - (parseInt(b.replace(/\D/g,""))||0));
      const hasMesN = mesNCols.length > 0;

      if (hasMesN) {
        const nomeKey  = headers.find(h => isNomeCol(h)) || headers[0];
        const etapaKey = headers.find(h => isEtapaCol(h)) || null;

        const startISO = cronInicio.value || (project?.vigenciaInicio || "");
        if (!startISO) {
          alert("Cronograma de execução — Início não definido.");
          return;
        }

        const out = [];
        for (const row of json) {
          const nome  = String(row[nomeKey] ?? "").trim();
          const etapa = etapaKey ? String(row[etapaKey] ?? "").trim() : "";
          if (!nome) continue;

          mesNCols.forEach((col, idx) => {
            const val = row[col];
            const marked = val !== null && val !== undefined && String(val).trim() !== "" && String(val).trim().toLowerCase() !== "0";
            if (marked) {
              const ym = addMonthsISO(startISO, idx); // Mês 1 => +0
              if (ym) {
                out.push({
                  etapa, nome, mes: ym,
                  entrega: `${ym}-05`,
                  status: "Não iniciada",
                  acao: "Em análise",
                  fileName: ""
                });
              }
            }
          });
        }

        rows = out;
        saveLS();
        renderTable();
        return;
      }

      // Formato com coluna “Mês”
      let nomeKey = null, mesKey = null, etapaKey = null;
      headers.forEach(h => {
        if (!nomeKey && isNomeCol(h)) nomeKey = h;
        if (!mesKey  && isMesCol(h))  mesKey  = h;
        if (!etapaKey && isEtapaCol(h)) etapaKey = h;
      });
      if (!nomeKey) nomeKey = headers.find(h => norm(h).includes("nome")) || headers[0];
      if (!mesKey)  mesKey  = headers.find(h => /mes|compet|period|data|month/i.test(h));

      if (!nomeKey || !mesKey) {
        alert("Não encontrei colunas de Nome e Mês na planilha.");
        return;
      }

      const out = [];
      for (const row of json) {
        const nome  = String(row[nomeKey] ?? "").trim();
        const etapa = etapaKey ? String(row[etapaKey] ?? "").trim() : "";
        const mRaw  = row[mesKey];
        if (!nome || mRaw === "" || mRaw == null) continue;

        const ym = parseToYYYYMM(mRaw);
        if (!ym) continue;

        out.push({
          etapa, nome, mes: ym,
          entrega: `${ym}-05`,
          status: "Não iniciada",
          acao: "Em análise",
          fileName: ""
        });
      }

      rows = out;
      saveLS();
      renderTable();
    } catch (e) {
      console.error(e);
      alert("Não foi possível ler a planilha. Verifique o formato das colunas.");
    }
  });

  qtdMetas.addEventListener("input", saveLS);

  (async () => {
    wireTabs();
    loadLS();
    await loadProject();
    renderTable();
  })();
});
