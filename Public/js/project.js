import { api } from "./app.js";

/* =========================================================
   Helpers globais (apenas uma vez)
========================================================= */
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const esc = (t="") =>
  String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'\'':'&#39;'}[c]));

const escAttr = (t="") => esc(t).replace(/"/g, "&quot;");

const toast = (msg, isErr=false) => {
  const el = $("#toast");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.classList.toggle("error", !!isErr);
  el.style.display = "block";
  setTimeout(()=> el.style.display = "none", 2200);
};

/* =========================================================
   Tabs helpers compartilhados
========================================================= */
const TAB_ALIASES = {
  evid: "evid",
  evidencias: "evid",
  "evidências": "evid",
  df: "df",
  financeiro: "df",
  "documentacao financeira": "df",
  "documentação financeira": "df"
};

const TAB_BUTTON_SELECTOR = ".tabs .tab, .tabs [data-tab], .tabs [aria-controls], .tabs [data-target]";
const TAB_PANEL_SELECTOR = ".tabpanel, [role='tabpanel']";

function normalizeTabKey(raw=""){
  const cleaned = String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/^#/, "")
    .replace(/^tab-/, "");
  return TAB_ALIASES[cleaned] || cleaned;
}

function getTabNameFromButton(btn){
  if (!btn) return "";
  const raw = btn.getAttribute("data-target") ||
              btn.getAttribute("aria-controls") ||
              btn.dataset?.tab ||
              btn.dataset?.name ||
              btn.textContent;
  return normalizeTabKey(raw);
}

function resolvePanelElement(rawName){
  const name = normalizeTabKey(rawName);
  if (!name) return null;
  const selectors = [
    `#tab-${name}`,
    `.tabpanel[data-panel="${name}"]`,
    `[role='tabpanel'][data-panel="${name}"]`,
    `#${name}`
  ];
  for (const sel of selectors){
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function activateTabByName(rawName, ctx={}){
  const name = normalizeTabKey(rawName);
  const panel = resolvePanelElement(name);
  if (!panel){
    console.warn("[tabs] Painel não encontrado:", rawName);
    return;
  }

  const buttons = ctx.tabsList || Array.from(document.querySelectorAll(TAB_BUTTON_SELECTOR));
  const panels  = ctx.panelsList || Array.from(document.querySelectorAll(TAB_PANEL_SELECTOR));

  buttons.forEach(btn => {
    const isActive = getTabNameFromButton(btn) === name;
    btn.classList.toggle("active", isActive);
    if (btn.hasAttribute("aria-selected")){
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    }
  });

  panels.forEach(p => {
    const panelKey = normalizeTabKey(p.id || p.getAttribute("data-panel"));
    const matches = p === panel || panelKey === name;
    p.classList.toggle("active", matches);
    if (matches){
      p.removeAttribute("hidden");
      p.style.display = "";
    }else{
      p.style.display = "none";
    }
  });
}

/* =========================================================
   Contexto do projeto + chaves de storage
========================================================= */
const Q  = new URLSearchParams(location.search);
const projectId = Q.get("id");
if (!projectId) location.href = "./dashboard.html";

const K_CRONO = (id) => `crono:${id}`;
const K_EVID  = (id) => `evid:${id}`;
const K_ROWS  = (id) => `rows:${id}`; // documentação financeira

const readJSON  = (k, d=undefined) => { try { return JSON.parse(localStorage.getItem(k) || (d===undefined? "null" : JSON.stringify(d))); } catch { return d; } };
const writeJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));

/* =========================================================
   Estado
========================================================= */
let project = null;

// Evidências
let crono = readJSON(K_CRONO(projectId), { start:"", end:"", period:"Mensal", metas:0, status:"Pendente", obs:"" });
let evidencias = readJSON(K_EVID(projectId), []);

// Documentação Financeira
let dfRows = readJSON(K_ROWS(projectId), []);
let fPc = "";       // filtro PC
let fBusca = "";    // filtro busca

// Loader XLSX (lazy)
let xlsxLoaderPromise = null;

async function ensureXlsx(){
  if (window.XLSX) return window.XLSX;
  if (!xlsxLoaderPromise){
    xlsxLoaderPromise = new Promise((resolve, reject)=>{
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      script.onload = () => resolve(window.XLSX);
      script.onerror = () => reject(new Error("Não foi possível carregar a biblioteca XLSX"));
      document.head.appendChild(script);
    });
  }
  try{
    await xlsxLoaderPromise;
  }catch(err){
    xlsxLoaderPromise = null;
    throw err;
  }
  return window.XLSX;
}

/* =========================================================
   Boot
========================================================= */
document.addEventListener("DOMContentLoaded", init);

async function init(){
  project = await api.getProject(projectId);
  if (!project) { location.href = "./dashboard.html"; return; }

  renderHeader();
  bindTabs();

  // Evidências
  initCrono();
  renderMeses();
  bindDistributionUpload();
  renderTabelaEvidencias();

  // Doc. Financeira
  bindDfUI();
  renderDF();

  // persistência segura na saída
  window.addEventListener("beforeunload", ()=>{
    writeJSON(K_CRONO(projectId), crono);
    writeJSON(K_EVID(projectId), evidencias);
    writeJSON(K_ROWS(projectId), dfRows);
  });
}

/* =========================================================
   Header + Tabs
========================================================= */
function renderHeader(){
  const header = $("#projectHeader");
  if (!header) return;
  header.innerHTML = `
    <h1>${esc(project.nome||"Projeto")}</h1>
    <div class="meta-line">
      <div><strong>Código:</strong> ${esc(project.codigo||"—")}</div>
      <div><strong>Vigência:</strong> ${esc(project.vigencia||"—")}</div>
      <div><strong>Responsável:</strong> ${esc(project.responsavel||"—")}</div>
      <div><strong>Status:</strong> ${badge(project.status)}</div>
    </div>`;
}
function badge(s=''){
  s = String(s||'').toLowerCase();
  if (s.includes('andamento')) return `<span class="badge badge--yellow">Em andamento</span>`;
  if (s.includes('final'))     return `<span class="badge badge--green">Finalizado</span>`;
  if (s.includes('pend'))      return `<span class="badge badge--gray">Pendente</span>`;
  return `<span class="badge badge--gray">${esc(s||'—')}</span>`;
}
/* =========================================================
   Header + Tabs
========================================================= */
function renderHeader(){
  const header = $("#projectHeader");
  if (!header) return;
  header.innerHTML = `
    <h1>${esc(project.nome||"Projeto")}</h1>
    <div class="meta-line">
      <div><strong>Código:</strong> ${esc(project.codigo||"—")}</div>
      <div><strong>Vigência:</strong> ${esc(project.vigencia||"—")}</div>
      <div><strong>Responsável:</strong> ${esc(project.responsavel||"—")}</div>
      <div><strong>Status:</strong> ${badge(project.status)}</div>
    </div>`;
}
function badge(s=''){
  s = String(s||'').toLowerCase();
  if (s.includes('andamento')) return `<span class="badge badge--yellow">Em andamento</span>`;
  if (s.includes('final'))     return `<span class="badge badge--green">Finalizado</span>`;
  if (s.includes('pend'))      return `<span class="badge badge--gray">Pendente</span>`;
  return `<span class="badge badge--gray">${esc(s||'—')}</span>`;
}

function bindTabs() {
  const tabs = Array.from(document.querySelectorAll(TAB_BUTTON_SELECTOR));
  const panels = Array.from(document.querySelectorAll(TAB_PANEL_SELECTOR));

  const activate = (rawName) => activateTabByName(rawName, { tabsList: tabs, panelsList: panels });

  tabs.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const target = btn.getAttribute("data-target") || btn.getAttribute("aria-controls");
      activate(target || btn.dataset.tab || btn.dataset.name || btn.textContent);
    });
  });

  const initialBtn = tabs.find(b => b.classList.contains("active"));
  if (initialBtn){
    activate(initialBtn.getAttribute("data-target") || initialBtn.getAttribute("aria-controls") || initialBtn.dataset.tab || initialBtn.dataset.name || initialBtn.textContent);
  }else{
    activate("evid");
  }
}

