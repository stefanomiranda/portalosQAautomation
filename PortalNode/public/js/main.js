// main.js
let currentCpSelection = '';
let currentAddressId = null;
let currentEnderecoDetalhes = null; // Para armazenar o objeto completo do endereço
let currentComplementoSelecionado = null;
let currentAccessToken = null;
let currentSubscriberId = null;
let currentProdutosDisponiveis = []; // Lista de produtos retornados pela viabilidade
let currentProdutoSelecionado = null;
let currentSlotsDisponiveis = []; // Lista de slots retornados
let currentSlotSelecionado = null;
let currentAgendamentoId = null; // ID retornado após agendar o slot
let currentInventoryId = null;

document.addEventListener('DOMContentLoaded', () => {
    loadCps();
    // Inicializa a primeira seção visível
    showSection('addressConsultation');
});

function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(section => {
        section.classList.add('hidden');
    });
    document.getElementById(sectionId).classList.remove('hidden');
    showMessage('', 'info', true); // Limpa mensagens ao mudar de seção
}

function showMessage(message, type, clear = false) {
    const messageDivs = document.querySelectorAll('.message');
    messageDivs.forEach(msgDiv => {
        if (clear) {
            msgDiv.classList.add('hidden');
            msgDiv.textContent = '';
            msgDiv.classList.remove('success', 'error', 'info');
        } else {
            msgDiv.classList.remove('hidden');
            msgDiv.textContent = message;
            msgDiv.classList.remove('success', 'error', 'info');
            msgDiv.classList.add(type);
        }
    });
}

async function loadCps() {
    const cpSelect = document.getElementById('cpSelect');
    try {
        const response = await fetch('/api/cps');
        const cps = await response.json();
        cpSelect.innerHTML = '<option value="">Selecione um CP</option>';
        cps.forEach(cp => {
            const option = document.createElement('option');
            option.value = cp;
            option.textContent = cp;
            cpSelect.appendChild(option);
        });
        cpSelect.disabled = false;
    } catch (error) {
        console.error('Erro ao carregar CPs:', error);
        showMessage('Erro ao carregar CPs.', 'error');
    }
}

async function consultarEndereco() {
    currentCpSelection = document.getElementById('cpSelect').value;
    const cep = document.getElementById('cepInput').value;
    const numero = document.getElementById('numeroInput').value;

    if (!currentCpSelection || !cep || !numero) {
        showMessage('Por favor, selecione um CP, digite o CEP e o número.', 'error');
        return;
    }

    showMessage('Consultando endereço...', 'info');
    try {
        const response = await fetch('/api/consultar-endereco', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cp_selection: currentCpSelection, cep, numero })
        });
        const data = await response.json();

        if (data.status === 'sucesso') {
            showMessage('Endereço encontrado!', 'success');
            currentAddressId = data.addressId;
            currentEnderecoDetalhes = data.endereco; // Armazena os detalhes do endereço
            currentAccessToken = data.accessToken;
            currentSubscriberId = data.subscriberId;

            // Usa a descrição completa do endereço que vem do backend
            document.getElementById('enderecoDisplay').textContent = data.endereco.description;

            displayComplementos(data.complementos);
            // showSection('complementSelection'); // Já é chamado dentro de displayComplementos
        } else {
            showMessage(`Erro ao consultar endereço: ${data.message}`, 'error');
        }
    } catch (error) {
        console.error('Erro ao consultar endereço:', error);
        showMessage('Erro ao consultar endereço.', 'error');
    }
}

