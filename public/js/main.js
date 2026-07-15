// public/js/main.js

// ─────────────────────────────────────────────
// Variáveis globais do fluxo
// ─────────────────────────────────────────────
let currentCpSelection             = '';
let currentAmbiente                = 'TRG'; // ✅ Ambiente selecionado
let currentAddressId               = null;
let currentEnderecoDetalhes        = null;
let currentComplementoSelecionado  = null;
let currentAccessToken             = null;
let currentSubscriberId            = null;
let currentProdutosDisponiveis     = [];
let currentProdutosSelecionados   = [];   // ✅ v3: array de produtos (suporta BL_+VoIP)
const ATTRIBUTES_TEMPLATES = {
    // Catálogos que exigem attributes além de catalogId
    'VoIP': { attribute: [{ name: 'voipNumber', value: '99999999999' }] }  // ✅ v5: número fixo (placeholder interno)
};
const CATEGORIA_POR_CATALOG = {
  'BL_':    'Banda Larga',   // BL_400MB, BL_600MB, BL_1GB, ...
  'MESH_':  'Banda Larga',
  'FTTR_':  'Banda Larga',
  'VoIP':   'VoIP',
  'PABX':   'VoIP',
  'TV_':    'IPTV',
  'IPTV_':  'IPTV',
  'ROKU':   'IPTV'
};

function categoriaDoProduto(catalogId) {
  if (!catalogId) return 'Banda Larga';
  for (const prefixo in CATEGORIA_POR_CATALOG) {
    if (catalogId.startsWith(prefixo)) return CATEGORIA_POR_CATALOG[prefixo];
  }
  return 'Banda Larga';
}
let currentSlotsDisponiveis        = [];
let currentSlotSelecionado         = null;
let currentAgendamentoId           = null;
let currentInventoryId             = null;
// ✅ Específicos do fluxo de Mudança de Endereço
let currentNewSubscriberId         = null; // subscriberId do NOVO endereço (gerado em consultar-endereco)
let currentOldSubscriberId         = null; // subscriberId do ENDEREÇO ANTIGO (informado na Etapa 1)
let currentInstalacaoResult        = null; // {orderId, saId, associatedDocument, subscriberId} da OS de instalação criada
let currentCustomerName            = 'João da Silva'; // nome padrão para payloads que exigem customer.name

// ─────────────────────────────────────────────
// Inicialização
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // ✅ Lê o ambiente da URL (?ambiente=TI) passado pelo index.html
    const urlParams  = new URLSearchParams(window.location.search);
    const ambURL     = urlParams.get('ambiente');
    const VALID_ENVS = ['TRG', 'TI', 'TRG2'];

    if (ambURL && VALID_ENVS.includes(ambURL.toUpperCase())) {
        currentAmbiente = ambURL.toUpperCase();
    }

    // Sincroniza o select com o ambiente recebido
    const ambSelect = document.getElementById('ambienteSelect');
    if (ambSelect) ambSelect.value = currentAmbiente;

    updateAmbienteBadge(currentAmbiente);
    loadCps();
    setStep(1);
});

// ─────────────────────────────────────────────
// ✅ Gerenciamento de Ambiente
// ─────────────────────────────────────────────
function onAmbienteChange() {
    const select = document.getElementById('ambienteSelect');
    currentAmbiente = select.value;
    updateAmbienteBadge(currentAmbiente);
    console.log(`[FRONTEND] Ambiente alterado para: ${currentAmbiente}`);
}

function updateAmbienteBadge(ambiente) {
    const badge     = document.getElementById('envBadge');
    const badgeText = document.getElementById('envBadgeText');
    if (!badge || !badgeText) return;

    badge.className = `env-badge ${ambiente}`;

    const labels = {
        TRG:  '🟡 TRG',
        TI:   '🟢 TI',
        TRG2: '🔵 TRG2'
    };
    badgeText.textContent = labels[ambiente] || ambiente;
}

// ─────────────────────────────────────────────
// ✅ v3: Templates / parsing / validação de attributes
// ─────────────────────────────────────────────
function templatePara(catalogId) {
    return ATTRIBUTES_TEMPLATES[catalogId] || null;
}

function parseAtributosSeguros(texto) {
    if (!texto || !texto.trim()) return null;
    try {
        return JSON.parse(texto);
    } catch (e) {
        return { __erro: 'JSON inválido: ' + e.message };
    }
}