/* =========================================================
   A) Evidências
========================================================= */
// ----- Cronograma -----
function initCrono(){
  $("#cronoStart")?.addEventListener("change", e => crono.start = e.target.value);
  $("#cronoEnd")?.addEventListener("change", e => crono.end = e.target.value);
  $("#cronoPeriod")?.addEventListener("change", e => crono.period = e.target.value);
  $("#cronoMetas")?.addEventListener("change", e => crono.metas = +e.target.value||0);
  $("#cronoObs")?.addEventListener("input", e => crono.obs = e.target.value);

  if ($("#cronoStart")) $("#cronoStart").value = crono.start || "";
  if ($("#cronoEnd"))   $("#cronoEnd").value   = crono.end   || "";
  if ($("#cronoPeriod"))$("#cronoPeriod").value= crono.period||"Mensal";
  if ($("#cronoMetas")) $("#cronoMetas").value = crono.metas || 0;
  if ($("#cronoObs"))   $("#cronoObs").value   = crono.obs   || "";
  setCronoStatus(crono.status || "Pendente");

  $("#btnSaveCrono")?.addEventListener('click', ()=>{
    setCronoStatus(crono.files?.length ? "Enviado" : "Pendente");
    writeJSON(K_CRONO(projectId), crono);
    toast("Cronograma salvo.");
  });
  $("#btnTemplateCrono")?.addEventListener('click', ()=> toast("Template baixado (placeholder)"));
}
function setCronoStatus(st){
  crono.status = st;
  const el = $("#cronoStatus");
  if (!el) return;
  el.className = "badge " + (st==="Enviado" ? "badge--green" : "badge--gray");
  el.textContent = st;
}

