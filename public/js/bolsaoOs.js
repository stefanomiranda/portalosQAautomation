// public/js/bolsaoOs.js

// ── Estado global do módulo ──────────────────
let todasAsOrders = []; // cache completo vindo da API

// ── Inicialização ────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadOrders();

    // ✅ Filtros reagem em tempo real — sem reload
    document.getElementById('filtroAmbiente').addEventListener('change', renderOrders);
    document.getElementById('filtroStatus').addEventListener('change',   renderOrders);

    // ✅ Botão de expurgo
    document.getElementById('btnExpurgo').addEventListener('click', expurgarVencidas);
});

// ── Carrega OS da API ─────────────────────────
async function loadOrders() {
    const osListContainer = document.getElementById('osListContainer');
    const ordersCount     = document.getElementById('ordersCount');

    osListContainer.innerHTML = '<p class="info">⏳ Carregando Ordens de Serviço...</p>';

    try {
        const response = await fetch('/api/ordens-servico');
        const data     = await response.json();

        if (data.status === 'sucesso') {
            todasAsOrders = data.orders || []; // ✅ salva no cache
            renderOrders();                    // ✅ delega a exibição
        } else {
            if (ordersCount) ordersCount.textContent = 'Erro';
            osListContainer.innerHTML = `
                <p style="color:#dc3545; text-align:center;">
                    ❌ Erro ao carregar OS: ${data.message || 'Resposta inválida.'}
                </p>`;
            console.error('[BOLSÃO] Erro ao carregar OS:', data);
        }

    } catch (error) {
        if (document.getElementById('ordersCount'))
            document.getElementById('ordersCount').textContent = 'Erro de rede';
        osListContainer.innerHTML = `
            <p style="color:#dc3545; text-align:center;">
                ❌ Erro de rede: ${error.message}
            </p>`;
        console.error('[BOLSÃO] Erro de rede:', error);
    }
}

// ── Renderiza com filtros aplicados ──────────
function renderOrders() {
    const osListContainer = document.getElementById('osListContainer');
    const ordersCount     = document.getElementById('ordersCount');
    const filtroAmbiente  = document.getElementById('filtroAmbiente').value;
    const filtroStatus    = document.getElementById('filtroStatus').value;
    const agora           = new Date();

    // ✅ Aplica filtro de ambiente
    let filtradas = todasAsOrders.filter(order => {
        if (filtroAmbiente === 'TODOS') return true;
        return order.ambiente === filtroAmbiente;
    });

    // ✅ Aplica filtro de status (vencida = slotDate no passado)
    filtradas = filtradas.filter(order => {
        const slotDate = new Date(order.slotDate);
        const vencida  = slotDate < agora;
        if (filtroStatus === 'ATIVAS')   return !vencida;
        if (filtroStatus === 'VENCIDAS') return  vencida;
        return true; // TODOS
    });

    // ── Atualiza contador ──
    const totalGeral = todasAsOrders.length;
    const exibindo   = filtradas.length;
    if (ordersCount) {
        ordersCount.textContent = filtroAmbiente === 'TODOS' && filtroStatus === 'TODOS'
            ? `${totalGeral} OS encontrada${totalGeral !== 1 ? 's' : ''}`
            : `${exibindo} de ${totalGeral} OS`;
    }

    // ── Lista vazia ──
    if (filtradas.length === 0) {
        osListContainer.innerHTML = `
            <div style="text-align:center; padding: 40px 20px; color: #adb5bd;">
                <div style="font-size: 3em; margin-bottom: 15px;">📭</div>
                <p style="font-size: 1.1em; margin: 0;">
                    ${todasAsOrders.length === 0
                        ? 'Nenhuma Ordem de Serviço criada ainda.'
                        : 'Nenhuma OS encontrada com os filtros aplicados.'}
                </p>
                ${todasAsOrders.length === 0
                    ? `<a href="createos.html"
                          style="display:inline-block; margin-top:15px; color:#212529;
                                 font-weight:700; text-decoration:none;
                                 background:#FFD700; padding:10px 20px; border-radius:8px;">
                           + Criar primeira OS
                       </a>`
                    : ''}
            </div>`;
        return;
    }

    // ── Renderiza cards (mais recente primeiro) ──
    osListContainer.innerHTML = '';
    [...filtradas].reverse().forEach(order => {
        const agora    = new Date();
        const slotDate = new Date(order.slotDate);
        const vencida  = slotDate < agora;

        const orderCard = document.createElement('div');
        orderCard.classList.add('order-card');
        if (vencida) orderCard.classList.add('vencida'); // ✅ estilo diferenciado

        const creationDateStr = new Date(order.creationDate).toLocaleString('pt-BR', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const slotDateStr = slotDate.toLocaleString('pt-BR', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        // ✅ Badge de ambiente
        const ambienteTag = order.ambiente
            ? `<span class="env-tag ${order.ambiente}">${getAmbienteLabel(order.ambiente)}</span>`
            : '';

        // ✅ Badge de vencida
        const vencidaTag = vencida
            ? `<span class="badge-vencida">⏰ Vencida</span>`
            : '';

        orderCard.innerHTML = `
            <h3>
                📋 OS: ${order.orderId}
                ${ambienteTag}
                ${vencidaTag}
            </h3>
            <p><strong>CP:</strong> ${order.cp}</p>
            <p><strong>Subscriber ID:</strong> ${order.subscriberId}</p>
            <p><strong>Documento Associado:</strong> ${order.associatedDocument || order.subscriberId || 'N/A'}</p>
            <p><strong>Produto:</strong> ${order.productName}
                <span style="color:#adb5bd; font-size:0.88em;">(${order.productCatalogId})</span>
            </p>
            <p><strong>Endereço:</strong> ${order.address
                ? `${order.address.streetName}, ${order.address.streetNr} — ${order.address.neighborhood}, ${order.address.locality} - ${order.address.stateOrProvince}`
                : 'N/A'}
            </p>
            <p><strong>Complemento:</strong> ${
                order.complement && order.complement.value
                    ? `${order.complement.type}: ${order.complement.value}`
                    : 'N/A'
            }</p>
            <p><strong>📅 Agendamento:</strong> ${slotDateStr}</p>
            <p><strong>SA ID:</strong> ${order.saId}</p>
            <p><strong>🕐 Criado em:</strong> ${creationDateStr}</p>
        `;

        osListContainer.appendChild(orderCard);
    });
}

// ── Expurga OS vencidas do cache e da tela ───
function expurgarVencidas() {
    const agora    = new Date();
    const antes    = todasAsOrders.length;

    // ✅ Filtra fora as vencidas do cache local
    todasAsOrders  = todasAsOrders.filter(order => new Date(order.slotDate) >= agora);

    const removidas = antes - todasAsOrders.length;

    if (removidas === 0) {
        alert('✅ Nenhuma OS vencida encontrada no bolsão.');
        return;
    }

    // ✅ Rerenderiza sem as vencidas
    renderOrders();
    alert(`🗑️ ${removidas} OS vencida${removidas !== 1 ? 's' : ''} removida${removidas !== 1 ? 's' : ''} do bolsão.`);
    console.log(`[BOLSÃO] Expurgo: ${removidas} OS removidas. Restam: ${todasAsOrders.length}`);
}

// ── Label do ambiente ─────────────────────────
function getAmbienteLabel(ambiente) {
    const labels = {
        TRG:  '🟡 TRG',
        TI:   '🟢 TI',
        TRG2: '🔵 TRG2'
    };
    return labels[ambiente] || ambiente;
}