function displayComplementos(complementos) {
    const complementListDiv = document.getElementById('complementList');
    const confirmComplementBtn = document.getElementById('confirmComplementBtn');
    complementListDiv.innerHTML = ''; // Limpa a lista anterior
    confirmComplementBtn.disabled = true; // Desabilita o botão até um complemento ser selecionado

    // Garante que a seção de complemento seja exibida
    showSection('complementSelection');

    if (complementos.length === 0) {
        complementListDiv.innerHTML = '<p>Nenhum complemento encontrado para este endereço.</p>';
        // Se não há complementos, permite que o usuário avance sem selecionar um
        confirmComplementBtn.disabled = false;
        // Define currentComplementoSelecionado como nulo ou um objeto vazio para indicar que não há seleção
        currentComplementoSelecionado = { id: null, type: 'N/A', description: 'N/A', value: '' };
        return;
    }

    // Adiciona uma opção para "Nenhum Complemento" se o usuário quiser ignorar
    const noComplementOption = document.createElement('div');
    noComplementOption.classList.add('complement-item');
    noComplementOption.textContent = 'Nenhum Complemento';
    noComplementOption.addEventListener('click', () => {
        document.querySelectorAll('.complement-item').forEach(item => item.classList.remove('selected'));
        noComplementOption.classList.add('selected');
        confirmComplementBtn.disabled = false;
        currentComplementoSelecionado = { id: null, type: 'N/A', description: 'N/A', value: '' };
    });
    complementListDiv.appendChild(noComplementOption);


    complementos.forEach(comp => {
        const complementItem = document.createElement('div');
        complementItem.classList.add('complement-item');

        // Acessa as propriedades diretamente do objeto 'comp'
        complementItem.textContent = `${comp.type}: ${comp.value} (${comp.description})`;

        // Armazena o objeto completo do complemento no dataset para fácil recuperação
        complementItem.dataset.complemento = JSON.stringify(comp);

        complementItem.addEventListener('click', () => {
            document.querySelectorAll('.complement-item').forEach(item => item.classList.remove('selected'));
            complementItem.classList.add('selected');
            confirmComplementBtn.disabled = false;
            currentComplementoSelecionado = JSON.parse(complementItem.dataset.complemento);
        });
        complementListDiv.appendChild(complementItem);
    });
}

function displayProducts(products) {
    const productListDiv = document.getElementById('productList');
    productListDiv.innerHTML = ''; // Limpa a lista anterior

    if (!products || products.length === 0) {
        productListDiv.innerHTML = '<p>Nenhum produto disponível para este endereço.</p>';
        document.getElementById('confirmProductBtn').disabled = true;
        return;
    }

    products.forEach(product => {
        const productItem = document.createElement('div');
        productItem.className = 'product-item';
        productItem.dataset.catalogId = product.catalogId;
        productItem.dataset.name = product.name;
        productItem.dataset.type = product.type;
        productItem.dataset.technology = product.technology;
        productItem.dataset.inventoryId = product.inventoryId; 

        let bestOfferTag = '';
        if (product.best_offer) {
            bestOfferTag = '<span class="best-offer-tag">Melhor Oferta!</span>';
        }

        productItem.innerHTML = `
            <h3>${product.name} (${product.catalogId}) ${bestOfferTag}</h3>
            <p>Tipo: ${product.type} | Tecnologia: ${product.technology}</p>
        `;

        productItem.addEventListener('click', () => {
            // Remove a seleção de todos os outros produtos
            document.querySelectorAll('.product-item').forEach(item => {
                item.classList.remove('selected');
            });
            // Adiciona a seleção ao item clicado
            productItem.classList.add('selected');
            document.getElementById('confirmProductBtn').disabled = false;
            currentProdutoSelecionado = {
            catalogId: productItem.dataset.catalogId,
            name: productItem.dataset.name,
            type: productItem.dataset.type,
            technology: productItem.dataset.technology,
            inventoryId: productItem.dataset.inventoryId // <--- ISSO É CRUCIAL!
        };
    });
        productListDiv.appendChild(productItem);
    });
}

