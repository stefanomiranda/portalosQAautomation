// app.js
const express = require('express');
const path = require('path');
const { CLIENTS } = require('./clients');
const { getTokenForCp } = require('./core/auth');
const { buscarEndereco, buscarComplementos, verificarDisponibilidade } = require('./core/viabilidade');
const { buscarSlotsDisponiveis, agendarSlot } = require('./core/agendamento');
const { criarOrdemServico } = require('./core/ordemServico');
const multer = require('multer');
const { processarPlanilhaViabilidade } = require('./core/viabilidadeLoteProcessor');
const fetch = require('node-fetch');
const app = express();
const {
    buscarSlotsMudancaEndereco,
    criarOrdemServicoMudancaEndereco
} = require('./core/mudancaEndereco');
// ✅ OpenShift injeta a porta via process.env.PORT — fallback 8080 para local
const diagRepo = require('./core/repositories/diagnosticosRepo');
const ttRepo = require('./core/repositories/troubleTicketsRepo');
const { parametrizarMockViaBrowser, executarDiagnosticoCompletoV2, conferirNokAuditoria } = require('./core/suiteDiagnostico');
const { buscarSlotEAgendar, abrirTroubleTicket, patchTroubleTicketV2, consultarNotificacoesTT } = require('./core/suiteTroubleTicket');
const PORT = process.env.PORT || 3000;
const { getConfigForEnv } = require('./config');
const https = require('node:https'); // ou: const https = require('https');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
// ─────────────────────────────────────────────
// Middlewares
// ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─────────────────────────────────────────────
// Estado em memória
// ✅ globalSubscriberIdCounter REMOVIDO — não é mais necessário
// ─────────────────────────────────────────────
const createdOrders = global.createdOrders || [];

// ─────────────────────────────────────────────
// ✅ Gerador de subscriberId único e sem estado
// ─────────────────────────────────────────────
function gerarSubscriberId() {
    const tsPart   = String(Date.now()).slice(-8);
    const randPart = String(Math.floor(Math.random() * 100)).padStart(2, '0');
    const subscriberId = `TDMQAOSS${tsPart}${randPart}`;
    console.log(`[APP] SubscriberId gerado: ${subscriberId}`);
    return subscriberId;
}

// ─────────────────────────────────────────────
// HELPER: valida e retorna o ambiente recebido
// ─────────────────────────────────────────────
function resolveAmbiente(ambiente) {
    const VALID    = ['TRG', 'TI', 'TRG2'];
    const resolved = String(ambiente || 'TRG').trim().toUpperCase();
    if (!VALID.includes(resolved)) {
        console.warn(`[APP] Ambiente inválido recebido: "${ambiente}". Usando TRG como fallback.`);
        return 'TRG';
    }
    console.log(`[APP] Ambiente resolvido: ${resolved}`);
    return resolved;
}

// ─────────────────────────────────────────────
// GET /api/cps
// ─────────────────────────────────────────────
app.get('/api/cps', (req, res) => {
    try {
        const cpList = Object.keys(CLIENTS);
        console.log('[APP] CPs disponíveis:', cpList);
        res.json(cpList);
    } catch (error) {
        console.error('[APP] Erro ao listar CPs:', error);
        res.status(500).json({ status: 'erro', message: 'Erro ao listar CPs.' });
    }
});

// ─────────────────────────────────────────────
// POST /api/gerar-token
//   Retorna o accessToken gerado para o CP+ambiente.
//   Usado pelo front da Retirada (buscar-slots + agendar-slot precisam do mesmo token).
// ─────────────────────────────────────────────
app.post('/api/gerar-token', async (req, res) => {
    const { cp_selection, ambiente } = req.body;
    const ambienteResolvido = resolveAmbiente(ambiente);
    if (!cp_selection) {
        return res.status(400).json({ status: 'erro', message: 'cp_selection é obrigatório.' });
    }
    try {
        const tokenData = await getTokenForCp(cp_selection, CLIENTS, ambienteResolvido);
        if (!tokenData || !tokenData.access_token) {
            return res.status(401).json({ status: 'erro', message: 'Não foi possível obter token para o CP selecionado.' });
        }
        res.json({
            status:       'sucesso',
            accessToken:  tokenData.access_token,
            cp:           cp_selection,
            ambiente:     ambienteResolvido
        });
    } catch (err) {
        console.error('[APP] Erro ao gerar token:', err.message);
        res.status(500).json({ status: 'erro', message: err.message });
    }
});

// ─────────────────────────────────────────────
// POST /api/gerar-subscriber-id
//   Retorna um subscriberId novo (TDMQAOSS + 8 chars ts + 2 chars random).
//   Usado pelo front da Retirada antes do buscar-slots (V.tal exige subscriberId único por OS).
// ─────────────────────────────────────────────
app.get('/api/gerar-subscriber-id', (req, res) => {
    try {
        const subscriberId = gerarSubscriberId();
        res.json({ status: 'sucesso', subscriberId });
    } catch (err) {
        console.error('[APP] Erro ao gerar subscriberId:', err.message);
        res.status(500).json({ status: 'erro', message: err.message });
    }
});

// ─────────────────────────────────────────────
// POST /api/consultar-endereco
// ─────────────────────────────────────────────
app.post('/api/consultar-endereco', async (req, res) => {
    const { cp_selection, cep, numero, ambiente } = req.body;
    const ambienteResolvido = resolveAmbiente(ambiente);

    if (!cp_selection || !cep || !numero) {
        return res.status(400).json({ status: 'erro', message: 'CP, CEP e Número são obrigatórios.' });
    }

    try {
        const tokenData = await getTokenForCp(cp_selection, CLIENTS, ambienteResolvido);
        console.log('[APP] Dados do Token recebidos:', JSON.stringify(tokenData, null, 2));

        if (!tokenData || !tokenData.access_token) {
            return res.status(401).json({ status: 'erro', message: 'Não foi possível obter o token de autenticação.' });
        }
        const accessToken = tokenData.access_token;

        const enderecoResult = await buscarEndereco(cep, numero, accessToken, ambienteResolvido);
        console.log('[APP] Resposta completa de buscarEndereco:', JSON.stringify(enderecoResult, null, 2));

        let addressId       = null;
        let enderecoDetalhes = null;

        if (
            enderecoResult &&
            enderecoResult.addresses &&
            enderecoResult.addresses.address &&
            enderecoResult.addresses.address.length > 0
        ) {
            enderecoDetalhes = enderecoResult.addresses.address[0];
            addressId        = enderecoDetalhes.id;
        } else {
            return res.status(404).json({
                status:   'erro',
                message:  'Endereço não encontrado ou sem detalhes.',
                endereco: enderecoResult
            });
        }

        const complementos = addressId
            ? await buscarComplementos(addressId, accessToken, ambienteResolvido)
            : [];
        console.log('[APP] Complementos enviados para o frontend:', complementos);

        const enderecoFormatado = {
            id:              enderecoDetalhes.id,
            description:     enderecoDetalhes.description,
            streetName:      enderecoDetalhes.streetName,
            streetNr:        enderecoDetalhes.number,
            neighborhood:    enderecoDetalhes.neighborhood,
            locality:        enderecoDetalhes.city,
            stateOrProvince: enderecoDetalhes.stateAbbreviation,
            postcode:        enderecoDetalhes.zipCode
        };

        // ✅ Gera subscriberId único sem estado — seguro para multi-pod e restart
        const subscriberId = gerarSubscriberId();

        res.json({
            status:      'sucesso',
            endereco:    enderecoFormatado,
            addressId:   addressId,
            complementos: complementos,
            accessToken: accessToken,
            subscriberId: subscriberId,
            ambiente:    ambienteResolvido
        });

    } catch (error) {
        console.error('[APP] Erro no backend ao consultar endereço:', error);
        res.status(500).json({ status: 'erro', message: error.message });
    }
});