// ----- Distribuição mensal -----
function renderMeses(){
  const anos = getAnosFromVigencia(project.vigencia) || [ new Date().getFullYear() ];
  const selAno = $("#filtroAno");
  if (selAno){
    selAno.innerHTML = anos.map(a=>`<option>${a}</option>`).join("");
    selAno.value = String(anos[0]);
    selAno.addEventListener('change', renderTabelaEvidencias);
  }

  const selMeta = $("#filtroMeta");
  if (selMeta){
    selMeta.innerHTML = `<option value="">Todas as metas</option>` +
      (crono.metas>0 ? Array.from({length:crono.metas},(_,i)=>`<option>${i+1}</option>`).join("") : "");
    selMeta.addEventListener('change', renderTabelaEvidencias);
  }

  const meses = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const chips = $("#mesesChips");
  if (chips){
    chips.innerHTML = meses.map((m,i)=>`<button class="chip chip-lg" data-m="${i+1}">${m} · <span class="qtd">0</span></button>`).join("");
    chips.querySelectorAll(".chip").forEach(c=>{
      c.addEventListener('click', ()=>{
        chips.querySelectorAll(".chip").forEach(x=>x.classList.remove('active'));
        c.classList.add('active');
        renderTabelaEvidencias();
      });
    });
  }

  $("#filtroBusca")?.addEventListener('input', renderTabelaEvidencias);
  $("#filtroStatus")?.addEventListener('change', renderTabelaEvidencias);
}

/* Upload XLSX/CSV para evidências */
function bindDistributionUpload(){
  const distFile = $("#fileDist");
  const distDrop = $("#dropDist");
  if (!distFile || !distDrop) return;

  distDrop.addEventListener("dragover", e => { e.preventDefault(); distDrop.classList.add('drag'); });
  distDrop.addEventListener("dragleave", () => distDrop.classList.remove('drag'));
  distDrop.addEventListener("drop", e => {
    e.preventDefault(); distDrop.classList.remove('drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) handleDistributionFile(f);
  });
  distFile.addEventListener("change", e => {
    const f = e.target?.files?.[0];
    if (f) handleDistributionFile(f);
  });
}

async function handleDistributionFile(file){
  if (!file) return;
  try{
    const rows = await readScheduleFile(file);
    if (!rows.length) { toast("Planilha sem linhas válidas.", true); return; }

    const ano = getSelectedYear();
    let adicionadas = 0;
    let maiorMeta = crono.metas || 0;

    rows.forEach(r=>{
      const etapa = String(r.etapa||"").trim();
      const indicador = String(r.indicador||"").trim();
      const metaNum = parseMetaFromEtapa(etapa);
      if (metaNum && metaNum > maiorMeta) maiorMeta = metaNum;

      for (let m=1; m<=12; m++){
        const cell = (r[`mes${m}`] ?? "").toString().trim().toLowerCase();
        if (["x","1","sim","ok"].includes(cell)){
          evidencias.push({
            id: Date.now()+Math.random(),
            nome: `${etapa} — ${indicador}`.trim(),
            mes: m,
            entrega: isoDateFromMonth(ano, m),   // dia 05 do mês/ano
            meta: metaNum || "",
            anexos: [],
            status: "Pendente",
            obs: ""
          });
          adicionadas++;
        }
      }
    });

    if (maiorMeta && maiorMeta !== crono.metas) {
      crono.metas = maiorMeta;
      writeJSON(K_CRONO(projectId), crono);
    }

    writeJSON(K_EVID(projectId), evidencias);
    renderMeses();
    renderTabelaEvidencias();
    toast(`Importado: ${adicionadas} evidência(s).`);
  }catch(err){
    console.error(err);
    toast("Falha ao ler o arquivo. Envie XLSX/CSV no formato esperado.", true);
  }
}

async function readScheduleFile(file){
  const name = (file.name||"").toLowerCase();

  if ((name.endsWith(".xlsx") || name.endsWith(".xls"))){
    await ensureXlsx();
    if (window.XLSX){
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval:"" });
      return normalizeRows(json);
    }
    throw new Error("Biblioteca XLSX indisponível");
  }

  // CSV
  const text = await file.text();
  const delim = text.includes(';') ? ';' : ',';
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0], delim).map(normalizeKey);
  const out = [];
  for (let i=1;i<lines.length;i++){
    const cols = splitCsvLine(lines[i], delim);
    const obj = {};
    headers.forEach((k,ix)=> obj[k] = (cols[ix]||"").trim());
    out.push(obj);
  }
  return normalizeRows(out);
}