function atributosLinhaValidos(produto) {
    // Se o catálogo não tem template, sem requirements
    if (!templatePara(produto.catalogId)) return true;
    // Se tem template, attributes é obrigatório e deve ter o mesmo shape do template
    if (!produto.attributes) return false;
    const tmplAttrs = templatePara(produto.catalogId).attribute || [];
    const linhaAttrs = (produto.attributes.attribute || []);
    // Mesma quantidade de atributos exigidos
    if (tmplAttrs.length !== linhaAttrs.length) return false;
    // Nenhum value vazio
    for (let i = 0; i < tmplAttrs.length; i++) {
        if (!linhaAttrs[i] || !String(linhaAttrs[i].value || '').trim()) return false;
    }
    return true;
}

function catalogoEhBandaLarga(catalogId) {
    return /^BL_/i.test(String(catalogId || ''));
}

// ─────────────────────────────────────────────
// ✅ Indicador de Etapas
// ─────────────────────────────────────────────
function setStep(activeStep) {
    for (let i = 1; i <= 5; i++) {
        const stepEl = document.getElementById(`step${i}`);
        const lineEl = document.getElementById(`line${i}`);
        if (!stepEl) continue;

        stepEl.classList.remove('active', 'done');
        if (i < activeStep)       stepEl.classList.add('done');
        else if (i === activeStep) stepEl.classList.add('active');

        if (lineEl) {
            lineEl.classList.toggle('done', i < activeStep);
        }
    }
}

// ─────────────────────────────────────────────
// Navegação entre seções
// ─────────────────────────────────────────────
function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(sectionId);
    if (target) target.classList.remove('hidden');
    showMessage('', 'info', true);
}

// ✅ Volta para seção anterior e atualiza step indicator
function voltarPara(sectionId, stepNumber) {
    showSection(sectionId);
    setStep(stepNumber);
}

function showMessage(message, type, clear = false) {
    const msgDiv = document.getElementById('globalMessage');
    if (!msgDiv) return;

    if (clear) {
        msgDiv.classList.add('hidden');
        msgDiv.textContent = '';
        msgDiv.classList.remove('success', 'error', 'info');
    } else {
        msgDiv.classList.remove('hidden', 'success', 'error', 'info');
        msgDiv.textContent = message;
        msgDiv.classList.add(type);
        // Scroll suave até a mensagem
        msgDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// ─────────────────────────────────────────────
// Carregar CPs
// ─────────────────────────────────────────────
async function loadCps() {
  // tenta IDs possíveis usados no projeto
  const cpSelect =
    document.getElementById('cpSelect') ||
    document.getElementById('cp_selection') ||
    document.getElementById('cpId');

  // Se a página não tem seletor de CP (ex.: algumas telas), não faz nada
  if (!cpSelect) return;

  try {
    const res = await fetch('/api/cps');
    const cps = await res.json();

    cpSelect.innerHTML = '';
    cps.forEach(cp => {
      const opt = document.createElement('option');
      opt.value = cp;
      opt.textContent = cp;
      cpSelect.appendChild(opt);
    });
  } catch (err) {
    console.error('Erro ao carregar CPs:', err);
  }
}
document.addEventListener('DOMContentLoaded', () => {
  loadCps();
});

// ─────────────────────────────────────────────
// Etapa 1: Consultar Endereço
// ─────────────────────────────────────────────
async function consultarEndereco() {
    currentCpSelection = document.getElementById('cpSelect').value;
    const cep    = document.getElementById('cepInput').value.trim();
    const numero = document.getElementById('numeroInput').value.trim();

    // ✅ Garante que o ambiente está sempre atualizado antes da requisição
    const ambSelect = document.getElementById('ambienteSelect');
    if (ambSelect) currentAmbiente = ambSelect.value;

    if (!currentCpSelection || !cep || !numero) {
        showMessage('Por favor, selecione um CP, digite o CEP e o número.', 'error');
        return;
    }

    showMessage('🔍 Consultando endereço...', 'info');

    try {
        const response = await fetch('/api/consultar-endereco', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cp_selection: currentCpSelection,
                cep,
                numero,
                ambiente: currentAmbiente // ✅ Envia ambiente
            })
        });
        const data = await response.json();

        if (data.status === 'sucesso') {
            currentAddressId        = data.addressId;
            currentEnderecoDetalhes = data.endereco;
            currentAccessToken      = data.accessToken;
            currentSubscriberId     = data.subscriberId;

            document.getElementById('enderecoDisplay').textContent = data.endereco.description;
            displayComplementos(data.complementos);
            showMessage('✅ Endereço encontrado!', 'success');
        } else {
            showMessage(`❌ Erro ao consultar endereço: ${data.message}`, 'error');
        }
    } catch (error) {
        console.error('Erro ao consultar endereço:', error);
        showMessage('❌ Erro ao consultar endereço: ' + error.message, 'error');
    }
}