// ─────────────────────────────────────────────
// POST /api/verificar-disponibilidade
// ─────────────────────────────────────────────
app.post('/api/verificar-disponibilidade', async (req, res) => {
    const { cp_selection, addressId, complementoSelecionado, accessToken, subscriberId, ambiente } = req.body;
    const ambienteResolvido = resolveAmbiente(ambiente);

    if (!cp_selection || !addressId || !accessToken || !subscriberId) {
        return res.status(400).json({ status: 'erro', message: 'CP, ID do Endereço, Token e SubscriberId são obrigatórios.' });
    }
    if (typeof accessToken !== 'string') {
        return res.status(401).json({ status: 'erro', message: 'Token de autenticação inválido ou ausente.' });
    }

    try {
        const disponibilidadeResult = await verificarDisponibilidade(
            addressId,
            complementoSelecionado,
            cp_selection,
            accessToken,
            subscriberId,
            ambienteResolvido
        );

        const control  = disponibilidadeResult.control;
        const resource = disponibilidadeResult.resource;

        if (control && control.type === 'S') {
            res.json({
                status:      'sucesso',
                message:     control.message,
                products:    resource.products ? resource.products.product : [],
                inventoryId: resource.inventoryId,
                accessToken: accessToken,
                subscriberId: subscriberId,
                ambiente:    ambienteResolvido
            });
        } else {
            res.status(400).json({
                status:  'erro',
                message: control && control.message ? control.message : 'Erro desconhecido ao verificar disponibilidade.',
                control: control
            });
        }
    } catch (error) {
        console.error('[APP] Erro no backend ao verificar disponibilidade:', error);
        res.status(500).json({ status: 'erro', message: error.message });
    }
});

// ─────────────────────────────────────────────
// POST /api/buscar-slots
// ─────────────────────────────────────────────
app.post('/api/buscar-slots', async (req, res) => {
    const { cp_selection, addressId, subscriberId, associatedDocument, productType, accessToken, ambiente, orderType } = req.body;
    const ambienteResolvido = resolveAmbiente(ambiente);
    const orderTypeFinal    = orderType || 'Instalacao';

    // associatedDocument: a V.tal valida junto com subscriberId no searchTimeSlot.
    // - Retirada com churn: vem do front (associatedDocument da Instalação original)
    // - Instalação: pode vir undefined — fallback para o próprio subscriberId
    const associatedDocumentFinal = associatedDocument || subscriberId;

    if (!cp_selection || !addressId || !subscriberId || !productType || !accessToken) {
        return res.status(400).json({ status: 'erro', message: 'Dados incompletos para buscar slots.' });
    }

    try {
        const slotsResult = await buscarSlotsDisponiveis(
            addressId,
            subscriberId,
            productType,
            accessToken,
            cp_selection,
            ambienteResolvido,
            { orderType: orderTypeFinal, associatedDocument: associatedDocumentFinal }
        );
        const listaSlots = (slotsResult && Array.isArray(slotsResult.slots))
            ? slotsResult.slots
            : (Array.isArray(slotsResult) ? slotsResult : []);
        res.json({ status: 'sucesso', slots: listaSlots });
    } catch (err) {
        console.error('Erro ao buscar slots:', err);
        res.status(500).json({ status: 'erro', message: err.message });
    }
});

// ─────────────────────────────────────────────
// POST /api/mudanca-endereco/buscar-slots
// ─────────────────────────────────────────────
app.post('/api/mudanca-endereco/buscar-slots', async (req, res) => {
    const {
        cp_selection,
        addressId,
        newSubscriberId,
        oldSubscriberId,
        retiradaAssociatedDocument,
        productType,
        accessToken,
        ambiente
    } = req.body;

    const ambienteResolvido = resolveAmbiente(ambiente);

    if (!cp_selection || !addressId || !newSubscriberId || !productType || !accessToken) {
        return res.status(400).json({ status: 'erro', message: 'Dados incompletos para buscar slots de mudança de endereço.' });
    }

    try {
        const slotsResult = await buscarSlotsMudancaEndereco({
            cp_selection,
            addressId,
            newSubscriberId,
            oldSubscriberId,
            retiradaAssociatedDocument,
            productType,
            accessToken,
            ambiente: ambienteResolvido
        });

        if (slotsResult && slotsResult.slots && slotsResult.slots.length > 0) {
            return res.json({
                status: 'sucesso',
                message: 'Slots disponíveis para mudança de endereço encontrados.',
                slots: slotsResult.slots,
                ambiente: ambienteResolvido
            });
        }

        return res.status(404).json({ status: 'erro', message: 'Nenhum slot disponível encontrado para mudança de endereço.' });

    } catch (error) {
        console.error('[APP] Erro ao buscar slots de mudança de endereço:', error);
        return res.status(500).json({ status: 'erro', message: error.message });
    }
});

