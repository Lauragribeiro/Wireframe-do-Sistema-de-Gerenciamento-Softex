// public/docfin.js — cabeçalho saneado

'use strict';

document.addEventListener('DOMContentLoaded', function () {
  /* ================== Utils/Helpers ================== */
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.from((r || document).querySelectorAll(s)); };

  var esc = function (t) {
    t = String(t || '');
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return t.replace(/[&<>"']/g, function (c) { return map[c]; });
  };

  var uid = function () { return Math.random().toString(36).slice(2); };

  var onlyDigits = function (s) { return (String(s || '').match(/\d+/g) || []).join(''); };
  var maskCNPJ   = function (d) { return String(d || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*$/, '$1.$2.$3/$4-$5'); };

  var abbr = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  var formatDateBR = function (input) {
    if (!input) return '';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(input)) return input;

    var m = String(input).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];

    var d = new Date(input);
    if (!isNaN(d)) {
      var dd = String(d.getDate()).padStart(2, '0');
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var yy = d.getFullYear();
      return dd + '/' + mm + '/' + yy;
    }
    return String(input);
  };
  const toISODate = (s) => {
    if (!s) return null;
    let m = String(s).match(/(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    m = String(s).match(/(\d{4})[\/.\-](\d{2})[\/.\-](\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  };

  const parseMoneyBR = (s) => {
    if (!s) return null;
    const v = parseFloat(String(s).replace(/\./g,"").replace(",", "."));
    return isNaN(v) ? null : v;
  };

  const formatBRL = (v) => {
    if (v == null || v === "") return "";
    let num = String(v).replace(/[^\d,-.]/g,"");
    if (/,/.test(num) && /\.\d{3}/.test(num)) num = num.replace(/\./g,"").replace(",","." );
    else if (/,/.test(num)) num = num.replace(",","."); else num = num.replace(/,/g,"");
    const n = Number(num);
    return new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" }).format(isNaN(n)?0:n);
  };

  const monthsSinceStart = (iso, start) => {
    if (!iso || !start) return 0;
    const [Y,M]  = iso.split("-").map(Number);
    const [y0,m0]= start.split("-").map(Number);
    return (Y-y0)*12 + (M-m0) + 1;
  };

  const deepMerge = (dst, src) => {
    if (!src) return dst;
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (!dst[k] || typeof dst[k] !== "object") dst[k] = {};
        deepMerge(dst[k], v);
      } else {
        if (v !== undefined && v !== null && v !== "") dst[k] = v;
      }
    }
    return dst;
  };
/* ================== Seletores / Estado ================== */
const form    = $("#form-evid");
const tblBody = $("#tbl-pc tbody");
const btnSave = $("#btn-save");
if (!form || !tblBody || !btnSave) {
  console.error("[docfin] Elementos essenciais não encontrados.");
  return;
}

/* === SOMENTE "Adicionar à tabela" deve submeter === */
const btnAddRow = $("#btn-add-row");
if (btnAddRow) btnAddRow.type = "button"; // impede submit nativo do <form>


// 1) Bloqueia ENTER de submeter o form (exceto em textarea)
form.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target && e.target.tagName !== "TEXTAREA") {
    e.preventDefault();
  }
});

// 2) Garantir que botões auxiliares nunca submetam
["#btn-pay-upload", "#btn-extrair-pagto"].forEach((sel) => {
  const el = $(sel);
  if (el) {
    el.type = "button";
    el.addEventListener("click", (ev) => ev.preventDefault());
  }
});