// ─────────────────────────────────────────────
// Etapa 2: Exibir e Confirmar Complemento
// ─────────────────────────────────────────────
function displayComplementos(complementos) {
    const complementListDiv    = document.getElementById('complementList');
    const confirmComplementBtn = document.getElementById('confirmComplementBtn');
    complementListDiv.innerHTML    = '';
    confirmComplementBtn.disabled  = true;

    showSection('complementSelection');
    setStep(2);

    if (complementos.length === 0) {
        complementListDiv.innerHTML = '<p>Nenhum complemento encontrado para este endereço.</p>';
        confirmComplementBtn.disabled = false;
        currentComplementoSelecionado = { id: null, type: 'N/A', description: 'N/A', value: '' };
        return;
    }

    // Opção "Nenhum Complemento"
    const noComplementOption = document.createElement('div');
    noComplementOption.classList.add('complement-item');
    noComplementOption.textContent = 'Nenhum Complemento';
    noComplementOption.addEventListener('click', () => {
        document.querySelectorAll('.complement-item').forEach(i => i.classList.remove('selected'));
        noComplementOption.classList.add('selected');
        confirmComplementBtn.disabled = false;
        currentComplementoSelecionado = { id: null, type: 'N/A', description: 'N/A', value: '' };
    });
    complementListDiv.appendChild(noComplementOption);

    complementos.forEach(comp => {
        const complementItem = document.createElement('div');
        complementItem.classList.add('complement-item');
        complementItem.textContent          = `${comp.type}: ${comp.value} (${comp.description})`;
        complementItem.dataset.complemento  = JSON.stringify(comp);

        complementItem.addEventListener('click', () => {
            document.querySelectorAll('.complement-item').forEach(i => i.classList.remove('selected'));
            complementItem.classList.add('selected');
            confirmComplementBtn.disabled = false;
            currentComplementoSelecionado = JSON.parse(complementItem.dataset.complemento);
        });
        complementListDiv.appendChild(complementItem);
    });
}

async function confirmarComplemento() {
    if (!currentComplementoSelecionado) {
        showMessage('Por favor, selecione um complemento ou a opção "Nenhum Complemento".', 'error');
        return;
    }
    showMessage('⏳ Verificando disponibilidade...', 'info');
    await verificarDisponibilidade();
}

