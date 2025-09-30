// public/docfin.js — robusto: CNPJ→Razão, colagem de comprovante, extrações, tabela e geração de docs
/* ====== Upload helper (POST /api/upload) ====== */
async function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/upload", { method: "POST", body: fd });
  const ct = r.headers.get("Content-Type") || "";
  const j  = await (ct.includes("application/json") ? r.json() : Promise.resolve({}));
  if (!r.ok || !j?.ok) throw new Error(j?.error || `Falha HTTP ${r.status}`);
  return j.file; // { url, originalname, mimetype, size, filename }
}

/* ====== Atualiza a linha, re-renderiza e persiste ====== */
function touchRowAndPersist(mutator) {
  const id = pcModal?.dataset?.rowId;
  if (!id) { alert("Abra uma linha e tente novamente."); return null; }
  const row = rows?.find?.(r => String(r.id) === String(id));
  if (!row) { alert("Linha não encontrada."); return null; }

  mutator(row);

  if (typeof renderTableRow === "function") renderTableRow(row);
  else if (typeof renderTable === "function") renderTable();

  try { localStorage.setItem(`pc_rows_${projectId}`, JSON.stringify(rows)); } catch {}
  return row;
}
// exemplo dentro do render da célula de anexos/ações:
nfCell.innerHTML = row.nfUrl ? `<a href="${row.nfUrl}" target="_blank" rel="noopener">NF</a>` : "—";
compCell.innerHTML = row.comprovanteUrl ? `<a href="${row.comprovanteUrl}" target="_blank">Comprovante</a>` : "—";
ordemCell.innerHTML = row.ordemUrl ? `<a href="${row.ordemUrl}" target="_blank">Ordem</a>` : "—";
oficioCell.innerHTML = row.oficioUrl ? `<a href="${row.oficioUrl}" target="_blank">Ofício</a>` : "—";
cotacoesCell.innerHTML = (row.cotacoes?.length)
  ? row.cotacoes.map(c => `<a href="${c.url}" target="_blank" rel="noopener">cotação</a>`).join(" · ")
  : "—";
app.use("/uploads", express.static(path.join(__dirname, "data", "uploads")));

/* ====== Binder para inputs simples (um arquivo) ====== */
function bindSingleUpload({ inputSel, rowFieldUrl, rowFieldName, rowFieldMime, rowFieldSize, linkSel, previewSel }) {
  const input = document.querySelector(inputSel);
  if (!input) return;

  input.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // validações (ajuste se quiser)
    const okTypes = ["application/pdf","image/png","image/jpeg","image/webp"];
    if (!okTypes.includes(file.type)) { alert("Tipo de arquivo não permitido."); input.value=""; return; }
    if (file.size > 25*1024*1024) { alert("Arquivo muito grande (máx 25MB)."); input.value=""; return; }

    try {
      const up = await uploadFile(file);
      const row = touchRowAndPersist(r => {
        r[rowFieldUrl]  = up.url;
        if (rowFieldName) r[rowFieldName] = up.originalname;
        if (rowFieldMime) r[rowFieldMime] = up.mimetype;
        if (rowFieldSize) r[rowFieldSize] = up.size;
      });
      if (!row) return;

      // feedback UI
      if (linkSel) {
        const a = document.querySelector(linkSel);
        if (a) { a.href = row[rowFieldUrl]; a.textContent = row[rowFieldName] || "abrir arquivo"; a.removeAttribute("hidden"); }
      }
      if (previewSel) {
        const img = document.querySelector(previewSel);
        if (img) {
          if ((row[rowFieldMime] || "").startsWith("image/")) {
            img.src = row[rowFieldUrl]; img.removeAttribute("hidden");
          } else {
            img.setAttribute("hidden",""); // não é imagem
          }
        }
      }
      input.value = "";
      alert("Arquivo anexado com sucesso!");
    } catch (err) {
      console.error("[upload] erro:", err);
      alert("Falha no upload: " + (err?.message || err));
      input.value = "";
    }
  });
}

/* ====== Binder para inputs múltiplos (várias cotações) ====== */
function bindMultiUpload({ inputSel, rowFieldArray, listSel }) {
  const input = document.querySelector(inputSel);
  if (!input) return;

  input.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    try {
      const uploaded = [];
      for (const f of files) {
        const okTypes = ["application/pdf","image/png","image/jpeg","image/webp"];
        if (!okTypes.includes(f.type)) throw new Error(`Tipo não permitido: ${f.type}`);
        if (f.size > 25*1024*1024) throw new Error(`Arquivo muito grande: ${f.name}`);
        uploaded.push(await uploadFile(f));
      }

      const row = touchRowAndPersist(r => {
        r[rowFieldArray] = Array.isArray(r[rowFieldArray]) ? r[rowFieldArray] : [];
        for (const up of uploaded) {
          r[rowFieldArray].push({ url: up.url, nome: up.originalname, mimetype: up.mimetype, size: up.size });
        }
      });
      if (!row) return;

      // UI: lista simples
      if (listSel) {
        const ul = document.querySelector(listSel);
        if (ul) {
          ul.innerHTML = "";
          for (const it of row[rowFieldArray]) {
            const li = document.createElement("li");
            li.innerHTML = `<a href="${it.url}" target="_blank" rel="noopener">${esc(it.nome || "arquivo")}</a>`;
            ul.appendChild(li);
          }
          ul.removeAttribute("hidden");
        }
      }

      input.value = "";
      alert("Arquivos de cotação anexados!");
    } catch (err) {
      console.error("[upload multiple] erro:", err);
      alert("Falha no upload: " + (err?.message || err));
      input.value = "";
    }
  });
}
document.addEventListener("DOMContentLoaded", () => {
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  window.addEventListener("error", e => console.error("[front error]", e.error || e.message));
  window.addEventListener("unhandledrejection", e => console.error("[front promise rejection]", e.reason));
  console.log("[docfin] script carregado");
async function downloadBlobFromPost(url, payload, filename) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Falha HTTP " + res.status);

    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    console.error("[docfin] erro no download:", err);
    alert("Erro ao baixar documento.");
  }
}
/* ===== Comprovante de pagamento: abrir picker e fazer upload ===== */
// Comprovante de pagamento (imagem/PDF)
bindSingleUpload({
  inputSel: "#payFileInput",               // já existe no seu HTML
  rowFieldUrl: "comprovanteUrl",
  rowFieldName: "comprovanteNome",
  rowFieldMime: "comprovanteMime",
  rowFieldSize: "comprovanteSize",
  linkSel: "#md-comprovante-link",         // <a> opcional no modal
  previewSel: "#md-comprovante-preview"    // <img> opcional no modal
});

