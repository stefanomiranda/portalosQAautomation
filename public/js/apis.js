// public/js/apis.js

let selectedApiAction = ''; // Armazena a ação da API selecionada (bloqueioParcial, bloqueioTotal, desbloqueio)
let availableOrders = [];   // Armazena as OSs carregadas do backend
let selectedOrder = null;   // Armazena a OS atualmente selecionada no dropdown

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const ambiente = urlParams.get('ambiente') || 'TRG';
    const preselectedAction = urlParams.get('action');
    const preselectedOsIndexEncoded = urlParams.get('osIndex');

    loadAvailableOrders().then(() => { // Garante que as OSs foram carregadas
        if (preselectedAction) {
            selectApiAction(preselectedAction);
        }
        if (preselectedOsIndexEncoded) {
            try {
                const preselectedOsIndex = atob(preselectedOsIndexEncoded); // Decodifica o índice
                const osSelector = document.getElementById('osSelector');
                // Encontra a opção correspondente ao índice e a seleciona
                const optionToSelect = Array.from(osSelector.options).find(option => option.value === preselectedOsIndex);
                if (optionToSelect) {
                    osSelector.value = preselectedOsIndex;
                    loadOsDetails(); // Carrega os detalhes da OS pré-selecionada
                }
            } catch (e) {
                console.error("Erro ao decodificar osIndex:", e);
            }
        }
    });
});

async function loadAvailableOrders() {
    const osSelector = document.getElementById('osSelector');
    osSelector.innerHTML = '<option value="">Carregando OSs...</option>';

    try {
        const response = await fetch('/api/ordens-servico');
        const data = await response.json();

        if (data.status === 'sucesso' && data.orders && data.orders.length > 0) {
            availableOrders = data.orders;
            osSelector.innerHTML = '<option value="">-- Selecione uma OS --</option>';
            availableOrders.forEach((order, index) => {
                const option = document.createElement('option');
                option.value = index; // Usamos o índice para facilitar a recuperação do objeto
                option.textContent = `OS: ${order.orderId} - ${order.productName} (${order.ambiente})`;
                osSelector.appendChild(option);
            });
        } else {
            osSelector.innerHTML = '<option value="">Nenhuma OS disponível</option>';
            showMessage('info', 'Nenhuma Ordem de Serviço criada ainda. Crie uma no "Bolsão de OS" para usar esta funcionalidade.');
        }
    } catch (error) {
        osSelector.innerHTML = '<option value="">Erro ao carregar OSs</option>';
        showMessage('error', `Erro ao carregar Ordens de Serviço: ${error.message}`);
        console.error('[APIs] Erro ao carregar OSs:', error);
    }
}

function selectApiAction(action) {
    selectedApiAction = action;
    const apiActionForm = document.getElementById('apiActionForm');
    const actionTitle = document.getElementById('actionTitle');
    const buttonActionText = document.getElementById('buttonActionText');

    apiActionForm.style.display = 'block'; // Exibe o formulário

    let titleText = '';
    let buttonText = '';
    switch (action) {
        case 'bloqueioParcial':
            titleText = 'Bloqueio Parcial';
            buttonText = 'Bloqueio Parcial';
            break;
        case 'bloqueioTotal':
            titleText = 'Bloqueio Total';
            buttonText = 'Bloqueio Total';
            break;
        case 'desbloqueio':
            titleText = 'Desbloqueio';
            buttonText = 'Desbloqueio';
            break;
    }
    actionTitle.textContent = titleText;
    buttonActionText.textContent = titleText; // Atualiza o texto do botão

    // Limpa mensagens anteriores
    hideMessage();
    // Reseta a seleção da OS e os detalhes
    document.getElementById('osSelector').value = '';
    document.getElementById('osDetails').innerHTML = '<p>Selecione uma OS para ver os detalhes.</p>';
    selectedOrder = null;

    // Garante que o campo manual esteja oculto e desmarcado ao selecionar uma nova ação
    const manualToggle = document.getElementById('manualSubscriberIdToggle');
    const manualGroup = document.getElementById('manualSubscriberIdGroup');
    const osSelector = document.getElementById('osSelector');

    manualToggle.checked = false;
    manualGroup.style.display = 'none';
    osSelector.disabled = false;
    document.getElementById('manualSubscriberIdInput').value = '';

    // NOVOS: Esconde os campos de CP e Ambiente manual
    document.getElementById('manualCpGroup').style.display = 'none';
    document.getElementById('manualAmbienteGroup').style.display = 'none';
}