// ─────────────────────────────────────────────
// POST /api/mudanca-endereco/criar-os
// ─────────────────────────────────────────────
app.post('/api/mudanca-endereco/criar-os', async (req, res) => {
    const {
        cp_selection,
        addressId,
        complementoSelecionado,
        produtoSelecionado,
        slotSelecionado,
        agendamentoId,
        accessToken,
        newSubscriberId,
        oldSubscriberId,
        retiradaAssociatedDocument,
        inventoryId,
        enderecoDetalhes,
        ambiente
    } = req.body;

    const ambienteResolvido = resolveAmbiente(ambiente);

    try {
        const osResult = await criarOrdemServicoMudancaEndereco({
            cp_selection,
            addressId,
            complementoSelecionado,
            produtoSelecionado,
            slotSelecionado,
            agendamentoId,
            accessToken,
            newSubscriberId,
            oldSubscriberId,
            retiradaAssociatedDocument,
            inventoryId,
            ambiente: ambienteResolvido
        });

        if (osResult && osResult.order && osResult.order.id) {
            const associatedDocument = osResult.order.associatedDocument ||
                String(retiradaAssociatedDocument || oldSubscriberId || '').trim();

            const newOrder = {
                orderId: osResult.order.id,
                saId: agendamentoId,
                correlationOrder: osResult.order.correlationOrder,
                associatedDocument,
                cp: cp_selection,
                ambiente: ambienteResolvido,
                subscriberId: newSubscriberId,
                flowType: 'MudancaEndereco',
                productName: produtoSelecionado?.name || '',
                productCatalogId: produtoSelecionado?.catalogId || '',
                address: {
                    streetName:      enderecoDetalhes?.streetName      || '',
                    streetNr:        enderecoDetalhes?.streetNr        || '',
                    neighborhood:    enderecoDetalhes?.neighborhood    || '',
                    locality:        enderecoDetalhes?.locality        || '',
                    stateOrProvince: enderecoDetalhes?.stateOrProvince || '',
                    postcode:        enderecoDetalhes?.postcode        || '',
                    description:     enderecoDetalhes?.description     || ''
                },
                complement: complementoSelecionado,
                slotDate: slotSelecionado?.startDate,
                creationDate: new Date().toISOString()
            };

            createdOrders.push(newOrder);

            return res.json({
                status: 'sucesso',
                message: 'Ordem de Serviço de mudança de endereço criada com sucesso!',
                orderId: osResult.order.id,
                saId: agendamentoId,
                associatedDocument,
                subscriberId: newSubscriberId,
                ambiente: ambienteResolvido
            });
        }

        return res.status(500).json({
            status: 'erro',
            message: 'Erro ao criar Ordem de Serviço de mudança de endereço: ID não retornado pela API.'
        });

    } catch (error) {
        console.error('[APP] Erro ao criar OS de mudança de endereço:', error);
        return res.status(500).json({ status: 'erro', message: error.message });
    }
});

// POST /api/mudanca-endereco/criar-retirada — Retirada (sistêmica, sem agendamento)
app.post('/api/mudanca-endereco/criar-retirada', async (req, res) => {
    const { criarOrdemServicoRetirada } = require('./core/mudancaEndereco');

    const {
        cp_selection,
        accessToken,
        oldSubscriberId,
        retiradaAssociatedDocument,
        produtoSelecionado,
        complementoSelecionado,
        enderecoDetalhes,
        ambiente,
        instalacao,                  // ✅ NOVO: OS da Instalação recém-criada
        correlationOrderOriginal,    // ✅ NOVO: atalho se o front já tiver
        subscriberIdNovo             // ✅ NOVO: para achar a OS certa em createdOrders
    } = req.body;

    if (!oldSubscriberId && !retiradaAssociatedDocument) {
        return res.status(400).json({
            status: 'erro',
            message: 'oldSubscriberId é obrigatório para criar a OS de Retirada.'
        });
    }

    try {
        // ============================================================
        // ✅ Helper local: resolve a Instalação mais recente em createdOrders
        // ============================================================
        function resolverInstalacaoRecente() {
            if (instalacao) return instalacao;
            if (Array.isArray(createdOrders) && createdOrders.length > 0) {
                // Preferência: a do mesmo subscriberId novo
                let candidata = null;
                for (let i = createdOrders.length - 1; i >= 0; i--) {
                    const o = createdOrders[i];
                    if (o.flowType !== 'MudancaEndereco') continue;
                    if (subscriberIdNovo && o.subscriberId === subscriberIdNovo) return o;
                    if (!candidata) candidata = o;
                }
                return candidata;
            }
            return null;
        }

        const instalacaoResolvida = resolverInstalacaoRecente();

        const result = await criarOrdemServicoRetirada({
            cp_selection,
            accessToken,
            oldSubscriberId,
            retiradaAssociatedDocument,
            produtoSelecionado,
            complementoSelecionado,
            correlationOrderOriginal,
            instalacao: instalacaoResolvida,
            ambiente: ambiente || 'TRG'
        });

        // ============================================================
        // ✅ Salva a Retirada no bolsão (mesmo padrão da Instalação)
        // ============================================================
        try {
            if (result && result.order && result.order.id) {
                createdOrders.push({
                    orderId: result.order.id,
                    saId: null,
                    correlationOrder: result.correlationOrder,
                    associatedDocument: result.associatedDocument,
                    cp: cp_selection,
                    ambiente: ambiente || 'TRG',
                    subscriberId: oldSubscriberId,
                    flowType: 'MudancaEnderecoRetirada',
                    productName: produtoSelecionado?.name || '',
                    productCatalogId: produtoSelecionado?.catalogId || '',
                    address: {
                        streetName:      enderecoDetalhes?.streetName      || '',
                        streetNr:        enderecoDetalhes?.streetNr        || '',
                        neighborhood:    enderecoDetalhes?.neighborhood    || '',
                        locality:        enderecoDetalhes?.locality        || '',
                        stateOrProvince: enderecoDetalhes?.stateOrProvince || '',
                        postcode:        enderecoDetalhes?.postcode        || '',
                        description:     enderecoDetalhes?.description     || ''
                    },
                    complement: complementoSelecionado,
                    creationDate: new Date().toISOString()
                });
            }
        } catch (e) {
            console.warn('[API] Não foi possível salvar a Retirada no bolsão:', e.message);
        }

        return res.json({
            status: 'sucesso',
            message: 'OS de Retirada criada com sucesso.',
            orderId: result?.order?.id,
            correlationOrder: result?.correlationOrder,
            associatedDocument: result?.associatedDocument
        });
    } catch (err) {
        console.error('[API] Erro ao criar OS de Retirada:', err.message);
        return res.status(500).json({ status: 'erro', message: err.message });
    }
});

// ─────────────────────────────────────────────
// POST /api/agendar-slot
// ─────────────────────────────────────────────
app.post('/api/agendar-slot', async (req, res) => {
    const { cp_selection, slotId, accessToken, ambiente } = req.body;
    const ambienteResolvido = resolveAmbiente(ambiente);

    if (!cp_selection || !slotId || !accessToken) {
        return res.status(400).json({ status: 'erro', message: 'CP, ID do Slot e Token são obrigatórios.' });
    }

    try {
        const agendamentoResult = await agendarSlot(slotId, accessToken, cp_selection, ambienteResolvido);

        if (agendamentoResult && agendamentoResult.control && agendamentoResult.control.type === 'S') {
            res.json({
                status:        'sucesso',
                message:       agendamentoResult.control.message,
                agendamentoId: agendamentoResult.appointment ? agendamentoResult.appointment.id : null,
                accessToken:   accessToken,
                ambiente:      ambienteResolvido
            });
        } else {
            res.status(400).json({
                status:  'erro',
                message: agendamentoResult?.control?.message || 'Erro desconhecido ao agendar slot.',
                control: agendamentoResult ? agendamentoResult.control : null
            });
        }
    } catch (error) {
        console.error('[APP] Erro no backend ao agendar slot:', error);
        res.status(500).json({ status: 'erro', message: error.message });
    }
});