function displaySlots(slots) {
    const slotListDiv = document.getElementById('slotList');
    slotListDiv.innerHTML = ''; // Limpa a lista anterior

    if (!slots || slots.length === 0) {
        slotListDiv.innerHTML = '<p>Nenhum slot de instalação disponível para este produto.</p>';
        document.getElementById('confirmSlotBtn').disabled = true;
        return;
    }

    slots.forEach(slot => {
        const slotItem = document.createElement('div');
        slotItem.classList.add('slot-item');
        slotItem.dataset.id = slot.id;
        slotItem.dataset.startDate = slot.startDate;
        slotItem.dataset.finishDate = slot.finishDate;

        // Formatar as datas para exibição
        const startDate = new Date(slot.startDate);
        const finishDate = new Date(slot.finishDate);

        const optionsDate = { year: 'numeric', month: 'long', day: 'numeric' };
        const optionsTime = { hour: '2-digit', minute: '2-digit' };

        const formattedDate = startDate.toLocaleDateString('pt-BR', optionsDate);
        const formattedStartTime = startDate.toLocaleTimeString('pt-BR', optionsTime);
        const formattedFinishTime = finishDate.toLocaleTimeString('pt-BR', optionsTime);

        slotItem.innerHTML = `
            <span>**Data:** ${formattedDate}</span>
            <span>**Horário:** ${formattedStartTime} - ${formattedFinishTime}</span>
        `;

        slotItem.addEventListener('click', () => {
            // Remove a seleção de outros slots
            document.querySelectorAll('.slot-item').forEach(item => item.classList.remove('selected'));
            // Adiciona a seleção ao slot clicado
            slotItem.classList.add('selected');
            // Habilita o botão de confirmação
            document.getElementById('confirmSlotBtn').disabled = false;

            // Armazena o slot selecionado em uma variável global
            currentSlotSelecionado = {
                id: slotItem.dataset.id,
                startDate: slotItem.dataset.startDate,
                finishDate: slotItem.dataset.finishDate
            };
        });
        slotListDiv.appendChild(slotItem);
    });
}

async function confirmarComplemento() {
    // Se currentComplementoSelecionado for null ou o objeto vazio de "Nenhum Complemento", está tudo bem.
    // A validação agora é feita na seleção do item.
    if (!currentComplementoSelecionado) {
        showMessage('Por favor, selecione um complemento ou a opção "Nenhum Complemento".', 'error');
        return;
    }

    showMessage('Complemento selecionado. Verificando disponibilidade...', 'info');
    await verificarDisponibilidade();
}