// ─────────────────────────────────────────────
// Etapa 3: Verificar Disponibilidade
// ─────────────────────────────────────────────
async function verificarDisponibilidade() {
    try {
        const response = await fetch('/api/verificar-disponibilidade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cp_selection:           currentCpSelection,
                addressId:              currentAddressId,
                complementoSelecionado: currentComplementoSelecionado,
                accessToken:            currentAccessToken,
                subscriberId:           currentSubscriberId,
                ambiente:               currentAmbiente // ✅ Envia ambiente
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[FRONTEND] Erro HTTP na viabilidade:', response.status, errorText);
            throw new Error(`Erro HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('[FRONTEND] Dados de disponibilidade:', data);

        if (data && data.status === 'sucesso') {
            currentInventoryId = data.inventoryId;
            displayProducts(data.products);
            showSection('productSelection');
            setStep(3);
            showMessage('✅ Disponibilidade verificada. Escolha um produto.', 'success');
        } else {
            showMessage(`❌ Erro ao verificar disponibilidade: ${data ? data.message : 'Resposta inválida.'}`, 'error');
        }
    } catch (error) {
        console.error('Erro ao verificar disponibilidade:', error);
        showMessage('❌ Erro ao verificar disponibilidade: ' + error.message, 'error');
    }
}

// ─────────────────────────────────────────────
// Etapa 4: Exibir e Confirmar Produto
// ─────────────────────────────────────────────
// ✅ v3: lista de produtos (cada item tem catalogId + attributes opcionais)
function displayProducts(products) {
    window.__produtosCatalogo = products || [];
    currentProdutosSelecionados = [];
    renderLinhasProduto();
    atualizarBotaoConfirmar();
}

// Renderiza todas as linhas de produto
function renderLinhasProduto() {
    const productListDiv = document.getElementById('productList');
    const attrsDiv       = document.getElementById('attributesTemplates');
    if (!productListDiv) return;
    productListDiv.innerHTML = '';
    if (attrsDiv) attrsDiv.innerHTML = '';

    if (currentProdutosSelecionados.length === 0) {
        // Primeira linha com BL_400MB sugerido se existir no catálogo
        const sugestao = (window.__produtosCatalogo || []).find(p => /^BL_/i.test(p.catalogId)) || (window.__produtosCatalogo || [])[0];
        if (sugestao) {
            currentProdutosSelecionados.push({ catalogId: sugestao.catalogId, attributes: templatePara(sugestao.catalogId) ? JSON.parse(JSON.stringify(templatePara(sugestao.catalogId))) : null });
        }
    }

    currentProdutosSelecionados.forEach((produto, idx) => {
        const row = document.createElement('div');
        row.className = 'product-row';
        row.dataset.idx = idx;

        const isBL = catalogoEhBandaLarga(produto.catalogId);
        const tagBL = isBL ? '<span class="bl-tag" style="background:#d4edda;color:#155724;padding:2px 6px;border-radius:4px;font-size:12px;margin-left:6px;">BL ✓</span>' : '';
        const tmpl = templatePara(produto.catalogId);
        const temTmpl = !!tmpl;
        const tagTmpl = temTmpl ? '<span class="attr-tag" style="background:#fff3cd;color:#856404;padding:2px 6px;border-radius:4px;font-size:12px;margin-left:4px;">Atributos obrigatórios</span>' : '';

        row.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px;border:1px solid #e0e0e0;border-radius:6px;margin-bottom:8px;">
                <select class="prod-catalog" data-idx="${idx}" style="flex:1;min-width:160px;">
                    ${(window.__produtosCatalogo || []).map(p => {
                        const sel = p.catalogId === produto.catalogId ? 'selected' : '';
                        return `<option value="${p.catalogId}" ${sel}>${p.name || p.catalogId} (${p.catalogId})</option>`;
                    }).join('')}
                </select>
                ${tagBL}${tagTmpl}
                <button type="button" class="remove-prod" data-idx="${idx}" style="background:#dc3545;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;">✕ Remover</button>
            </div>
        `;
        productListDiv.appendChild(row);

        // Se o catálogo exige attributes, renderiza o bloco de attributes
        if (temTmpl) {
            // ✅ v5: não renderiza mais o textarea — número VoIP é fixo
            const bloco = document.createElement('div');
            bloco.className = 'product-attrs-info';
            bloco.style.cssText = 'font-size:12px;color:#856404;padding:4px 14px 10px;margin:-4px 0 8px 0;';
            bloco.textContent = `Número VoIP de placeholder: 99999999999 (atributos preenchidos automaticamente)`;
            productListDiv.appendChild(bloco);
        }
    });

    // Listeners
    productListDiv.querySelectorAll('.prod-catalog').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = Number(e.target.dataset.idx);
            const novo = e.target.value;
            currentProdutosSelecionados[idx] = {
                catalogId: novo,
                attributes: templatePara(novo) ? JSON.parse(JSON.stringify(templatePara(novo))) : null
            };
            renderLinhasProduto();
        });
    });
    productListDiv.querySelectorAll('.remove-prod').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = Number(e.target.dataset.idx);
            currentProdutosSelecionados.splice(idx, 1);
            renderLinhasProduto();
            atualizarBotaoConfirmar();
        });
    });
}


function adicionarLinhaProduto() {
    if (!window.__produtosCatalogo || window.__produtosCatalogo.length === 0) {
        showMessage('Nenhum produto disponível para adicionar.', 'error');
        return;
    }
    const primeiro = window.__produtosCatalogo[0];
    currentProdutosSelecionados.push({
        catalogId: primeiro.catalogId,
        attributes: templatePara(primeiro.catalogId) ? JSON.parse(JSON.stringify(templatePara(primeiro.catalogId))) : null
    });
    renderLinhasProduto();
    atualizarBotaoConfirmar();
}