function loadOsDetails() {
    const osSelector = document.getElementById('osSelector');
    const osDetailsDiv = document.getElementById('osDetails');
    const selectedIndex = osSelector.value; // selectedIndex será uma string

    // Desmarca o checkbox de Subscriber ID manual se uma OS for selecionada
    const manualToggle = document.getElementById('manualSubscriberIdToggle');
    const manualGroup = document.getElementById('manualSubscriberIdGroup');
    const manualCpGroup = document.getElementById('manualCpGroup'); // NOVO
    const manualAmbienteGroup = document.getElementById('manualAmbienteGroup'); // NOVO

    if (selectedIndex !== '') { // Apenas se algo foi selecionado
        manualToggle.checked = false;
        manualGroup.style.display = 'none';
        document.getElementById('manualSubscriberIdInput').value = '';
        // NOVOS: Esconde os campos de CP e Ambiente manual
        manualCpGroup.style.display = 'none';
        manualAmbienteGroup.style.display = 'none';
    }

    if (selectedIndex === '') {
        osDetailsDiv.innerHTML = '<p>Selecione uma OS para ver os detalhes.</p>';
        selectedOrder = null;
        return;
    }

    // CORREÇÃO AQUI: Converter selectedIndex para número
    selectedOrder = availableOrders[parseInt(selectedIndex)];

    if (selectedOrder) {
        const creationDate = new Date(selectedOrder.creationDate).toLocaleString('pt-BR', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const slotDate = new Date(selectedOrder.slotDate).toLocaleString('pt-BR', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        osDetailsDiv.innerHTML = `
            <p><strong>OS ID:</strong> ${selectedOrder.orderId}</p>
            <p><strong>CP:</strong> ${selectedOrder.cp}</p>
            <p><strong>Ambiente:</strong> ${selectedOrder.ambiente}</p>
            <p><strong>Subscriber ID:</strong> ${selectedOrder.subscriberId}</p>
            <p><strong>Produto:</strong> ${selectedOrder.productName} (${selectedOrder.productCatalogId})</p>
            <p><strong>Endereço:</strong> ${selectedOrder.address.streetName}, ${selectedOrder.address.streetNr} - ${selectedOrder.address.neighborhood}</p>
            <p><strong>Agendamento:</strong> ${slotDate}</p>
            <p><strong>Criado em:</strong> ${creationDate}</p>
        `;
    } else {
        osDetailsDiv.innerHTML = '<p>Detalhes da OS não encontrados.</p>';
        console.error('[APIs] selectedOrder é null ou undefined para o índice:', selectedIndex);
    }
    hideMessage();
}

// NOVA FUNÇÃO: Alterna a visibilidade do campo de Subscriber ID manual
function toggleManualSubscriberId() {
    const manualToggle = document.getElementById('manualSubscriberIdToggle');
    const manualGroup = document.getElementById('manualSubscriberIdGroup');
    const osSelector = document.getElementById('osSelector');
    const osDetailsDiv = document.getElementById('osDetails');
    const manualCpGroup = document.getElementById('manualCpGroup'); // NOVO
    const manualAmbienteGroup = document.getElementById('manualAmbienteGroup'); // NOVO

    if (manualToggle.checked) {
        manualGroup.style.display = 'block';
        osSelector.disabled = true; // Desabilita a seleção de OS se for usar manual
        osSelector.value = ''; // Limpa a seleção da OS
        osDetailsDiv.innerHTML = '<p>Subscriber ID manual será utilizado.</p>';
        selectedOrder = null; // Limpa a OS selecionada

        // NOVOS: Mostra os campos de CP e Ambiente manual
        manualCpGroup.style.display = 'block';
        manualAmbienteGroup.style.display = 'block';
    } else {
        manualGroup.style.display = 'none';
        osSelector.disabled = false; // Habilita a seleção de OS
        document.getElementById('manualSubscriberIdInput').value = ''; // Limpa o campo manual
        osDetailsDiv.innerHTML = '<p>Selecione uma OS para ver os detalhes.</p>';

        // NOVOS: Esconde os campos de CP e Ambiente manual
        manualCpGroup.style.display = 'none';
        manualAmbienteGroup.style.display = 'none';
    }
    hideMessage(); // Limpa mensagens ao alternar
}


async function executeApiAction() {
    const manualToggle = document.getElementById('manualSubscriberIdToggle');
    const manualSubscriberIdInput = document.getElementById('manualSubscriberIdInput');
    const manualCpInput = document.getElementById('manualCpInput'); // NOVO
    const manualAmbienteSelect = document.getElementById('manualAmbienteSelect'); // NOVO

    let currentSubscriberId = '';
    let currentCp = '';
    let currentAmbiente = '';
    let orderForPayload = null; // A OS que será usada para preencher o payload (pode ser null se manual)

    if (manualToggle.checked) {
        currentSubscriberId = manualSubscriberIdInput.value.trim();
        currentCp = manualCpInput.value.trim(); // NOVO: Pega o CP do input manual
        currentAmbiente = manualAmbienteSelect.value; // NOVO: Pega o Ambiente do select manual

        if (!currentSubscriberId) {
            showMessage('warning', 'Por favor, preencha o Subscriber ID manual.');
            return;
        }
        // NOVO: Valida CP e Ambiente manual
        if (!currentCp) {
            showMessage('warning', 'Por favor, preencha o CP manual.');
            return;
        }
        if (!currentAmbiente) {
            showMessage('warning', 'Por favor, selecione o Ambiente manual.');
            return;
        }

        // Se usar manual, não há selectedOrder, então orderForPayload permanece null
        // e os valores de CP e Ambiente virão dos inputs manuais.

    } else {
        if (!selectedOrder) {
            showMessage('warning', 'Por favor, selecione uma Ordem de Serviço primeiro.');
            return;
        }
        currentSubscriberId = selectedOrder.subscriberId;
        currentCp = selectedOrder.cp;
        currentAmbiente = selectedOrder.ambiente;
        orderForPayload = selectedOrder;
    }

    if (!selectedApiAction) {
        showMessage('warning', 'Por favor, selecione uma ação de API (Bloqueio/Desbloqueio).');
        return;
    }

    const executeButton = document.getElementById('executeApiButton');
    const spinner = document.getElementById('apiSpinner');
    executeButton.disabled = true;
    spinner.style.display = 'inline-block';
    showMessage('info', 'Executando a operação, por favor aguarde...');

    // O payload agora precisa ser construído com base no subscriberId manual ou da OS
    const payload = buildPayload(selectedApiAction, orderForPayload, currentSubscriberId); // Passa o subscriberId explícito

    if (!payload) { // Caso buildPayload retorne null por falta de subscriberId
        showMessage('error', 'Erro: Não foi possível construir o payload. Subscriber ID ausente.');
        executeButton.disabled = false;
        spinner.style.display = 'none';
        return;
    }

    try {
        const response = await fetch('/api/execute-api-action', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: selectedApiAction,
                payload: payload,
                cp_selection: currentCp, // Usa o CP determinado
                ambiente: currentAmbiente // Usa o ambiente determinado
            }),
        });

        const data = await response.json();

        if (data.status === 'sucesso') {
            showMessage('success', `Operação de ${selectedApiAction} realizada com sucesso! Mensagem: ${data.message}`);
            console.log('Resposta da API:', data);
        } else {
            showMessage('error', `Erro ao executar ${selectedApiAction}: ${data.message || 'Erro desconhecido.'}`);
            console.error('Erro na API:', data);
        }
    } catch (error) {
        showMessage('error', `Erro de rede ao executar ${selectedApiAction}: ${error.message}`);
        console.error('[APIs] Erro de rede:', error);
    } finally {
        executeButton.disabled = false;
        spinner.style.display = 'none';
    }
}