function normalizeRows(rows){
  const get = (o, ...keys) => { for (const k of keys){ if (o[k]!=null && o[k] !="") return o[k]; } return ""; };
  return rows.map(oRaw=>{
    const o = {};
    for (const k in oRaw){ o[normalizeKey(k)] = oRaw[k]; }
    const rec = {
      etapa     : get(o, "etapa","meta","metaetapa"),
      indicador : get(o, "indicador","descricao","descricaoindicador"),
      qtd       : get(o, "qtd","quantidade","qtdtotal")
    };
    for (let m=1;m<=12;m++){
      rec[`mes${m}`] = get(o, `mes${m}`, `m${m}`, `mes_${m}`);
    }
    return rec;
  });
}

function splitCsvLine(line, delim){
  const out = []; let cur = "", inQ = false;
  for (let i=0;i<line.length;i++){
    const c = line[i];
    if (c === '"'){ inQ = !inQ; continue; }
    if (c === delim && !inQ){ out.push(cur); cur=""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function normalizeKey(s){
  return String(s||"")
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/\s+/g,'')
    .replace(/[^a-z0-9]/g,'');
}

function parseMetaFromEtapa(etapa){
  const m = String(etapa||"").match(/m\s*([0-9]+)/i);
  return m ? +m[1] : "";
}

// ----- Tabela de evidências -----
function linhaVazia(){
  return { id: Date.now()+Math.random(), nome:"", mes:"", entrega:"", meta:"", anexos:[], status:"Pendente", obs:"" };
}

$("#btnAddLinha")?.addEventListener("click", ()=>{
  evidencias.push(linhaVazia());
  renderTabelaEvidencias(true);
});
$("#btnSalvarTabela")?.addEventListener("click", ()=>{
  writeJSON(K_EVID(projectId), evidencias);
  toast("Tabela salva.");
});
$("#btnImport")?.addEventListener("click", ()=> toast("Importar planilha (placeholder)"));
$("#btnExportXlsx")?.addEventListener("click", ()=> toast("Exportar XLSX (placeholder)"));
$("#btnExportCsv")?.addEventListener("click", ()=> toast("Exportar CSV (placeholder)"));

function renderTabelaEvidencias(focusUltima=false){
  const grid = $("#gridEvid");
  if (!grid) return;
  grid.querySelectorAll(".tr").forEach(el=>el.remove());

  const meta = $("#filtroMeta")?.value || "";
  const busca = ($("#filtroBusca")?.value || "").toLowerCase();
  const chipSel = $("#mesesChips .chip.active");
  const mesSel = chipSel ? chipSel.dataset.m : "";
  const fs = $("#filtroStatus")?.value || "";

  let list = evidencias.slice();
  if (meta)  list = list.filter(r => String(r.meta||"") === meta);
  if (mesSel)list = list.filter(r => String(r.mes||"") === String(mesSel));
  if (busca) list = list.filter(r => (r.nome||"").toLowerCase().includes(busca));
  if (fs)    list = list.filter(r => r.status === fs);

  // contadores nos chips
  const countByMonth = Array(13).fill(0);
  evidencias.forEach(r => { const m = +r.mes||0; if (m>=1 && m<=12) countByMonth[m]++; });
  $("#mesesChips")?.querySelectorAll(".chip .qtd").forEach((el,i)=> el.textContent = countByMonth[i+1] || 0);

  // progresso
  const concl = evidencias.filter(r => (r.status==="Enviado" || r.status==="Aprovado")).length;
  const prog = evidencias.length ? Math.round(100*concl/evidencias.length) : 0;
  if ($("#progressAno")) $("#progressAno").style.width = `${prog}%`;

  const frag = document.createDocumentFragment();
  list.forEach((r)=> frag.appendChild(renderRowEvidencia(r)));
  grid.appendChild(frag);

  const total = evidencias.length;
  const entregues = evidencias.filter(r => (r.status==="Enviado" || r.status==="Aprovado")).length;
  const pend = evidencias.filter(r => r.status==="Pendente").length;
  const atras = evidencias.filter(r => r.status==="Atrasada").length;
  if ($("#gridResumo")) $("#gridResumo").innerHTML = `
    <span>Total: ${total}</span>
    <span>Entregues: ${entregues}</span>
    <span>Pendentes: ${pend}</span>
    <span>Atrasadas: ${atras}</span>`;

  if (focusUltima) {
    const lastInput = grid.querySelector(".tr:last-child input[name='nome']");
    lastInput && lastInput.focus();
  }
}

function renderRowEvidencia(r){
  const mesesOpts = ["","Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
    .map((m,i)=>`<option value="${i === 0 ? "" : i}">${m}</option>`).join("");

  const wrap = document.createElement("div");
  wrap.className = "tr";
  wrap.innerHTML = `
    <div class="td"><input name="nome" value="${escAttr(r.nome)}" placeholder="Ex.: Relatório de atividades"></div>
    <div class="td"><select name="mes">${mesesOpts}</select></div>
    <div class="td"><input type="date" name="entrega" value="${escAttr(r.entrega||"")}"></div>
    <div class="td">
      <select name="meta">
        <option value=""></option>
        ${Array.from({length: (+readJSON(K_CRONO(projectId), crono).metas || 0)},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join("")}
      </select>
    </div>
    <div class="td">
      <div class="drop mini">Solte/Selecione <input type="file" hidden></div>
      <div class="chips"></div>
    </div>
    <div class="td">
      <select name="status">
        <option ${r.status==="Pendente"?"selected":""}>Pendente</option>
        <option ${r.status==="Enviado"?"selected":""}>Enviado</option>
        <option ${r.status==="Aprovado"?"selected":""}>Aprovado</option>
        <option ${r.status==="Atrasada"?"selected":""}>Atrasada</option>
      </select>
    </div>
    <div class="td"><input name="obs" value="${escAttr(r.obs||"")}" placeholder="Observações…"></div>
    <div class="td actions">
      <button class="icon-btn btView" title="Ver">👁️</button>
      <button class="icon-btn btDel" title="Remover">🗑️</button>
    </div>
  `;

  wrap.querySelector("select[name='mes']").value = String(r.mes||"");
  wrap.querySelector("select[name='meta']").value = String(r.meta||"");

  wrap.querySelector("input[name='nome']").addEventListener("input", e => r.nome = e.target.value);
  wrap.querySelector("select[name='mes']").addEventListener("change", e => {
    r.mes = +e.target.value || "";
    if (r.mes) {
      const ano = getSelectedYear();
      r.entrega = isoDateFromMonth(ano, r.mes); // sempre dia 05
      wrap.querySelector("input[name='entrega']").value = r.entrega;
    } else {
      r.entrega = "";
      wrap.querySelector("input[name='entrega']").value = "";
    }
    renderTabelaEvidencias();
  });
  wrap.querySelector("input[name='entrega']").addEventListener("change", e => r.entrega = e.target.value);
  wrap.querySelector("select[name='meta']").addEventListener("change", e => r.meta = e.target.value);
  wrap.querySelector("select[name='status']").addEventListener("change", e => { r.status = e.target.value; renderTabelaEvidencias(); });
  wrap.querySelector("input[name='obs']").addEventListener("input", e => r.obs = e.target.value);

  const drop = wrap.querySelector(".drop.mini");
  const inputFile = drop.querySelector("input[type='file']");
  const chips = wrap.querySelector(".chips");

  const repaintFiles = () => {
    chips.innerHTML = (r.anexos||[]).map((f,i)=>`<span class="chip">${esc(f.name)} <button class="chip-x" data-i="${i}">×</button></span>`).join("");
    chips.querySelectorAll(".chip-x").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const i = +btn.dataset.i;
        r.anexos.splice(i,1);
        repaintFiles();
      });
    });
  };
  repaintFiles();

  const handleFiles = (fl) => {
    const arr = Array.from(fl||[]);
    if (!arr.length) return;
    r.anexos = (r.anexos||[]).concat(arr.map(f=>({ name:f.name, size:f.size })));
    repaintFiles();
  };

  drop.addEventListener("click", ()=> inputFile.click());
  drop.addEventListener("dragover", e=>{ e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener("dragleave", ()=> drop.classList.remove('drag'));
  drop.addEventListener("drop", e=>{ e.preventDefault(); drop.classList.remove('drag'); handleFiles(e.dataTransfer.files); });
  inputFile.addEventListener("change", e=> handleFiles(e.target.files));

  wrap.querySelector(".btDel").addEventListener("click", ()=>{
    evidencias = evidencias.filter(x => x !== r);
    renderTabelaEvidencias();
  });
  wrap.querySelector(".btView").addEventListener("click", ()=>{
    alert("Pré-visualização (placeholder)");
  });

  return wrap;
}

/* =========================================================
   B) Documentação Financeira
========================================================= */
const fmtMoney = (v)=> (Number(v||0))
  .toLocaleString("pt-BR",{style:"currency",currency:"BRL"})
  .replace(/\s/g,'');

function bindDfUI(){
  // abrir modal nova compra
  $("#btnNovaCompra")?.addEventListener("click", ()=>{
    $("#formCompra")?.reset();
    const dlg = $("#dlgCompra");
    if (dlg?.showModal) dlg.showModal(); else dlg?.setAttribute("open",""); // fallback
  });

  // salvar compra
  $("#formCompra")?.addEventListener("submit",(e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const item = {
      id: Date.now().toString(),
      favorecido: (fd.get("favorecido")||"").toString().trim(),
      pc: computePcLabel(project.vigencia, fd.get("dataPag")),
      cnpj: (fd.get("cnpj")||"").toString().trim(),
      dataTitulo: fd.get("dataTitulo") || "",
      nf: (fd.get("nf")||"").toString().trim(),
      extrato: (fd.get("extrato")||"").toString().trim(),
      dataPag: fd.get("dataPag") || "",
      valor: Number(fd.get("valor")||0),
      rubrica: (fd.get("rubrica")||"").toString(),
      mesAno: (fd.get("mesAno")||"").toString(),
      just: (fd.get("just")||"").toString(),
      docs: [],
      status: "Pendente"
    };
    dfRows.unshift(item);
    persistDF();
    $("#dlgCompra")?.close();
  });

  // upload automático
  $("#btnPick")?.addEventListener("click", ()=> $("#filePicker")?.click());
  $("#filePicker")?.addEventListener("change", (e)=> handleFilesDF(e.target.files));
  const drop = $("#drop");
  if (drop){
    drop.addEventListener("dragover", (e)=>{ e.preventDefault(); drop.style.background="#F3F6FF"; });
    drop.addEventListener("dragleave", ()=> drop.style.background="transparent");
    drop.addEventListener("drop", (e)=>{ e.preventDefault(); drop.style.background="transparent"; handleFilesDF(e.dataTransfer.files); });
  }

  // filtros
  $("#fPc")?.addEventListener("change",  (e)=>{ fPc    = e.target.value; renderDF(); });
  $("#fBusca")?.addEventListener("input", (e)=>{ fBusca = e.target.value.toLowerCase().trim(); renderDF(); });
}

async function handleFilesDF(fileList){
  if(!fileList?.length) return;
  const files = Array.from(fileList);

  for(const f of files){
    const parsed = await parseFromFilename(f.name); // mock OCR
    const item = {
      id: Date.now().toString()+Math.random().toString(16).slice(2),
      favorecido: parsed.favorecido || "",
      pc: computePcLabel(project.vigencia, parsed.dataPag || ""),
      cnpj: parsed.cnpj || "",
      dataTitulo: parsed.dataTitulo || "",
      nf: parsed.nf || "",
      extrato: parsed.extrato || "",
      dataPag: parsed.dataPag || "",
      valor: parsed.valor || 0,
      rubrica: parsed.rubrica || "",
      mesAno: parsed.mesAno || (parsed.dataPag ? toMesAno(parsed.dataPag) : ""),
      just: "",
      docs: [ {name:f.name, size:f.size, type:f.type} ],
      status: "Pendente"
    };
    dfRows.unshift(item);
  }
  persistDF();
}

function persistDF(){
  writeJSON(K_ROWS(projectId), dfRows);
  renderDF();
}

function renderDF(){
  // filtros
  let list = dfRows.slice();
  if(fPc) list = list.filter(r => r.pc===fPc);
  if(fBusca){
    list = list.filter(r =>
      (r.favorecido||"").toLowerCase().includes(fBusca) ||
      (r.cnpj||"").toLowerCase().includes(fBusca) ||
      (r.nf||"").toLowerCase().includes(fBusca)
    );
  }

  // KPIs
  if ($("#kTotal")) $("#kTotal").textContent = String(list.length);
  if ($("#kValor")){
    const soma = list.reduce((acc,r)=> acc + Number(r.valor||0), 0);
    $("#kValor").textContent = fmtMoney(soma);
  }
  if ($("#kPend"))  $("#kPend").textContent  = String(list.filter(r => (r.status||"") === "Pendente").length);
  if ($("#kPc"))    $("#kPc").textContent    = guessCurrentPc();

  const tb = $("#tbody");
  if (!tb) return;
  tb.innerHTML = "";
  list.forEach(r=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input value="${esc(r.favorecido||"")}" data-k="favorecido" data-id="${r.id}"></td>
      <td><span class="pill">${esc(r.pc||"")}</span></td>
      <td><input value="${esc(r.cnpj||"")}" data-k="cnpj" data-id="${r.id}"></td>
      <td><input type="date" value="${esc(r.dataTitulo||"")}" data-k="dataTitulo" data-id="${r.id}"></td>
      <td><input value="${esc(r.nf||"")}" data-k="nf" data-id="${r.id}"></td>
      <td><input value="${esc(r.extrato||"")}" data-k="extrato" data-id="${r.id}"></td>
      <td><input type="date" value="${esc(r.dataPag||"")}" data-k="dataPag" data-id="${r.id}"></td>
      <td><input type="number" step="0.01" value="${esc(r.valor||"")}" data-k="valor" data-id="${r.id}"></td>
      <td>
        <select data-k="rubrica" data-id="${r.id}">
          ${rubricas().map(opt=>`<option ${opt===r.rubrica?'selected':''}>${esc(opt)}</option>`).join("")}
        </select>
      </td>
      <td><input value="${esc(r.mesAno||"")}" placeholder="MM/AAAA" data-k="mesAno" data-id="${r.id}"></td>
      <td><textarea data-k="just" data-id="${r.id}">${esc(r.just||"")}</textarea></td>
      <td class="cell-doc">
        <span class="pill">${r.docs?.length||0} doc(s)</span>
        <button class="btn-outline" data-action="addDoc" data-id="${r.id}">Upload</button>
      </td>
      <td>
        <select data-k="status" data-id="${r.id}">
          <option ${r.status==="Pendente"?'selected':''}>Pendente</option>
          <option ${r.status==="Em análise"?'selected':''}>Em análise</option>
          <option ${r.status==="Validado"?'selected':''}>Validado</option>
        </select>
      </td>
    `;
    tb.appendChild(tr);
  });

  // edição inline
  $$("input[data-id], select[data-id], textarea[data-id]").forEach(el=>{
    el.addEventListener("change", (e)=>{
      const id = e.target.dataset.id;
      const k  = e.target.dataset.k;
      const i  = dfRows.findIndex(r => r.id===id);
      if(i<0) return;
      let val = e.target.value;

      if(k==="valor") val = Number(val||0);
      dfRows[i][k] = val;

      if(k==="dataPag"){
        dfRows[i].pc = computePcLabel(project.vigencia, val);
        dfRows[i].mesAno = toMesAno(val);
      }
      persistDF();
    });
  });

  // upload por linha
  $$("button[data-action='addDoc']").forEach(b=>{
    b.addEventListener("click", ()=>{
      const id = b.dataset.id;
      const input = document.createElement("input");
      input.type="file"; input.multiple=true;
      input.addEventListener("change", ()=>{
        const i = dfRows.findIndex(r => r.id===id);
        if(i<0) return;
        const newDocs = Array.from(input.files).map(f=>({name:f.name, size:f.size, type:f.type}));
        dfRows[i].docs = [...(dfRows[i].docs||[]), ...newDocs];
        persistDF();
      });
      input.click();
    });
  });
}

/* =========================================================
   Utilitários compartilhados
========================================================= */
function getSelectedYear(){
  return parseInt($("#filtroAno")?.value, 10) || new Date().getFullYear();
}
function isoDateFromMonth(year, m){ // YYYY-MM-05
  const mm = String(m).padStart(2,"0");
  return `${year}-${mm}-05`;
}
function getAnosFromVigencia(vig=""){
  const m = (vig||"").match(/(\d{4}).*?(\d{4})/);
  if (!m) return null;
  const ini = +m[1], fim = +m[2];
  if (isNaN(ini) || isNaN(fim) || ini>fim) return null;
  const arr = []; for (let a=ini; a<=fim; a++) arr.push(a); return arr;
}
function toMesAno(dateStr){
  try{ const d=new Date(dateStr); const mm=String(d.getMonth()+1).padStart(2,"0"); return `${mm}/${d.getFullYear()}`; }catch{ return ""; }
}

// ---- Cálculo de PC por data de pagamento ----
function parseVigenciaStart(vig){
  // formato esperado "MM/YYYY - MM/YYYY" (mas tolera outras variações)
  if(!vig) return null;
  const m = String(vig).match(/(\d{2})\/(\d{4})/);
  if(!m) return null;
  const [, mm, yyyy] = m;
  return new Date(Number(yyyy), Number(mm)-1, 1); // 1º dia do mês inicial
}
function monthsDiffInclusive(start, date){
  const y = date.getFullYear() - start.getFullYear();
  const m = date.getMonth() - start.getMonth();
  return y*12 + m + 1; // começa em 1
}
function computePcLabel(vigencia, dataPagamentoStr){
  try{
    const start = parseVigenciaStart(vigencia);
    if(!start || !dataPagamentoStr) return "";
    const dp = new Date(dataPagamentoStr);
    if(isNaN(dp)) return "";
    const n = monthsDiffInclusive(start, dp);
    if(n<=3) return "PC 1";
    if(n<=6) return "PC 2";
    if(n<=9) return "PC 3";
    return "PC Final";
  }catch{ return ""; }
}
function rubricas(){
  return [
    "Materiais de consumo",
    "Material para protótipo",
    "Outros correlatos",
    "Serviços técnicos de terceiros",
    "Treinamento",
    "Aquisição ou uso de programas de computação e aquisição de máquinas, de equipamentos, de aparelhos e de instrumentos, seus acessórios, sobressalentes e ferramentas",
    "Aquisição, implantação, ampliação ou modernização de infraestrutura física e de laboratórios de PD&I, realizadas e justificadas no âmbito de investimentos em PD&I",
    "Aquisições de livros e periódicos técnicos",
    "Custos incorridos"
  ];
}
function guessCurrentPc(){
  const start = parseVigenciaStart(project?.vigencia||"");
  if(!start) return "—";
  const today = new Date();
  const n = monthsDiffInclusive(start, today);
  if(n<=3) return "PC 1";
  if(n<=6) return "PC 2";
  if(n<=9) return "PC 3";
  return "PC Final";
}

// ---- OCR mock (nome do arquivo) ----
async function parseFromFilename(name){
  // exemplos reconhecidos: "CNPJ_12.345.678/0001-99_NF_12345_Valor_1.234,56_2025-06-05.pdf"
  const s = name.normalize("NFC");

  const cnpj = (s.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/) || s.match(/\d{14}/) || [])[0] || "";
  const nf   = (s.match(/NF[_-\s]?(\d{3,})/i) || s.match(/NFE?[_-\s]?(\d{3,})/i) || [])[1] || "";
  const extr = (s.match(/EXTRATO[_-\s]?(\d{3,})/i) || [])[1] || "";
  const valor= (s.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/)||[])[1]  // 1.234,56
              || (s.match(/(\d+\.\d{2})/)||[])[1] || "";
  const data = (s.match(/(\d{4})-(\d{2})-(\d{2})/)||[])[0]  // 2025-06-05
              || (s.match(/(\d{2})-(\d{2})-(\d{4})/)||[])[0] // 05-06-2025
              || "";

  const fav  = (s.split(/[_-]/).find(t => t.length>3 && !t.match(/\d/))||"").replace(/\.(pdf|png|jpg|jpeg)$/i,"");

  let rubrica = "";
  if(/servi[cç]o/i.test(s)) rubrica = "Serviços técnicos de terceiros";
  if(/consumo|material/i.test(s)) rubrica = rubrica || "Materiais de consumo";

  const valorNum = valor
    ? Number(String(valor).replace(/\./g,'').replace(',','.'))
    : 0;

  return {
    favorecido: fav.toUpperCase(),
    cnpj, nf, extrato: extr,
    dataPag: data ? dataFormatToISO(data) : "",
    valor: valorNum,
    rubrica,
    dataTitulo: "",
    mesAno: ""
  };
}
function dataFormatToISO(dstr){
  if(/^\d{4}-\d{2}-\d{2}$/.test(dstr)) return dstr;    // 2025-06-05
  const m = dstr.match(/(\d{2})-(\d{2})-(\d{4})/);     // 05-06-2025
  if(m) return `${m[3]}-${m[2]}-${m[1]}`;
  return "";
}

// === Alternância de Abas (Evidências / Documentação Financeira) ===
// Colar no final de js/project.js
document.addEventListener('DOMContentLoaded', () => {
  // Aliases aceitos (p/ botões com data-tab="evidencias"/"financeiro")
  // Usa os mesmos aliases globais definidos acima.

  // ---- Seletores principais
  const tabsRoot = document.getElementById('tabs') || document.querySelector('nav.tabs');
  const tabs = tabsRoot ? Array.from(tabsRoot.querySelectorAll('.tab, [data-tab], [aria-controls], [data-target]')) : [];
  const panels = Array.from(document.querySelectorAll('.project-page .tabpanel, .project-page [role="tabpanel"]'));

  // ---- Migração de conteúdo legado (se você esqueceu de mover)
  // 1) Se #tab-df estiver vazio e existir #df antigo, move o conteúdo
  (function migrateLegacy() {
    const dfPanel = document.getElementById('tab-df') || document.querySelector('.tabpanel[data-panel="df"]');
    const oldDf   = document.getElementById('df');
    if (dfPanel && dfPanel.children.length === 0 && oldDf && oldDf.children.length) {
      [...oldDf.childNodes].forEach(n => dfPanel.appendChild(n));
      oldDf.remove();
    }
    // 2) Se #tab-evid estiver vazio e existir #tab-evidencias antigo, move o conteúdo
    const evidPanel  = document.getElementById('tab-evid') || document.querySelector('.tabpanel[data-panel="evid"]');
    const oldEvidsec = document.getElementById('tab-evidencias');
    if (evidPanel && evidPanel.children.length === 0 && oldEvidsec && oldEvidsec.children.length) {
      [...oldEvidsec.childNodes].forEach(n => evidPanel.appendChild(n));
      oldEvidsec.remove();
    }
  })();

  const activateByButton = (btn) => {
    const name = getTabNameFromButton(btn);
    if (!name) return;
    activateTabByName(name, { tabsList: tabs, panelsList: panels });
  };

  // ---- Inicialização
  const initialBtn =
    tabs.find(b => b.classList.contains('active')) ||
    tabs[0];

  if (initialBtn) activateByButton(initialBtn);

  // ---- Click handler (delegação segura)
  if (tabsRoot) {
    tabsRoot.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab, [data-tab], [aria-controls], [data-target]');
      if (!btn || !tabs.includes(btn)) return;
      e.preventDefault();
      activateByButton(btn);
    });
  }

  // ---- Sanity check opcional (descomente se quiser debugar no console)
  // console.log('[tabs] botoes:', tabs.length, 'painéis:', panels.length);
});