function atualizarBotaoConfirmar() {
    const btn = document.getElementById('confirmProductBtn');
    if (!btn) return;
    const temProdutos = currentProdutosSelecionados.length > 0;
    const temBL = currentProdutosSelecionados.some(p => catalogoEhBandaLarga(p.catalogId));
    const semDuplicatas = new Set(currentProdutosSelecionados.map(p => p.catalogId)).size === currentProdutosSelecionados.length;
    // ✅ v5: attributes vem do template hardcoded, sempre preenchido
    btn.disabled = !(temProdutos && temBL && semDuplicatas);
}

async function confirmarProduto() {
    if (currentProdutosSelecionados.length === 0) {
        showMessage('Adicione pelo menos 1 produto.', 'error');
        return;
    }
    const temBL = currentProdutosSelecionados.some(p => catalogoEhBandaLarga(p.catalogId));
    if (!temBL) {
        showMessage('Adicione pelo menos 1 produto de Banda Larga (BL_).', 'error');
        return;
    }
    // ✅ v5: attributes vem preenchido do template (VoIP = 99999999999)
    currentProdutoSelecionado = currentProdutosSelecionados[0];
    showMessage('⏳ Buscando slots de agendamento...', 'info');
    await buscarSlots();
}

// ─────────────────────────────────────────────
// Etapa 5: Buscar e Confirmar Slot
// ─────────────────────────────────────────────
async function buscarSlots() {
    try {
        // ✅ Pega o primeiro produto BL_ da lista (regra: >=1 BL_)
        //    Fallback: primeiro produto da lista, depois 'Banda Larga'.
        const produtoBandaLarga = (currentProdutosSelecionados || [])
            .find(p => p && p.catalogId && p.catalogId.startsWith('BL_'));
        const catalogIdEscolhido = (produtoBandaLarga || currentProdutosSelecionados[0] || {}).catalogId;
        const productType        = categoriaDoProduto(catalogIdEscolhido);

        const requestBody = {
            cp_selection: currentCpSelection,
            addressId:    currentAddressId,
            subscriberId: currentSubscriberId,
            productType,                          // ✅ categoria ("Banda Larga"), não catalogId
            accessToken:  currentAccessToken,
            ambiente:     currentAmbiente
        };

        console.log('[FRONTEND] Request buscar-slots:', requestBody);

        const response = await fetch('/api/buscar-slots', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Erro HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('[FRONTEND] Slots recebidos:', data);

        if (data.status === 'sucesso' && data.slots) {
            displaySlots(data.slots);
            showSection('slotSelection');
            setStep(4);
            showMessage('✅ Slots carregados. Escolha um horário.', 'success');
        } else {
            showMessage(`❌ Erro ao buscar slots: ${data.message || 'Nenhum slot disponível.'}`, 'error');
        }
    } catch (error) {
        console.error('Erro ao buscar slots:', error);
        showMessage('❌ Erro ao buscar slots: ' + error.message, 'error');
    }
}

function displaySlots(slots) {
    const slotListDiv = document.getElementById('slotList');
    slotListDiv.innerHTML = '';
    document.getElementById('confirmSlotBtn').disabled = true;

    if (!slots || slots.length === 0) {
        slotListDiv.innerHTML = '<p>Nenhum slot de agendamento disponível para este produto.</p>';
        return;
    }

    slots.forEach(slot => {
        const div = document.createElement('div');
        div.classList.add('slot-item');
        div.dataset.id         = slot.id;
        div.dataset.startDate  = slot.startDate;
        div.dataset.finishDate = slot.finishDate;

        const startDate  = new Date(slot.startDate);
        const finishDate = new Date(slot.finishDate);

        const formattedDate  = startDate.toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' });
        const formattedStart = startDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
        const formattedEnd   = finishDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });

        div.innerHTML = `
            <span><strong>📅 Data:</strong> ${formattedDate}</span>
            <span><strong>🕐 Horário:</strong> ${formattedStart} - ${formattedEnd}</span>
        `;

        div.addEventListener('click', () => {
            document.querySelectorAll('.slot-item').forEach(i => i.classList.remove('selected'));
            div.classList.add('selected');
            document.getElementById('confirmSlotBtn').disabled = false;
            currentSlotSelecionado = slot;
        });
        slotListDiv.appendChild(div);
    });
}