// ─────────────────────────────────────────────
// POST /api/criar-os  (v2 — lista de produtos)
// ─────────────────────────────────────────────
app.post('/api/criar-os', async (req, res) => {
    const {
        cp_selection,
        addressId,
        complementoSelecionado,
        produtoSelecionado,    // ✅ retrocompat (singular)
        produtos,              // ✅ novo: array de { catalogId }
        slotSelecionado,
        agendamentoId,
        accessToken,
        subscriberId,
        inventoryId,
        enderecoDetalhes,
        ambiente
    } = req.body;

    const ambienteResolvido = resolveAmbiente(ambiente);

    // ✅ Aceita ambos: lista nova (produtos) ou singular legado (produtoSelecionado)
    const produtosParaEnvio = Array.isArray(produtos) && produtos.length > 0
        ? produtos
        : (produtoSelecionado ? [produtoSelecionado] : []);

    if (produtosParaEnvio.length === 0) {
        return res.status(400).json({
            status:  'erro',
            message: 'É obrigatório informar ao menos um produto (com Banda Larga — prefixo BL_).'
        });
    }

    // ✅ Validação: ao menos 1 produto de Banda Larga (prefixo BL_)
    const temBandaLarga = produtosParaEnvio.some(p => {
        const id = typeof p === 'string' ? p : (p && p.catalogId);
        return typeof id === 'string' && id.trim().toUpperCase().startsWith('BL_');
    });
    if (!temBandaLarga) {
        return res.status(400).json({
            status:  'erro',
            message: 'A OS precisa ter ao menos um produto de Banda Larga (prefixo BL_).'
        });
    }

    try {
        // Quando vier 1 produto só, mantemos compat com a chamada singular
        const produtoUnico = produtosParaEnvio.length === 1 ? produtosParaEnvio[0] : produtoSelecionado;

        const opcoes = {
            ambiente: ambienteResolvido,
            produtos: produtosParaEnvio
        };

        const osResult = await criarOrdemServico(
            cp_selection,
            addressId,
            complementoSelecionado,
            produtoUnico,
            slotSelecionado,
            agendamentoId,
            accessToken,
            subscriberId,
            inventoryId,
            opcoes
        );

        if (osResult && osResult.order && osResult.order.id) {

            const associatedDocument = osResult.order.associatedDocument || subscriberId;

            const listaCatalogs = produtosParaEnvio
                .map(p => (typeof p === 'string' ? p : p?.catalogId))
                .filter(Boolean);

            const newOrder = {
                orderId:            osResult.order.id,
                saId:               agendamentoId,
                correlationOrder:   osResult.order.correlationOrder,
                associatedDocument,
                cp:                 cp_selection,
                ambiente:           ambienteResolvido,
                subscriberId:       subscriberId,
                produtos:           listaCatalogs,
                productName:        produtoSelecionado?.name || '',
                productCatalogId:   produtoSelecionado?.catalogId || listaCatalogs[0] || '',
                address: {
                    streetName:      enderecoDetalhes?.streetName      || '',
                    streetNr:        enderecoDetalhes?.streetNr        || '',
                    neighborhood:    enderecoDetalhes?.neighborhood    || '',
                    locality:        enderecoDetalhes?.locality        || '',
                    stateOrProvince: enderecoDetalhes?.stateOrProvince || '',
                    postcode:        enderecoDetalhes?.postcode        || '',
                    description:     enderecoDetalhes?.description     || ''
                },
                complement:   complementoSelecionado,
                slotDate:     slotSelecionado?.startDate,
                creationDate: new Date().toISOString()
            };

            createdOrders.push(newOrder);
            try {
                const subscriberAddressesRepo = require('./core/repositories/subscriberAddressesRepo');
                subscriberAddressesRepo.upsert({
                    subscriberId:        subscriberId,
                    ambiente:            ambienteResolvido,
                    cp:                  cp_selection,
                    orderId:             osResult.order.id,
                    correlationOrder:    osResult.order.correlationOrder,
                    associatedDocument:  associatedDocument,
                    addressId:           addressId,
                    inventoryId:         inventoryId,
                    complementType:      complementoSelecionado?.type || null,
                    complementValue:     complementoSelecionado?.value || null,
                    productCatalogId:    listaCatalogs[0] || produtoSelecionado?.catalogId || null,
                    produtos:            listaCatalogs,
                    flowType:            'Instalacao'
                });
                console.log(`[API] subscriber_addresses persistido para ${subscriberId} (orderId ${osResult.order.id}, produtos: ${listaCatalogs.length})`);
            } catch (e) {
                console.warn('[API] Falha ao persistir subscriber_addresses (Instalacao):', e.message);
            }

            console.log(`[APP] ✅ OS salva no bolsão. Total: ${createdOrders.length}`);
            console.log('[APP] OS criada:', JSON.stringify(newOrder, null, 2));

            res.json({
                status:             'sucesso',
                message:            'Ordem de Serviço criada com sucesso!',
                orderId:            osResult.order.id,
                saId:               agendamentoId,
                associatedDocument,
                subscriberId:       subscriberId,
                produtos:           listaCatalogs,
                ambiente:           ambienteResolvido
            });

        } else {
            console.error('[APP] Resposta inesperada da API de OS:', osResult);
            res.status(500).json({
                status:  'erro',
                message: 'Erro ao criar Ordem de Serviço: ID não retornado pela API.'
            });
        }
    } catch (error) {
        console.error('[APP] Erro ao criar Ordem de Serviço:', error.message);
        res.status(500).json({ status: 'erro', message: error.message });
    }
});

// ─────────────────────────────────────────────
// GET /api/instalacoes-ativas  (dropdown do formulario de Retirada)
// ─────────────────────────────────────────────
app.get('/api/instalacoes-ativas', (req, res) => {
    const ambiente = resolveAmbiente(req.query.ambiente);
    try {
        const repo = require('./core/repositories/subscriberAddressesRepo');
        const rows = repo.listByFlowType('Instalacao', ambiente);
        const itens = rows.map(r => ({
            subscriberId:       r.subscriber_id,
            ambiente:           r.ambiente,
            cp:                 r.cp,
            orderId:            r.order_id,
            correlationOrder:   r.correlation_order,
            associatedDocument: r.associated_document,
            addressId:          r.address_id,
            inventoryId:        r.inventory_id,
            productCatalogId:   r.product_catalog_id,
            produtos:           r.produtos || [],
            createdAt:          r.created_at
        }));
        res.json({ status: 'sucesso', ambiente, total: itens.length, items: itens });
    } catch (e) {
        console.error('[APP] Erro ao listar instalacoes ativas:', e.message);
        res.status(500).json({ status: 'erro', message: e.message });
    }
});