// Nota fiscal / Recibo
bindSingleUpload({
  inputSel: "#nfFileInput",
  rowFieldUrl: "nfUrl",
  rowFieldName: "nfNome",
  rowFieldMime: "nfMime",
  rowFieldSize: "nfSize",
  linkSel: "#md-nf-link"
});

// Ordem de Fornecimento
bindSingleUpload({
  inputSel: "#ordemFileInput",
  rowFieldUrl: "ordemUrl",
  rowFieldName: "ordemNome",
  rowFieldMime: "ordemMime",
  rowFieldSize: "ordemSize",
  linkSel: "#md-ordem-link"
});

// Ofício de Solicitação
bindSingleUpload({
  inputSel: "#oficioFileInput",
  rowFieldUrl: "oficioUrl",
  rowFieldName: "oficioNome",
  rowFieldMime: "oficioMime",
  rowFieldSize: "oficioSize",
  linkSel: "#md-oficio-link"
});

// Cotações (múltiplos arquivos)
bindMultiUpload({
  inputSel: "#cotacoesInput",              // <input type="file" multiple>
  rowFieldArray: "cotacoes",
  listSel: "#cotacoesList"                 // <ul> opcional para mostrar
});

const badDropzone = document.querySelector("#dropzone-comprovante, .dropzone-generica");
badDropzone && (badDropzone.style.display = "none");

// 1) Botão visível que dispara o input hidden (ajuste os seletores se seu HTML usar outro id/data-attr)
const payFileInput = document.querySelector("#payFileInput");
const btnPickPay   = document.querySelector("#btn-pay-upload") 
                  || document.querySelector('[data-action="pick-pay-file"]');

btnPickPay?.addEventListener("click", (e) => {
  e.preventDefault();
  payFileInput?.click();
});

// 2) Helper de upload (usa a rota /api/upload do backend com multer)
async function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/upload", { method: "POST", body: fd });
  const ct = r.headers.get("Content-Type") || "";
  if (!r.ok) {
    const j = ct.includes("application/json") ? await r.json().catch(() => ({})) : {};
    throw new Error(j?.error || `Falha HTTP ${r.status}`);
  }
  const j = await r.json();
  if (!j?.ok) throw new Error(j?.error || "upload_failed");
  return j.file; // { url, originalname, mimetype, size, filename }
}