async function confirmarSlot() {
    if (!currentSlotSelecionado) {
        showMessage('Por favor, selecione um slot de agendamento.', 'error');
        return;
    }
    showMessage('⏳ Agendando slot...', 'info');
    await agendarSlotSelecionado();
}

// ─────────────────────────────────────────────
// Etapa 6: Agendar Slot
// ─────────────────────────────────────────────
async function agendarSlotSelecionado() {
    try {
        const response = await fetch('/api/agendar-slot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cp_selection: currentCpSelection,
                slotId:       currentSlotSelecionado.id,
                accessToken:  currentAccessToken,
                ambiente:     currentAmbiente // ✅ Envia ambiente
            })
        });
        const data = await response.json();
        console.log('[FRONTEND] Resposta do agendamento:', data);

        if (data.status === 'sucesso') {
            currentAgendamentoId = data.agendamentoId;
            if (!currentAgendamentoId) {
                throw new Error('ID do agendamento não encontrado na resposta do servidor.');
            }
            displayOrderConfirmation();
            showSection('orderConfirmation');
            setStep(5);
            showMessage('✅ Slot agendado com sucesso!', 'success');
        } else {
            showMessage(`❌ Erro ao agendar slot: ${data.message}`, 'error');
        }
    } catch (error) {
        console.error('Erro ao agendar slot:', error);
        showMessage('❌ Erro ao agendar slot: ' + error.message, 'error');
    }
}

