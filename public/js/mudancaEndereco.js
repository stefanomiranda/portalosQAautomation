// public/js/mudancaEndereco.js
//
// Frontend do fluxo de Mudança de Endereço.
// As variáveis globais abaixo são declaradas em main.js (carregado ANTES deste
// arquivo). O comentário /* global */ silencia o aviso de "implicit global"
// do editor (VSCode/ESLint) sem alterar o comportamento em runtime.

/* global currentAmbiente, currentCpSelection, currentAddressId,
           currentEnderecoDetalhes, currentAccessToken, currentInventoryId,
           currentComplementoSelecionado, currentProdutoSelecionado,
           currentSlotSelecionado, currentAgendamentoId, currentNewSubscriberId,
           currentOldSubscriberId, currentInstalacaoResult */

(function () {
    'use strict';

    function getEl(id) { return document.getElementById(id); }

    function showMsg(el, message, type) {
        if (!el) return;
        el.classList.remove('hidden', 'success', 'error', 'info');
        el.classList.add(type || 'info');
        el.textContent = message;
    }
    function clearMsg(el) {
        if (!el) return;
        el.classList.add('hidden');
        el.textContent = '';
    }

    function getProductType(produto) {
        if (!produto) return '';
        return (
            produto.productType ||
            produto.type ||
            produto.technology ||
            produto.name ||
            ''
        );
    }

    document.addEventListener('DOMContentLoaded', () => {
        const cpSelect                  = getEl('cpSelect');
        const oldSubscriberIdInput      = getEl('oldSubscriberId');
        const cepInput                  = getEl('cepInput');
        const numeroInput               = getEl('numeroInput');

        const consultarEnderecoBtn      = getEl('consultarEnderecoBtn');
        const verificarDisponibilidadeBtn = getEl('verificarDisponibilidadeBtn');
        const buscarSlotsBtn            = getEl('buscarSlotsBtn');
        const agendarSlotBtn            = getEl('agendarSlotBtn');
        const criarOsBtn                = getEl('criarOsBtn');
        const criarRetiradaBtn          = getEl('criarRetiradaBtn');

        const statusMessage             = getEl('statusMessage');
        const enderecoInfo              = getEl('enderecoInfo');
        const newSubscriberInfo         = getEl('newSubscriberInfo');
        const confirmacaoOs             = getEl('confirmacaoOs');
        const confirmacaoRetirada       = getEl('confirmacaoRetirada');

        const complementoSection        = getEl('complementoSection');
        const complementosList          = getEl('complementosList');
        const produtoSection            = getEl('produtoSection');
        const produtosList              = getEl('produtosList');
        const slotSection               = getEl('slotSection');
        const slotsList                 = getEl('slotsList');
        const osSection                 = getEl('osSection');
        const retiradaSection           = getEl('retiradaSection');

        const homeBtn = getEl('homeBtn');
        if (homeBtn && typeof currentAmbiente !== 'undefined') {
            homeBtn.href = `index.html?ambiente=${currentAmbiente}`;
        }

        async function carregarCps() {
            const resp = await fetch('/api/cps');
            const cps = await resp.json();
            cpSelect.innerHTML = '<option value="">Selecione um CP</option>';
            cps.forEach(cp => {
                const o = document.createElement('option');
                o.value = cp;
                o.textContent = cp;
                cpSelect.appendChild(o);
            });
        }

        // ─── Bolsão de OSs criadas pelo PortalNode ────────────────────
        const bolsaoOsSelect = getEl('bolsaoOsSelect');
        async function carregarBolsao() {
            if (!bolsaoOsSelect) return;
            try {
                const resp = await fetch(`/api/orders?ambiente=${encodeURIComponent(currentAmbiente)}`);
                const data = await resp.json();
                const orders = (data && (data.orders || data.data)) || [];

                bolsaoOsSelect.innerHTML = '<option value="">— Selecione uma OS do bolsão (opcional) —</option>';

                if (orders.length === 0) {
                    const opt = document.createElement('option');
                    opt.value = '';
                    opt.textContent = 'Nenhuma OS no bolsão deste ambiente';
                    opt.disabled = true;
                    bolsaoOsSelect.appendChild(opt);
                    return;
                }

                orders.forEach((o, idx) => {
                    const opt = document.createElement('option');
                    opt.value = String(o.subscriberId || o.saId || o.orderId || idx);
                    const flowLabel = o.flowType ? ` [${o.flowType}]` : '';
                    const ambLabel  = o.ambiente ? ` • ${o.ambiente}` : '';
                    const subLabel  = o.subscriberId ? ` • SUB ${o.subscriberId}` : '';
                    const saLabel   = o.saId ? ` • SA ${o.saId}` : '';
                    opt.textContent = `${o.orderId || ('OS#' + idx)}${subLabel}${saLabel}${flowLabel}${ambLabel}`;
                    opt.dataset.order = JSON.stringify(o);
                    bolsaoOsSelect.appendChild(opt);
                });
            } catch (err) {
                if (bolsaoOsSelect) {
                    bolsaoOsSelect.innerHTML = '<option value="">Erro ao carregar bolsão</option>';
                }
            }
        }

        if (bolsaoOsSelect && oldSubscriberIdInput) {
            bolsaoOsSelect.addEventListener('change', () => {
                const selectedOption = bolsaoOsSelect.options[bolsaoOsSelect.selectedIndex];
                if (!selectedOption || !selectedOption.dataset.order) return;
                try {
                    const order = JSON.parse(selectedOption.dataset.order);
                    const sub = order.subscriberId || order.subscriberIdOld;
                    if (sub && oldSubscriberIdInput) {
                        oldSubscriberIdInput.value = sub;
                        oldSubscriberIdInput.readOnly = true;
                        oldSubscriberIdInput.style.background = '#f8f9fa';
                    }
                } catch (_) {}
            });
        }

        function renderComplementos(complementos) {
            complementosList.innerHTML = '';
            const semComp = document.createElement('div');
            semComp.className = 'complement-item selected';
            semComp.textContent = 'Sem complemento';
            semComp.addEventListener('click', () => {
                document.querySelectorAll('.complement-item').forEach(i => i.classList.remove('selected'));
                semComp.classList.add('selected');
                currentComplementoSelecionado = null;
            });
            complementosList.appendChild(semComp);
            currentComplementoSelecionado = null;

            (complementos || []).forEach(comp => {
                const item = document.createElement('div');
                item.className = 'complement-item';
                item.textContent = `${comp.type}: ${comp.value}`;
                item.addEventListener('click', () => {
                    document.querySelectorAll('.complement-item').forEach(i => i.classList.remove('selected'));
                    item.classList.add('selected');
                    currentComplementoSelecionado = comp;
                });
                complementosList.appendChild(item);
            });
        }

        function renderProdutos(produtos) {
            produtosList.innerHTML = '';
            currentProdutoSelecionado = null;
            if (buscarSlotsBtn) buscarSlotsBtn.disabled = true;

            (produtos || []).forEach(prod => {
                const card = document.createElement('div');
                card.className = 'product-item';
                card.innerHTML = `
                    <h3>${prod.name || 'Produto'}</h3>
                    <p>CatalogId: ${prod.catalogId || '-'}</p>
                `;
                card.addEventListener('click', () => {
                    document.querySelectorAll('.product-item').forEach(i => i.classList.remove('selected'));
                    card.classList.add('selected');
                    currentProdutoSelecionado = prod;
                    if (buscarSlotsBtn) buscarSlotsBtn.disabled = false;
                });
                produtosList.appendChild(card);
            });
        }

        function renderSlots(slots) {
            slotsList.innerHTML = '';
            currentSlotSelecionado = null;
            if (agendarSlotBtn) agendarSlotBtn.disabled = true;
            if (criarOsBtn)     criarOsBtn.disabled = true;

            if (!slots || slots.length === 0) {
                slotsList.innerHTML = '<p>Nenhum slot de agendamento disponível para este produto.</p>';
                return;
            }

            (slots || []).forEach(slot => {
                const card = document.createElement('div');
                card.className = 'slot-item';
                card.dataset.id         = slot.id;
                card.dataset.startDate  = slot.startDate;
                card.dataset.finishDate = slot.finishDate;

                const startDate  = new Date(slot.startDate);
                const finishDate = new Date(slot.finishDate);

                const formattedDate  = startDate.toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' });
                const formattedStart = startDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
                const formattedEnd   = finishDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });

                card.innerHTML = `
                    <span><strong>📅 Data:</strong> ${formattedDate}</span>
                    <span><strong>🕐 Horário:</strong> ${formattedStart} - ${formattedEnd}</span>
                `;

                card.addEventListener('click', () => {
                    document.querySelectorAll('.slot-item').forEach(i => i.classList.remove('selected'));
                    card.classList.add('selected');
                    currentSlotSelecionado = slot;
                    if (agendarSlotBtn) agendarSlotBtn.disabled = false;
                });

                slotsList.appendChild(card);
            });
        }

        // ─── 1) Consultar endereço NOVO ─────────────────────────────────
        if (consultarEnderecoBtn) {
            consultarEnderecoBtn.addEventListener('click', async () => {
                clearMsg(statusMessage);
                clearMsg(enderecoInfo);
                clearMsg(newSubscriberInfo);
                clearMsg(confirmacaoOs);
                clearMsg(confirmacaoRetirada);

                if (complementoSection) complementoSection.classList.add('hidden');
                if (produtoSection)     produtoSection.classList.add('hidden');
                if (slotSection)        slotSection.classList.add('hidden');
                if (osSection)          osSection.classList.add('hidden');
                if (retiradaSection)    retiradaSection.classList.add('hidden');

                currentCpSelection = cpSelect.value;
                const cep    = cepInput.value.trim();
                const numero = numeroInput.value.trim();

                if (!currentCpSelection || !cep || !numero) {
                    showMsg(statusMessage, 'CP, CEP e número são obrigatórios.', 'error');
                    return;
                }

                showMsg(statusMessage, `Consultando endereço no ambiente ${currentAmbiente}...`, 'info');

                try {
                    const resp = await fetch('/api/consultar-endereco', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            cp_selection: currentCpSelection,
                            cep,
                            numero,
                            ambiente: currentAmbiente
                        })
                    });
                    const data = await resp.json();
                    if (!resp.ok || data.status !== 'sucesso') {
                        throw new Error(data.message || 'Falha ao consultar endereço.');
                    }

                    currentAddressId         = data.addressId;
                    currentEnderecoDetalhes  = data.endereco;
                    currentAccessToken       = data.accessToken;

                    // ✅ Backend pode retornar subscriberId novo (caso ideal, ex.: TesteInst2003)
                    //    ou vir vazio — nesse caso, fallback com regra "+new" sobre o oldSubscriberId
                    if (data.subscriberId) {
                        currentNewSubscriberId = data.subscriberId;
                    } else {
                        const old = (currentOldSubscriberId || oldSubscriberIdInput.value || '').trim();
                        currentNewSubscriberId = old ? (old + 'new') : null;
                    }
                    currentOldSubscriberId = oldSubscriberIdInput.value.trim() || currentOldSubscriberId;

                    showMsg(
                        enderecoInfo,
                        `Endereço: ${data.endereco.description || `${data.endereco.streetName}, ${data.endereco.streetNr}`}`,
                        'info'
                    );
                    showMsg(
                        newSubscriberInfo,
                        `Novo SubscriberId gerado: ${currentNewSubscriberId}`,
                        'info'
                    );

                    renderComplementos(data.complementos || []);
                    if (complementoSection) complementoSection.classList.remove('hidden');

                    showMsg(statusMessage, 'Endereço consultado com sucesso.', 'success');
                } catch (err) {
                    showMsg(statusMessage, `Erro ao consultar endereço: ${err.message}`, 'error');
                }
            });
        }

        // ─── 2) Verificar disponibilidade ────────────────────────────────
        if (verificarDisponibilidadeBtn) {
            verificarDisponibilidadeBtn.addEventListener('click', async () => {
                clearMsg(statusMessage);
                if (produtoSection)  produtoSection.classList.add('hidden');
                if (slotSection)     slotSection.classList.add('hidden');
                if (osSection)       osSection.classList.add('hidden');
                if (retiradaSection) retiradaSection.classList.add('hidden');

                try {
                    const resp = await fetch('/api/verificar-disponibilidade', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            cp_selection: currentCpSelection,
                            addressId: currentAddressId,
                            complementoSelecionado: currentComplementoSelecionado,
                            accessToken: currentAccessToken,
                            subscriberId: currentNewSubscriberId,
                            ambiente: currentAmbiente
                        })
                    });

                    const data = await resp.json();
                    if (!resp.ok || data.status !== 'sucesso') {
                        throw new Error(data.message || 'Falha ao verificar disponibilidade.');
                    }

                    currentInventoryId = data.inventoryId;
                    renderProdutos(data.products || []);
                    if (produtoSection) produtoSection.classList.remove('hidden');

                    showMsg(statusMessage, 'Disponibilidade verificada com sucesso.', 'success');
                } catch (err) {
                    showMsg(statusMessage, `Erro na disponibilidade: ${err.message}`, 'error');
                }
            });
        }

        // ─── 3) Buscar slots (especializado mudança de endereço) ────────
        if (buscarSlotsBtn) {
            buscarSlotsBtn.addEventListener('click', async () => {
                clearMsg(statusMessage);
                if (slotSection)     slotSection.classList.add('hidden');
                if (osSection)       osSection.classList.add('hidden');
                if (retiradaSection) retiradaSection.classList.add('hidden');

                const oldSubscriberId            = oldSubscriberIdInput.value.trim();

                if (!oldSubscriberId) {
                    showMsg(
                        statusMessage,
                        'Informe o SubscriberId Antigo (ou selecione uma OS do bolsão).',
                        'error'
                    );
                    return;
                }

                const productType = getProductType(currentProdutoSelecionado);
                if (!productType) {
                    showMsg(statusMessage, 'Não foi possível identificar o productType do produto selecionado.', 'error');
                    return;
                }

                try {
                    const resp = await fetch('/api/mudanca-endereco/buscar-slots', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            cp_selection: currentCpSelection,
                            addressId: currentAddressId,
                            newSubscriberId: currentNewSubscriberId,
                            oldSubscriberId,
                            productType,
                            accessToken: currentAccessToken,
                            ambiente: currentAmbiente
                        })
                    });

                    const data = await resp.json();
                    if (!resp.ok || data.status !== 'sucesso') {
                        throw new Error(data.message || 'Falha ao buscar slots.');
                    }

                    renderSlots(data.slots || []);
                    if (slotSection) slotSection.classList.remove('hidden');

                    showMsg(statusMessage, 'Slots encontrados com sucesso.', 'success');
                } catch (err) {
                    showMsg(statusMessage, `Erro ao buscar slots: ${err.message}`, 'error');
                }
            });
        }

        // ─── 4) Agendar slot ────────────────────────────────────────────
        if (agendarSlotBtn) {
            agendarSlotBtn.addEventListener('click', async () => {
                clearMsg(statusMessage);
                if (osSection)       osSection.classList.add('hidden');
                if (retiradaSection) retiradaSection.classList.add('hidden');
                if (criarOsBtn)      criarOsBtn.disabled = true;

                try {
                    const resp = await fetch('/api/agendar-slot', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            cp_selection: currentCpSelection,
                            slotId: currentSlotSelecionado.id,
                            accessToken: currentAccessToken,
                            ambiente: currentAmbiente
                        })
                    });

                    const data = await resp.json();
                    if (!resp.ok || data.status !== 'sucesso') {
                        throw new Error(data.message || 'Falha ao agendar slot.');
                    }

                    currentAgendamentoId = data.agendamentoId;
                    if (osSection) osSection.classList.remove('hidden');
                    if (criarOsBtn) criarOsBtn.disabled = false;

                    showMsg(statusMessage, 'Slot agendado com sucesso.', 'success');
                } catch (err) {
                    showMsg(statusMessage, `Erro ao agendar slot: ${err.message}`, 'error');
                }
            });
        }

        // ─── 5) Criar OS de Instalação (mudança de endereço) ─────────────
        if (criarOsBtn) {
            criarOsBtn.addEventListener('click', async () => {
                clearMsg(statusMessage);
                clearMsg(confirmacaoOs);
                if (retiradaSection) retiradaSection.classList.add('hidden');
                if (criarRetiradaBtn) criarRetiradaBtn.disabled = true;

                const oldSubscriberId = oldSubscriberIdInput.value.trim();

                try {
                    const resp = await fetch('/api/mudanca-endereco/criar-os', {
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
                            newSubscriberId: currentNewSubscriberId,
                            oldSubscriberId,
                            inventoryId: currentInventoryId,
                            enderecoDetalhes: currentEnderecoDetalhes,
                            ambiente: currentAmbiente
                        })
                    });

                    const data = await resp.json();
                    if (!resp.ok || data.status !== 'sucesso') {
                        throw new Error(data.message || 'Falha ao criar OS.');
                    }

                    currentInstalacaoResult = {
                        orderId: data.orderId,
                        saId: data.saId,
                        associatedDocument: data.associatedDocument,
                        subscriberId: data.subscriberId
                    };

                    showMsg(
                        confirmacaoOs,
                        `OS de Instalação criada com sucesso! OrderId: ${data.orderId} | SA: ${data.saId} | AssociatedDocument: ${data.associatedDocument}`,
                        'success'
                    );
                    showMsg(statusMessage, 'Instalação concluída com sucesso. Você já pode criar a OS de Retirada abaixo.', 'success');

                    if (retiradaSection) {
                        retiradaSection.classList.remove('hidden');
                        if (criarRetiradaBtn) criarRetiradaBtn.disabled = false;
                        retiradaSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                } catch (err) {
                    showMsg(statusMessage, `Erro ao criar OS: ${err.message}`, 'error');
                }
            });
        }

        // ─── 6) Criar OS de Retirada (após sucesso da Instalação) ───────
        if (criarRetiradaBtn) {
            criarRetiradaBtn.addEventListener('click', async () => {
                clearMsg(statusMessage);
                clearMsg(confirmacaoRetirada);
                criarRetiradaBtn.disabled = true;

                const oldSubscriberId = oldSubscriberIdInput.value.trim();

                if (!oldSubscriberId) {
                    showMsg(statusMessage, 'SubscriberId Antigo é obrigatório para a Retirada.', 'error');
                    criarRetiradaBtn.disabled = false;
                    return;
                }

                showMsg(statusMessage, 'Criando OS de Retirada...', 'info');

                try {
                    const resp = await fetch('/api/mudanca-endereco/criar-retirada', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            cp_selection: currentCpSelection,
                            accessToken: currentAccessToken,
                            oldSubscriberId,
                            produtoSelecionado: currentProdutoSelecionado,
                            complementoSelecionado: currentComplementoSelecionado,
                            enderecoDetalhes: currentEnderecoDetalhes,
                            ambiente: currentAmbiente
                        })
                    });

                    const data = await resp.json();
                    if (!resp.ok || data.status !== 'sucesso') {
                        throw new Error(data.message || 'Falha ao criar OS de Retirada.');
                    }

                    showMsg(
                        confirmacaoRetirada,
                        `✅ OS de Retirada criada com sucesso! OrderId: ${data.orderId} | SA: ${data.saId} | AssociatedDocument: ${data.associatedDocument}`,
                        'success'
                    );
                    showMsg(statusMessage, 'Fluxo de mudança de endereço concluído com sucesso!', 'success');
                } catch (err) {
                    showMsg(statusMessage, `Erro ao criar OS de Retirada: ${err.message}`, 'error');
                    criarRetiradaBtn.disabled = false;
                }
            });
        }

        // ─── Init ───────────────────────────────────────────────────────
        carregarCps().catch(err => {
            showMsg(statusMessage, `Erro ao carregar CPs: ${err.message}`, 'error');
        });
        carregarBolsao();
    });
})();