// ─────────────────────────────────────────────
// POST /api/criar-os-retirada  (v5 — com agendamento opcional)
//   Recebe { correlationOrderOriginal, cp_selection, ambiente, addressId?, inventoryId?,
//            complementoSelecionado?, produtos?, atributos?, slotSelecionado?, agendamentoId? }.
//   - Se slotSelecionado + agendamentoId vierem preenchidos: appointment é incluído no payload (churn).
//   - Se não vierem: Retirada sistêmica (sem appointment, sem churn).
//   Fluxo: token → buscar Instalacao no repo → criarOrdemServico → persistir com flowType=Retirada.
// ─────────────────────────────────────────────
app.post('/api/criar-os-retirada', async (req, res) => {
    const {
        correlationOrderOriginal,
        cp_selection,
        ambiente,
        addressId,
        inventoryId,
        complementoSelecionado,
        produtos,         // string[] | { catalogId, attributes? }[]
        atributos,        // { catalogId: { attribute: [...] } }   <- v4
        slotSelecionado,  // ✅ v5: opcional, presente se for Retirada com churn
        agendamentoId     // ✅ v5: opcional
    } = req.body;

    const ambienteResolvido = resolveAmbiente(ambiente);

    if (!correlationOrderOriginal) {
        return res.status(400).json({ status: 'erro', message: 'correlationOrderOriginal e obrigatorio (identificador da OS de Instalacao original).' });
    }
    if (!cp_selection) {
        return res.status(400).json({ status: 'erro', message: 'cp_selection e obrigatorio.' });
    }

    try {
        const tokenData = await getTokenForCp(cp_selection, CLIENTS, ambienteResolvido);
        if (!tokenData || !tokenData.access_token) {
            return res.status(401).json({ status: 'erro', message: 'Nao foi possivel obter token para o CP selecionado.' });
        }
        const accessToken = tokenData.access_token;

        const repo = require('./core/repositories/subscriberAddressesRepo');
        const instalacaoOriginal = repo.findBySubscriberId(correlationOrderOriginal, ambienteResolvido);
        if (!instalacaoOriginal) {
            return res.status(404).json({
                status:  'erro',
                message: `Nenhuma Instalacao encontrada para subscriberId=${correlationOrderOriginal} no ambiente ${ambienteResolvido}. Verifique se a Instalacao original foi criada e esta persistida.`
            });
        }

        const addressIdFinal   = addressId   || instalacaoOriginal.address_id;
        const inventoryIdFinal = inventoryId || instalacaoOriginal.inventory_id;
        let produtosFinais     = Array.isArray(produtos) && produtos.length
                                  ? produtos
                                  : (instalacaoOriginal.produtos || [instalacaoOriginal.product_catalog_id].filter(Boolean));
        const complementoFinal = complementoSelecionado || (instalacaoOriginal.complement_type && instalacaoOriginal.complement_value
                                  ? { type: instalacaoOriginal.complement_type, value: instalacaoOriginal.complement_value }
                                  : null);

        // v4: mescla o mapa `atributos` (vindo do front) nos produtos
        if (atributos && typeof atributos === 'object') {
            produtosFinais = produtosFinais.map(p => {
                const cat = typeof p === 'string' ? p : p.catalogId;
                const a = atributos[cat];
                if (typeof p === 'string') return a ? { catalogId: p, attributes: a } : p;
                return a ? { ...p, attributes: a } : p;
            });
        }

        if (!addressIdFinal) {
            return res.status(400).json({ status: 'erro', message: 'addressId nao resolvido (nem veio do front nem da Instalacao original).' });
        }
        if (!produtosFinais || produtosFinais.length === 0) {
            return res.status(400).json({ status: 'erro', message: 'Nenhum produto resolvido para a Retirada. Informe produtos[] no body ou garanta que a Instalacao original tem produtos salvos.' });
        }

        const opcoes = {
            orderType:                'Retirada',
            correlationOrderOriginal: correlationOrderOriginal,
            associatedDocument:       instalacaoOriginal.associated_document || correlationOrderOriginal,
            produtos:                 produtosFinais
        };

        // ✅ v5: passa slotSelecionado e agendamentoId quando vierem (Retirada com churn)
        const slotFinal        = slotSelecionado || null;
        const agendamentoFinal = agendamentoId    || null;

        const osResult = await criarOrdemServico(
            cp_selection,
            addressIdFinal,
            complementoFinal,
            null,                       // produtoSelecionado (singular) - nao usado
            slotFinal,                  // ✅ v5: slot do agendamento (null se sem churn)
            agendamentoFinal,           // ✅ v5: agendamentoId (null se sem churn)
            accessToken,
            correlationOrderOriginal,   // subscriberId da Instalacao original
            inventoryIdFinal,
            ambienteResolvido,
            opcoes
        );

        if (osResult && osResult.order && osResult.order.id) {
            const orderIdFinal            = osResult.order.id;
            const correlationOrderFinal   = osResult.order.correlationOrder || osResult.correlationOrder;
            const associatedDocumentFinal = osResult.associatedDocument || instalacaoOriginal.associated_document || correlationOrderOriginal;

            repo.upsert({
                subscriberId:        correlationOrderOriginal,
                ambiente:            ambienteResolvido,
                cp:                  cp_selection,
                orderId:             orderIdFinal,
                correlationOrder:    correlationOrderFinal,
                associatedDocument:  associatedDocumentFinal,
                addressId:           addressIdFinal,
                inventoryId:         inventoryIdFinal,
                complementType:      complementoFinal?.type || null,
                complementValue:     complementoFinal?.value || null,
                productCatalogId:    produtosFinais[0]?.catalogId || produtosFinais[0] || null,
                produtos:            osResult.produtos || produtosFinais,
                flowType:            'Retirada'
            });

            createdOrders.push({
                orderId:            orderIdFinal,
                saId:               agendamentoFinal,
                correlationOrder:   correlationOrderFinal,
                associatedDocument: associatedDocumentFinal,
                cp:                 cp_selection,
                ambiente:           ambienteResolvido,
                subscriberId:       correlationOrderOriginal,
                orderType:          'Retirada',
                productName:        null,
                productCatalogId:   produtosFinais[0]?.catalogId || produtosFinais[0] || null,
                produtos:           osResult.produtos || produtosFinais,
                creationDate:       new Date().toISOString()
            });

            res.json({
                status:             'sucesso',
                message:            'Ordem de Servico de Retirada criada com sucesso!',
                orderId:            orderIdFinal,
                saId:               agendamentoFinal,
                associatedDocument: associatedDocumentFinal,
                subscriberId:       correlationOrderOriginal,
                orderType:          'Retirada',
                produtos:           osResult.produtos || produtosFinais,
                instalacaoOriginal: {
                    subscriberId:       instalacaoOriginal.subscriber_id,
                    associatedDocument: instalacaoOriginal.associated_document,
                    produtos:           instalacaoOriginal.produtos
                },
                ambiente: ambienteResolvido
            });
        } else {
            res.status(500).json({ status: 'erro', message: 'Resposta inesperada da API de OS (sem order.id).', raw: osResult });
        }
    } catch (error) {
        console.error('[APP] Erro ao criar OS de Retirada:', error.message);
        res.status(500).json({ status: 'erro', message: error.message });
    }
});

