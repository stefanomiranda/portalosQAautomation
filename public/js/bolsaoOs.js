// public/js/bolsaoOs.js

let availableOrders = [];
let filteredOrders  = [];
let currentAmbiente  = new URLSearchParams(window.location.search).get('ambiente') || 'TODOS';
let currentStatus    = 'TODOS';

document.addEventListener('DOMContentLoaded', () => {
    const filtroAmbienteEl = document.getElementById('filtroAmbiente');
    if (filtroAmbienteEl) {
        filtroAmbienteEl.value = (currentAmbiente || 'TODOS').toUpperCase();
        filtroAmbienteEl.addEventListener('change', (e) => {
            currentAmbiente = e.target.value;
            applyFilters();
        });
    }

    const filtroStatusEl = document.getElementById('filtroStatus');
    if (filtroStatusEl) {
        filtroStatusEl.addEventListener('change', (e) => {
            currentStatus = e.target.value;
            applyFilters();
        });
    }

    const btnExpurgoEl = document.getElementById('btnExpurgo');
    if (btnExpurgoEl) btnExpurgoEl.addEventListener('click', expurgarVencidas);

    loadOrders();
});

async function loadOrders() {
    const osListContainer = document.getElementById('osListContainer');
    const ordersCount     = document.getElementById('ordersCount');

    osListContainer.innerHTML = '<p class="info">⏳ Carregando Ordens de Serviço...</p>';

    try {
        const response = await fetch('/api/ordens-servico');
        const data     = await response.json();

        if (data.status === 'sucesso' && data.orders && data.orders.length > 0) {
            availableOrders = data.orders;
            applyFilters();
        } else if (data.status === 'sucesso' && data.orders && data.orders.length === 0) {
            availableOrders = [];
            filteredOrders  = [];
            if (ordersCount) ordersCount.textContent = '0 OS encontradas';
            renderEmpty();
        } else {
            if (ordersCount) ordersCount.textContent = 'Erro';
            osListContainer.innerHTML = `
                <p class="error">
                    ❌ Erro ao carregar Ordens de Serviço: ${data.message || 'Resposta inválida.'}
                </p>`;
            console.error('[BOLSÃO] Erro ao carregar OS:', data);
        }
    } catch (error) {
        if (ordersCount) ordersCount.textContent = 'Erro de rede';
        osListContainer.innerHTML = `
            <p class="error">
                ❌ Erro de rede: ${error.message}
            </p>`;
        console.error('[BOLSÃO] Erro de rede:', error);
    }
}

function applyFilters() {
    filteredOrders = (availableOrders || []).filter((o) => {
        if (currentAmbiente !== 'TODOS' && String(o.ambiente || '').toUpperCase() !== currentAmbiente) {
            return false;
        }
        if (currentStatus === 'ATIVAS'   && isVencida(o)) return false;
        if (currentStatus === 'VENCIDAS' && !isVencida(o)) return false;
        return true;
    });
    renderList();
}

function isVencida(order) {
    if (!order || !order.slotDate) return false;
    const t = new Date(order.slotDate).getTime();
    if (isNaN(t)) return false;
    return t < Date.now();
}

function renderList() {
    const osListContainer = document.getElementById('osListContainer');
    const ordersCount     = document.getElementById('ordersCount');
    if (!osListContainer) return;

    osListContainer.innerHTML = '';
    if (ordersCount) {
        ordersCount.textContent = `${filteredOrders.length} OS encontrada${filteredOrders.length !== 1 ? 's' : ''}`;
    }

    if (filteredOrders.length === 0) {
        renderEmpty();
        return;
    }

    [...filteredOrders].reverse().forEach((order, index) => {
        osListContainer.appendChild(buildOrderCard(order, index));
    });
}

