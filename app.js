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

const app = express();

// ✅ OpenShift injeta a porta via process.env.PORT — fallback 8080 para local
const PORT = process.env.PORT || 8080;

// ─────────────────────────────────────────────
// Middlewares
// ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─────────────────────────────────────────────
// Estado em memória
// ✅ globalSubscriberIdCounter REMOVIDO — não é mais necessário
// ─────────────────────────────────────────────
const createdOrders = [];

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
    const { cp_selection, addressId, subscriberId, productType, accessToken, ambiente } = req.body;
    const ambienteResolvido = resolveAmbiente(ambiente);

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
            ambienteResolvido
        );

        if (slotsResult && slotsResult.slots && slotsResult.slots.length > 0) {
            res.json({
                status:   'sucesso',
                message:  'Slots disponíveis encontrados.',
                slots:    slotsResult.slots,
                ambiente: ambienteResolvido
            });
        } else {
            res.status(404).json({ status: 'erro', message: 'Nenhum slot disponível encontrado.' });
        }
    } catch (error) {
        console.error('[APP] Erro no backend ao buscar slots:', error);
        res.status(500).json({ status: 'erro', message: error.message });
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
// POST /api/criar-os
// ─────────────────────────────────────────────
app.post('/api/criar-os', async (req, res) => {
    const {
        cp_selection,
        addressId,
        complementoSelecionado,
        produtoSelecionado,
        slotSelecionado,
        agendamentoId,
        accessToken,
        subscriberId,
        inventoryId,
        enderecoDetalhes,
        ambiente
    } = req.body;

    const ambienteResolvido = resolveAmbiente(ambiente);

    try {
        const osResult = await criarOrdemServico(
            cp_selection,
            addressId,
            complementoSelecionado,
            produtoSelecionado,
            slotSelecionado,
            agendamentoId,
            accessToken,
            subscriberId,
            inventoryId,
            ambienteResolvido
        );

        if (osResult && osResult.order && osResult.order.id) {
            const newOrder = {
                orderId:            osResult.order.id,
                saId:               agendamentoId,
                correlationOrder:   osResult.order.correlationOrder,
                associatedDocument: osResult.order.associatedDocument,
                cp:                 cp_selection,
                ambiente:           ambienteResolvido,
                subscriberId:       subscriberId,
                productName:        produtoSelecionado.name,
                productCatalogId:   produtoSelecionado.catalogId,
                address: {
                    streetName:      enderecoDetalhes.streetName,
                    streetNr:        enderecoDetalhes.streetNr,
                    neighborhood:    enderecoDetalhes.neighborhood,
                    locality:        enderecoDetalhes.locality,
                    stateOrProvince: enderecoDetalhes.stateOrProvince,
                    postcode:        enderecoDetalhes.postcode,
                    description:     enderecoDetalhes.description
                },
                complement:   complementoSelecionado,
                slotDate:     slotSelecionado.startDate,
                creationDate: new Date().toISOString()
            };
            createdOrders.push(newOrder);

            console.log('[APP] Ordem de Serviço armazenada no Bolsão:', newOrder);

            res.json({
                status:             'sucesso',
                message:            'Ordem de Serviço criada com sucesso!',
                orderId:            osResult.order.id,
                saId:               agendamentoId,
                associatedDocument: osResult.order.associatedDocument || subscriberId, // ✅ fallback para subscriberId
                subscriberId:       subscriberId, // ✅ envia explicitamente
                ambiente:           ambienteResolvido
            });
        } else {
            console.error('[APP] Resposta inesperada da API de Ordem de Serviço:', osResult);
            res.status(500).json({ status: 'erro', message: 'Erro ao criar Ordem de Serviço: ID não retornado pela API.' });
        }
    } catch (error) {
        console.error('[APP] Erro ao criar Ordem de Serviço:', error.message);
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

// ─────────────────────────────────────────────
// ✅ Iniciar servidor — 0.0.0.0 obrigatório no OpenShift
// ─────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor rodando em http://0.0.0.0:${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
});