// ─────────────────────────────────────────────
// GET /api/ordens-servico
// ─────────────────────────────────────────────
app.get('/api/ordens-servico', (req, res) => {
    console.log('[APP] Requisição para listar Ordens de Serviço. Total:', createdOrders.length);
    res.json({ status: 'sucesso', orders: createdOrders });
});

// ─────────────────────────────────────────────
// POST /api/execute-api-action
// ─────────────────────────────────────────────
app.post('/api/execute-api-action', async (req, res) => {
    const { action, payload, cp_selection, ambiente } = req.body;
    const ambienteResolvido = resolveAmbiente(ambiente);

    if (!action || !payload || !cp_selection || !ambiente) {
        return res.status(400).json({ status: 'erro', message: 'Dados incompletos para executar a ação da API.' });
    }

    console.log(`[APP] Recebida requisição para ${action} no ambiente ${ambienteResolvido} para CP ${cp_selection}`);
    console.log('[APP] Payload recebido:', JSON.stringify(payload, null, 2));

    try {
        // Primeiro, obter o token de autenticação
        const tokenData = await getTokenForCp(cp_selection, CLIENTS, ambienteResolvido);
        if (!tokenData || !tokenData.access_token) {
            return res.status(401).json({ status: 'erro', message: 'Não foi possível obter o token de autenticação para o CP selecionado.' });
        }
        const accessToken = tokenData.access_token;

        // URL da API externa (baseHost)
        const BASE_HOSTS = {
            TRG:  'https://apitrg.vtal.com.br',
            TI:   'https://api-ti1.vtal.com.br',
            TRG2: 'https://api-ti2.vtal.com.br'
        };
        const baseHost = BASE_HOSTS[ambienteResolvido];
        if (!baseHost) {
            return res.status(500).json({ status: 'erro', message: `Ambiente ${ambienteResolvido} não configurado para API externa.` });
        }

        const apiUrl = `${baseHost}/api/productOrdering/v2/productOrder`;

        console.log(`[APP] Enviando requisição para API externa: ${apiUrl}`);
        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify(payload)
        });

        const apiResponseData = await apiResponse.json();

        if (apiResponse.ok) {
            console.log(`[APP] Resposta da API externa para ${action}:`, JSON.stringify(apiResponseData, null, 2));
            res.json({
                status: 'sucesso',
                message: `Operação de ${action} concluída com sucesso.`,
                apiResponse: apiResponseData
            });
        } else {
            console.error(`[APP] Erro da API externa para ${action} (Status: ${apiResponse.status}):`, JSON.stringify(apiResponseData, null, 2));
            res.status(apiResponse.status).json({
                status: 'erro',
                message: `A API externa retornou um erro para ${action}: ${apiResponseData.message || apiResponseData.error || 'Erro desconhecido.'}`,
                apiResponse: apiResponseData
            });
        }

    } catch (error) {
        console.error(`[APP] Erro no backend ao executar ${action}:`, error);
        res.status(500).json({ status: 'erro', message: `Erro interno do servidor ao executar ${action}: ${error.message}` });
    }
});

// ─────────────────────────────────────────────
// POST /api/upload-viabilidade-lote
// ─────────────────────────────────────────────
const upload = multer({ dest: 'uploads/' });

app.post('/api/upload-viabilidade-lote', upload.single('spreadsheet'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: 'erro', message: 'Nenhum arquivo enviado.' });
    }

    const cp_selection      = String(req.body.cp_selection || '').trim();
    const ambiente          = String(req.body.ambiente || 'TRG').trim();
    const ambienteResolvido = resolveAmbiente(ambiente);

    if (!cp_selection) {
        return res.status(400).json({ status: 'erro', message: 'CP de seleção é obrigatório.' });
    }
    if (!CLIENTS[cp_selection]) {
        return res.status(400).json({ status: 'erro', message: `CP inválido: ${cp_selection}` });
    }

    try {
        console.log('[UPLOAD] arquivo:', req.file.originalname, '| cp:', cp_selection, '| ambiente:', ambienteResolvido);

        const result   = await processarPlanilhaViabilidade(req.file.path, cp_selection, CLIENTS, ambienteResolvido);
        const fileName = path.basename(result.resultFilePath || result);

        return res.json({
            status:   'sucesso',
            message:  'Planilha processada com sucesso!',
            fileName,
            ambiente: ambienteResolvido
        });
    } catch (error) {
        console.error('[APP] Erro ao processar planilha de viabilidade em lote:', error);
        return res.status(500).json({ status: 'erro', message: error.message });
    }
});

// ─────────────────────────────────────────────
// GET /api/download-viabilidade-lote
// ─────────────────────────────────────────────
app.get('/api/download-viabilidade-lote', (req, res) => {
    const fileName = String(req.query.fileName || '').trim();

    if (!fileName) {
        return res.status(400).json({ status: 'erro', message: 'Nome do arquivo não fornecido.' });
    }
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        return res.status(400).json({ status: 'erro', message: 'Nome de arquivo inválido.' });
    }

    const filePath = path.join(__dirname, 'processed_spreadsheets', fileName);

    res.download(filePath, (err) => {
        if (!err) return;
        console.error('[APP] Erro ao baixar arquivo:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ status: 'erro', message: 'Erro ao baixar o arquivo.' });
        }
    });
});

// SUITE 1 - MOCK
app.post('/api/diagnostico/suite1/mock', async (req, res) => {
  try {
    const { ambiente = 'TRG', login, senha, subscriberId } = req.body;
    const out = await parametrizarMockViaBrowser({ ambiente, login, senha, subscriberId });
    res.json({ status: 'sucesso', ...out });
  } catch (e) {
    res.status(500).json({ status: 'erro', message: e.message });
  }
});