// ─────────────────────────────────────────────
// Etapa 7: Confirmação e Criação da OS
// ─────────────────────────────────────────────
function displayOrderConfirmation() {
    // ✅ Exibe o ambiente no resumo da OS
    const ambienteEl = document.getElementById('confirmAmbiente');
    if (ambienteEl) {
        const labels = { TRG: '🟡 TRG', TI: '🟢 TI', TRG2: '🔵 TRG2' };
        ambienteEl.textContent = labels[currentAmbiente] || currentAmbiente;
    }

    document.getElementById('confirmAddress').textContent =
        `${currentEnderecoDetalhes.streetName}, ${currentEnderecoDetalhes.streetNr} - ` +
        `${currentEnderecoDetalhes.neighborhood}, ${currentEnderecoDetalhes.locality} - ` +
        `${currentEnderecoDetalhes.stateOrProvince}, ${currentEnderecoDetalhes.postcode}`;

    document.getElementById('confirmComplement').textContent =
        currentComplementoSelecionado && currentComplementoSelecionado.value
            ? `${currentComplementoSelecionado.type}: ${currentComplementoSelecionado.value}`
            : 'N/A';

    const listaStr = currentProdutosSelecionados
        .map(p => {
            const cat = window.__produtosCatalogo ? window.__produtosCatalogo.find(x => x.catalogId === p.catalogId) : null;
            const nome = cat ? cat.name : p.catalogId;
            const tech = cat && cat.technology ? ` — Tecnologia: ${cat.technology}` : '';
            const bl = catalogoEhBandaLarga(p.catalogId) ? ' [BL]' : '';
            return `${nome} (${p.catalogId})${bl}${tech}`;
        })
        .join('; ');
    document.getElementById('confirmProduct').textContent = listaStr;

    const startDate  = new Date(currentSlotSelecionado.startDate);
    const finishDate = new Date(currentSlotSelecionado.finishDate);

    document.getElementById('confirmSlot').textContent =
        `${startDate.toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' })} ` +
        `das ${startDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })} ` +
        `às ${finishDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

async function criarOrdemDeServico() {
    if (!currentAgendamentoId) {
        showMessage('❌ Agendamento não confirmado. Volte e selecione um slot.', 'error');
        return;
    }

    showMessage('⏳ Criando Ordem de Serviço...', 'info');
    document.getElementById('createOrderBtn').disabled = true;

    try {
        const response = await fetch('/api/criar-os', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cp_selection:           currentCpSelection,
                addressId:              currentAddressId,
                complementoSelecionado: currentComplementoSelecionado,
                produtos:               currentProdutosSelecionados,  // ✅ v3: array (suporta attributes)
                produtoSelecionado:     currentProdutosSelecionados[0] || null, // retrocompat
                slotSelecionado:        currentSlotSelecionado,
                agendamentoId:          currentAgendamentoId,
                accessToken:            currentAccessToken,
                subscriberId:           currentSubscriberId,
                inventoryId:            currentInventoryId,
                enderecoDetalhes:       currentEnderecoDetalhes,
                ambiente:               currentAmbiente // ✅ Envia ambiente
            })
        });
        const data = await response.json();

        if (data.status === 'sucesso') {
            document.getElementById('finalOrderId').textContent = data.orderId;
            document.getElementById('finalSaId').textContent    = data.saId;

            // ✅ Cadeia de fallback garantida:
            // 1. associatedDocument retornado pela API
            // 2. subscriberId retornado pelo backend
            // 3. subscriberId que o frontend enviou na requisição
            // 4. 'N/A' se nenhum estiver disponível
            document.getElementById('finalAssociatedDocument').textContent =
                data.associatedDocument  ||
                data.subscriberId        ||
                currentSubscriberId      ||
                'N/A';

            document.getElementById('createOrderBtn').disabled = true;
            showMessage(`✅ Ordem de Serviço criada com sucesso! ID: ${data.orderId}`, 'success');

        } else {
            document.getElementById('createOrderBtn').disabled = false;
            showMessage(`❌ Erro ao criar OS: ${data.message}`, 'error');
        }

        } catch (error) {
            console.error('Erro ao criar OS:', error);
            document.getElementById('createOrderBtn').disabled = false;
            showMessage('❌ Erro ao criar Ordem de Serviço: ' + error.message, 'error');
        }
}

// ─────────────────────────────────────────────
// Reset do Fluxo
// ─────────────────────────────────────────────
function resetFlow() {
    // Variáveis de fluxo — ✅ mantém o ambiente atual
    currentCpSelection            = '';
    currentAddressId              = null;
    currentEnderecoDetalhes       = null;
    currentComplementoSelecionado = null;
    currentAccessToken            = null;
    currentSubscriberId           = null;
    currentProdutosDisponiveis    = [];
    currentProdutosSelecionados   = [];
    currentProdutoSelecionado     = null;
    currentSlotsDisponiveis       = [];
    currentSlotSelecionado        = null;
    currentAgendamentoId          = null;
    currentInventoryId            = null;
    currentNewSubscriberId        = null;
    currentOldSubscriberId        = null;
    currentInstalacaoResult       = null;

    // Limpar campos
    document.getElementById('cpSelect').value    = '';
    document.getElementById('cepInput').value    = '';
    document.getElementById('numeroInput').value = '';

    // Limpar displays
    document.getElementById('enderecoDisplay').textContent        = '';
    document.getElementById('complementList').innerHTML           = '';
    document.getElementById('productList').innerHTML              = '';
    document.getElementById('slotList').innerHTML                 = '';
    document.getElementById('finalOrderId').textContent          = '';
    document.getElementById('finalSaId').textContent             = '';
    document.getElementById('finalAssociatedDocument').textContent = '';

    // Reabilitar botões
    document.getElementById('createOrderBtn').disabled      = false;
    document.getElementById('confirmComplementBtn').disabled = true;
    document.getElementById('confirmProductBtn').disabled   = true;
    document.getElementById('confirmSlotBtn').disabled      = true;

    setStep(1);
    showSection('addressConsultation');
    showMessage('', 'info', true);
}

(function () {
  const VALID_ENVS = new Set(['TRG', 'TI', 'TRG2']);

  function normalizeEnv(v) {
    const env = String(v || '').trim().toUpperCase();
    return VALID_ENVS.has(env) ? env : 'TRG';
  }

  function getEnvFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return normalizeEnv(params.get('ambiente'));
  }

  function appendEnvToUrl(url, ambiente) {
    try {
      const u = new URL(url, window.location.origin);
      u.searchParams.set('ambiente', ambiente);
      return `${u.pathname}${u.search}${u.hash}`;
    } catch {
      return url;
    }
  }

  function propagateEnvToLinks() {
    const ambiente = getEnvFromUrl();
    const links = document.querySelectorAll('a[href]');
    links.forEach((a) => {
      const href = a.getAttribute('href');
      if (!href) return;
      if (
        href.startsWith('#') ||
        href.startsWith('javascript:') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:')
      ) return;

      a.setAttribute('href', appendEnvToUrl(href, ambiente));
    });
  }

  window.PortalNodeEnv = {
    get: getEnvFromUrl,
    normalize: normalizeEnv,
    appendToUrl: appendEnvToUrl
  };

  document.addEventListener('DOMContentLoaded', propagateEnvToLinks);
})();