// 3) Ao selecionar o arquivo, envia e vincula na linha do modal aberto
payFileInput?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  // validações rápidas
  const maxBytes = 25 * 1024 * 1024;
  if (file.size > maxBytes) { alert("Arquivo muito grande (máx 25MB)."); e.target.value = ""; return; }
  const okTypes = ["image/png","image/jpeg","image/jpg","image/webp","application/pdf"]; // permita PDF também, se quiser
  if (!okTypes.includes(file.type)) { alert("Tipo de arquivo não permitido."); e.target.value = ""; return; }

  // precisa ter uma linha aberta no modal (pcModal.dataset.rowId)
  const id = pcModal?.dataset?.rowId;
  if (!id) { alert("Abra uma linha e tente novamente."); e.target.value = ""; return; }
  const row = rows?.find?.(r => String(r.id) === String(id));
  if (!row) { alert("Linha não encontrada."); e.target.value = ""; return; }

  // feedback (opcional)
  btnPickPay && (btnPickPay.disabled = true);

  try {
    const up = await uploadFile(file);

    // vincule nos campos da linha (ajuste os nomes se já usa outros):
    row.comprovanteUrl  = up.url;
    row.comprovanteNome = up.originalname;
    row.comprovanteTipo = up.mimetype;
    row.comprovanteSize = up.size;

    // (opcional) se quiser copiar a data do título/pgto a partir do comprovante depois, faça aqui.

    // atualiza UI
    if (typeof renderTableRow === "function") renderTableRow(row);
    else if (typeof renderTable === "function") renderTable();

    // salva no localStorage para não perder antes do PUT
    try { localStorage.setItem(`pc_rows_${projectId}`, JSON.stringify(rows)); } catch {}

    // limpa input e feedback
    e.target.value = "";
    alert("Comprovante anexado com sucesso!");

    // exibe link/preview no modal (se existir contêiner)
    const link = document.querySelector("#md-comprovante-link");
    if (link) {
      link.href = row.comprovanteUrl;
      link.textContent = row.comprovanteNome || "abrir comprovante";
      link.removeAttribute("hidden");
    }
    const preview = document.querySelector("#md-comprovante-preview"); // <img> opcional
    if (preview && row.comprovanteUrl && row.comprovanteTipo.startsWith("image/")) {
      preview.src = row.comprovanteUrl;
      preview.removeAttribute("hidden");
    }
  } catch (err) {
    console.error("[upload comprovante] erro:", err);
    alert("Falha no upload do comprovante: " + (err?.message || err));
  } finally {
    btnPickPay && (btnPickPay.disabled = false);
  }
});


    // ... (seu código anterior dentro do DOMContentLoaded)

  /* ===================== Folha de Rosto ===================== */
  // (mantém sua versão atual de gerarFolhaDeRosto e o listener único do #btn-folha)

  /* ===================== Modal de detalhes (PC) ===================== */
  const pcModal = document.querySelector('#pc-modal');
  const pcClose = document.querySelector('#pc-close');
  const $md     = (sel) => document.querySelector(sel);

  function setVal(sel, val) { const el = $md(sel); if (el) el.value = val; }

  function openPCModal(row) {
    if (!pcModal || !row) return;

    setVal('#md-fav',         row.favorecido || '—');
    setVal('#md-cnpj',        row.cnpj || '—');
    setVal('#md-pc',          row.pcNumero || '—');
    setVal('#md-data-titulo', toBR(row.dataTitulo) || '—');
    setVal('#md-nf',          row.nf || '—');
    setVal('#md-extrato',     row.nExtrato || '—');
    setVal('#md-data-pagto',  toBR(row.dataPagamento) || '—');
    setVal('#md-valor',       row.valor != null && row.valor !== "" ? formatBRL(row.valor) : '—');
    setVal('#md-rubrica',     getRubricaLong(row.rubrica) || '—');
    setVal('#md-mesano',      row.mesLabel || '—');
    setVal('#md-just',        row.just || '—');

    if (pcModal.showModal) pcModal.showModal();
    else pcModal.setAttribute('open', '');
    document.body.classList.add('modal-open');
    pcModal.dataset.rowId = row.id;
  }

  function closePCModal() {
    if (!pcModal) return;
    if (pcModal.close) pcModal.close(); else pcModal.removeAttribute('open');
    document.body.classList.remove('modal-open');
  }
  pcClose?.addEventListener('click', closePCModal);
  pcModal?.addEventListener('cancel', (e) => { e.preventDefault(); closePCModal(); });
  pcModal?.addEventListener('click', (e) => {
    const rect = pcModal.querySelector('.modal__content')?.getBoundingClientRect();
    if (!rect) return;
    const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                   e.clientY >= rect.top  && e.clientY <= rect.bottom;
    if (!inside) closePCModal();
  });

  /* ===================== Diagnóstico rápido ===================== */
  window.addEventListener("error", (e) => console.error("[docfin] erro global:", e?.message || e));
  window.addEventListener("unhandledrejection", (e) => console.error("[docfin] promise rejeitada:", e?.reason || e));
}); // <<< fecha o DOMContentLoaded


  /* ===================== Refs essenciais ===================== */
  const form    = $("#form-evid");
  const tblBody = $("#tbl-pc tbody");
  const btnSave = $("#btn-save");
  if (!form || !tblBody || !btnSave) {
    console.error("[docfin] Elementos essenciais não encontrados na página.");
    return;
  }
  console.log("[docfin] DOM pronto");

  /* ===================== Utils gerais ===================== */
  const esc = (t = "") =>
    String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const onlyDigits = (s) => (String(s || "").match(/\d+/g) || []).join("");
  const maskCNPJ  = (d) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*$/, "$1.$2.$3/$4-$5");
  const toBR = (iso) => !iso ? "" : (() => { const [y,m,d] = iso.split("-"); return `${d}/${m}/${y}`; })();
  const uid = () => Math.random().toString(36).slice(2);
  const abbr = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

  // Padrões BR
  const RUBRICA_LABELS = {
    "Materiais de consumo": "Materiais de consumo",
    "Material para protótipo": "Material para protótipo",
    "Outros correlatos": "Outros correlatos",
    "Serviços técnicos de terceiros": "Serviços técnicos de terceiros",
    "Treinamento": "Treinamento",
    "Softwares / máquinas / equipamentos":
      "Aquisição ou uso de programas de computação e aquisição de máquinas, de equipamentos, de aparelhos e de instrumentos, seus acessórios, sobressalentes e ferramentas",
    "Infraestrutura PD&I":
      "Aquisição, implantação, ampliação ou modernização de infraestrutura física e de laboratórios de PD&I",
    "Livros e periódicos técnicos": "Aquisições de livros e periódicos técnicos",
    "Custos incorridos": "Custos incorridos",
  };
  const getRubricaLong = (val) => RUBRICA_LABELS[val] || val || "";

  function formatDateBR(input) {
    if (!input) return "";
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(input)) return input; // já está BR
    const m = String(input).match(/^(\d{4})-(\d{2})-(\d{2})$/); // yyyy-mm-dd
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    const d = new Date(input);
    if (!isNaN(d)) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    }
    return String(input);
  }
  function toISODate(s) {
    if (!s) return null;
    let m = String(s).match(/(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    m = String(s).match(/(\d{4})[\/.\-](\d{2})[\/.\-](\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  function parseMoneyBR(s) {
    if (!s) return null;
    const v = parseFloat(String(s).replace(/\./g, "").replace(",", "."));
    return isNaN(v) ? null : v;
  }
  function formatBRL(value) {
    if (value == null || value === "") return "";
    let num = String(value).replace(/[^\d,-.]/g, "");
    if (/,/.test(num) && /\.\d{3}/.test(num)) num = num.replace(/\./g, "").replace(",", ".");
    else if (/,/.test(num)) num = num.replace(",", ".");
    else num = num.replace(/,/g, "");
    const n = Number(num);
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
      .format(isNaN(n) ? 0 : n);
  }

  function monthsSinceStart(iso, start) {
    if (!iso || !start) return 0;
    const [Y, M] = iso.split("-").map(Number);
    const [y0, m0] = start.split("-").map(Number);
    return (Y - y0) * 12 + (M - m0) + 1;
  }
  function getFieldLabelText(fieldId) {
  const label = document.querySelector(`label[for="${fieldId}"]`);
  return (label?.textContent || "").trim();
}

  /* ===================== Estado do projeto/tabela ===================== */
  let currentProject  = null;
  let projectId       = null;
  let vigenciaInicio  = null; // yyyy-mm-dd
  let vigenciaFim     = null; // yyyy-mm-dd
  const rows = [];

  function pcLabelForPayment(isoPay) {
    if (!vigenciaInicio || !vigenciaFim || !isoPay) return "";
    const dur   = monthsSinceStart(`${vigenciaFim.slice(0,7)}-01`, `${vigenciaInicio.slice(0,7)}-01`);
    const total = Math.max(1, Math.ceil(dur / 3));
    const k     = monthsSinceStart(isoPay, `${vigenciaInicio.slice(0,7)}-01`);
    const idx   = Math.min(Math.max(Math.ceil(k / 3), 1), total);
    return (idx === total) ? "PC Final" : `${idx}ª PC`;
  }
  function monthLabelPlusOne(isoDate) {
    if (!isoDate) return "";
    const d = new Date(`${isoDate}T00:00:00`);
    d.setMonth(d.getMonth() + 1);
    return `${abbr[d.getMonth()]}/${d.getFullYear()}`;
  }

  /* ===================== Helpers de arquivo/OCR ===================== */
  async function fileToText(file) {
    if (!file) return "";
    try {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (ext === "pdf" && window.pdfjsLib) {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        let text = "";
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const c = await page.getTextContent();
          text += c.items.map(it => it.str).join(" ") + "\n";
        }
        return text;
      } else if (window.Tesseract) {
        const { data: { text } } = await Tesseract.recognize(file, "por+eng");
        return text || "";
      }
      return "";
    } catch (err) {
      console.warn("Falha lendo arquivo", file?.name, err);
      return "";
    }
  }
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
  async function compressDataURL(dataURL, maxW = 1200, quality = 0.85) {
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

  /* ===================== Extrações específicas ===================== */
  function formatNFeNumberKeepZeros(raw) {
    if (!raw) return "";
    const digits = onlyDigits(raw);
    const nine   = digits.padStart(9, "0").slice(-9);
    return nine.replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3");
  }
  function parseNFNumberFromNF(text = "") {
    const t = String(text || "");
    let m =
      t.match(/(?:n[úu]mero|n[ºo]|n°|no\.?)\s*(?:da\s*)?(?:nf-?e|nota\s*fiscal)[^\d]{0,15}(\d[\d\.\s]{1,20})/i) ||
      t.match(/nf-?e[^\d]{0,15}(\d[\d\.\s]{1,20})/i) ||
      t.match(/danfe[^\d]{0,15}(\d[\d\.\s]{1,20})/i);
    if (!m) return "";
    return (m[1].match(/\d+/g) || []).join("");
  }
  function issueDateISOFromXML(xmlText) {
    try {
      const mDh = xmlText.match(/<dhEmi>([^<]+)<\/dhEmi>/);
      if (mDh && mDh[1]) {
        const d = new Date(mDh[1].trim());
        const yyyy = d.getFullYear();
        const mm   = String(d.getMonth() + 1).padStart(2, "0");
        const dd   = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      }
      const mD = xmlText.match(/<dEmi>([^<]+)<\/dEmi>/);
      if (mD && mD[1]) return mD[1].trim();
    } catch {}
    return null;
  }
  function issueDateISOFromPDFText(txt = "") {
    const pats = [
      /data\s*de\s*emiss[aã]o\s*[:\-]?\s*(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/i,
      /emiss[aã]o\s*[:\-]?\s*(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/i,
      /danfe[^\n]{0,40}emitid[ao]\s*em\s*(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/i
    ];
    for (const rx of pats) {
      const m = txt.match(rx);
      if (m) { const [, dd, mm, yyyy] = m; return `${yyyy}-${mm}-${dd}`; }
    }
    return null;
  }
  function extractJustificativaFromOficio(text = "") {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    let m = t.match(/(?:Justificativa|Justifica-se|Motiva[cç][aã]o)\s*[:\-]\s*(.+?)(?:\.\s+[A-ZÁÉÍÓÚ]|$)/i);
    if (m && m[1]) return m[1].trim();
    m = t.match(/([^.]{20,200}justific[aá][^\.]{0,200}\.)/i);
    return (m && m[1]) ? m[1].trim() : "";
  }

  /* ===================== Cabeçalho do projeto ===================== */
  const pNome   = $("#p-nome");
  const pCodigo = $("#p-codigo");
  const pGer    = $("#p-gerente");
  const pStatus = $("#p-status");

  /* ===================== Campos do formulário ===================== */
  const selRubrica = $("#rubrica");

  // Favorecido
  const inCNPJ   = $("#cnpj-fav");
  const inRazao  = $("#fav-razao");
  const cnpjHint = $("#cnpj-hint");

  // Campos extraídos do comprovante
  const inDtPag   = $("#inputDataPagamento");
  const inExtrato = $("#inputNumeroExtrato");
  const inValor   = $("#inputValorPago");
  const inMesAno  = $("#inputMesAno");

  // Uploads
  const upNF       = $("#up-nf");
  const upOficio   = $("#up-oficio");
  const upOrdem    = $("#up-ordem");
  const upCotacoes = $("#up-cotacoes");

  // Chips + dicas
  const chipsNF     = $("#chips-nf");
  const chipsOficio = $("#chips-oficio");
  const chipsOrdem  = $("#chips-ordem");
  const chipsCot    = $("#chips-cotacoes");
  const hintNF      = $("#hint-nf");
  const hintOficio  = $("#hint-oficio");

  // Comprovante (colagem)
  const zonePay       = $("#pay-paste-zone");
  const payFile       = $("#payFileInput");
  const payPreview    = $("#payPreview");
  const btnExtrairPay = $("#btn-extrair-pagto");
  const payStatus     = $("#payStatus");

  /* ===================== CNPJ → Razão (BrasilAPI) ===================== */
 /* ===================== Auto CNPJ → Razão Social ===================== */
/* ===================== Auto-preencher razão social via CNPJ ===================== */
const cnpjInput = document.querySelector("#cnpj");
const favInput  = document.querySelector("#favorecido");
const res = await fetch(`/api/cnpj/${digits}`);

async function lookupCNPJ(cnpj) {
  const digits = onlyDigits(cnpj);
  if (digits.length !== 14) return null;
  try {
    // Se seu backend faz proxy, use `/api/cnpj/${digits}` em vez da BrasilAPI direta
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn("[docfin] Erro fetch CNPJ:", e);
    return null;
  }
}

async function handleCNPJChange() {
  const data = await lookupCNPJ(cnpjInput.value);
  if (data?.razao_social) {
    favInput.value = data.razao_social;
    // atualiza linha em edição se estiver em modal
    const id = pcModal?.dataset?.rowId;
    if (id) {
      const row = rows.find(r => String(r.id) === String(id));
      if (row) {
        row.cnpj = maskCNPJ(onlyDigits(cnpjInput.value));
        row.favorecido = data.razao_social;
      }
    }
  }
}

cnpjInput?.addEventListener("blur", handleCNPJChange);
cnpjInput?.addEventListener("change", handleCNPJChange);

  /* ===================== Comprovante (colar/arrastar) ===================== */
  let comprovanteDataURL = null; // dataURL da imagem colada/arrastada
  function setPayStatus(msg) { if (payStatus) payStatus.textContent = msg || ""; }
  function setPayImage(dataURL) {
    if (!payPreview) return;
    payPreview.src = dataURL;
    payPreview.style.display = "block";
    comprovanteDataURL = dataURL;
    if (btnExtrairPay) btnExtrairPay.disabled = false;
    setPayStatus("Imagem pronta para extração.");
  }
  function setImageFromFile(f) {
    if (!f) return;
    fileToDataURL(f).then(d => compressDataURL(d)).then(setPayImage).catch(err => {
      console.error("[docfin] Falha ao preparar imagem:", err);
      setPayStatus("Falha ao preparar imagem.");
    });
  }
  zonePay?.addEventListener("click", () => payFile?.click());
  zonePay?.addEventListener("dragover", (e) => { e.preventDefault(); zonePay.classList.add("dragover"); });
  zonePay?.addEventListener("dragleave", () => zonePay.classList.remove("dragover"));
  zonePay?.addEventListener("drop", (e) => {
    e.preventDefault(); zonePay.classList.remove("dragover");
    setImageFromFile(e.dataTransfer?.files?.[0]);
  });
  payFile?.addEventListener("change", (e) => setImageFromFile(e.target.files?.[0]));
  window.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.type?.startsWith("image/")) {
        setImageFromFile(it.getAsFile());
        e.preventDefault();
        break;
      }
    }
  });

  btnExtrairPay?.addEventListener("click", async () => {
    if (!comprovanteDataURL) return;
    btnExtrairPay.disabled = true;
    setPayStatus("Extraindo...");

    try {
      const resp = await fetch("/api/extrair-documento-imagem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_data_url: comprovanteDataURL })
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${text}`);

      let ex; try { ex = JSON.parse(text); } catch { throw new Error("Resposta JSON inválida"); }

      const dt   = ex?.data_pagamento?.iso ?? "";
      const ne   = ex?.numero_extrato?.raw ?? "";
      const vRaw = ex?.valor_pago?.raw ?? "";
      const vNum = ex?.valor_pago?.valor_pago_num ?? null;
      const mes  = ex?.mes_ao_pagamento?.mes ?? ex?.mes_ano_pagamento?.mes ?? null;
      const ano  = ex?.mes_ao_pagamento?.ano ?? ex?.mes_ano_pagamento?.ano ?? null;

      if (inDtPag)   inDtPag.value = dt || "";
      if (inExtrato) inExtrato.value = ne || "";
      if (inValor)   inValor.value = vRaw || (vNum != null ? String(vNum).replace(".", ",") : "");
      if (inMesAno)  inMesAno.value = (mes && ano) ? `${String(mes).padStart(2, "0")}/${ano}` : "";

      setPayStatus("Dados extraídos do comprovante.");
    } catch (err) {
      console.error(err);
      setPayStatus("Falha na extração.");
      alert("Não foi possível extrair os dados do comprovante.");
    } finally {
      btnExtrairPay.disabled = false;
    }
  });

  /* ===================== NF / Ofício — extrações imediatas (sugestões) ===================== */
  const extracted = { nf: "", just: "", dataTituloISO: "" }; // sugestões imediatas

  function drawChips(box, files) {
    if (!box) return;
    const list = Array.isArray(files) ? files : (files ? [files] : []);
    box.innerHTML = list.map(f => `<span class="chip">📎 ${esc(f.name || f)}</span>`).join(" ");
  }

  upNF?.addEventListener("change", async () => {
    const f = upNF.files?.[0];
    drawChips(chipsNF, f);

    if (!f) {
      if (hintNF) hintNF.textContent = "";
      extracted.nf = "";
      extracted.dataTituloISO = "";
      return;
    }

    const ext = (f.name.split(".").pop() || "").toLowerCase();

    // XML: lê <nNF> e <dhEmi>/<dEmi>
    if (ext === "xml") {
      try {
        const buf = await f.arrayBuffer();
        const xml = new TextDecoder("utf-8").decode(new Uint8Array(buf));

        const nNF   = (xml.match(/<nNF>(\d+)<\/nNF>/) || [])[1] || "";
        const nfFmt = formatNFeNumberKeepZeros(nNF);
        extracted.nf = nfFmt;

        extracted.dataTituloISO = issueDateISOFromXML(xml) || "";

        if (hintNF) hintNF.textContent = nfFmt ? `NF/Recibo sugerido: ${nfFmt}` : "";
        return;
      } catch (e) {
        console.warn("[docfin] Falha lendo XML da NF:", e);
        // cai para OCR/PDF
      }
    }

    // PDF/scan: usa OCR/texto
    const txt   = await fileToText(f);
    const num   = parseNFNumberFromNF(txt);
    const nfFmt = formatNFeNumberKeepZeros(num);
    extracted.nf = nfFmt;

    extracted.dataTituloISO = issueDateISOFromPDFText(txt) || "";

    if (hintNF) hintNF.textContent = nfFmt ? `NF/Recibo sugerido: ${nfFmt}` : "";
  });

  upOficio?.addEventListener("change", async () => {
    const f = upOficio.files?.[0];
    drawChips(chipsOficio, f);
    if (!f) {
      if (hintOficio) hintOficio.textContent = "";
      extracted.just = "";
      return;
    }
    const txt  = await fileToText(f);
    const just = extractJustificativaFromOficio(txt);
    if (hintOficio) hintOficio.textContent = just ? `Justificativa sugerida: ${just}` : "";
    extracted.just = just || "";
  });

  upOrdem?.addEventListener("change",   () => drawChips(chipsOrdem,  upOrdem.files?.[0]));
  upCotacoes?.addEventListener("change",() => drawChips(chipsCot,    Array.from(upCotacoes.files || [])));

  /* ===================== Renderização da tabela ===================== */
  function docBadge(row) {
    const files = row.docs || [];
    if (!files.length) return `<span class="badge badge--neutral">sem anexos</span>`;
    const names = files.map(f => f?.name || f?.filename || (typeof f === "string" ? f : "")).filter(Boolean);
    return `<span class="badge badge--ok" title="${esc(names.join(", "))}">${names.length} arquivo(s)</span>`;
  }

  function render() {
    if (!tblBody) return;
    tblBody.innerHTML = rows.map(r => `
      <tr data-id="${r.id}">
        <td contenteditable="true">${esc(r.favorecido || "—")}</td>
        <td>${esc(r.pcNumero || "")}</td>
        <td contenteditable="true">${esc(r.cnpj || "")}</td>
        <td contenteditable="true">${esc(toBR(r.dataTitulo) || "")}</td>
        <td contenteditable="true">${esc(r.nf || "")}</td>
        <td contenteditable="true">${esc(r.nExtrato || "")}</td>
        <td contenteditable="true">${esc(toBR(r.dataPagamento) || "")}</td>
        <td contenteditable="true">${esc(formatBRL(r.valor) || "")}</td>
        <td contenteditable="true">${esc(getRubricaLong(r.rubrica) || "")}</td>
        <td>${esc(r.mesLabel || "")}</td>
        <td contenteditable="true">${esc(r.just || "")}</td>
        <td>${docBadge(r)}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="icon-btn" data-act="del" title="Excluir">🗑️</button>
        </td>
      </tr>
    `).join("");
  }

  tblBody.addEventListener("click", (e) => {
    const btnDel = e.target.closest("[data-act='del']");
    if (btnDel) {
      const tr  = btnDel.closest("tr");
      const id  = tr?.dataset?.id;
      const idx = rows.findIndex(r => r.id === id);
      if (idx >= 0) { rows.splice(idx, 1); render(); }
      return;
    }
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const id = tr.dataset.id;
    const row = rows.find(r => r.id === id);
    if (row) openPCModal(row);
  });

  /* ===================== Download helpers ===================== */
  async function downloadBlobFromPost(url, payload, filename) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`HTTP ${resp.status} — ${t}`);
    }
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "documento.docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  /* ===================== Template data (com formatos BR) ===================== */
  function buildTemplateData(row) {
    return {
      instituicao: currentProject?.instituicao || "",
      projeto: currentProject?.titulo || "",
      codigo: currentProject?.codigo || "",
      gerente: currentProject?.responsavel || "",
      status: (currentProject?.status || "").replace("_", " "),
      vigencia_inicio: currentProject?.vigenciaInicio || "",
      vigencia_fim: currentProject?.vigenciaFim || "",

      favorecido: row.favorecido || "",
      cnpj: row.cnpj || "",
      pc_numero: row.pcNumero || "",
      // datas/valor já no formato que o documento deve exibir
      data_titulo: formatDateBR(row.dataTitulo) || "",
      nf_recibo: row.nf || "",
      n_extrato: row.nExtrato || "",
      data_pagamento: formatDateBR(row.dataPagamento) || "",
      valor_pago: formatBRL(row.valor) || "",
      rubrica: getRubricaLong(row.rubrica) || "",
      mes_ano: row.mesLabel || "",
      justificativa: row.just || "",
    };
  }

  /* ===================== Botões do modal (gerações) ===================== */
  // Gerar Folha de Rosto
  const btnFolha = $("#btn-folha");
  btnFolha?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const id  = pcModal?.dataset?.rowId;
    if (!id) { alert("Abra uma linha e tente novamente."); return; }
    const row = rows.find(r => r.id === id);
    if (!row) { alert("Linha não encontrada."); return; }

    btnFolha.disabled = true;
    try {
      const data = buildTemplateData(row);
      const payload = {
        instituicao: currentProject?.instituicao || "EDGE",
        rubrica: data.rubrica,                 // já vem no texto longo
        data,
        filenameHint: `Folha_${currentProject?.codigo || "Projeto"}_${row.pcNumero || ""}`
      };
      await downloadBlobFromPost("/api/generate/folha-rosto", payload, "folha_de_rosto.docx");
    } catch (err) {
      alert("Falha ao gerar a Folha de Rosto:\n" + (err?.message || err));
      console.error(err);
    } finally {
      btnFolha.disabled = false;
    }
  });

  // Gerar Mapa/Justificativa
  $("#btn-just-dispensa")?.addEventListener("click", async () => {
    const id  = pcModal?.dataset?.rowId;
    if (!id) { alert("Abra uma linha e tente novamente."); return; }
    const row = rows.find(r => r.id === id);
    if (!row) { alert("Linha não encontrada."); return; }

    try {
      const data = buildTemplateData(row);
      const temCotacoes = Array.isArray(row.docs) && row.docs.some(d => (d?.name || "").toLowerCase().includes("cota"));
      const payload = {
        instituicao: currentProject?.instituicao || "EDGE",
        temCotacoes,
        data,
        filenameHint: `Cotacao_ou_Dispensa_${currentProject?.codigo || "Projeto"}_${row.pcNumero || ""}`
      };
      await downloadBlobFromPost(
        "/api/generate/mapa-ou-dispensa",
        payload,
        temCotacoes ? "mapa_de_cotacao.docx" : "justificativa_dispensa.docx"
      );
    } catch (e) {
      alert("Falha ao gerar o documento.");
      console.error(e);
    }
  });

  // ZIP (placeholder)
  $("#btn-zip")?.addEventListener("click", () => {
    alert("Depois juntamos todos os documentos num ZIP 😉");
  });

  /* ===================== Carregar projeto / dados salvos ===================== */
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

      // Cabeçalho
      if (pNome)   pNome.textContent   = project.titulo || "—";
      if (pCodigo) pCodigo.textContent = project.codigo || project.id || "—";
      if (pGer)    pGer.textContent    = project.responsavel || "—";
      if (pStatus) pStatus.textContent = (project.status || "—").replace("_", " ");

      // Vigência (normaliza d/m/Y -> Y-m-d)
      const fix = d => /^\d{2}\/\d{2}\/\d{4}$/.test(d || "") ? d.split("/").reverse().join("-") : d;
      vigenciaInicio = fix(project.vigenciaInicio);
      vigenciaFim    = fix(project.vigenciaFim);

      currentProject = { ...project, vigenciaInicio, vigenciaFim };

      // Tabs
      $("#tab-evidencias")?.setAttribute("href", `/prestacao.html?id=${encodeURIComponent(projectId)}`);
      $("#tab-docfin")?.setAttribute("href", `/docfin.html?id=${encodeURIComponent(projectId)}`);

      // Linhas salvas
      try {
        const rr = await fetch(`/api/purchases?projectId=${encodeURIComponent(projectId)}`);
        const jj = await rr.json();
        if (jj?.ok && Array.isArray(jj.data)) {
          rows.splice(0, rows.length, ...jj.data);
          render();
        }
      } catch (err) {
        console.warn("[docfin] /api/purchases falhou", err);
      }
    } catch (e) {
      console.error("[docfin] /api/projects erro", e);
    }
  })();

  /* ===================== Submit (Adicionar à tabela) ===================== */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    let favorecido  = (inRazao?.value || "").trim();
    const cnpjDigits = onlyDigits(inCNPJ?.value || "");
    if (!favorecido && cnpjDigits.length === 14) {
      const raz = await fillRazaoFromCNPJ();
      if (raz) favorecido = raz;
    }

    const rubrica  = selRubrica?.value || "";
    const fNF      = upNF?.files?.[0]     || null;
    const fOficio  = upOficio?.files?.[0] || null;
    const fOrdem   = upOrdem?.files?.[0]  || null;
    const fCots    = Array.from(upCotacoes?.files || []);

    const valDtPagISO = (inDtPag?.value || "").trim();
    const valExtrato  = (inExtrato?.value || "").trim();
    const valValor    = parseMoneyBR((inValor?.value || "").trim());
    const valMesAno   = (inMesAno?.value || "").trim();

    const id = uid();
    const docsBase = [fNF, fOficio, fOrdem, ...fCots].filter(Boolean);
    if (comprovanteDataURL) docsBase.unshift({ name: "Comprovante (colado)" });

    const row = {
      id,
      favorecido,
      pcNumero: "",
      cnpj: cnpjDigits ? maskCNPJ(cnpjDigits) : "",
      dataTitulo: extracted.dataTituloISO || "",   // emissão NF-e (ISO)
      nf: extracted.nf || "",                      // 000.000.000
      nExtrato: valExtrato,
      dataPagamento: valDtPagISO,
      valor: valValor ?? "",
      rubrica,
      mesLabel: valMesAno || "",
      just: extracted.just || "",
      docs: docsBase
    };

    if (row.dataPagamento) {
      row.pcNumero = pcLabelForPayment(row.dataPagamento);
      if (!row.mesLabel) row.mesLabel = monthLabelPlusOne(row.dataPagamento);
    }

    rows.unshift(row);
    render();

    // Backend opcional (parse server-side)
    const temArquivo = !!(fNF || fOficio || fOrdem || fCots.length);
    if (temArquivo) {
      const fd = new FormData();
      if (fNF)     fd.append("nf", fNF);
      if (fOficio) fd.append("oficio", fOficio);
      if (fOrdem)  fd.append("ordem", fOrdem);
      fCots.forEach(c => fd.append("cotacoes", c));
      fd.append("vigenciaInicio", vigenciaInicio || "");
      fd.append("vigenciaFim",    vigenciaFim    || "");

      try {
        const r = await fetch("/api/parse-docs", { method: "POST", body: fd });
        const j = await r.json();
        if (j?.ok) {
          const ii = rows.findIndex(rw => rw.id === id);
          if (ii >= 0) {
            rows[ii] = {
              ...rows[ii],
              cnpj:          rows[ii].cnpj || j.data?.cnpj || "",
              nf:            rows[ii].nf || (j.data?.nf ? formatNFeNumberKeepZeros(j.data.nf) : ""),
              dataTitulo:    rows[ii].dataTitulo || (j.data?.dataTitulo ? toISODate(j.data.dataTitulo) : ""),
              nExtrato:      rows[ii].nExtrato || j.data?.nExtrato || "",
              dataPagamento: rows[ii].dataPagamento || j.data?.dataPagamento || "",
              valor:         rows[ii].valor ?? j.data?.valor,
              just:          rows[ii].just || j.data?.just || "",
              pcNumero:      rows[ii].pcNumero || j.data?.pcNumero || (rows[ii].dataPagamento ? pcLabelForPayment(rows[ii].dataPagamento) : ""),
              mesLabel:      rows[ii].mesLabel || j.data?.mesLabel || (rows[ii].dataPagamento ? monthLabelPlusOne(rows[ii].dataPagamento) : "")
            };
            render();
          }
        }
      } catch (err) {
        console.warn("[docfin] /api/parse-docs falhou", err);
      }
    }

    // Limpa UI do comprovante + uploads (mantém valores extraídos)
    comprovanteDataURL = null;
    try { if (payFile) payFile.value = ""; } catch {}
    if (payStatus) payStatus.textContent = "";
    if (payPreview) { payPreview.src = ""; payPreview.style.display = "none"; }
    try {
      if (upNF) upNF.value = "";
      if (upOficio) upOficio.value = "";
      if (upOrdem) upOrdem.value = "";
      if (upCotacoes) upCotacoes.value = "";
    } catch {}
    if (chipsNF) chipsNF.innerHTML = "";
    if (chipsOficio) chipsOficio.innerHTML = "";
    if (chipsOrdem) chipsOrdem.innerHTML = "";
    if (chipsCot) chipsCot.innerHTML = "";
    if (hintNF) hintNF.textContent = "";
    if (hintOficio) hintOficio.textContent = "";
  });

  /* ===================== Salvar tabela ===================== */
/* ===================== Salvar tabela ===================== */
btnSave.addEventListener("click", async () => {
  try {
    const r = await fetch("/api/purchases", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, rows })
    });
    const j = await r.json();
    if (j?.ok) {
      persistLocal(); // <<<<<<<<<<<<<< ADICIONE ISTO
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

/* ===================== Diagnóstico rápido ===================== */
window.addEventListener("error", (e) => console.error("[docfin] erro global:", e?.message || e));
window.addEventListener("unhandledrejection", (e) => console.error("[docfin] promise rejeitada:", e?.reason || e));

/* ===================== FOLHA DE ROSTO ===================== */
/**
 * Observações importantes:
 * - Evitamos listeners duplicados para #btn-folha (era o que gerava 2 downloads).
 * - Unificamos helpers de rubrica/data/moeda.
 * - O payload inclui campos amplamente usados no backend:
 *   naturezaDisp (rubrica expandida), rubrica (rótulo curto), favorecido, cnpj,
 *   numeroExtrato, nfnd, datas e valor.
 * - O filenameHint ajuda o backend a nomear o arquivo.
 */

/* ---- Tabela de rótulos estendidos por rubrica ---- */
const RUBRICA_LABELS_LONG = {
  "Materiais de consumo": "Materiais de consumo",
  "Material para protótipo": "Material para protótipo",
  "Outros correlatos": "Outros correlatos",
  "Serviços técnicos de terceiros": "Serviços técnicos de terceiros",
  "Treinamento": "Treinamento",
  "Softwares / máquinas / equipamentos":
    "Aquisição ou uso de programas de computação e aquisição de máquinas, de equipamentos, de aparelhos e de instrumentos, seus acessórios, sobressalentes e ferramentas",
  "Infraestrutura PD&I":
    "Aquisição, implantação, ampliação ou modernização de infraestrutura física e de laboratórios de PD&I",
  "Livros e periódicos técnicos": "Aquisições de livros e periódicos técnicos",
  "Custos incorridos": "Custos incorridos",
};

/* ---- Helpers de formatação ---- */
function formatDateBR(input) {
  if (!input) return "";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(input)) return input; // já está BR
  const m = String(input).match(/^(\d{4})-(\d{2})-(\d{2})$/); // yyyy-mm-dd
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(input);
  if (!isNaN(d)) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  return String(input);
}

function formatBRL(value) {
  if (value == null || value === "") return "";
  let num = String(value).replace(/[^\d,-.]/g, "");
  if (/,/.test(num) && /\.\d{3}/.test(num)) num = num.replace(/\./g, "").replace(",", ".");
  else if (/,/.test(num)) num = num.replace(",", ".");
  else num = num.replace(/,/g, "");
  const n = Number(num);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(isNaN(n) ? 0 : n);
}

/* ---- Rubrica: pega texto visível do <select> e mapeia para o rótulo longo ---- */
function getRubricaSelectText() {
  const sel = document.querySelector("#rubrica");
  const opt = sel?.options?.[sel.selectedIndex];
  return (opt?.text || sel?.value || "").trim();
}
function mapRubricaLong(val) {
  return RUBRICA_LABELS_LONG[val] || val || "";
}

/* ---- Geração da folha (POST para o backend gerar e baixar) ---- */
async function gerarFolhaDeRosto(row) {
  // 1) rótulo do campo (label), 2) fallback para texto visível do select, 3) fallback para dado da linha
  const rotuloCampoRubrica = getFieldLabelText("rubrica");
  const rubricaCampo = rotuloCampoRubrica || getRubricaSelectText() || row.rubrica || "";

  const dataRow = (typeof buildTemplateData === "function") ? buildTemplateData(row) : null;

  const payload = {
    instituicao: currentProject?.instituicao || "EDGE",
    filenameHint: `Folha_${currentProject?.codigo || "Projeto"}_${row.pcNumero || ""}`,

    // use SEMPRE o rótulo do campo
    rubrica: rubricaCampo,
    naturezaDisp: rubricaCampo, // se o backend espera este campo, mantemos igual ao rótulo do campo

    favorecido: row.favorecido || "",
    cnpj: row.cnpj || "",
    numeroExtrato: row.numeroExtrato || "",
    nfnd: row.numeroNF || row.nf || row.recibo || "",

    dataEmissaoNF: formatDateBR(row.dataTitulo || row.dataEmissaoNF || ""),
    dataPagamento: formatDateBR(row.dataPagamento || ""),
    valor: formatBRL(row.valorPago ?? row.valor ?? ""),

    ...(dataRow ? { data: dataRow } : {})
  };

  await downloadBlobFromPost("/api/generate/folha-rosto", payload, "folha_de_rosto.docx");
}

async function gerarFolhaDeRosto(row) {
  // Preferimos o texto atualmente selecionado no <select>, com fallback do dado da linha
  const rubricaCurta = getRubricaSelectText() || row.rubrica || "";
  const rubricaLonga = mapRubricaLong(rubricaCurta);

  // Alguns backends esperam 'data' estruturada; outros esperam campos soltos.
  // Mantemos os campos soltos e, se existir buildTemplateData, enviamos também em 'data'.
  const dataRow = (typeof buildTemplateData === "function") ? buildTemplateData(row) : null;

  const payload = {
    // metadados do projeto
    instituicao: currentProject?.instituicao || "EDGE",
    filenameHint: `Folha_${currentProject?.codigo || "Projeto"}_${row.pcNumero || ""}`,

    // rubrica (curta e longa)
    rubrica: rubricaCurta,
    naturezaDisp: rubricaLonga,

    // campos financeiros/documentais
    favorecido: row.favorecido || "",
    cnpj: row.cnpj || "",
    numeroExtrato: row.numeroExtrato || "",
    nfnd: row.numeroNF || row.nf || row.recibo || "",

    dataEmissaoNF: formatDateBR(row.dataTitulo || row.dataEmissaoNF || ""),
    dataPagamento: formatDateBR(row.dataPagamento || ""),
    valor: formatBRL(row.valorPago ?? row.valor ?? ""),

    // opcional: bloco data para templates DOCX (quando seu backend usa merge de placeholders)
    ...(dataRow ? { data: dataRow } : {})
  };

  // Função utilitária que você já possui para baixar blob via POST:
  // downloadBlobFromPost(url, payload, filename)
  await downloadBlobFromPost("/api/generate/folha-rosto", payload, "folha_de_rosto.docx");
}

/* ---- Listener ÚNICO do botão #btn-folha ---- */
(() => {
  const btnFolha = document.querySelector("#btn-folha");
  if (!btnFolha) {
    console.warn("[docfin] #btn-folha não encontrado.");
    return;
  }

  // Evita múltiplos binds caso o script seja injetado mais de uma vez:
  if (btnFolha.dataset.bound === "1") return;
  btnFolha.dataset.bound = "1";

  btnFolha.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const id = pcModal?.dataset?.rowId;
    if (!id) { alert("Abra uma linha e tente novamente."); return; }

    const row = rows?.find?.(r => String(r.id) === String(id));
    if (!row) { alert("Linha não encontrada."); return; }

    btnFolha.disabled = true;
    btnFolha.classList.add("is-loading"); // se tiver CSS para loading

    try {
      await gerarFolhaDeRosto(row);
    } catch (err) {
      console.error("[docfin] Falha ao gerar a Folha de Rosto:", err);
      alert("Falha ao gerar a Folha de Rosto.\n" + (err?.message || err));
    } finally {
      btnFolha.disabled = false;
      btnFolha.classList.remove("is-loading");
    }
  });
})();
persistLocal();

async function downloadBlobFromPost(url, payload, fallbackFilename = "arquivo.bin") {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Se o backend mandou JSON de erro, mostre
    const ct = res.headers.get("Content-Type") || "";
    if (!res.ok) {
      if (ct.includes("application/json")) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || j?.message || `Falha HTTP ${res.status}`);
      }
      throw new Error(`Falha HTTP ${res.status}`);
    }

    // Tenta extrair o nome de arquivo do Content-Disposition
    let filename = fallbackFilename;
    const cd = res.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^;"']+)/i);
    if (m && m[1]) filename = decodeURIComponent(m[1].replace(/["']/g, ""));

    // Baixa como blob
    const blob = await res.blob();
    const urlObj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = urlObj;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(urlObj);
  } catch (err) {
    console.error("[docfin] erro no download:", err);
    alert("Erro ao baixar documento: " + (err?.message || err));
  }
}