// SUITE 1 - Diagnóstico Completo V2
app.post('/api/diagnostico/suite1/executar', async (req, res) => {
  try {
    const { cp_selection, ambiente = 'TRG', payload } = req.body;
    const tokenData = await getTokenForCp(cp_selection, require('./clients'), ambiente);
    if (!tokenData?.access_token) throw new Error('Token inválido.');

    const diagnosticoId = await diagRepo.createDiagnostico({
      ambiente,
      cp: cp_selection,
      subscriberId: payload?.customer?.subscriberId,
      status: 'PENDENTE',
      requestPayload: payload
    });

    const responsePayload = await executarDiagnosticoCompletoV2({
      ambiente,
      payload,
      accessToken: tokenData.access_token
    });

    await diagRepo.updateDiagnostico(diagnosticoId, {
      status: 'SUCESSO',
      responsePayload
    });

    res.json({ status: 'sucesso', diagnosticoId, data: responsePayload });
  } catch (e) {
    res.status(500).json({ status: 'erro', message: e.message });
  }
});

// SUITE 1 - Auditoria NOK
app.get('/api/diagnostico/:id/auditoria-nok', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { cp_selection, ambiente = 'TRG', correlationId } = req.query;

    const tokenData = await getTokenForCp(cp_selection, require('./clients'), ambiente);
    if (!tokenData?.access_token) throw new Error('Token inválido.');

    const auditoriaPayload = await conferirNokAuditoria({
      ambiente,
      correlationId,
      accessToken: tokenData.access_token
    });

    const nok = JSON.stringify(auditoriaPayload).includes('"NOK"');
    await diagRepo.updateDiagnostico(id, {
      status: nok ? 'NOK_AUDITORIA' : 'SUCESSO',
      auditoriaPayload
    });

    res.json({ status: 'sucesso', diagnosticoId: id, nok, auditoriaPayload });
  } catch (e) {
    res.status(500).json({ status: 'erro', message: e.message });
  }
});

// SUITE 2 - Fluxo principal (slot + agendar + abrir TT)
app.post('/api/chamado/suite2/executar', async (req, res) => {
  try {
    const {
      cp_selection,
      ambiente = 'TRG',
      addressId,
      subscriberId,
      productType,
      ttPayload,
      diagnosticoId,
      createdOrderId
    } = req.body;

    const tokenData = await getTokenForCp(cp_selection, require('./clients'), ambiente);
    if (!tokenData?.access_token) throw new Error('Token inválido.');

    const { slot, agendamentoResp } = await buscarSlotEAgendar({
      ambiente,
      addressId,
      subscriberId,
      productType,
      accessToken: tokenData.access_token,
      cp_selection
    });

    const openResp = await abrirTroubleTicket({
      ambiente,
      payload: ttPayload,
      accessToken: tokenData.access_token
    });

    const ticketId = openResp?.id || openResp?.troubleTicket?.id || null;
    const protocolo = openResp?.protocol || openResp?.troubleTicket?.protocol || null;
    const agendamentoId = agendamentoResp?.appointment?.id || null;

    const id = await ttRepo.createTroubleTicket({
      ambiente,
      diagnosticoId,
      createdOrderId,
      ttIdExterno: ticketId,
      ttProtocolo: protocolo,
      status: 'ABERTO',
      t088Status: 'PENDENTE_HUMANO',
      slotId: slot.id,
      agendamentoId,
      requestOpen: ttPayload,
      responseOpen: openResp
    });

    res.json({
      status: 'sucesso',
      troubleTicketLocalId: id,
      troubleTicketExternoId: ticketId,
      protocolo,
      checkpointHumano: 'T088 pendente no SOM'
    });
  } catch (e) {
    res.status(500).json({ status: 'erro', message: e.message });
  }
});

// SUITE 2 - Patch TT V2
app.patch('/api/chamado/:id/patch-v2', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { cp_selection, ambiente = 'TRG', ttIdExterno, payload } = req.body;

    const tokenData = await getTokenForCp(cp_selection, require('./clients'), ambiente);
    if (!tokenData?.access_token) throw new Error('Token inválido.');

    const patchResp = await patchTroubleTicketV2({
      ambiente,
      ttId: ttIdExterno,
      payload,
      accessToken: tokenData.access_token
    });

    await ttRepo.patchTroubleTicket(id, {
      status: 'PATCHED',
      requestPatch: payload,
      responsePatch: patchResp
    });

    res.json({ status: 'sucesso', id, patchResp });
  } catch (e) {
    res.status(500).json({ status: 'erro', message: e.message });
  }
});

// SUITE 2 - Notificações
app.get('/api/chamado/:id/notificacoes', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { cp_selection, ambiente = 'TRG', ttIdExterno } = req.query;

    const tokenData = await getTokenForCp(cp_selection, require('./clients'), ambiente);
    if (!tokenData?.access_token) throw new Error('Token inválido.');

    const notificacoes = await consultarNotificacoesTT({
      ambiente,
      ttId: ttIdExterno,
      accessToken: tokenData.access_token
    });

    await ttRepo.saveNotificacoes(id, notificacoes);
    res.json({ status: 'sucesso', id, notificacoes });
  } catch (e) {
    res.status(500).json({ status: 'erro', message: e.message });
  }
});

function normalizeAmbiente(value) {
  const env = String(value || 'TRG').toUpperCase();
  return ['TRG', 'TI', 'TRG2'].includes(env) ? env : 'TRG';
}

app.get('/api/orders', (req, res) => {
  const ambiente = normalizeAmbiente(req.query.ambiente);
  // Se quiser, filtre por ambiente se a OS tiver esse campo
  const orders = createdOrders;
  return res.json({ ambiente, total: orders.length, orders });
});