// Ajustado para aceitar explicitSubscriberId e lidar com 'order' sendo null
function buildPayload(action, order, explicitSubscriberId = null) {
    // A data associada ao documento deve ser a data atual no formato ISO 8601
    const associatedDocumentDate = new Date().toISOString().slice(0, -5) + '-03:00'; // Ajusta para fuso horário -03:00

    // Determine qual subscriberId usar
    const finalSubscriberId = explicitSubscriberId || (order ? order.subscriberId : null);

    if (!finalSubscriberId) {
        console.error("Erro: Subscriber ID não disponível para construir o payload.");
        return null; // Retorna null para indicar que o payload não pode ser construído
    }

    const basePayload = {
        order: {
            // Se 'order' for null, usa finalSubscriberId como fallback para correlationOrder e associatedDocument
            correlationOrder: order ? (order.correlationOrder || finalSubscriberId) : finalSubscriberId,
            associatedDocument: order ? (order.associatedDocument || finalSubscriberId) : finalSubscriberId,
            associatedDocumentDate: associatedDocumentDate,
            type: "", // Será preenchido abaixo
            infraType: "FTTH", // Assumindo FTTH conforme seus exemplos
            customer: {
                // Tentar pegar da OS, senão usar valores padrão
                name: order ? order.customerName || "Thiales Teste" : "Thiales Teste",
                subscriberId: finalSubscriberId, // Usa o subscriberId determinado
                businessUnity: order ? order.businessUnity || "varejo" : "varejo",
                fantasyName: order ? order.fantasyName || "InterHome Internet" : "InterHome Internet",
                phoneNumber: {
                    phoneNumbers: order && order.phoneNumber ? order.phoneNumber.phoneNumbers : ["000000000", ""]
                },
                workContact: {
                    name: order && order.workContact ? order.workContact.name : "",
                    email: order && order.workContact ? order.workContact.email : "",
                    phone: order && order.workContact ? order.workContact.phone : ""
                }
            },
            addresses: {
                address: {
                    // Tentar pegar da OS, senão usar valores padrão
                    // AQUI ESTÁ A CORREÇÃO PRINCIPAL: Garantir id e inventoryId
                    id: order && order.address && order.address.id ? order.address.id : 330057, // Usar ID do endereço da OS, ou fallback
                    inventoryId: order && order.inventoryId ? order.inventoryId : "4627650", // Usar inventoryId da OS, ou fallback
                    reference: order && order.address && order.address.reference ? order.address.reference : "",
                    complement: {
                        complements: [
                            {
                                type: order && order.complement && order.complement.type ? order.complement.type : "",
                                value: order && order.complement && order.complement.value ? order.complement.value : ""
                            }
                        ]
                    }
                }
            },
            products: {
                product: [
                    {
                        // Tentar pegar da OS, senão usar valor padrão
                        catalogId: order ? order.productCatalogId : "BL_300MB",
                        action: "" // Será preenchido abaixo
                    }
                ]
            }
        }
    };

    switch (action) {
        case 'bloqueioParcial':
            basePayload.order.type = "Bloqueio";
            basePayload.order.products.product[0].action = "bloquear parcial";
            break;
        case 'bloqueioTotal':
            basePayload.order.type = "Bloqueio";
            basePayload.order.products.product[0].action = "bloquear total";
            break;
        case 'desbloqueio':
            basePayload.order.type = "Desbloqueio";
            basePayload.order.products.product[0].action = "desbloquear total";
            break;
    }

    return basePayload;
}

function showMessage(type, text) {
    const apiMessage = document.getElementById('apiMessage');
    apiMessage.className = `message ${type}`;
    apiMessage.textContent = text;
    apiMessage.style.display = 'block';
}

function hideMessage() {
    const apiMessage = document.getElementById('apiMessage');
    apiMessage.style.display = 'none';
}