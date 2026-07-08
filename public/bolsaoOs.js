// public/js/bolsaoOs.js

// Mova esta declaração para o escopo global do arquivo
let availableOrders = []; // Armazena as OSs carregadas do backend

document.addEventListener('DOMContentLoaded', () => {
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
            // Atribua os dados à variável global availableOrders
            availableOrders = data.orders;
            osListContainer.innerHTML = '';

            // ✅ Atualiza o contador
            if (ordersCount) {
                ordersCount.textContent = `${availableOrders.length} OS encontrada${availableOrders.length > 1 ? 's' : ''}`;
            }

            // ✅ Exibe em ordem inversa (mais recente primeiro)
            // Use availableOrders para iterar
            [...availableOrders].reverse().forEach((order, index) => { // Adicione 'index' aqui
                const orderCard = document.createElement('div');
                orderCard.classList.add('order-card');

                const creationDate = new Date(order.creationDate).toLocaleString('pt-BR', {
                    year: 'numeric', month: 'long', day: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });

                const slotDate = new Date(order.slotDate).toLocaleString('pt-BR', {
                    year: 'numeric', month: 'long', day: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });

                // ✅ Badge de ambiente com cor dinâmica
                const ambienteTag = order.ambiente
                    ? `<span class="env-tag ${order.ambiente}">${getAmbienteLabel(order.ambiente)}</span>`
                    : '';

                orderCard.innerHTML = `
                    <h3>
                        📋 OS: ${order.orderId}
                        ${ambienteTag}
                    </h3>
                    <p><strong>CP:</strong> ${order.cp}</p>
                    <p><strong>Subscriber ID:</strong> ${order.subscriberId}</p>
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
                    <p><strong>📅 Agendamento:</strong> ${slotDate}</p>
                    <p><strong>SA ID:</strong> ${order.saId}</p>
                    <p><strong>🕐 Criado em:</strong> ${creationDate}</p>
                    <!-- NOVOS BOTÕES DE AÇÃO -->
                    <div style="margin-top: 15px; border-top: 1px solid #eee; padding-top: 15px; display: flex; gap: 10px; flex-wrap: wrap;">
                        <button class="action-button" onclick="goToApiAction('${index}', 'bloqueioParcial')">🔒 Bloqueio Parcial</button>
                        <button class="action-button" onclick="goToApiAction('${index}', 'bloqueioTotal')">🚫 Bloqueio Total</button>
                        <button class="action-button" onclick="goToApiAction('${index}', 'desbloqueio')">🔓 Desbloqueio</button>
                    </div>
                    <!-- FIM NOVOS BOTÕES -->
                `;
                osListContainer.appendChild(orderCard);
            });

        } else if (data.status === 'sucesso' && data.orders && data.orders.length === 0) {
            if (ordersCount) ordersCount.textContent = '0 OS encontradas';
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
        } else {
            if (ordersCount) ordersCount.textContent = 'Erro';
            osListContainer.innerHTML = `
                <p style="color:#dc3545; text-align:center;">
                    ❌ Erro ao carregar Ordens de Serviço: ${data.message || 'Resposta inválida.'}
                </p>`;
            console.error('[BOLSÃO] Erro ao carregar OS:', data);
        }
    } catch (error) {
        if (ordersCount) ordersCount.textContent = 'Erro de rede';
        osListContainer.innerHTML = `
            <p style="color:#dc3545; text-align:center;">
                ❌ Erro de rede: ${error.message}
            </p>`;
        console.error('[BOLSÃO] Erro de rede:', error);
    }
}

// ✅ Retorna o label do ambiente com ícone
function getAmbienteLabel(ambiente) {
    const labels = {
        TRG:  '🟡 TRG',
        TI:   '🟢 TI',
        TRG2: '🔵 TRG2'
    };
    return labels[ambiente] || ambiente;
}

// Adicione esta nova função ao final do arquivo public/js/bolsaoOs.js
function goToApiAction(orderIndex, action) {
  const idx = Number(orderIndex);
  const orders = Array.isArray(window.availableOrders) ? window.availableOrders : [];
  const selected = orders[idx] || null;

  const ambienteFromUrl = new URLSearchParams(window.location.search).get('ambiente');
  const ambiente = String(selected?.ambiente || ambienteFromUrl || 'TRG').toUpperCase();

  const encodedOrderIndex = btoa(String(orderIndex));
  window.location.href = `apis.html?ambiente=${encodeURIComponent(ambiente)}&action=${encodeURIComponent(action)}&osIndex=${encodeURIComponent(encodedOrderIndex)}`;
}

window.availableOrders = availableOrders;