// 3) Se usa data-pick para abrir inputs de arquivo
$$('[data-pick]').forEach((btn) => {
  btn.type = "button";
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    const sel = btn.getAttribute("data-pick");
    $(sel)?.click();
  });
});

  // Cabeçalho projeto / Abas
  const pNome   = $("#p-nome");
  const pCodigo = $("#p-codigo");
  const pGer    = $("#p-gerente");
  const pStatus = $("#p-status");

  // Campos do formulário
  const selRubrica = $("#rubrica");
  const inCNPJ     = $("#cnpj-fav");
  const inRazao    = $("#fav-razao");

  const inDtPag   = $("#inputDataPagamento");
  const inExtrato = $("#inputNumeroExtrato");
  const inValor   = $("#inputValorPago");
  const inMesAno  = $("#inputMesAno");
  const inJust    = $("#inputJust"); // opcional

  // Uploads (inputs reais do HTML)
  const upNF       = $("#nfFileInput");
  const upOficio   = $("#oficioFileInput");
  const upOrdem    = $("#ordemFileInput");
  const upCotacoes = $("#cotacoesInput");

  // Comprovante (dropzone/paste)
  const zonePay    = $("#pay-paste-zone");
  const btnPickPay = $("#btn-pay-upload");
  const payFile    = $("#payFileInput");
  const payPreview = $("#payPreview");
  const btnExtrair = $("#btn-extrair-pagto");
  const payStatus  = $("#payStatus");

  // Modal
  const pcModal = $("#pc-modal");
  const pcClose = $("#pc-close");

  // Array de linhas
  const rows = window.rows || [];
  window.rows = rows;

  // Proteções para “não sumir” ao carregar do servidor
  let didLocalAdd = false;
  let didLoadPurchases = false;

  // Estado de projeto
  let projectId      = null;
  let currentProject = null;
  let vigenciaInicio = null; // yyyy-mm-dd
  let vigenciaFim    = null; // yyyy-mm-dd

  // resultados mais recentes por origem
  let lastParsedDocs = {};   // acumulado do LLM (NF/Ofício/Ordem/Cotações)
  let lastParsedPay  = null; // Comprovante (imagem/OFX)

  // arquivos enviados e prontos para irem na linha
  const formDocs = {
    nf: null,
    oficio: null,
    ordem: null,
    cotacoes: [],
    comprovante: null
  };

  /* ================== CNPJ → Razão Social ================== */
  async function lookupCNPJBackend(cnpjDigits) {
    if (!cnpjDigits || cnpjDigits.length !== 14) return null;
    try {
      const res = await fetch(`/api/cnpj/${cnpjDigits}`);
      if (!res.ok) return null;
      return await res.json(); // { razao_social, ... }
    } catch (e) {
      console.warn("[docfin] /api/cnpj falhou:", e);
      return null;
    }
  }
  async function autofillRazao() {
    const digits = onlyDigits(inCNPJ?.value || "");
    if (digits.length !== 14) return;
    const data = await lookupCNPJBackend(digits);
    if (data?.razao_social) inRazao.value = data.razao_social;
  }
  inCNPJ?.addEventListener("blur",  autofillRazao);
  inCNPJ?.addEventListener("change",autofillRazao);

  /* ================== Upload genérico (POST /api/upload) ================== */
  async function uploadFile(file) {
    const fd = new FormData();
    fd.append("file", file);

    const r = await fetch("/api/upload", { method:"POST", body: fd });

    // tenta ler como JSON; se vier texto, falha com mensagem útil
    let j;
    try {
      j = await r.json();
    } catch {
      const txt = await r.text();
      throw new Error(`Falha no upload (HTTP ${r.status}): ${txt?.slice?.(0,200) || "sem corpo"}`);
    }
    if (!r.ok || !j?.ok) {
      throw new Error(j?.error || `Falha HTTP ${r.status}`);
    }

    // backend pode responder { ok, file:{...} } OU { ok, url, originalname, ... }
    const f = j.file || j;

    // normaliza o objeto de arquivo que guardamos em rows[*].docs
    return {
      url:         f.url || f.link || "",
      originalname:f.originalname || f.name || file.name || "arquivo",
      mimetype:    f.mimetype || f.type || file.type || "",
      size:        typeof f.size === "number" ? f.size : (file.size ?? 0),
      filename:    f.filename || f.key || ""
    };
  }

  // Botões [data-pick] disparam o input correspondente
  $$('[data-pick]').forEach(btn => {
    const sel = btn.getAttribute('data-pick');
    btn.addEventListener('click', () => $(sel)?.click());
  });

  /* ================== PARSE IMEDIATO (envia o File para /api/parse-docs) ================== */
 async function parseDocsImmediate({ nf=null, oficio=null, ordem=null, cotacoes=[] } = {}) {
  const hasAny = nf || oficio || ordem || (cotacoes && cotacoes.length);
  if (!hasAny) return;

  const fd = new FormData();
  if (nf)     fd.append("nf", nf);
  if (oficio) fd.append("oficio", oficio);
  if (ordem)  fd.append("ordem", ordem);
  (cotacoes||[]).forEach(f => fd.append("cotacoes", f));

  try {
    const r = await fetch("/api/parse-docs", { method: "POST", body: fd });
    const j = await r.json();
    console.log("[docfin] /api/parse-docs ->", j);
    if (r.ok && j?.ok) {
      // mescla o que veio com o acumulado
      deepMerge(lastParsedDocs, j.data || {});
      // se houver justificativa, já preenche o campo
      if (inJust && lastParsedDocs.just) inJust.value = String(lastParsedDocs.just || "");
      // depois de deepMerge(...)

    } else {
      console.warn("[docfin] parse-docs não OK:", j);
    }
  } catch (err) {
    console.warn("[docfin] parse-docs falhou:", err);
  }
}
let autoInsertedHash = null;
function hashAutoRow() {
  // gera uma “assinatura” simples do combo NF+Comprovante
  try {
    return JSON.stringify({
      nfDate:  lastParsedDocs?.data_emissao_iso || "",
      nfNum:   lastParsedDocs?.nf_num_9_mask || lastParsedDocs?.nf_num_9 || "",
      pay: {
        dt:    lastParsedPay?.data_pagamento_iso || "",
        val:   lastParsedPay?.valor_num ?? null,
        extr:  lastParsedPay?.numero_extrato_raw || ""
      }
    });
  } catch { return String(Date.now()); }
}
async function maybeAutoInsertRow(reason = "") {
  // 1) checa se já temos NF **e** Comprovante
  // use só a data ISO mandada pelo backend; o render já chama formatDateBR
const dataTituloISO = lastParsedDocs?.data_emissao_iso || "";

// mostre o número curto (mascarado se existir). NÃO caia no .nf (que pode vir “qualquer coisa”)
const nfCurta =
  lastParsedDocs?.nf_num ||               // preferido
  lastParsedDocs?.nf_num_mask ||          // número com máscara
  lastParsedDocs?.nf_num_9_mask ||        // fallback 9 dígitos (mascarado)
  lastParsedDocs?.nf_num_9 ||             // fallback 9 dígitos
  lastParsedDocs?.nf ||                   // último recurso
  "";
const haveNF  = !!(dataTituloISO || nfCurta);
const havePay = !!(lastParsedPay && (lastParsedPay.data_pagamento_iso || lastParsedPay.valor_num != null || lastParsedPay.numero_extrato_raw));
if (!haveNF || !havePay) return;

  // 2) evita inserir duplicado se os mesmos dados já foram inseridos
  const h = hashAutoRow();
  if (autoInsertedHash && autoInsertedHash === h) return;

  // 3) monta a linha usando os mesmos critérios do submit()
  const onlyDigits = (s) => (String(s||"").match(/\d+/g) || []).join("");
  const maskCNPJ   = (d) => String(d||"").replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*$/, "$1.$2.$3/$4-$5");
  const monthLabelPlusOne = (isoDate) => {
    if (!isoDate) return "";
    const abbr = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
    const d = new Date(`${isoDate}T00:00:00`);
    d.setMonth(d.getMonth()+1);
    return `${abbr[d.getMonth()]}/${d.getFullYear()}`;
  };
  const pcLabelForPayment = (isoPay) => {
    if (!window.currentProject?.vigenciaInicio || !window.currentProject?.vigenciaFim || !isoPay) return "1ª PC";
    const monthsSinceStart = (iso, start) => {
      const [Y,M]  = iso.split("-").map(Number);
      const [y0,m0]= start.split("-").map(Number);
      return (Y-y0)*12 + (M-m0) + 1;
    };
    const ini = String(window.currentProject.vigenciaInicio||"").slice(0,7)+"-01";
    const fim = String(window.currentProject.vigenciaFim||"").slice(0,7)+"-01";
    const dur   = monthsSinceStart(fim, ini);
    const total = Math.max(1, Math.ceil(dur/3));
    const k     = monthsSinceStart((lastParsedPay?.data_pagamento_iso||isoPay), ini);
    const idx   = Math.min(Math.max(Math.ceil(k/3),1), total);
    return (idx === total) ? "PC Final" : `${idx}ª PC`;
  };

  // favorecido e CNPJ (usa inputs, senão deixa vazio — o usuário pode preencher)
  const inCNPJ   = document.querySelector("#cnpj-fav");
  const inRazao  = document.querySelector("#fav-razao");
  const selRubrica = document.querySelector("#rubrica");

  const cnpjDigits = onlyDigits(inCNPJ?.value || "");
  let favorecido   = (inRazao?.value || "").trim();

  if (!favorecido && cnpjDigits.length === 14) {
    // se quiser, pode chamar /api/cnpj aqui como no submit; para não atrasar, mantém como está
  }

  const dataPagISO = (lastParsedPay?.data_pagamento_iso || "").trim();
  const nExtrato   = (lastParsedPay?.numero_extrato_raw || "").trim();
  const valorNum   = (typeof lastParsedPay?.valor_num === "number") ? lastParsedPay.valor_num : null;

  const mesLabel   = dataPagISO ? monthLabelPlusOne(dataPagISO) : "";

  const row = {
    id: Math.random().toString(36).slice(2),
    favorecido,
    pcNumero: dataPagISO ? pcLabelForPayment(dataPagISO) : "",
    cnpj: cnpjDigits ? maskCNPJ(cnpjDigits) : "",

    // NF
    dataTitulo: dataTituloISO || "",
    nf: nfCurta || "",

    // Comprovante
    nExtrato,
    dataPagamento: dataPagISO || "",
    valor: valorNum,

    // Tela
    rubrica: selRubrica?.value || "",
    mesLabel,

    // Ofício
    just: (document.querySelector("#inputJust")?.value || lastParsedDocs?.just || "").trim(),

    // Anexos
    docs: {
      nf:          window.formDocs?.nf || null,
      oficio:      window.formDocs?.oficio || null,
      ordem:       window.formDocs?.ordem || null,
      cotacoes:    Array.isArray(window.formDocs?.cotacoes) ? [...window.formDocs.cotacoes] : [],
      comprovante: window.formDocs?.comprovante || null
    }
  };

  // adiciona no topo e renderiza
  (window.rows || (window.rows = [])).unshift(row);
  const tbody = document.querySelector("#tbl-pc tbody");
  if (tbody) {
    // reusa tua função render() se existir
    if (typeof window.render === "function") window.render();
    else {
      // fallback rápido (caso não esteja no escopo global)
      const formatDateBR = (input) => {
        if (!input) return "";
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(input)) return input;
        const m = String(input).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;
        const d = new Date(input);
        if (!isNaN(d)) {
          const dd = String(d.getDate()).padStart(2,"0");
          const mm = String(d.getMonth()+1).padStart(2,"0");
          const yy = d.getFullYear();
          return `${dd}/${mm}/${yy}`;
        }
        return String(input);
      };
      const formatBRL = (v) => v==null||v==="" ? "" : new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v));
      const esc = (t="") => String(t).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
      const r = row;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(r.favorecido || "—")}</td>
        <td>${esc(r.pcNumero || "")}</td>
        <td>${esc(r.cnpj || "")}</td>
        <td>${esc(formatDateBR(r.dataTitulo) || "")}</td>
        <td>${esc(r.nf || "")}</td>
        <td>${esc(r.nExtrato || "")}</td>
        <td>${esc(formatDateBR(r.dataPagamento) || "")}</td>
        <td>${esc(formatBRL(r.valor) || "")}</td>
        <td>${esc(r.rubrica || "")}</td>
        <td>${esc(r.mesLabel || "")}</td>
        <td>${esc(r.just || "")}</td>
        <td>—</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="icon-btn" data-act="del" title="Excluir">🗑️</button>
        </td>`;
      tbody.prepend(tr);
    }
  }

  // memoriza hash para não duplicar
  autoInsertedHash = h;

  console.log("[auto-insert]", { reason, row });
}
  /* ================== Binds de upload ================== */
 async function bindSingleUpload({ inputSel, linkSel, hintSel, targetKey, parseField }) {
  const input = $(inputSel);
  if (!input) return;
  input.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      // 1) Sobe o arquivo para aparecer na coluna “Documentação”
      const up = await uploadFile(file);
      formDocs[targetKey] = up;

      // 2) Atualiza UI (link)
      const a = $(linkSel);
      if (a) {
        a.href = up.url;
        a.textContent = up.originalname || "abrir arquivo";
        a.hidden = false;
      }
      const hint = $(hintSel);
      if (hint) hint.textContent = `${up.mimetype || ""} • ${Math.round((up.size||0)/1024)} KB`;

      // 3) ⚙️ Corrigido — clonar o File antes de enviar para /api/parse-docs
      const payload = {};
      if (parseField) {
        const clone = new File([file], file.name, { type: file.type });
        payload[parseField] = clone;
      }

      await parseDocsImmediate(payload);
    } catch (err) {
      console.error("[upload] erro:", err);
      alert("Falha no upload: " + (err?.message || err));
    } finally {
      e.target.value = "";
    }
  });
}
  function bindMultiUpload({ inputSel, listSel }) {
    const input = $(inputSel);
    if (!input) return;
    input.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      try {
        // 1) Sobe todos
        const ups = [];
        for (const f of files) ups.push(await uploadFile(f));
        formDocs.cotacoes = ups;

        // 2) UI (lista de links)
        const ul = $(listSel);
        if (ul) {
          ul.innerHTML = "";
          for (const up of ups) {
            const li = document.createElement("li");
            li.innerHTML = `<a href="${up.url}" target="_blank" rel="noopener">${esc(up.originalname || "arquivo")}</a>`;
            ul.appendChild(li);
          }
          ul.hidden = false;
        }

        // 3) Parse imediato com os **Files**
        await parseDocsImmediate({ cotacoes: files });
      } catch (err) {
        console.error("[upload multiple] erro:", err);
        alert("Falha no upload: " + (err?.message || err));
      } finally {
        e.target.value = "";
      }
    });
  }

  bindSingleUpload({ inputSel:"#nfFileInput",     linkSel:"#md-nf-link",     hintSel:"#hint-nf",     targetKey:"nf",     parseField:"nf"     });
  bindSingleUpload({ inputSel:"#oficioFileInput", linkSel:"#md-oficio-link", hintSel:"#hint-oficio", targetKey:"oficio", parseField:"oficio" });
  bindSingleUpload({ inputSel:"#ordemFileInput",  linkSel:"#md-ordem-link",  hintSel:null,           targetKey:"ordem",  parseField:"ordem"  });
  bindMultiUpload  ({ inputSel:"#cotacoesInput",  listSel:"#cotacoesList" });

  /* ================== Comprovante: paste/drag + extração ================== */
  let payFileLocal = null;
  let payDataURL   = null;

  const setPayStatus = (msg) => { if (payStatus) payStatus.textContent = msg || ""; };
  const resetPreview = () => { if (payPreview) { payPreview.src = ""; payPreview.hidden = true; } };
  const setImagePreview = (u) => { if (payPreview) { payPreview.src = u; payPreview.hidden = false; } };

  btnPickPay?.addEventListener("click", (e) => { e.preventDefault(); payFile?.click(); });

  zonePay?.addEventListener("dragover", (e) => { e.preventDefault(); zonePay.classList.add("dragover"); });
  zonePay?.addEventListener("dragleave", () => zonePay.classList.remove("dragover"));
  zonePay?.addEventListener("drop", (e) => {
    e.preventDefault(); zonePay.classList.remove("dragover");
    const f = e.dataTransfer?.files?.[0];
    if (f) handleComprovanteFile(f);
  });

  window.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) { handleComprovanteFile(f); e.preventDefault(); return; }
      }
      if (it.type?.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) { handleComprovanteFile(f); e.preventDefault(); return; }
      }
    }
  });

  payFile?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) handleComprovanteFile(f);
  });

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  async function compressDataURL(dataURL, maxW = 1200, quality = 0.9) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = dataURL;
    });
  }

  async function parseOFXClient(file) {
    const text = await file.text();
    const t = text.replace(/\r/g,"");
    const get = (rx) => (t.match(rx) || [,""])[1].trim();

    let dt = get(/<DTPOSTED>(\d{8})/i);
    let iso = "";
    if (dt && dt.length === 8) iso = `${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}`;

    let valRaw = get(/<TRNAMT>(-?\d+[.,]?\d*)/i);
    valRaw = valRaw.replace(",", ".");

    let nExtr = get(/<CHECKNUM>([^<]+)/i) || get(/<FITID>([^<]+)/i);

    const d = iso ? new Date(`${iso}T00:00:00`) : null;
    const mes = d ? String(d.getMonth()+1).padStart(2,"0") : "";
    const ano = d ? d.getFullYear() : "";

    return {
      data_pagamento: { iso },
      numero_extrato: { raw: nExtr || "" },
      valor_pago: { raw: valRaw || "", valor_pago_num: valRaw ? Number(valRaw) : null },
      mes_ano_pagamento: { mes, ano },
      mes_ao_pagamento: { mes, ano }
    };
  }

 // Substitua a função inteira por esta
async function handleComprovanteFile(file) {
  resetPreview();
  payFileLocal = null;
  payDataURL   = null;

  const name = (file.name || "").toLowerCase();
  const mime = file.type || "";
  const ext  = (name.split(".").pop() || "");

  const isImg = mime.startsWith("image/");
  const isOFX = ["ofx","xml"].includes(ext) ||
                ["application/ofx","application/x-ofx","application/xml","text/xml","application/octet-stream"]
                  .includes(mime);

  if (!(isImg || isOFX)) {
    setPayStatus("Use imagem ou OFX.");
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    setPayStatus("Máx 25MB.");
    return;
  }

  // Prepara preview e dados
  if (isImg) {
    const durl = await fileToDataURL(file);
    payDataURL = await compressDataURL(durl, 1200, 0.9);
    setImagePreview(payDataURL);
    setPayStatus("Imagem pronta para extração.");
  } else {
    setPayStatus("OFX carregado.");
  }

  // Guarda o file para upload posterior
  payFileLocal = file;

  // Habilita o botão e dispara a extração automaticamente
  if (btnExtrair) {
    btnExtrair.disabled = false;
    // dispara a mesma lógica do listener do botão
    try {
      // pequena espera para garantir que a UI atualizou
      setTimeout(() => btnExtrair.click(), 0);
    } catch (e) {
      console.warn("[docfin] auto-extract falhou (pode ignorar):", e);
    }
  }
}
  btnExtrair?.addEventListener("click", async () => {
    if (!payFileLocal && !payDataURL) return;
    btnExtrair.disabled = true;
    setPayStatus("Extraindo...");

    try {
      const name = (payFileLocal?.name || "").toLowerCase();
      const mime = payFileLocal?.type || "";
      const ext  = (name.split(".").pop() || "");

      const isImg = !!payDataURL;
      const isOFX = ["ofx","xml"].includes(ext) ||
                    ["application/ofx","application/x-ofx","application/xml","text/xml","application/octet-stream"].includes(mime);

      let ex = null;

      if (isImg) {
        const resp = await fetch("/api/extrair-documento-imagem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_data_url: payDataURL })
        });
        const text = await resp.text();
        if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${text}`);
        ex = JSON.parse(text);
      } else if (isOFX) {
        try {
          const fd = new FormData();
          fd.append("file", payFileLocal);
          const r = await fetch("/api/extrair-ofx", { method: "POST", body: fd });
          ex = r.ok ? await r.json() : await parseOFXClient(payFileLocal);
        } catch {
          ex = await parseOFXClient(payFileLocal);
        }
      }

      if (!ex) throw new Error("Sem dados extraídos");