app.post('/api/suite2/slots-agendar', async (req, res) => {
  try {
    const ambiente = normalizeAmbiente(req.body.ambiente);
    const osIndex = Number(req.body.osIndex);
    const slotIdManual = req.body.slotId || null;

    if (!Number.isInteger(osIndex) || osIndex < 0 || osIndex >= createdOrders.length) {
      return res.status(400).json({ ok: false, message: 'osIndex inválido' });
    }

    const order = createdOrders[osIndex];
    const cpId = order.cp_selection || order.cp || req.body.cpId;
    const subscriberId = req.body.subscriberId || order.subscriberId;
    const productType = req.body.productType || order.productType || 'Fibra';
    const addressId = order.addressId;

    if (!cpId || !subscriberId || !addressId) {
      return res.status(400).json({ ok: false, message: 'Dados obrigatórios ausentes na OS (cp/subscriber/addressId).' });
    }

    const tokenData = await getTokenForCp(cpId, require('./clients'), ambiente);
    if (!tokenData || !tokenData.access_token) {
      return res.status(401).json({ ok: false, message: 'Falha ao obter token' });
    }

    const slotsResp = await buscarSlots(
      addressId,
      subscriberId,
      productType,
      tokenData.access_token,
      cpId,
      ambiente
    );

    const slots = slotsResp?.appointments || slotsResp?.slots || [];
    const slotId = slotIdManual || (Array.isArray(slots) && slots[0]?.id);

    if (!slotId) {
      return res.status(404).json({ ok: false, message: 'Nenhum slot disponível para agendar', slots: slotsResp });
    }

    const agendamentoResp = await agendarSlot(slotId, tokenData.access_token, cpId, ambiente);

    return res.json({
      ok: true,
      ambiente,
      slotId,
      slots: slotsResp,
      agendamento: agendamentoResp
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

app.post('/api/suite2/trouble-ticket/open', async (req, res) => {
  try {
    const ambiente = normalizeAmbiente(req.body.ambiente);
    const config = getConfigForEnv(ambiente);

    const cpId = req.body.cpId;
    const tokenData = await getTokenForCp(cpId, require('./clients'), ambiente);
    if (!tokenData?.access_token) return res.status(401).json({ ok: false, message: 'Falha no token' });

    const response = await axios.post(
      config.TT_OPEN_URL,
      req.body.payload || {},
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        httpsAgent
      }
    );

    return res.json({ ok: true, ambiente, data: response.data });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.response?.data || err.message });
  }
});

app.patch('/api/suite2/trouble-ticket/:ttId', async (req, res) => {
  try {
    const ambiente = normalizeAmbiente(req.body.ambiente || req.query.ambiente);
    const config = getConfigForEnv(ambiente);

    const cpId = req.body.cpId;
    const tokenData = await getTokenForCp(cpId, require('./clients'), ambiente);
    if (!tokenData?.access_token) return res.status(401).json({ ok: false, message: 'Falha no token' });

    const url = `${config.TT_PATCH_V2_URL}/${encodeURIComponent(req.params.ttId)}`;
    const response = await axios.patch(
      url,
      req.body.payload || {},
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        httpsAgent
      }
    );

    return res.json({ ok: true, ambiente, data: response.data });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.response?.data || err.message });
  }
});

app.get('/api/suite2/trouble-ticket/:ttId/notificacoes', async (req, res) => {
  try {
    const ambiente = normalizeAmbiente(req.query.ambiente);
    const config = getConfigForEnv(ambiente);

    const cpId = req.query.cpId;
    const tokenData = await getTokenForCp(cpId, require('./clients'), ambiente);
    if (!tokenData?.access_token) return res.status(401).json({ ok: false, message: 'Falha no token' });

    const response = await axios.get(config.TT_NOTIF_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      params: { ttId: req.params.ttId },
      httpsAgent
    });

    return res.json({ ok: true, ambiente, data: response.data });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.response?.data || err.message });
  }
});

// ─────────────────────────────────────────────
// 🟢 NOVO: Jobs de processamento em background
//    Resolve o 504 do proxy: a request HTTP responde em ~200ms
//    com um jobId, e o trabalho pesado roda em background.
//    O frontend faz polling de progresso.
// ─────────────────────────────────────────────

const JOBS = new Map(); // jobId -> { status, total, processadas, ok, erro, ignorado, arquivo, erroMsg, startedAt, finishedAt }

function criarJob() {
    const jobId = `job_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    JOBS.set(jobId, {
        status: 'iniciado',
        total: 0,
        processadas: 0,
        ok: 0,
        erro: 0,
        ignorado: 0,
        arquivo: null,
        erroMsg: null,
        startedAt: new Date().toISOString(),
        finishedAt: null
    });
    // limpeza: remove jobs com mais de 2h para não vazar memória
    setTimeout(() => JOBS.delete(jobId), 2 * 60 * 60 * 1000);
    return jobId;
}

// POST /api/upload-viabilidade-lote/start
// Aceita o mesmo FormData da rota antiga. Retorna { jobId } em ~200ms.
// O processamento roda em background, sem segurar a request HTTP.
app.post('/api/upload-viabilidade-lote/start', upload.single('spreadsheet'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: 'erro', message: 'Nenhum arquivo enviado.' });
    }
    const cp_selection      = String(req.body.cp_selection || '').trim();
    const ambiente          = String(req.body.ambiente || 'TRG').trim();
    const ambienteResolvido = (() => {
        const VALID = ['TRG', 'TI', 'TRG2'];
        const r = ambiente.toUpperCase();
        return VALID.includes(r) ? r : 'TRG';
    })();

    if (!cp_selection) {
        return res.status(400).json({ status: 'erro', message: 'CP de seleção é obrigatório.' });
    }
    if (!CLIENTS[cp_selection]) {
        return res.status(400).json({ status: 'erro', message: `CP inválido: ${cp_selection}` });
    }

    const jobId = criarJob();
    console.log(`[JOB] ${jobId} iniciado | cp: ${cp_selection} | ambiente: ${ambienteResolvido} | arquivo: ${req.file.originalname}`);

    // Devolve IMEDIATAMENTE o jobId. O resto roda em background.
    res.json({
        status: 'sucesso',
        jobId,
        message: 'Job iniciado. Acompanhe pelo endpoint de progresso.'
    });

    // === Processamento em background ===
    // Não usa await antes do res.json — o response já foi enviado.
    (async () => {
        try {
            const result = await processarPlanilhaViabilidade(
                req.file.path, cp_selection, CLIENTS, ambienteResolvido
            );
            const job = JOBS.get(jobId);
            if (job) {
                job.status = 'concluido';
                job.arquivo = path.basename(result.resultFilePath || result);
                job.finishedAt = new Date().toISOString();
                console.log(`[JOB] ${jobId} concluído | arquivo: ${job.arquivo}`);
            }
        } catch (error) {
            console.error(`[JOB] ${jobId} falhou:`, error.message);
            const job = JOBS.get(jobId);
            if (job) {
                job.status = 'erro';
                job.erroMsg = error.message;
                job.finishedAt = new Date().toISOString();
            }
        }
    })();
});

// GET /api/viabilidade-lote/progresso?jobId=xxx
// O frontend chama a cada 2s. Retorna o estado atual do job.
app.get('/api/viabilidade-lote/progresso', (req, res) => {
    const jobId = String(req.query.jobId || '').trim();
    if (!jobId) {
        return res.status(400).json({ status: 'erro', message: 'jobId é obrigatório.' });
    }
    const job = JOBS.get(jobId);
    if (!job) {
        return res.status(404).json({ status: 'erro', message: 'Job não encontrado (ou expirou).' });
    }
    res.json({
        status: 'sucesso',
        jobId,
        jobStatus: job.status,
        total: job.total,
        processadas: job.processadas,
        ok: job.ok,
        erro: job.erro,
        ignorado: job.ignorado,
        arquivo: job.arquivo,
        erroMsg: job.erroMsg,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt
    });
});

app.use('/api/fsl', require('./routes/fsl'));
app.use('/api/instalacao-encerramento', require('./routes/instalacao-encerramento'));
app.use('/api/retirada-encerramento', require('./routes/retirada-encerramento'));
// ─────────────────────────────────────────────
// ✅ Iniciar servidor — 0.0.0.0 obrigatório no OpenShift
// ─────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor rodando em http://0.0.0.0:${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
});