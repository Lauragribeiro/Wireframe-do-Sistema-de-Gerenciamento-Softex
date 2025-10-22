const defaultNow = () => new Date();
const defaultIdFactory = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`;

export const resolveStoredBolsistas = ({ previous = [], stored = null, projectId = '' } = {}) => {
  const prevList = Array.isArray(previous) ? [...previous] : [];
  if (!projectId) {
    return { list: prevList, shouldPersist: false };
  }

  if (Array.isArray(stored) && stored.length > 0) {
    return { list: stored, shouldPersist: false };
  }

  if (prevList.length > 0) {
    return { list: prevList, shouldPersist: true };
  }

  return { list: Array.isArray(stored) ? [...stored] : [], shouldPersist: false };
};

export const buildTermoData = (upload, fallback = null, now = defaultNow) => {
  if (upload) {
    const stamp = now();
    const iso = stamp.toISOString();
    return {
      fileName: upload.fileName,
      vigenciaRaw: upload.parsed?.vigenciaRaw || '',
      vigenciaISO: upload.parsed?.vigenciaISO || null,
      valorMaximoRaw: upload.parsed?.valorMaximoRaw || '',
      valorMaximo: upload.parsed?.valorMaximo ?? null,
      parsedAt: iso,
    };
  }

  if (fallback) {
    return { ...fallback };
  }

  return null;
};

export const buildBolsistaRecord = ({
  editingId = null,
  nome,
  cpfDigits,
  funcao,
  valorNum,
  termoUpload = null,
  fallbackTermo = null,
  now = defaultNow,
  idFactory = defaultIdFactory,
  existingRecord = null,
} = {}) => {
  const stamp = now();
  const iso = stamp.toISOString();
  const termo = buildTermoData(termoUpload, fallbackTermo, () => stamp);
  const historicoAlteracoes = Array.isArray(existingRecord?.historicoAlteracoes)
    ? [...existingRecord.historicoAlteracoes]
    : [];

  const registrarAlteracao = (campo, anterior, atual) => {
    historicoAlteracoes.unshift({
      campo,
      anterior,
      atual,
      modificadoEm: iso,
    });
  };

  if (existingRecord) {
    if (existingRecord.valor !== valorNum) {
      registrarAlteracao('valor', existingRecord.valor ?? null, valorNum ?? null);
    }

    const funcaoAnterior = existingRecord.funcao ?? '';
    const funcaoAtual = funcao ?? '';
    if (funcaoAnterior !== funcaoAtual) {
      registrarAlteracao('funcao', funcaoAnterior, funcaoAtual);
    }
  }

  return {
    id: editingId || idFactory(),
    nome,
    cpf: cpfDigits,
    funcao,
    valor: valorNum,
    termo,
    atualizadoEm: iso,
    historicoAlteracoes,
  };
};

export const upsertBolsistas = (bolsistas = [], record, editingId = null) => {
  const list = Array.isArray(bolsistas) ? [...bolsistas] : [];
  if (!record) return list;

  if (editingId != null) {
    const idx = list.findIndex((item) => String(item.id) === String(editingId));
    if (idx >= 0) {
      list[idx] = record;
      return list;
    }
  }

  list.push(record);
  return list;
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const requestTermoAnalysis = async (file) => {
    const fd = new FormData();
    fd.append('termo', file);

    let response;
    try {
      response = await fetch('/api/parse-termo-outorga', { method: 'POST', body: fd });
    } catch (err) {
      console.error('Falha na requisição de análise do termo:', err);
      throw new Error('Não foi possível enviar o termo para análise. Verifique sua conexão e tente novamente.');
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      const text = await response.text().catch(() => '');
      console.error('Resposta inesperada ao analisar termo:', err, text);
      throw new Error('Resposta inválida do servidor ao analisar o termo de outorga.');
    }

    if (!response.ok || !payload?.ok) {
      const message = payload?.message || `Erro ao processar o termo (HTTP ${response.status}).`;
      throw new Error(message);
    }

    return payload?.data || {};
  };

  const escapeHtml = (t = '') => String(t).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c] || c));

  const onlyDigits = (val = '') => String(val).replace(/\D+/g, '');

  const formatCPF = (cpf = '') => {
    const digits = onlyDigits(cpf);
    if (digits.length !== 11) return digits || cpf;
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  };

  const formatBRL = (value) => {
    if (value == null || value === '') return '';
    const num = Number(value);
    if (Number.isNaN(num)) return '';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
  };

  const parseMoney = (raw) => {
    if (raw == null || raw === '') return null;
    let str = String(raw).trim();
    if (!str) return null;
    str = str.replace(/[^0-9,.-]/g, '');
    if (!str) return null;
    if (str.includes(',')) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      const parts = str.split('.');
      if (parts.length > 2) {
        const dec = parts.pop();
        str = `${parts.join('')}.${dec}`;
      }
      str = str.replace(/,/g, '.');
    }
    const num = Number(str);
    return Number.isFinite(num) ? num : null;
  };

  const formatDateBR = (iso) => {
    if (!iso) return '';
    const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  };

  const formatDateTimeBR = (iso) => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return String(iso);
    }
    const dia = String(date.getDate()).padStart(2, '0');
    const mes = String(date.getMonth() + 1).padStart(2, '0');
    const ano = date.getFullYear();
    const hora = String(date.getHours()).padStart(2, '0');
    const minuto = String(date.getMinutes()).padStart(2, '0');
    return `${dia}/${mes}/${ano} às ${hora}:${minuto}`;
  };

  const toISODate = (raw) => {
    if (!raw) return null;
    const text = String(raw).trim();
    let m = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (m) {
      const [_, y, mth, d] = m;
      return `${y.padStart(4, '0')}-${mth.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    m = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if (m) {
      let [_, d, mth, y] = m;
      if (y.length === 2) y = (Number(y) >= 70 ? '19' : '20') + y;
      return `${y.padStart(4, '0')}-${mth.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return null;
  };

  const validateCPF = (raw) => {
    const cpf = onlyDigits(raw);
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    let sum = 0;
    for (let i = 0; i < 9; i += 1) {
      sum += Number(cpf[i]) * (10 - i);
    }
    let check = (sum * 10) % 11;
    if (check === 10) check = 0;
    if (check !== Number(cpf[9])) return false;

    sum = 0;
    for (let i = 0; i < 10; i += 1) {
      sum += Number(cpf[i]) * (11 - i);
    }
    check = (sum * 10) % 11;
    if (check === 10) check = 0;
    return check === Number(cpf[10]);
  };

  const collectMatches = (regex, text) => {
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push({ match: match[0], index: match.index });
    }
    return matches;
  };

  const analyseTermoText = (text = '') => {
    const simplified = text.replace(/\s+/g, ' ');
    const lower = simplified.toLowerCase();

    const dateRegex = /(\d{4}[\/-]\d{1,2}[\/-]\d{1,2})|(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/g;
    const valueRegex = /(?:r\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})/gi;

    const dateMatches = collectMatches(dateRegex, simplified);
    const valueMatches = collectMatches(valueRegex, simplified);

    const pickByKeyword = (matches, keywords) => {
      if (!matches.length) return null;
      let best = null;
      matches.forEach((item) => {
        const start = Math.max(0, item.index - 80);
        const end = Math.min(simplified.length, item.index + item.match.length + 80);
        const context = lower.slice(start, end);
        let score = 0;
        keywords.forEach((kw, idx) => {
          if (kw.test(context)) score += (idx + 1) * 2;
        });
        if (score === 0) score = 1; // fallback para algum valor
        if (!best || score > best.score || (score === best.score && item.index > best.index)) {
          best = { ...item, score };
        }
      });
      return best;
    };

    const chosenDate = pickByKeyword(dateMatches, [/(vig[êe]ncia|vigencia)/, /(t[ée]rmino|termino|fim)/, /(at[ée])/]);
    const chosenValue = pickByKeyword(valueMatches, [/(valor|bolsa|limite|total|montante)/]);

    const vigenciaRaw = chosenDate?.match || '';
    const vigenciaISO = vigenciaRaw ? toISODate(vigenciaRaw) : null;

    const valorRaw = chosenValue?.match || '';
    const valorMax = valorRaw ? parseMoney(valorRaw) : null;

    return {
      vigenciaRaw,
      vigenciaISO,
      valorMaximoRaw: valorRaw,
      valorMaximo: valorMax,
    };
  };

  const parseTermoPDF = async (file) => {
    if (!file) throw new Error('Nenhum arquivo informado');
    if (!/pdf$/i.test(file.type) && !file.name.toLowerCase().endsWith('.pdf')) {
      throw new Error('Apenas arquivos PDF são aceitos.');
    }

    const remoteData = await requestTermoAnalysis(file);
    const rawText = remoteData.rawText || remoteData.text || '';

    let parsed = null;
    if (remoteData.parsed && typeof remoteData.parsed === 'object') {
      parsed = { ...remoteData.parsed };
    }

    if (rawText && (!parsed || (!parsed.vigenciaISO && parsed.valorMaximo == null))) {
      const fallback = analyseTermoText(rawText);
      parsed = { ...fallback, ...(parsed || {}) };
    }

    return {
      fileName: remoteData.fileName || file.name,
      size: remoteData.size ?? file.size,
      parsed,
      rawText,
    };
  };

  const computeIndicator = (row) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const vigenciaISO = row?.termo?.vigenciaISO || row?.termo?.vigenciaFim;
    const valorMax = row?.termo?.valorMaximo;
    const valorBolsa = row?.valor;

    let okVigencia = true;
    let vigenciaDetail = '';
    if (!vigenciaISO) {
      okVigencia = false;
      vigenciaDetail = 'Vigência não identificada.';
    } else {
      const date = new Date(`${vigenciaISO}T00:00:00`);
      if (Number.isNaN(date.getTime())) {
        okVigencia = false;
        vigenciaDetail = 'Data de vigência inválida no termo.';
      } else if (date < today) {
        okVigencia = false;
        vigenciaDetail = `Termo vencido em ${formatDateBR(vigenciaISO)}.`;
      } else {
        vigenciaDetail = `Vigente até ${formatDateBR(vigenciaISO)}.`;
      }
    }

    let okValor = true;
    let valorDetail = '';
    if (valorMax == null || Number.isNaN(valorMax)) {
      okValor = false;
      valorDetail = 'Valor máximo não encontrado no termo.';
    } else if (valorBolsa != null && Number(valorBolsa) > valorMax + 0.009) {
      okValor = false;
      valorDetail = `Valor acima do limite de ${formatBRL(valorMax)}.`;
    } else {
      valorDetail = `Limite identificado: ${formatBRL(valorMax)}.`;
    }

    const ok = okVigencia && okValor;
    const label = ok ? 'Vigente' : 'Não Vigente';
    const detail = ok ? vigenciaDetail : `${vigenciaDetail} ${valorDetail}`.trim();

    return {
      status: ok ? 'vigente' : 'nao_vigente',
      label,
      detail: detail.replace(/\s+/g, ' ').trim(),
      vigenciaDetail,
      valorDetail,
    };
  };

  const renderIndicator = (row) => {
    const info = computeIndicator(row);
    const cls = info.status === 'vigente' ? 'status-pill status-pill--ok' : 'status-pill status-pill--alert';
    const secondary = info.status === 'vigente' ? info.detail : `${info.vigenciaDetail} ${info.valorDetail}`.trim();
    return `
      <span class="${cls}">${escapeHtml(info.label)}</span>
      <span class="status-pill__detail">${escapeHtml(secondary || info.detail)}</span>
    `;
  };

  const updateTermoSummary = (data) => {
    const summary = $('#termo-summary');
    if (!summary) return;

    if (!data) {
      summary.hidden = true;
      summary.innerHTML = '';
      return;
    }

    const parts = [];
    if (data.fileName) {
      parts.push(`
        <div class="termo-summary__item">
          <span class="termo-summary__label">Arquivo:</span>
          <span class="termo-summary__value">${escapeHtml(data.fileName)}</span>
        </div>
      `);
    }

    const vigenciaText = data.parsed?.vigenciaISO
      ? `${formatDateBR(data.parsed.vigenciaISO)}${data.parsed.vigenciaRaw ? ` (encontrado como "${escapeHtml(data.parsed.vigenciaRaw)}")` : ''}`
      : (data.parsed?.vigenciaRaw ? `Não foi possível converter a data "${escapeHtml(data.parsed.vigenciaRaw)}".` : 'Vigência não identificada no documento.');

    parts.push(`
      <div class="termo-summary__item">
        <span class="termo-summary__label">Vigência final:</span>
        <span class="termo-summary__value">${vigenciaText}</span>
      </div>
    `);

    const valorText = data.parsed?.valorMaximo != null
      ? `${formatBRL(data.parsed.valorMaximo)}${data.parsed.valorMaximoRaw ? ` ("${escapeHtml(data.parsed.valorMaximoRaw)}")` : ''}`
      : (data.parsed?.valorMaximoRaw
        ? `Não foi possível converter o valor "${escapeHtml(data.parsed.valorMaximoRaw)}".`
        : 'Valor máximo não identificado.');

    parts.push(`
      <div class="termo-summary__item">
        <span class="termo-summary__label">Valor máximo previsto:</span>
        <span class="termo-summary__value">${valorText}</span>
      </div>
    `);

    summary.innerHTML = parts.join('');
    summary.hidden = false;
  };

  const historicoCampoLabels = {
    valor: 'Valor da Bolsa',
    funcao: 'Função no Projeto',
  };

  const formatHistoricoValue = (campo, raw) => {
    if (campo === 'valor') {
      if (raw == null || raw === '') return '—';
      return formatBRL(raw) || '—';
    }
    if (raw == null || raw === '') return '—';
    return String(raw);
  };

  const updateHistoricoSection = (row = null) => {
    if (!historicoCard || !historicoList) return;

    if (!row) {
      historicoCard.hidden = true;
      historicoList.innerHTML = '<p class="history-block__empty muted">Nenhuma alteração registrada até o momento.</p>';
      return;
    }

    const historico = Array.isArray(row.historicoAlteracoes) ? row.historicoAlteracoes : [];
    historicoCard.hidden = false;

    if (!historico.length) {
      historicoList.innerHTML = '<p class="history-block__empty muted">Nenhuma alteração registrada até o momento.</p>';
      return;
    }

    const items = historico.map((entry) => {
      const campo = entry.campo || entry.field || '';
      const label = historicoCampoLabels[campo] || entry.campoLabel || campo || 'Campo';
      const anterior = escapeHtml(formatHistoricoValue(campo, entry.anterior));
      const atual = escapeHtml(formatHistoricoValue(campo, entry.atual));
      const rawData = entry.modificadoEm || entry.alteradoEm || entry.data || entry.timestamp || '';
      const dataTexto = formatDateTimeBR(rawData) || '—';
      const dataAttr = rawData ? ` datetime="${escapeHtml(rawData)}"` : '';
      const dataHtml = rawData
        ? `<time class="history-item__date"${dataAttr}>${escapeHtml(dataTexto)}</time>`
        : `<span class="history-item__date">${escapeHtml(dataTexto)}</span>`;

      return `
        <article class="history-item">
          <div class="history-item__header">
            <span class="history-item__field">${escapeHtml(label)}</span>
            ${dataHtml}
          </div>
          <div class="history-item__values">
            <div class="history-item__value history-item__value--previous">
              <span class="history-item__label">Anterior</span>
              <span class="history-item__content">${anterior}</span>
            </div>
            <div class="history-item__value history-item__value--current">
              <span class="history-item__label">Atual</span>
              <span class="history-item__content">${atual}</span>
            </div>
          </div>
        </article>
      `;
    });

    historicoList.innerHTML = items.join('');
  };

  const tableBody = $('#lista-bolsistas');

  const modal = $('#bolsista-modal');
  const modalTitle = $('#modal-title');
  const btnClose = $('#modal-close');
  const btnNovo = $('#btn-novo-bolsista');
  const btnCancelar = $('#btn-cancelar');
  const form = $('#bolsista-form');
  const nomeInput = $('#campo-nome');
  const cpfInput = $('#campo-cpf');
  const funcaoInput = $('#campo-funcao');
  const valorInput = $('#campo-valor');
  const termoInput = $('#campo-termo');
  const btnSelecionarTermo = $('#btn-selecionar-termo');
  const termoFileName = $('#termo-file-name');
  const termoFeedback = $('#termo-feedback');
  const formFeedback = $('#form-feedback');
  const historicoCard = $('#historico-card');
  const historicoList = $('#historico-list');

  const projectNome = $('#p-nome');
  const projectCodigo = $('#p-codigo');
  const projectGerente = $('#p-gerente');
  const projectStatus = $('#p-status');

  const tabEvid = $('#tab-evidencias');
  const tabDoc = $('#tab-docfin');
  const tabBolsas = $('#tab-bolsas');

  let projectId = '';
  let bolsistas = [];
  let editingId = null;
  let termoUpload = null;

  const storageKey = () => `bolsas_${projectId || 'default'}`;

  const setFormFeedback = (message, type = 'info') => {
    if (!formFeedback) return;
    formFeedback.textContent = message || '';
    formFeedback.classList.toggle('form-feedback--error', type === 'error');
    formFeedback.classList.toggle('form-feedback--success', type === 'success');
  };

  const setTermoFeedback = (message, type = 'info') => {
    if (!termoFeedback) return;
    termoFeedback.textContent = message || '';
    termoFeedback.classList.toggle('form-feedback--error', type === 'error');
    termoFeedback.classList.toggle('form-feedback--success', type === 'success');
  };

  const saveLocal = () => {
    if (!projectId) return;
    try {
      localStorage.setItem(storageKey(), JSON.stringify(bolsistas));
    } catch (err) {
      console.warn('Não foi possível salvar os bolsistas localmente.', err);
    }
  };

  const loadLocal = () => {
    const previous = Array.isArray(bolsistas) ? bolsistas : [];
    let storedList = null;

    if (projectId) {
      try {
        const raw = localStorage.getItem(storageKey());
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) storedList = parsed;
        }
      } catch (err) {
        console.warn('Não foi possível carregar os bolsistas armazenados.', err);
      }
    }

    const { list, shouldPersist } = resolveStoredBolsistas({
      previous,
      stored: storedList,
      projectId,
    });

    bolsistas = list;
    if (shouldPersist) {
      saveLocal();
    }
  };

  const renderTable = () => {
    if (!tableBody) return;
    if (!Array.isArray(bolsistas) || bolsistas.length === 0) {
      tableBody.innerHTML = '<tr class="table-empty"><td colspan="5">Nenhum bolsista cadastrado até o momento.</td></tr>';
      return;
    }

    const rowsHtml = bolsistas.map((row) => `
      <tr data-id="${escapeHtml(String(row.id))}" class="table-row">
        <td>${escapeHtml(row.nome || '')}</td>
        <td>${escapeHtml(formatCPF(row.cpf))}</td>
        <td>${escapeHtml(row.funcao || '')}</td>
        <td>${escapeHtml(formatBRL(row.valor))}</td>
        <td>${renderIndicator(row)}</td>
      </tr>
    `).join('');

    tableBody.innerHTML = rowsHtml;
  };

  const wireTableClicks = () => {
    tableBody?.addEventListener('click', (ev) => {
      const rowEl = ev.target.closest('tr[data-id]');
      if (!rowEl) return;
      const { id } = rowEl.dataset;
      const row = bolsistas.find((item) => String(item.id) === String(id));
      if (!row) return;
      openEditModal(row);
    });
  };

  const closeModal = () => {
    if (!modal) return;
    modal.close();
    setFormFeedback('');
    setTermoFeedback('');
    updateTermoSummary(null);
    updateHistoricoSection(null);
    termoUpload = null;
    editingId = null;
  };

  const openModal = () => {
    if (!modal) return;
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
  };

  const resetModalFields = () => {
    if (!form) return;
    form.reset();
    nomeInput?.removeAttribute('readonly');
    cpfInput?.removeAttribute('readonly');
    nomeInput?.removeAttribute('disabled');
    cpfInput?.removeAttribute('disabled');
    if (termoFileName) termoFileName.textContent = 'Nenhum arquivo selecionado.';
    updateTermoSummary(null);
    setFormFeedback('');
    setTermoFeedback('');
    updateHistoricoSection(null);
    termoUpload = null;
  };

  const openCreateModal = () => {
    resetModalFields();
    editingId = null;
    modalTitle.textContent = 'Novo Bolsista';
    setTermoFeedback('Envie o Termo de Outorga em PDF para que o sistema extraia vigência e valor máximo.', 'info');
    nomeInput?.focus();
    openModal();
  };

  const fillModalWithRow = (row) => {
    if (!row) return;
    resetModalFields();
    editingId = row.id;
    modalTitle.textContent = 'Detalhes do Bolsista';

    if (nomeInput) {
      nomeInput.value = row.nome || '';
      nomeInput.setAttribute('readonly', 'readonly');
      nomeInput.setAttribute('disabled', 'disabled');
    }
    if (cpfInput) {
      cpfInput.value = formatCPF(row.cpf);
      cpfInput.setAttribute('readonly', 'readonly');
      cpfInput.setAttribute('disabled', 'disabled');
    }
    if (funcaoInput) funcaoInput.value = row.funcao || '';
    if (valorInput) valorInput.value = formatBRL(row.valor) || '';

    const termo = row.termo || null;
    if (termo) {
      if (termoFileName) termoFileName.textContent = termo.fileName || 'Termo carregado.';
      updateTermoSummary({
        fileName: termo.fileName,
        parsed: {
          vigenciaISO: termo.vigenciaISO || termo.vigenciaFim || null,
          vigenciaRaw: termo.vigenciaRaw || '',
          valorMaximo: termo.valorMaximo,
          valorMaximoRaw: termo.valorMaximoRaw || '',
        },
      });
      const indicator = computeIndicator(row);
      setTermoFeedback(`${indicator.vigenciaDetail} ${indicator.valorDetail}`.trim(), indicator.status === 'vigente' ? 'success' : 'error');
    } else {
      if (termoFileName) termoFileName.textContent = 'Nenhum termo cadastrado.';
      updateTermoSummary(null);
      setTermoFeedback('Faça upload de um Termo de Outorga em PDF.', 'info');
    }

    updateHistoricoSection(row);
  };

  const openEditModal = (row) => {
    fillModalWithRow(row);
    openModal();
  };

  const normalizeValorInput = () => {
    if (!valorInput) return;
    const num = parseMoney(valorInput.value);
    if (num == null) {
      valorInput.value = '';
      return;
    }
    valorInput.value = formatBRL(num);
  };

  const normalizeCPFInput = () => {
    if (!cpfInput) return;
    const digits = onlyDigits(cpfInput.value);
    if (digits.length <= 11) cpfInput.value = formatCPF(digits);
  };

  const wireInputs = () => {
    valorInput?.addEventListener('blur', normalizeValorInput);
    cpfInput?.addEventListener('blur', normalizeCPFInput);

    btnSelecionarTermo?.addEventListener('click', () => {
      termoInput?.click();
    });

    termoInput?.addEventListener('change', async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) {
        if (termoFileName) termoFileName.textContent = 'Nenhum arquivo selecionado.';
        setTermoFeedback('');
        updateTermoSummary(null);
        termoUpload = null;
        return;
      }

      if (termoFileName) termoFileName.textContent = file.name;
      setTermoFeedback('Processando termo de outorga…', 'info');

      try {
        termoUpload = await parseTermoPDF(file);
        updateTermoSummary(termoUpload);
        if (termoUpload.parsed?.vigenciaISO || termoUpload.parsed?.valorMaximo != null) {
          setTermoFeedback('Termo de Outorga lido com sucesso.', 'success');
        } else {
          setTermoFeedback('Termo lido, porém não encontramos vigência ou valor máximo. Verifique manualmente.', 'error');
        }
      } catch (err) {
        console.error('Falha ao ler o termo de outorga:', err);
        setTermoFeedback(err.message || 'Não foi possível processar o PDF.', 'error');
        updateTermoSummary(null);
        termoUpload = null;
      }
    });
  };

  const handleModalSubmit = (ev) => {
    ev.preventDefault();
    setFormFeedback('');

    const nome = nomeInput?.value.trim();
    const cpfDigits = onlyDigits(cpfInput?.value || '');
    const funcao = funcaoInput?.value.trim();
    const valorNum = parseMoney(valorInput?.value);

    if (!nome) {
      setFormFeedback('Informe o nome completo do bolsista.', 'error');
      nomeInput?.focus();
      return;
    }
    if (nome.length > 255) {
      setFormFeedback('O nome completo deve ter no máximo 255 caracteres.', 'error');
      nomeInput?.focus();
      return;
    }

    if (!cpfDigits || cpfDigits.length !== 11 || !validateCPF(cpfDigits)) {
      setFormFeedback('Informe um CPF válido (11 dígitos).', 'error');
      cpfInput?.focus();
      return;
    }

    if (!funcao) {
      setFormFeedback('Informe a função do bolsista no projeto.', 'error');
      funcaoInput?.focus();
      return;
    }

    if (valorNum == null || valorNum <= 0) {
      setFormFeedback('Informe o valor da bolsa no formato monetário (ex.: R$ 4.500,00).', 'error');
      valorInput?.focus();
      return;
    }

    if (!editingId && !termoUpload) {
      setFormFeedback('Faça upload do Termo de Outorga em PDF para concluir o cadastro.', 'error');
      termoInput?.focus();
      return;
    }

    const existing = editingId
      ? bolsistas.find((item) => String(item.id) === String(editingId))
      : null;

    const record = buildBolsistaRecord({
      editingId,
      nome,
      cpfDigits,
      funcao,
      valorNum,
      termoUpload,
      fallbackTermo: existing?.termo || null,
      existingRecord: existing || null,
    });

    bolsistas = upsertBolsistas(bolsistas, record, editingId);
    setFormFeedback(editingId ? 'Bolsista atualizado com sucesso.' : 'Bolsista cadastrado com sucesso.', 'success');

    termoUpload = null;
    saveLocal();
    renderTable();
    setTimeout(() => closeModal(), 400);
  };

  const initTabs = () => {
    const qs = projectId ? `?id=${encodeURIComponent(projectId)}` : '';
    if (tabEvid) tabEvid.href = `/prestacao.html${qs}`;
    if (tabDoc) tabDoc.href = `/docfin.html${qs}`;
    if (tabBolsas) tabBolsas.href = `/bolsas.html${qs}`;
    tabBolsas?.classList.add('active');
  };

  const loadProject = async () => {
    try {
      const url = new URL(window.location.href);
      projectId = url.searchParams.get('id') || '';

      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Falha ao carregar os projetos.');
      const json = await res.json();
      const list = Array.isArray(json?.data) ? json.data : [];

      let project = list.find((item) => String(item.id) === String(projectId));
      if (!project && list.length) {
        project = list[0];
        projectId = String(project.id);
      }

      if (project) {
        projectNome.textContent = project.titulo || '—';
        projectCodigo.textContent = project.codigo || project.id || '—';
        projectGerente.textContent = project.responsavel || '—';
        projectStatus.textContent = (project.status || '—').replace('_', ' ');
      }

      initTabs();
      loadLocal();
      renderTable();
    } catch (err) {
      console.error('Falha ao carregar dados do projeto.', err);
      initTabs();
      loadLocal();
      renderTable();
    }
  };

  btnNovo?.addEventListener('click', openCreateModal);
  btnCancelar?.addEventListener('click', (e) => {
    e.preventDefault();
    closeModal();
  });
  btnClose?.addEventListener('click', closeModal);
  modal?.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeModal();
  });
  modal?.addEventListener('click', (ev) => {
    const content = modal.querySelector('.modal__content');
    if (!content) return;
    if (!content.contains(ev.target)) {
      closeModal();
    }
  });

  form?.addEventListener('submit', handleModalSubmit);

  wireInputs();
  wireTableClicks();
  loadProject();
});
}