function buildOrderCard(order, index) {
    const card = document.createElement('div');
    card.className = 'order-card' + (isVencida(order) ? ' vencida' : '');

    const creationDate = new Date(order.creationDate).toLocaleString('pt-BR', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const slotDate = new Date(order.slotDate).toLocaleString('pt-BR', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const ambienteTag = order.ambiente
        ? `<span class="env-tag ${order.ambiente}">${getAmbienteLabel(order.ambiente)}</span>`
        : '';
    const vencidaBadge = isVencida(order) ? '<span class="badge-vencida">VENCIDA</span>' : '';

    const flowTag = order.flowType
        ? `<span style="display:inline-block;background:#1976d2;color:#fff;padding:2px 8px;border-radius:10px;font-size:0.72em;font-weight:700;margin-left:6px;">${order.flowType}</span>`
        : '';

    card.innerHTML = `
        <h3>
            📋 OS: ${order.orderId || 'N/A'}
            ${ambienteTag}
            ${vencidaBadge}
            ${flowTag}
        </h3>
        <p><strong>CP:</strong> ${order.cp || 'N/A'}</p>
        <p><strong>Subscriber ID:</strong> ${order.subscriberId || 'N/A'}</p>
        <p><strong>Produto:</strong> ${order.productName || 'N/A'}
            <span style="color:#adb5bd; font-size:0.88em;">(${order.productCatalogId || 'N/A'})</span>
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
        <p><strong>📅 Agendamento:</strong> ${slotDate}</p>
        <p><strong>SA ID:</strong> ${order.saId || 'N/A'}</p>
        <p><strong>🕐 Criado em:</strong> ${creationDate}</p>
        <div style="margin-top: 15px; border-top: 1px solid #eee; padding-top: 15px; display: flex; gap: 10px; flex-wrap: wrap;">
            <button class="action-button" onclick="goToApiAction('${index}', 'bloqueioParcial')">🔒 Bloqueio Parcial</button>
            <button class="action-button" onclick="goToApiAction('${index}', 'bloqueioTotal')">🚫 Bloqueio Total</button>
            <button class="action-button" onclick="goToApiAction('${index}', 'desbloqueio')">🔓 Desbloqueio</button>
        </div>
    `;
    return card;
}

function renderEmpty() {
    const osListContainer = document.getElementById('osListContainer');
    if (!osListContainer) return;
    osListContainer.innerHTML = `
        <div style="text-align:center; padding: 40px 20px; color: #adb5bd;">
            <div style="font-size: 3em; margin-bottom: 15px;">📭</div>
            <p style="font-size: 1.1em; margin: 0;">Nenhuma Ordem de Serviço criada ainda.</p>
            <a href="createos.html"
               style="display:inline-block; margin-top:15px; color:#212529;
                      font-weight:700; text-decoration:none;
                      background:#FFD700; padding:10px 20px; border-radius:8px;">
                + Criar primeira OS
            </a>
        </div>
    `;
}

function getAmbienteLabel(ambiente) {
    const labels = {
        TRG:  '🟡 TRG',
        TI:   '🟢 TI',
        TRG2: '🔵 TRG2'
    };
    return labels[ambiente] || ambiente;
}

function goToApiAction(orderIndex, action) {
    const idx = Number(orderIndex);
    const orders = Array.isArray(window.availableOrders) ? window.availableOrders : [];
    const selected = orders[idx] || null;

    const ambienteFromUrl = new URLSearchParams(window.location.search).get('ambiente');
    const ambiente = String(selected?.ambiente || ambienteFromUrl || 'TRG').toUpperCase();

    const encodedOrderIndex = btoa(String(idx));
    window.location.href = `apis.html?ambiente=${encodeURIComponent(ambiente)}&action=${encodeURIComponent(action)}&osIndex=${encodeURIComponent(encodedOrderIndex)}`;
}

function expurgarVencidas() {
    const antes   = availableOrders.length;
    availableOrders = availableOrders.filter((o) => !isVencida(o));
    const removidas = antes - availableOrders.length;
    applyFilters();
    const msg = document.getElementById('bolsaoMessage');
    if (msg) {
        msg.className = 'message info';
        msg.classList.remove('hidden');
        msg.textContent = `🗑️ ${removidas} OS vencida${removidas === 1 ? '' : 's'} expurgada${removidas === 1 ? '' : 's'} do bolsão.`;
        setTimeout(() => msg.classList.add('hidden'), 4000);
    }
}

window.availableOrders = availableOrders;