// depois de obter `ex` do backend:
const dt   = ex?.data_pagamento?.iso ?? "";
const ne   = ex?.numero_extrato?.raw ?? "";
const vRaw = ex?.valor_pago?.raw ?? "";
const vNum = ex?.valor_pago?.valor_pago_num ?? null;
const mes  = ex?.mes_ao_pagamento?.mes ?? ex?.mes_ano_pagamento?.mes ?? null;
const ano  = ex?.mes_ao_pagamento?.ano ?? ex?.mes_ano_pagamento?.ano ?? null;

// preenche os campos da tela
inDtPag.value   = dt || "";
inExtrato.value = ne || "";
inValor.value   = vRaw || (vNum != null ? String(vNum).replace(".", ",") : "");
inMesAno.value  = (mes && ano) ? `${mes}/${ano}` :
                  (dt ? (() => { const d=new Date(`${dt}T00:00:00`);
                                 return `${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`
                               })() : "");

      lastParsedPay = {
        data_pagamento_iso: dt || "",
        numero_extrato_raw: ne || "",
        valor_num: (vNum != null ? vNum : (vRaw ? Number(String(vRaw).replace(",", ".")) : null)),
        mes: mes || (dt ? String(new Date(`${dt}T00:00:00`).getMonth()+1).padStart(2,"0") : ""),
        ano: ano || (dt ? new Date(`${dt}T00:00:00`).getFullYear() : "")
      };
      
      // preencher campos visíveis
      if (inDtPag)   inDtPag.value = dt || "";
      if (inExtrato) inExtrato.value = ne || "";
      if (inValor)   inValor.value = vRaw || (vNum != null ? String(vNum).replace(".", ",") : "");
      if (inMesAno)  inMesAno.value = (lastParsedPay.mes && lastParsedPay.ano)
        ? `${lastParsedPay.mes}/${lastParsedPay.ano}`
        : (dt ? (() => { const d=new Date(`${dt}T00:00:00`); return `${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; })() : "");

      // Sobe o arquivo do comprovante para aparecer na Documentação
      if (payFileLocal) {
        try {
          formDocs.comprovante = await uploadFile(payFileLocal);
        } catch (e) {
          console.warn("[docfin] upload comprovante falhou:", e);
        }
      }

      setPayStatus("Dados extraídos.");
    } catch (err) {
      console.error(err);
      setPayStatus("Falha na extração.");
      alert("Não foi possível extrair os dados do comprovante.");
    } finally {
      btnExtrair.disabled = false;
    }
  });
// ==== AUTO-APPEND: cria linha automaticamente quando tiver NF + Comprovante ====

function canBuildRow() {
  const hasNFDate  = !!(lastParsedDocs?.data_emissao_iso || lastParsedDocs?.dataTitulo);
  const hasNFNum   = !!(lastParsedDocs?.nf_num_9_mask || lastParsedDocs?.nf_num_9 || lastParsedDocs?.nf);
  const dataPagISO = (inDtPag?.value || lastParsedPay?.data_pagamento_iso || "").trim();
  const hasExtrato = !!(inExtrato?.value || lastParsedPay?.numero_extrato_raw);
  const hasValor   = !!(inValor?.value || (typeof lastParsedPay?.valor_num === "number"));

  return hasNFDate && hasNFNum && dataPagISO && hasExtrato && hasValor;
}

function buildRowFromState() {
  // Favorecido e CNPJ
  let favorecido   = (inRazao?.value || "").trim();
  const cnpjDigits = (String(inCNPJ?.value || "").match(/\d+/g) || []).join("");
  // (Opcional) se não tiver razão social, tenta API de CNPJ — aqui só usa o que já estiver no input
  const cnpjMask   = cnpjDigits ? cnpjDigits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*$/, "$1.$2.$3/$4-$5") : "";

  // NF/Título
  const dataTituloISO = lastParsedDocs?.data_emissao_iso || lastParsedDocs?.dataTitulo || "";
  const nfCurta       = lastParsedDocs?.nf_num_9_mask || lastParsedDocs?.nf_num_9 || lastParsedDocs?.nf || "";

  // Comprovante
  const dataPagISO  = (inDtPag?.value || lastParsedPay?.data_pagamento_iso || "").trim();
  const nExtrato    = (inExtrato?.value || lastParsedPay?.numero_extrato_raw || "").trim();
  const valorNum    = (() => {
    const v = (inValor?.value || "").trim();
    if (v) return Number(String(v).replace(/\./g,"").replace(",",".")); // 1.234,56 -> 1234.56
    return (typeof lastParsedPay?.valor_num === "number") ? lastParsedPay.valor_num : null;
  })();

  // Mês/Ano (preferir input se existir; senão deriva do comprovante)
  const mesAnoForm  = (inMesAno?.value || "").trim();
  const mesLabel    = mesAnoForm
    ? (() => {
        const [mm, yyyy] = mesAnoForm.split("/");
        const M = Number(mm);
        const nomes = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
        return (nomes[M-1] && yyyy) ? `${nomes[M-1]}/${yyyy}` : "";
      })()
    : (lastParsedDocs?.mesLabel || (dataPagISO ? (() => {
          const d=new Date(`${dataPagISO}T00:00:00`);
          return ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][d.getMonth()]+"/"+d.getFullYear();
        })() : ""));

  const row = {
    id: Math.random().toString(36).slice(2),
    favorecido,
    pcNumero: "",

    cnpj: cnpjMask,

    // DA NF
    dataTitulo: dataTituloISO || "",
    nf: nfCurta || "",

    // DO COMPROVANTE
    nExtrato,
    dataPagamento: dataPagISO || "",
    valor: valorNum,

    // DA TELA
    rubrica: selRubrica?.value || "",
    mesLabel,

    // DO OFÍCIO
    just: (inJust?.value || lastParsedDocs?.just || "").trim(),

    // arquivos anexados
    docs: {
      nf: formDocs.nf || null,
      oficio: formDocs.oficio || null,
      ordem: formDocs.ordem || null,
      cotacoes: Array.isArray(formDocs.cotacoes) ? [...formDocs.cotacoes] : [],
      comprovante: formDocs.comprovante || null
    }
  };

  if (row.dataPagamento && !row.pcNumero) {
    // usa mesma função já existente no arquivo
    row.pcNumero = pcLabelForPayment(row.dataPagamento);
  }

  return row;
}

// tenta criar e inserir a linha; se conseguir, renderiza e limpa o form
function attemptAutoAppendRow() {
  if (!canBuildRow()) return false;
  const row = buildRowFromState();
  rows.unshift(row);
  render();
  clearFormForNext?.();
  return true;
}
/* ================== Helpers NF ================== */
function leftPad9(n){ n = String(n||"").replace(/\D/g,""); return n ? n.padStart(9,"0") : ""; }
function mask9(n){ const d = leftPad9(n); return d ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}` : ""; }
function nfFromChave(chave44){
  const c = String(chave44||"").replace(/\D/g,"");
  if (c.length !== 44) return "";
  // nNF = 9 dígitos após cUF(2)+AAMM(4)+CNPJ(14)+mod(2)+série(3) = 25
  return c.slice(25, 34);
}
function nfDisplay(r){
  if (r.nf_num_9_mask) return r.nf_num_9_mask;
  if (r.nf_num_9)      return mask9(r.nf_num_9);
  if (r.nf_num_mask)   return r.nf_num_mask;
  if (r.nf_num)        return mask9(r.nf_num);
  if (r.nf)            return mask9(r.nf);
  const chave = r.chave_acesso || r.chave || r.nfe_key || r.chaveNFe || "";
  const nnf = nfFromChave(chave);
  return nnf ? mask9(nnf) : "";
}

/* ================== Tabela / Render ================== */
function docBadge(row) {
  const names = [];
  if (row.docs?.nf) names.push("NF");
  if (row.docs?.oficio) names.push("Ofício");
  if (row.docs?.ordem) names.push("Ordem");
  if (Array.isArray(row.docs?.cotacoes) && row.docs.cotacoes.length) names.push(`${row.docs.cotacoes.length} cot.`);
  if (row.docs?.comprovante) names.push("Comprovante");
  if (!names.length) return `<span class="badge badge--neutral">sem anexos</span>`;
  return `<span class="badge badge--ok" title="${esc(names.join(", "))}">${names.join(" · ")}</span>`;
}

function render() {
  tblBody.innerHTML = rows.map(r => `
    <tr data-id="${r.id}" data-row-id="${r.id}">
      <td>${esc(r.favorecido || "—")}</td>
      <td>${esc(r.pcNumero || "")}</td>
      <td>${esc(r.cnpj || "")}</td>

      <td data-col="dataTitulo">${esc(formatDateBR(r.dataTitulo) || "")}</td>

      <td data-col="nf">${esc(nfDisplay(r))}</td>

      <td data-col="nExtrato">${esc(r.nExtrato || "")}</td>
      <td data-col="dataPagamento">${esc(formatDateBR(r.dataPagamento) || "")}</td>
      <td data-col="valor">${esc(formatBRL(r.valor) || "")}</td>

      <td data-col="tipoRubrica">${
        esc(selRubrica?.options?.[selRubrica.selectedIndex]?.text || r.rubrica || "")
      }</td>

      <td data-col="mesAno">${esc(r.mesLabel || "")}</td>
      <td data-col="just">${esc(r.just || "")}</td>

      <td>${docBadge(r)}</td>

      <td style="text-align:right;white-space:nowrap;">
        <button class="btn btn-sm btn-outline" data-act="editar"  data-id="${r.id}">Editar</button>
        <button class="btn btn-sm btn-primary hidden" data-act="salvar"  data-id="${r.id}">Salvar</button>
        <button class="btn btn-sm hidden" data-act="cancelar" data-id="${r.id}">Cancelar</button>
        <button class="icon-btn" data-act="del" title="Excluir">🗑️</button>
      </td>
    </tr>
  `).join("");
}

// Delegação de eventos (Editar/Salvar/Cancelar)
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;

  const act = btn.dataset.act;
  const id  = btn.dataset.id;

  // Localiza a <tr> de forma robusta
  const tr = btn.closest('tr[data-id], tr[data-row-id]') 
          || document.querySelector(`tr[data-id="${id}"]`)
          || document.querySelector(`tr[data-row-id="${id}"]`);
  if (!tr) return;

  if (act === "editar") {
    enableInlineEdit(tr, ["dataTitulo", "nf", "nExtrato", "dataPagamento", "valor", "tipoRubrica", "mesAno", "just"]);
    toggleButtons(tr, { editar:false, salvar:true, cancelar:true });
  }

  if (act === "cancelar") {
    disableInlineEdit(tr);
    toggleButtons(tr, { editar:true, salvar:false, cancelar:false });
  }

  if (act === "salvar") {
    const payload = collectInlineValues(tr);

    // normaliza NF editada (opcional mas recomendado)
    if (payload.nf) {
      const d = leftPad9(payload.nf);
      if (d) {
        payload.nf_num_9 = d;          // para o backend/estado
        payload.nf       = mask9(d);   // para exibição
      }
    }

    const r = await fetch("/pc/update-row", {
      method:"POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    }).then(r => r.json()).catch(() => null);

    if (r?.ok && r.data) {
      applyRowValues(tr, r.data);        // garanta que applyRowValues use nfDisplay(r)
      // força a célula NF a usar nosso helper
      const tdNf = tr.querySelector('[data-col="nf"]');
      if (tdNf) tdNf.textContent = nfDisplay(r.data);
      disableInlineEdit(tr);
      toggleButtons(tr, { editar:true, salvar:false, cancelar:false });
    } else {
      alert("Falha ao salvar a linha.");
    }
  }
});

// Helpers
function enableInlineEdit(tr, keys) {
  for (const k of keys) {
    const td = tr.querySelector(`[data-col="${k}"]`);
    if (!td) continue;
    const val = td.textContent.trim();
    td.dataset.prev = val;
    td.innerHTML = `<input class="tbl-input" value="${val}">`;
  }
}
function disableInlineEdit(tr) {
  for (const td of tr.querySelectorAll("td[data-col]")) {
    const inp = td.querySelector("input.tbl-input");
    if (inp) td.textContent = td.dataset.prev ?? inp.value ?? "";
    delete td.dataset.prev;
  }
}
function collectInlineValues(tr) {
  const data = { id: tr.dataset.rowId };
  for (const td of tr.querySelectorAll("td[data-col]")) {
    const key = td.dataset.col;
    const inp = td.querySelector("input.tbl-input");
    if (inp) data[key] = inp.value;
    else data[key] = td.textContent.trim();
  }
  return data;
}
function applyRowValues(tr, row) {
  const set = (k, v) => {
    const td = tr.querySelector(`[data-col="${k}"]`);
    if (td) td.textContent = v ?? "";
  };
  set("dataTitulo", row.dataTitulo || "");
  set("nf", row.nf_num || row.nf_num_mask || row.nf_num_9_mask || row.nf_num_9 || row.nf || "");
  set("nExtrato", row.nExtrato || "");
  set("dataPagamento", row.dataPagamento || "");
  set("valor", row.valor != null ? `R$ ${Number(row.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "");
  set("tipoRubrica", row.rubrica || row.tipoRubrica || "");
  set("mesAno", row.mesAno || "");
  set("just", row.just || "");
}

function toggleButtons(tr, map) {
  const btnE = tr.querySelector('[data-act="editar"]');
  const btnS = tr.querySelector('[data-act="salvar"]');
  const btnC = tr.querySelector('[data-act="cancelar"]');
  if (btnE) btnE.classList.toggle("hidden", map.editar === false);
  if (btnS) btnS.classList.toggle("hidden", map.salvar !== true);
  if (btnC) btnC.classList.toggle("hidden", map.cancelar !== true);
}

  tblBody.addEventListener("click", (e) => {
    const b = e.target.closest(".pc-edit-actions [data-act]");
  if (b) e.stopPropagation(); 
   const btnDel = e.target.closest("[data-act='del']");
    if (btnDel) {
      const tr = btnDel.closest("tr");
      const id = tr?.dataset?.id;
      const idx = rows.findIndex(r => r.id === id);
      if (idx >= 0) { rows.splice(idx,1); render(); }
      return;
    }
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const row = rows.find(r => r.id === tr.dataset.id);
    if (row) openPCModal(row);
  });

  function openPCModal(row) {
    const toBR = formatDateBR;
    if (!pcModal || !row) return;
    const setVal = (sel,val) => { const el = pcModal.querySelector(sel); if (el) el.value = val; };

    setVal('#md-fav',        row.favorecido || '—');
    setVal('#md-cnpj',       row.cnpj || '—');
    setVal('#md-pc',         row.pcNumero || '—');
    setVal('#md-data-titulo',toBR(row.dataTitulo) || '—');
    setVal('#md-nf',         row.nf || '—');
    setVal('#md-extrato',    row.nExtrato || '—');
    setVal('#md-data-pagto', toBR(row.dataPagamento) || '—');
    setVal('#md-rubrica',    row.rubrica || row.tipoRubrica || '—');
    setVal('#md-mesano',     row.mesLabel || '—');
    setVal('#md-just',       row.just || '—');

    const docArea = pcModal.querySelector("#md-docs");
    if (docArea) {
      const d = row.docs || {};
      const parts = [];
      if (d.nf)         parts.push(`<a href="${d.nf.url}" target="_blank" rel="noopener">NF/Recibo</a>`);
      if (d.oficio)     parts.push(`<a href="${d.oficio.url}" target="_blank" rel="noopener">Ofício</a>`);
      if (d.ordem)      parts.push(`<a href="${d.ordem.url}" target="_blank" rel="noopener">Ordem de fornecimento</a>`);
      if (Array.isArray(d.cotacoes) && d.cotacoes.length)
        d.cotacoes.forEach((c,i)=> parts.push(`<a href="${c.url}" target="_blank" rel="noopener">Cotação ${i+1}</a>`));
      if (d.comprovante) parts.push(`<a href="${d.comprovante.url}" target="_blank" rel="noopener">Comprovante</a>`);
      docArea.innerHTML = parts.length ? parts.join(" · ") : '<span class="muted">sem anexos</span>';
    }

    pcModal.dataset.rowId = row.id;
    if (pcModal.showModal) pcModal.showModal(); else pcModal.setAttribute("open","");
    document.body.classList.add('modal-open');
  }
// salve a rubrica no objeto da linha quando o usuário confirmar
const pcSave = document.querySelector("#pc-save"); // id do botão "Salvar" do modal
pcSave?.addEventListener("click", () => {
  const id = pcModal?.dataset?.rowId;
  const row = rows.find(r => String(r.id) === String(id));
  if (!row) return;

  // pega do campo do modal (input ou select), preferindo o valor digitado/selecionado
  const rubEl = pcModal.querySelector("#md-rubrica");
  let rubricaValue = "";
  if (rubEl) {
    if (rubEl.tagName === "SELECT") {
      const opt = rubEl.options[rubEl.selectedIndex];
      rubricaValue = (opt?.text || rubEl.value || "").trim();
    } else {
      rubricaValue = (rubEl.value || rubEl.textContent || "").trim();
    }
  }

  if (rubricaValue) {
    row.rubrica = rubricaValue;        // ✅ fixa na linha
    row.tipoRubrica = rubricaValue;    // (se você ainda usa esse campo em algum lugar)
  }

  // ... aqui continue salvando os demais campos do modal do jeito que já faz
  closePCModal();
  render?.(); // se você tiver uma função que re-renderiza a tabela
});
  function closePCModal() {
    if (!pcModal) return;
    if (pcModal.close) pcModal.close(); else pcModal.removeAttribute("open");
    document.body.classList.remove('modal-open');
  }
  pcClose?.addEventListener("click", closePCModal);
  pcModal?.addEventListener("cancel", (e) => { e.preventDefault(); closePCModal(); });
  pcModal?.addEventListener("click", (e) => {
    const rect = pcModal.querySelector('.modal__content')?.getBoundingClientRect();
    if (!rect) return;
    const inside = e.clientX>=rect.left && e.clientX<=rect.right && e.clientY>=rect.top && e.clientY<=rect.bottom;
    if (!inside) closePCModal();
  });

  /* ================== Carregar projeto + linhas ================== */
  (async () => {
    try {
      const url = new URL(location.href);
      projectId = url.searchParams.get("id") || "";

      const r = await fetch("/api/projects");
      const j = await r.json();
      const list = j?.data || [];
      if (!list.length) return;

      let project = projectId ? list.find(p => String(p.id) === String(projectId)) : list[0];
      if (!project) project = list[0], projectId = String(project.id);

      const fix = d => /^\d{2}\/\d{2}\/\d{4}$/.test(d||"") ? d.split("/").reverse().join("-") : d;
      vigenciaInicio = fix(project.vigenciaInicio);
      vigenciaFim    = fix(project.vigenciaFim);
      currentProject = { ...project, vigenciaInicio, vigenciaFim };
      window.currentProject = currentProject; // <- publica para o botão Folha de Rosto

      if (pNome)   pNome.textContent   = project.titulo || "—";
      if (pCodigo) pCodigo.textContent = project.codigo || project.id || "—";
      if (pGer)    pGer.textContent    = project.responsavel || "—";
      if (pStatus) pStatus.textContent = (project.status || "—").replace("_"," ");

      $("#tab-evidencias")?.setAttribute("href", `/prestacao.html?id=${encodeURIComponent(projectId)}`);
      $("#tab-docfin")?.setAttribute("href", `/docfin.html?id=${encodeURIComponent(projectId)}`);

      try {
        const rr = await fetch(`/api/purchases?projectId=${encodeURIComponent(projectId)}`);
        const jj = await rr.json();

        didLoadPurchases = true;

        if (jj?.ok && Array.isArray(jj.data)) {
          if (!didLocalAdd && rows.length === 0) {
            rows.splice(0, rows.length, ...jj.data);
          } else {
            const ids = new Set(rows.map(r => String(r.id)));
            for (const srv of jj.data) {
              const id = String(srv.id ?? "");
              if (!ids.has(id)) rows.push(srv);
            }
          }
          render();
        }
      } catch (err) { console.warn("[docfin] /api/purchases falhou", err); }
    } catch (e) { console.error("[docfin] /api/projects erro", e); }
  })();

  /* ================== Regras de PC / Mês ================== */
  const pcLabelForPayment = (isoPay) => {
    if (!vigenciaInicio || !vigenciaFim || !isoPay) return "1ª PC";
    const dur   = monthsSinceStart(`${vigenciaFim.slice(0,7)}-01`, `${vigenciaInicio.slice(0,7)}-01`);
    const total = Math.max(1, Math.ceil(dur/3));
    const k     = monthsSinceStart(isoPay, `${vigenciaInicio.slice(0,7)}-01`);
    const idx   = Math.min(Math.max(Math.ceil(k/3),1), total);
    return (idx === total) ? "PC Final" : `${idx}ª PC`;
  };

  const monthLabelPlusOne = (isoDate) => {
    if (!isoDate) return "";
    const d = new Date(`${isoDate}T00:00:00`);
    d.setMonth(d.getMonth()+1);
    return `${abbr[d.getMonth()]}/${d.getFullYear()}`;
  };

  /* ================== Adicionar linha (submit) ================== */
  if (btnAddRow && form) {
    btnAddRow.addEventListener("click", () => {
      didLocalAdd = true; // evita que o carregamento posterior apague a linha
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.dispatchEvent(new Event("submit", { cancelable: true }));
    });
  }
// flag fora do listener
let submitting = false;

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (submitting) return;
  submitting = true;

  try {
    // --- LOG DE DIAGNÓSTICO ---
    console.log("--- Dados de Parsing no Submit ---");
    console.log("lastParsedDocs (NF/Ofício):", lastParsedDocs);
    console.log("lastParsedPay  (Comprovante):", lastParsedPay);
    console.log("Form Data (Data/Valor/Extrato):", {
      data:   inDtPag?.value,
      valor:  inValor?.value,
      extrato:inExtrato?.value
    });
    console.log("----------------------------------");

    // Favorecido + CNPJ
    let favorecido   = (inRazao?.value || "").trim();
    const cnpjDigits = onlyDigits(inCNPJ?.value || "");
    if (!favorecido && cnpjDigits.length === 14) {
      const data = await lookupCNPJBackend(cnpjDigits);
      if (data?.razao_social) favorecido = data.razao_social;
    }

    // NF / Título
    const dataTituloISO = lastParsedDocs?.data_emissao_iso || lastParsedDocs?.dataTitulo || "";
    const nfCurta       = lastParsedDocs?.nf_num_9_mask || lastParsedDocs?.nf_num_9 || lastParsedDocs?.nf || "";

    // Comprovante
    const dataPagISO = (inDtPag?.value || lastParsedPay?.data_pagamento_iso || "").trim();
    const nExtrato   = (inExtrato?.value || lastParsedPay?.numero_extrato_raw || "").trim();
    const valorNum   = (() => {
      const v = (inValor?.value || "").trim();
      if (v) return Number(String(v).replace(/\./g,"").replace(",",".")); // 1.234,56 -> 1234.56
      return (typeof lastParsedPay?.valor_num === "number") ? lastParsedPay.valor_num : null;
    })();

    // Mês/Ano
    const mesAnoForm = (inMesAno?.value || "").trim(); // MM/AAAA
    const mesLabel   = mesAnoForm
      ? (() => {
          const [mm, yyyy] = mesAnoForm.split("/");
          const m = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][Number(mm)-1] || "";
          return m && yyyy ? `${m}/${yyyy}` : "";
        })()
      : (lastParsedDocs?.mesLabel || (dataPagISO ? monthLabelPlusOne(dataPagISO) : ""));

    // Linha
    const row = {
      id: uid(),
      favorecido,
      pcNumero: dataPagISO ? pcLabelForPayment(dataPagISO) : "",
      cnpj: cnpjDigits ? maskCNPJ(cnpjDigits) : "",
      dataTitulo: dataTituloISO || "",
      nf: nfCurta || "",
      nExtrato,
      dataPagamento: dataPagISO || "",
      valor: valorNum,
      rubrica: selRubrica?.value || "",
      mesLabel,
      just: (inJust?.value || lastParsedDocs?.just || "").trim(),
      docs: {
        nf: formDocs.nf || null,
        oficio: formDocs.oficio || null,
        ordem: formDocs.ordem || null,
        cotacoes: Array.isArray(formDocs.cotacoes) ? [...formDocs.cotacoes] : [],
        comprovante: formDocs.comprovante || null
      }
    };

    console.log("[ADD ROW] =>", row);
    rows.unshift(row);
    render();
    clearFormForNext();
  } catch (err) {
    console.error("[submit] erro:", err);
    alert("Falha ao adicionar a linha. Veja o console.");
  } finally {
    submitting = false;
  }
});
  function clearFormForNext() {
    ["#inputDataPagamento","#inputNumeroExtrato","#inputValorPago","#inputMesAno","#inputJust"]
      .forEach(sel => { const el = $(sel); if (el) el.value = ""; });

    lastParsedDocs = {};
    lastParsedPay  = null;
    formDocs.nf = formDocs.oficio = formDocs.ordem = formDocs.comprovante = null;
    formDocs.cotacoes = [];

    ["#md-nf-link","#md-oficio-link","#md-ordem-link"].forEach(sel=>{
      const a=$(sel); if(a){ a.hidden=true; a.removeAttribute("href"); a.textContent=""; }
    });
    const ul = $("#cotacoesList"); if (ul) { ul.innerHTML=""; ul.hidden = true; }

    [upNF, upOficio, upOrdem, upCotacoes, payFile].forEach(el => { if (el) el.value = ""; });
    resetPreview(); setPayStatus("");
    // Se quiser também limpar CNPJ e Razão:
    // if (inCNPJ) inCNPJ.value = "";
    // if (inRazao) inRazao.value = "";
  }

  /* ================== Salvar tabela ================== */
  btnSave.addEventListener("click", async () => {
    try {
      const r = await fetch("/api/purchases", {
        method:"PUT",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ projectId, rows })
      });
      const j = await r.json();
      if (j?.ok) {
        const old = btnSave.textContent;
        btnSave.textContent = "Salvo!";
        btnSave.disabled = true;
        setTimeout(() => { btnSave.textContent = old; btnSave.disabled = false; }, 1200);
      } else {
        alert("Falha ao salvar a tabela.");
      }
    } catch (err) {
      console.error("[docfin] erro ao salvar:", err);
      alert("Erro ao salvar a tabela.");
    }
  });

  /* ================== Diagnóstico ================== */
  window.addEventListener("error", e => console.error("[docfin] erro global:", e?.message || e));
  window.addEventListener("unhandledrejection", e => console.error("[docfin] promise rejeitada:", e?.reason || e));
/* ====== Processos de Compras – Ações (Editar/Salvar/Cancelar) ====== */
(() => {
  const LABELS = ["favor", "cnpj", "data do título", "nf/recibo", "nº do extrato", "data do pagamento", "valor pago", "tipo de rubrica", "mês/ano", "justificativa", "documentação", "ações"];

  function norm(s=""){ return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim(); }

  function findPcTable(){
    const tables = Array.from(document.querySelectorAll("table"));
    for (const t of tables){
      const ths = Array.from(t.querySelectorAll("thead th"));
      if (!ths.length) continue;
      const headText = ths.map(th => norm(th.textContent)).join(" | ");
      // heurística: precisa ter pelo menos 4 desses termos
      const hits = ["favor", "cnpj", "data do titulo", "nf/recibo", "acoes"]
        .filter(h => headText.includes(h)).length;
      if (hits >= 3) return t;
    }
    return null;
  }

  function ensureActionsHeader(table){
    const thead = table.tHead || table.querySelector("thead");
    if (!thead) return { idx: -1 };
    const ths = Array.from(thead.querySelectorAll("th"));
    let idx = ths.findIndex(th => norm(th.textContent).includes("acoes"));
    if (idx === -1){
      const th = document.createElement("th");
      th.textContent = "Ações";
      thead.rows[0].appendChild(th);
      idx = ths.length; // nova última coluna
    }
    return { idx };
  }

  function injectButtons(table, idxAcoes){
    const tbody = table.tBodies[0];
    if (!tbody) return;
    Array.from(tbody.rows).forEach((tr, i) => {
      tr.dataset.rowId ||= String(i+1);
      // garante célula de Ações
      while (tr.cells.length <= idxAcoes){
        tr.appendChild(document.createElement("td"));
      }
      const tdA = tr.cells[idxAcoes];
      // só injeta se ainda não tiver nossos botões
      if (!tdA.querySelector("[data-act='editar']")){
        tdA.innerHTML = `
          <button class="btn btn-sm btn-outline" data-act="editar" data-id="${tr.dataset.rowId}">Editar</button>
          <button class="btn btn-sm btn-primary" data-act="salvar" data-id="${tr.dataset.rowId}" style="display:none">Salvar</button>
          <button class="btn btn-sm" data-act="cancelar" data-id="${tr.dataset.rowId}" style="display:none">Cancelar</button>
        `;
      }
    });
  }

  // campos que pode editar (índices por cabeçalho)
  function mapEditableIndexes(table){
    const ths = Array.from(table.querySelectorAll("thead th"));
    const find = (label) => ths.findIndex(th => norm(th.textContent).includes(label));
    return {
      dataTitulo:  find("data do titulo"),
      nf:          find("nf/recibo"),
      nExtrato:    find("nº do extrato"),
      dataPagamento: find("data do pagamento"),
      valor:       find("valor pago"),
      tipoRubrica: find("tipo de rubrica"),
      mesAno:      find("mes/ano"),
      just:        find("justificativa"),
    };
  }

  function enableEdit(tr, idx){
    Object.entries(idx).forEach(([k, i]) => {
      if (i < 0) return;
      const cell = tr.cells[i];
      if (!cell || cell.querySelector("input")) return;
      const val = cell.textContent.trim();
      cell.dataset.prev = val;
      const isValor = k === "valor";
      cell.innerHTML = `<input class="tbl-input" ${isValor ? 'inputmode="decimal"' : ''} value="${val}">`;
    });
  }
  function cancelEdit(tr, idx){
    Object.values(idx).forEach((i) => {
      if (i < 0) return;
      const cell = tr.cells[i];
      if (!cell) return;
      const inp = cell.querySelector("input");
      if (inp){
        const prev = cell.dataset.prev ?? "";
        cell.textContent = prev;
        delete cell.dataset.prev;
      }
    });
  }
  function collectValues(tr, idx){
    const get = (i) => {
      if (i < 0) return "";
      const c = tr.cells[i]; if (!c) return "";
      const inp = c.querySelector("input");
      return (inp ? inp.value : c.textContent).trim();
    };
    return {
      id: tr.dataset.rowId,
      dataTitulo:    get(idx.dataTitulo),
      nf:            get(idx.nf),
      nExtrato:      get(idx.nExtrato),
      dataPagamento: get(idx.dataPagamento),
      valor:         get(idx.valor),
      tipoRubrica:   get(idx.tipoRubrica),
      mesAno:        get(idx.mesAno),
      just:          get(idx.just),
    };
  }
  function applyValues(tr, idx, row){
    const set = (i, v) => { if (i >= 0 && tr.cells[i]) tr.cells[i].textContent = v ?? ""; };
    const fmtBRL = (v) => {
      const n = Number(String(v).replace(/[^\d.-]/g,""));
      return Number.isFinite(n) ? "R$ " + n.toLocaleString("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2}) : (v || "");
    };
    set(idx.dataTitulo, row.dataTitulo || "");
    set(idx.nf, row.nf_num_9_mask || row.nf || "");
    set(idx.nExtrato, row.nExtrato || "");
    set(idx.dataPagamento, row.dataPagamento || "");
    set(idx.valor, fmtBRL(row.valor));
    set(idx.tipoRubrica, row.tipoRubrica || "");
    set(idx.mesAno, row.mesAno || "");
    set(idx.just, row.just || "");
  }
  function toggleBtns(tr, idxAcoes, editing){
    const tdA = tr.cells[idxAcoes]; if (!tdA) return;
    const bE = tdA.querySelector('[data-act="editar"]');
    const bS = tdA.querySelector('[data-act="salvar"]');
    const bC = tdA.querySelector('[data-act="cancelar"]');
    if (bE) bE.style.display = editing ? "none" : "";
    if (bS) bS.style.display = editing ? "" : "none";
    if (bC) bC.style.display = editing ? "" : "none";
  }

  async function saveRow(payload){
    // normaliza valor antes de enviar
    if (payload.valor) {
      payload.valor = payload.valor.replace(/\s/g,"").replace(/[R$r$]/gi,"").replace(/\./g,"").replace(",",".");
    }
    const r = await fetch("/pc/update-row", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    }).then(r => r.json()).catch(() => null);
    return r;
  }

  function hydrateAll(){
    const table = findPcTable();
    if (!table) return;
    const { idx: idxAcoes } = ensureActionsHeader(table);
    injectButtons(table, idxAcoes);
    // guarda no elemento para reuso
    table.__pcIdxAcoes = idxAcoes;
    table.__pcEditIdx  = mapEditableIndexes(table);

    // observa mudanças no tbody (re-render dinâmico)
    if (!table.__observer){
      const obs = new MutationObserver(() => {
        injectButtons(table, table.__pcIdxAcoes);
      });
      const tb = table.tBodies[0];
      if (tb) obs.observe(tb, { childList: true, subtree: true });
      table.__observer = obs;
    }
  }

  // Delegação de eventos (um só ouvinte)
  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-act]");
    if (!btn) return;
    const table = findPcTable(); if (!table) return;
    const idxA = table.__pcIdxAcoes ?? ensureActionsHeader(table).idx;
    const editIdx = table.__pcEditIdx ?? mapEditableIndexes(table);

    const id  = btn.dataset.id;
    const tr  = table.querySelector(`tbody tr[data-row-id="${id}"], tbody tr[data-rowId="${id}"]`) || btn.closest("tr");
    if (!tr) return;

    const act = btn.dataset.act;
    if (act === "editar"){
      enableEdit(tr, editIdx);
      toggleBtns(tr, idxA, true);
    } else if (act === "cancelar"){
      cancelEdit(tr, editIdx);
      toggleBtns(tr, idxA, false);
    } else if (act === "salvar"){
      const payload = collectValues(tr, editIdx);
      const res = await saveRow(payload);
      if (res?.ok && res.data){
        applyValues(tr, editIdx, res.data);
        toggleBtns(tr, idxA, false);
      } else {
        alert("Falha ao salvar a linha.");
      }
    }
  });

  // roda ao carregar e também após pequenos atrasos (caso a tabela seja renderizada depois)
  const boot = () => hydrateAll();
  document.addEventListener("DOMContentLoaded", boot);
  if (document.readyState === "interactive" || document.readyState === "complete") boot();
  // tenta novamente após render assíncrono
  setTimeout(boot, 300);
  setTimeout(boot, 1000);
})();
// === RESET PC EDIT (limpa qualquer edição anterior sem quebrar nada) ===
(function resetPcEditOnce(){
  try {
    document.querySelectorAll('td[contenteditable="true"]').forEach(td => {
      td.removeAttribute('contenteditable');
      td.style.outline = ''; td.style.background = '';
      if (td.dataset.prevText != null) { td.textContent = td.dataset.prevText; }
      delete td.dataset.prevText;
      td.removeAttribute('data-pc-edit');
    });
    document.querySelectorAll('.pc-edit-actions').forEach(el => el.remove()); // remove só nosso wrap (não mexe na lixeira)
  } catch(e) { /* silencioso */ }
})();
});

/* ===================== FOLHA DE ROSTO E MAPA DE COTAÇÃO  ===================== */
(function(){
  // ---------- helpers básicos ----------
  function S(v){ return v == null ? "" : String(v); }
  function sanitize(name, fallback){
    return S(name || fallback).replace(/[\\/:*?"<>|]+/g,"_").replace(/\s+/g,"_").replace(/_+/g,"_").slice(0,120);
  }
  function toBR(iso){
    if (!iso) return "";
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(iso)) return iso;
    const d = new Date(iso);
    if (isNaN(+d)) return S(iso);
    const dd = String(d.getDate()).padStart(2,"0");
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const yy = d.getFullYear();
    return `${dd}/${mm}/${yy}`;
  }
  function toBRL(v){
    if (v == null || v === "") return "";
    if (typeof v === "string" && v.trim().startsWith("R$")) return v;
    const n = typeof v === "number" ? v : Number(String(v).replace(/\./g,"").replace(",",".")); // 1.234,56 -> 1234.56
    return Number.isFinite(n) ? n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"}) : S(v);
  }
  function getRows(){ return Array.isArray(window.rows) ? window.rows : []; }

  function getSelectedRowFromModal(){
    const modal = document.querySelector("#pc-modal");
    const id = modal?.dataset?.rowId;
    const rows = getRows();
    if (!rows.length) return null;
    if (!id) return rows[0] || null;
    return rows.find(r => String(r.id) === String(id)) || rows[0] || null;
  }

  // Natureza do dispêndio = exatamente o texto do select “Tipo de rubrica”
  function getNaturezaDisp(row){
    return S(row?.tipoRubrica ?? row?.rubrica ?? "");
  }

  // tenta encontrar anexos de cotação na linha (documentação)
  function pickCotacoesFromRow(row){
    const out = [];

    // 1) estrutura “canônica”
    if (Array.isArray(row?.docs?.cotacoes)) {
      for (const c of row.docs.cotacoes) out.push(c);
    }

    // 2) estruturas alternativas comuns: row.documentacao (array de arquivos)
    const docArrs = [
      row?.documentacao, row?.documentacao?.arquivos, row?.docs, row?.arquivos, row?.files
    ].filter(Array.isArray);

    for (const arr of docArrs) {
      for (const f of arr) {
        const name = S(f.name || f.filename || f.fileName || "");
        const kind = (f.kind || f.tipo || f.category || "").toLowerCase();
        const looksLikeCot = /cota[cç][aã]o|cotac|cot-?/i.test(name) || kind === "cotacao" || kind === "cotações" || kind === "cotacoes";
        if (looksLikeCot) out.push(f);
      }
    }
    // mapeia p/ formato fino
    return out.map((c)=>({
      name: S(c.name || c.filename || c.fileName || "cotacao.pdf"),
      text: S(c.text || ""),
      url:  S(c.url  || c.link || ""),
      path: S(c.path || "")
    }));
  }

  // Normaliza propostas p/ o formato final do DOCX:
  // [{ selecao, ofertante, cnpj_ofertante, data_cotacao, valor }]
  function normalizaPropostas(raw){
    const list = Array.isArray(raw) ? raw : [];
    let menorIdx = -1, menorVal = Number.POSITIVE_INFINITY, jaTemSelecionada = false;

    const parsed = list.map((p, i) => {
      const ofertante      = S(p.ofertante || p.fornecedor || p.nome || "");
      const cnpj_ofertante = S(p.cnpj_ofertante || p.cnpj || p.cpf || p.cnpjCpf || "");
      const data_cotacao   = toBR(p.data_cotacao || p.dataCotacao || p.data || "");
      const valorRaw       = p.valor || p.preco || p.total || p.valorBR || "";
      const valor          = toBRL(valorRaw);

      const n = (typeof valorRaw === "number") ? valorRaw :
                Number(String(valorRaw).replace(/\./g,"").replace(",",".")); // 1.234,56 -> 1234.56
      if (Number.isFinite(n) && n < menorVal){ menorVal = n; menorIdx = i; }

      const selecionada = !!(p.selecionada || p.selecao === "SELECIONADA" || p.selecao === "Selecionada" || p.selecao === "SIM" || p.selecao === true);
      if (selecionada) jaTemSelecionada = true;

      return {
        selecao: selecionada ? "SELECIONADA" : (S(p.selecao) || `Cotação ${i + 1}`),
        ofertante, cnpj_ofertante, data_cotacao, valor
      };
    });

    if (!jaTemSelecionada && menorIdx >= 0 && parsed[menorIdx]) parsed[menorIdx].selecao = "SELECIONADA";

    // filtra linhas totalmente vazias
    return parsed.filter(p => p.ofertante || p.cnpj_ofertante || p.data_cotacao || p.valor);
  }

  async function postAndDownload(url, body, filenameFallback, mime){
    console.log("[docfin] POST →", url, {
      keys: Object.keys(body||{}),
      propostasLen: Array.isArray(body?.propostas) ? body.propostas.length : 0,
      docsCotacoesLen: Array.isArray(body?.docs?.cotacoes) ? body.docs.cotacoes.length : 0
    });

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.error("[docfin] Falha de rede:", e);
      alert("Não consegui conectar ao servidor. Veja o console.");
      throw e;
    }
    if (!res.ok){
      const txt = await res.text().catch(()=> "");
      console.error("[docfin] HTTP", res.status, txt);
      alert(`Erro ${res.status} ao gerar documento.\n${txt || "(sem detalhes)"}`);
      throw new Error(`HTTP ${res.status}`);
    }

    const dispo = res.headers.get("Content-Disposition") || "";
    const m = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(dispo);
    const suggested = m ? decodeURIComponent(m[1]) : null;
    const filename = sanitize(suggested || filenameFallback || "documento");

    const ab = await res.arrayBuffer();
    const blob = new Blob([ab], { type: mime || "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    try { a.click(); } finally {
      URL.revokeObjectURL(a.href);
      a.remove();
    }
    console.log("[docfin] ✓ Download", filename);
  }

  // ---------- payload builders ----------
  function buildPayloadFolha(){
    const proj = window.currentProject || {};
    const row  = getSelectedRowFromModal();
    if (!row) return { error: "Abra/seleciona uma linha antes de gerar a Folha." };

    const natureza = getNaturezaDisp(row);
    const dtPg = row.dataPagamento || "";
    const baseDate = dtPg ? new Date(dtPg) : new Date();
    const dia = String(baseDate.getDate()).padStart(2,"0");
    const mes = String(baseDate.getMonth()+1).padStart(2,"0");
    const ano = String(baseDate.getFullYear());

    const payload = {
      instituicao:   S(proj.instituicao || "EDGE"),
      cnpj:          S(proj.cnpj),
      termo:         S(proj.termoParceria),
      numeroPc:      S(row.pcNumero),
      projeto:       S(proj.titulo),
      prestacao:     S(natureza), // <- EXATO
      favorecido:    S(row.favorecido),
      cnpjFav:       S(row.cnpj),
      extrato:       S(row.nExtrato || row.numeroExtrato),
      nf:            S(row.nf_num || row.nf_num_mask || row.nf || ""),
      dataEmissao:   toBR(row.data_emissao || row.dataTitulo || ""),
      dataPagamento: toBR(row.dataPagamento || ""),
      valor:         toBRL(row.valor),
      justificativa: S(row.just || row.justificativa || ""),
      localidade:    "Maceió",
      dia, mes, ano,
      coordenador:   S(proj.coordenador || ""),
      filenameHint:  `Folha_${S(proj.codigo || "Projeto")}_${S(row.pcNumero || "")}`,

      // chaves que o template usa
      projeto_codigo: S(proj.codigo),
      projeto_nome:   S(proj.titulo),
      pc_numero:      S(row.pcNumero),
      rubrica:        S(natureza),
      n_extrato:      S(row.nExtrato || row.numeroExtrato),
      nf_recibo:      S(row.nf_num || row.nf_num_mask || row.nf || ""),
      data_emissao:   toBR(row.data_emissao || row.dataTitulo || ""),
      data_pagamento: toBR(row.dataPagamento || ""),
      valor_pago:     toBRL(row.valor),

      // compat
      proj: {
        instituicao:   S(proj.instituicao || "EDGE"),
        cnpj:          S(proj.cnpj),
        termoParceria: S(proj.termoParceria),
        projetoNome:   S(proj.titulo),
        projetoCodigo: S(proj.codigo),
      },
      processo: {
        naturezaDisp:     S(natureza),
        pcNumero:         S(row.pcNumero),
        favorecidoNome:   S(row.favorecido),
        favorecidoDoc:    S(row.cnpj),
        extratoNumero:    S(row.nExtrato || row.numeroExtrato),
        nfNumero:         S(row.nf_num || row.nf_num_mask || row.nf || ""),
        nfDataEmissaoISO: S(row.data_emissao || row.dataTitulo || ""),
        dataPagamentoISO: S(row.dataPagamento || ""),
        valorTotalBR:     toBRL(row.valor),
      },
      extras: { cidade: "Maceió" },
      acao: "gerar_folha_rosto",
    };

    return { payload };
  }

  function buildPayloadMapa(){
    const proj = window.currentProject || {};
    const row  = getSelectedRowFromModal();
    if (!row) return { error: "Abra/seleciona uma linha antes de gerar o Mapa." };

    const natureza = getNaturezaDisp(row);

    // Coleta anexos de cotação vistos na UI (coluna Documentação)
    const cotacoesSlim = pickCotacoesFromRow(row);

    // Propostas preenchidas manualmente (se houver na linha)
    let propostasEstr = Array.isArray(row?.propostas) ? row.propostas : [];
    propostasEstr = propostasEstr
      .map(p => ({
        selecao:        S(p.selecao || p.selecionada || ""),
        ofertante:      S(p.ofertante || p.fornecedor || ""),
        cnpj_ofertante: S(p.cnpj || p.cpf || ""),
        data_cotacao:   toBR(p.data || p.dataCotacao || ""),
        valor:          S(p.valor || p.preco || p.total || "")
      }))
      .filter(p => p.ofertante || p.cnpj_ofertante || p.data_cotacao || p.valor);

    const propostas = normalizaPropostas(propostasEstr);

    const dtPg = row.dataPagamento || "";
    const baseDate = dtPg ? new Date(dtPg) : new Date();
    const dia = String(baseDate.getDate()).padStart(2,"0");
    const mes = String(baseDate.getMonth()+1).padStart(2,"0");
    const ano = String(baseDate.getFullYear());

    const payload = {
      instituicao:   S(proj.instituicao || "EDGE"),
      cnpj:          S(proj.cnpj),
      termo:         S(proj.termoParceria),
      numeroPc:      S(row.pcNumero),
      projeto:       S(proj.titulo),
      prestacao:     S(natureza), // <- EXATO
      favorecido:    S(row.favorecido),
      cnpjFav:       S(row.cnpj),
      extrato:       S(row.nExtrato || row.numeroExtrato),
      nf:            S(row.nf_num || row.nf_num_mask || row.nf || ""),
      dataEmissao:   toBR(row.data_emissao || row.dataTitulo || ""),
      dataPagamento: toBR(row.dataPagamento || ""),
      valor:         toBRL(row.valor),
      justificativa: S(row.just || row.justificativa || ""),
      localidade:    "Maceió",
      dia, mes, ano,
      coordenador:   S(proj.coordenador || ""),
      filenameHint:  `MapaCotacao_${S(proj.codigo || "Projeto")}_${S(row.pcNumero || "")}`,

      // campos do template
      codigo_projeto: S(proj.codigo),
      projeto:        S(proj.titulo),
      rubrica:        S(natureza),
      data_aquisicao: toBR(row.dataPagamento || ""),
      justificativa:  S(row.just || row.justificativa || ""),
      localidade:     "Maceió",
      dia, mes, ano,
      coordenador:    S(proj.coordenador || ""),

      // blocos para o backend (IA/heurística sobre PDFs)
      proj: {
        instituicao:   S(proj.instituicao || "EDGE"),
        cnpj:          S(proj.cnpj),
        termoParceria: S(proj.termoParceria),
        projetoNome:   S(proj.titulo),
        projetoCodigo: S(proj.codigo),
      },
      processo: {
        naturezaDisp:     S(natureza),
        objeto:           S(row.objeto || ""),
        justificativa:    S(row.just || row.justificativa || ""),
        dataAquisicaoISO: S(row.dataPagamento || ""),
      },
      docs: { cotacoes: cotacoesSlim },
      acao: "gerar_mapa_cotacao",
    };

    // Sempre mande 'propostas' (mesmo vazia) para o loop do template
    payload.propostas = propostas;

    console.log("[docfin] buildPayloadMapa", {
      propostasLen: propostas.length,
      cotacoesNoRow: cotacoesSlim.map(c=>c.name)
    });

    return { payload };
  }

  // ---------- click handlers ----------
  const FOLHA_SELECTORS = ["#btn-folha", "#btn-folha-rosto", "[data-action='folha']"];
  const MAPA_SELECTORS  = ["#btn-mapa", "#btnMapa", "[data-action='mapa']"];
  const FOLHA_TEXT_RX = /(gerar|baixar).*(folha|folha de rosto)/i;
  const MAPA_TEXT_RX  = /(gerar|baixar).*(mapa|cot(a|ã)cao)/i;

  function matchesAny(el, selectors){
    try { return selectors.some(sel => el.closest(sel)); }
    catch { return false; }
  }
  function isTextLike(el, rx){
    const t = (el.textContent || "").trim();
    return rx.test(t);
  }

  document.addEventListener("click", async (e) => {
    const el = e.target;
    if (!el) return;

    // FOLHA
    if (matchesAny(el, FOLHA_SELECTORS) || isTextLike(el.closest("button, a, [role='button']") || el, FOLHA_TEXT_RX)) {
      e.preventDefault(); e.stopPropagation();
      const { payload, error } = buildPayloadFolha();
      if (error) { alert(error); return; }
      const filename = `${sanitize(payload.filenameHint, "folha_de_rosto")}.docx`;
      await postAndDownload("/api/generate/folha-rosto", payload, filename,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      return;
    }

    // MAPA
    if (matchesAny(el, MAPA_SELECTORS) || isTextLike(el.closest("button, a, [role='button']") || el, MAPA_TEXT_RX)) {
      e.preventDefault(); e.stopPropagation();
      const { payload, error } = buildPayloadMapa();
      if (error) { alert(error); return; }
      const filename = `${sanitize(payload.filenameHint, "mapa_cotacao")}.docx`;
      await postAndDownload("/api/generate/mapa-cotacao", payload, filename,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      return;
    }
  }, true);

  // ---------- diagnóstico ----------
  window.generateFolhaNow = async function(){
    const { payload, error } = buildPayloadFolha();
    if (error) { alert(error); return; }
    const filename = `${sanitize(payload.filenameHint, "folha_de_rosto")}.docx`;
    await postAndDownload("/api/generate/folha-rosto", payload, filename,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  };
  window.generateMapaNow = async function(){
    const { payload, error } = buildPayloadMapa();
    if (error) { alert(error); return; }
    const filename = `${sanitize(payload.filenameHint, "mapa_cotacao")}.docx`;
    await postAndDownload("/api/generate/mapa-cotacao", payload, filename,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  };

  document.addEventListener("keydown", (e)=>{
    if (e.altKey && (e.key === "f" || e.key === "F")) { e.preventDefault(); window.generateFolhaNow(); }
    if (e.altKey && (e.key === "m" || e.key === "M")) { e.preventDefault(); window.generateMapaNow(); }
  });

  window.addEventListener("load", () => {
    const folhaFound = !!document.querySelector(FOLHA_SELECTORS.join(", "));
    const mapaFound  = !!document.querySelector(MAPA_SELECTORS.join(", "));
    console.log("[docfin] botões encontrados:", { folhaFound, mapaFound, FOLHA_SELECTORS, MAPA_SELECTORS });
  });

  console.log("[docfin] bloco de ações carregado.");
})();