async function verificarDisponibilidade() {
    showMessage('Verificando disponibilidade...', 'info');
    try {
        const response = await fetch('/api/verificar-disponibilidade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cp_selection: currentCpSelection,
                addressId: currentAddressId,
                complementoSelecionado: currentComplementoSelecionado,
                accessToken: currentAccessToken,
                subscriberId: currentSubscriberId
            })
        });

        // Adicionando as verificações robustas que discutimos
        if (!response) {
            throw new Error('Nenhuma resposta recebida do servidor.');
        }

        if (!response.ok) {
            const errorText = await response.text(); // Tenta ler como texto para depuração
            console.error('[FRONTEND] Erro HTTP na resposta da viabilidade:', response.status, errorText);
            throw new Error(`Erro HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('[FRONTEND] Dados recebidos da verificação de disponibilidade:', data); // Log crucial

        if (data && data.status === 'sucesso') {
            displayProducts(data.products);
            currentInventoryId = data.inventoryId; // Salvar inventoryId
            showSection('productSelection');
            showMessage('Disponibilidade verificada. Escolha um produto.', 'success');
        }else {
            showMessage(`Erro ao verificar disponibilidade: ${data ? data.message : 'Resposta inválida do servidor.'}`, 'error');
        }
    } catch (error) {
        console.error('Erro ao verificar disponibilidade:', error);
        showMessage('Erro ao verificar disponibilidade: ' + error.message, 'error');
    }
}

async function confirmarProduto() {
    if (!currentProdutoSelecionado) {
        showMessage('Por favor, selecione um produto.', 'error');
        return;
    }
    showMessage('Produto selecionado. Buscando slots de agendamento...', 'info');
    await buscarSlots();
}

async function buscarSlots() {
    showMessage('Buscando slots de instalação...', 'info');
    try {
        const response = await fetch('/api/buscar-slots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cp_selection: currentCpSelection,
                addressId: currentAddressId,
                subscriberId: currentSubscriberId,
                productType: currentProdutoSelecionado.type, // Usar o tipo do produto selecionado
                accessToken: currentAccessToken
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Erro HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('[FRONTEND] Dados recebidos da busca de slots:', data); // Log para verificar a estrutura

        if (data.status === 'sucesso' && data.slots) { // Verificar se data.slots existe
            displaySlots(data.slots); // Passar o array de slots
            showSection('slotSelection');
            showMessage('Slots disponíveis carregados. Escolha um horário.', 'success');
        } else {
            showMessage(`Erro ao buscar slots: ${data.message || 'Nenhum slot disponível ou resposta inválida.'}`, 'error');
        }
    } catch (error) {
        console.error('Erro ao buscar slots:', error);
        showMessage('Erro ao buscar slots: ' + error.message, 'error');
    }
}

function displaySlots(slots) {
    const slotListDiv = document.getElementById('slotList');
    slotListDiv.innerHTML = '';
    document.getElementById('confirmSlotBtn').disabled = true;

    if (slots.length === 0) {
        slotListDiv.innerHTML = '<p>Nenhum slot de agendamento disponível para este produto.</p>';
        return;
    }

    slots.forEach(slot => {
        const div = document.createElement('div');
        div.classList.add('slot-item');
        div.dataset.id = slot.id;
        div.dataset.startDate = slot.startDate;
        div.dataset.finishDate = slot.finishDate;

        const startDate = new Date(slot.startDate);
        const finishDate = new Date(slot.finishDate);

        const options = {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
            hour12: false // Formato 24h
        };
        const formattedStartDate = startDate.toLocaleString('pt-BR', options);
        const formattedFinishDate = finishDate.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });

        div.innerHTML = `
            <span><strong>Data:</strong> ${formattedStartDate.split(' ')[0]} ${formattedStartDate.split(' ')[1]} ${formattedStartDate.split(' ')[2]}</span>
            <span><strong>Horário:</strong> ${formattedStartDate.split(' ')[3]} - ${formattedFinishDate}</span>
        `;
        div.addEventListener('click', () => {
            document.querySelectorAll('.slot-item').forEach(item => item.classList.remove('selected'));
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
    showMessage('Slot selecionado. Agendando...', 'info');
    await agendarSlotSelecionado();
}

async function agendarSlotSelecionado() {
    try {
        const response = await fetch('/api/agendar-slot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cp_selection: currentCpSelection,
                slotId: currentSlotSelecionado.id,
                accessToken: currentAccessToken
            })
        });
        const data = await response.json();
        console.log('[FRONTEND] Resposta completa do agendamento:', data);

        if (data.status === 'sucesso') {
            showMessage('Slot agendado com sucesso!', 'success');
            // AQUI ESTÁ A MUDANÇA!
            currentAgendamentoId = data.agendamentoId; // <--- AGORA ACESSAMOS DIRETAMENTE 'agendamentoId'
            if (!currentAgendamentoId) {
                console.error('[FRONTEND] ID do agendamento não encontrado na resposta:', data);
                throw new Error('ID do agendamento não encontrado na resposta do servidor.');
            }
            displayOrderConfirmation();
            showSection('orderConfirmation');
        } else {
            showMessage(`Erro ao agendar slot: ${data.message}`, 'error');
        }
    } catch (error) {
        console.error('Erro ao agendar slot:', error);
        showMessage('Erro ao agendar slot: ' + error.message, 'error');
    }
}

function displayOrderConfirmation() {
    document.getElementById('confirmAddress').textContent =
        `${currentEnderecoDetalhes.streetName}, ${currentEnderecoDetalhes.streetNr} - ${currentEnderecoDetalhes.neighborhood}, ${currentEnderecoDetalhes.locality} - ${currentEnderecoDetalhes.stateOrProvince}, ${currentEnderecoDetalhes.postcode}`;
    document.getElementById('confirmComplement').textContent =
        currentComplementoSelecionado && currentComplementoSelecionado.value ? `${currentComplementoSelecionado.type}: ${currentComplementoSelecionado.value}` : 'N/A';
    document.getElementById('confirmProduct').textContent =
        `${currentProdutoSelecionado.name} (${currentProdutoSelecionado.catalogId}) - Tecnologia: ${currentProdutoSelecionado.technology}`;

    const startDate = new Date(currentSlotSelecionado.startDate);
    const finishDate = new Date(currentSlotSelecionado.finishDate);
    const options = {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
        hour12: false
    };
    const formattedStartDate = startDate.toLocaleString('pt-BR', options);
    const formattedFinishDate = finishDate.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });

    document.getElementById('confirmSlot').textContent =
        `${formattedStartDate.split(' ')[0]} ${formattedStartDate.split(' ')[1]} ${formattedStartDate.split(' ')[2]} das ${formattedStartDate.split(' ')[3]} às ${formattedFinishDate}`;
}

async function criarOrdemDeServico() {
    if (!currentAgendamentoId) {
        showMessage('Erro: Agendamento não confirmado. Por favor, volte e selecione um slot.', 'error');
        return;
    }

    showMessage('Criando Ordem de Serviço...', 'info');
    try {
        const response = await fetch('/api/criar-os', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cp_selection: currentCpSelection,
                addressId: currentAddressId,
                complementoSelecionado: currentComplementoSelecionado,
                produtoSelecionado: currentProdutoSelecionado,
                slotSelecionado: currentSlotSelecionado,
                agendamentoId: currentAgendamentoId,
                accessToken: currentAccessToken,
                subscriberId: currentSubscriberId,
                inventoryId: currentInventoryId,
                enderecoDetalhes: currentEnderecoDetalhes // <--- ADICIONADO AQUI!
            })
        });
        const data = await response.json();

        if (data.status === 'sucesso') {
            showMessage(`Ordem de Serviço criada com sucesso! ID da OS: ${data.orderId}`, 'success');
            document.getElementById('finalOrderId').textContent = data.orderId;
            document.getElementById('finalSaId').textContent = data.saId;
            document.getElementById('finalAssociatedDocument').textContent = data.associatedDocument;
            document.getElementById('createOrderBtn').disabled = true;
        } else {
            showMessage(`Erro ao criar Ordem de Serviço: ${data.message}`, 'error');
        }
    } catch (error) {
        console.error('Erro ao criar Ordem de Serviço:', error);
        showMessage('Erro ao criar Ordem de Serviço.', 'error');
    }
}

// main.js - Adicione esta função ao final do arquivo, ou onde preferir
function resetFlow() {
    // Limpar variáveis globais
    currentCpSelection = '';
    currentAddressId = null;
    currentEnderecoDetalhes = null;
    currentComplementoSelecionado = null;
    currentAccessToken = null;
    currentSubscriberId = null;
    currentProdutosDisponiveis = [];
    currentProdutoSelecionado = null;
    currentSlotsDisponiveis = [];
    currentSlotSelecionado = null;
    currentAgendamentoId = null;
    currentInventoryId = null; // Limpar também o inventoryId

    // Limpar campos do formulário
    document.getElementById('cpSelect').value = '';
    document.getElementById('cepInput').value = '';
    document.getElementById('numeroInput').value = '';

    // Limpar displays
    document.getElementById('enderecoDisplay').textContent = '';
    document.getElementById('complementList').innerHTML = '';
    document.getElementById('productList').innerHTML = '';
    document.getElementById('slotList').innerHTML = '';
    document.getElementById('finalOrderId').textContent = ''; // Limpar o ID da OS final

    // Reabilitar botões (se necessário, dependendo do fluxo inicial)
    document.getElementById('createOrderBtn').disabled = false;
    document.getElementById('confirmComplementBtn').disabled = true;
    document.getElementById('confirmProductBtn').disabled = true;
    document.getElementById('confirmSlotBtn').disabled = true;

    // Voltar para a primeira seção
    showSection('addressConsultation');
    showMessage('', 'info', true); // Limpar todas as mensagens
}