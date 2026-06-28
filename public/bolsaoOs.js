// public/bolsaoOs.js
document.addEventListener('DOMContentLoaded', () => {
    loadOrders();
});

async function loadOrders() {
    const osListContainer = document.getElementById('osListContainer');
    osListContainer.innerHTML = '<p class="info">Carregando Ordens de Serviço...</p>'; // Mensagem de carregamento

    try {
        const response = await fetch('/api/ordens-servico');
        const data = await response.json();

        if (data.status === 'sucesso' && data.orders && data.orders.length > 0) {
            osListContainer.innerHTML = ''; // Limpa a mensagem de carregamento
            data.orders.forEach(order => {
                const orderCard = document.createElement('div');
                orderCard.classList.add('order-card'); // Adicionar uma classe para estilização

                // Formatar a data de criação
                const creationDate = new Date(order.creationDate).toLocaleString('pt-BR', {
                    year: 'numeric', month: 'long', day: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });

                // Formatar a data do slot
                const slotDate = new Date(order.slotDate).toLocaleString('pt-BR', {
                    year: 'numeric', month: 'long', day: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });

                orderCard.innerHTML = `
                    <h3>OS ID: ${order.orderId}</h3>
                    <p><strong>CP:</strong> ${order.cp}</p>
                    <p><strong>Subscriber ID:</strong> ${order.subscriberId}</p>
                    <p><strong>Produto:</strong> ${order.productName} (Catalog ID: ${order.productCatalogId})</p>
                    <p><strong>Endereço:</strong> ${order.address ? `${order.address.streetName}, ${order.address.streetNr}, ${order.address.neighborhood}` : 'N/A'}</p>
                    <p><strong>Complemento:</strong> ${order.complement && order.complement.value ? `${order.complement.type}: ${order.complement.value}` : 'N/A'}</p>
                    <p><strong>Data do Agendamento:</strong> ${slotDate}</p>
                    <p><strong>Data de Criação:</strong> ${creationDate}</p>
                    <p><strong>SA ID:</strong> ${order.saId}</p>
                `;
                osListContainer.appendChild(orderCard);
            });
        } else if (data.status === 'sucesso' && data.orders && data.orders.length === 0) {
            osListContainer.innerHTML = '<p class="info">Nenhuma Ordem de Serviço criada ainda.</p>';
        } else {
            osListContainer.innerHTML = `<p class="error">Erro ao carregar Ordens de Serviço: ${data.message || 'Resposta inválida.'}</p>`;
            console.error('Erro ao carregar Ordens de Serviço:', data);
        }
    } catch (error) {
        osListContainer.innerHTML = `<p class="error">Erro de rede ao carregar Ordens de Serviço: ${error.message}</p>`;
        console.error('Erro de rede ao carregar Ordens de Serviço:', error);
    }
}

// Função para exibir mensagens (reutilizada do main.js, pode ser centralizada depois)
function showMessage(message, type) {
    const messageDiv = document.querySelector('#osListSection .message');
    if (messageDiv) {
        messageDiv.classList.remove('hidden', 'success', 'error', 'info');
        messageDiv.textContent = message;
        messageDiv.classList.add(type);
    }
}