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
let currentProdutoSelecionado      = null;
let currentSlotsDisponiveis        = [];
let currentSlotSelecionado         = null;
let currentAgendamentoId           = null;
let currentInventoryId             = null;

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
    const cpSelect = document.getElementById('cpSelect');
    try {
        const response = await fetch('/api/cps');
        const cps = await response.json();
        cpSelect.innerHTML = '<option value="">Selecione um CP</option>';
        cps.forEach(cp => {
            const option = document.createElement('option');
            option.value       = cp;
            option.textContent = cp;
            cpSelect.appendChild(option);
        });
        cpSelect.disabled = false;
    } catch (error) {
        console.error('Erro ao carregar CPs:', error);
        showMessage('Erro ao carregar CPs.', 'error');
    }
}

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
function displayProducts(products) {
    const productListDiv = document.getElementById('productList');
    productListDiv.innerHTML = '';

    if (!products || products.length === 0) {
        productListDiv.innerHTML = '<p>Nenhum produto disponível para este endereço.</p>';
        document.getElementById('confirmProductBtn').disabled = true;
        return;
    }

    products.forEach(product => {
        const productItem = document.createElement('div');
        productItem.className           = 'product-item';
        productItem.dataset.catalogId   = product.catalogId;
        productItem.dataset.name        = product.name;
        productItem.dataset.type        = product.type;
        productItem.dataset.technology  = product.technology;
        productItem.dataset.inventoryId = product.inventoryId;

        const bestOfferTag = product.best_offer
            ? '<span class="best-offer-tag">⭐ Melhor Oferta!</span>'
            : '';

        productItem.innerHTML = `
            <h3>${product.name} (${product.catalogId}) ${bestOfferTag}</h3>
            <p>Tipo: ${product.type} | Tecnologia: ${product.technology}</p>
        `;

        productItem.addEventListener('click', () => {
            document.querySelectorAll('.product-item').forEach(i => i.classList.remove('selected'));
            productItem.classList.add('selected');
            document.getElementById('confirmProductBtn').disabled = false;
            currentProdutoSelecionado = {
                catalogId:   productItem.dataset.catalogId,
                name:        productItem.dataset.name,
                type:        productItem.dataset.type,
                technology:  productItem.dataset.technology,
                inventoryId: productItem.dataset.inventoryId
            };
        });
        productListDiv.appendChild(productItem);
    });
}

async function confirmarProduto() {
    if (!currentProdutoSelecionado) {
        showMessage('Por favor, selecione um produto.', 'error');
        return;
    }
    showMessage('⏳ Buscando slots de agendamento...', 'info');
    await buscarSlots();
}

// ─────────────────────────────────────────────
// Etapa 5: Buscar e Confirmar Slot
// ─────────────────────────────────────────────
async function buscarSlots() {
    try {
        const response = await fetch('/api/buscar-slots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cp_selection: currentCpSelection,
                addressId:    currentAddressId,
                subscriberId: currentSubscriberId,
                productType:  currentProdutoSelecionado.type,
                accessToken:  currentAccessToken,
                ambiente:     currentAmbiente // ✅ Envia ambiente
            })
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

    document.getElementById('confirmProduct').textContent =
        `${currentProdutoSelecionado.name} (${currentProdutoSelecionado.catalogId}) — ` +
        `Tecnologia: ${currentProdutoSelecionado.technology}`;

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
                produtoSelecionado:     currentProdutoSelecionado,
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
    currentProdutoSelecionado     = null;
    currentSlotsDisponiveis       = [];
    currentSlotSelecionado        = null;
    currentAgendamentoId          = null;
    currentInventoryId            = null;

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