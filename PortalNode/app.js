// app.js
const express = require('express');
const path = require('path');
const { CLIENTS } = require('./clients');
const { getTokenForCp } = require('./core/auth');
const { buscarEndereco, buscarComplementos, verificarDisponibilidade } = require('./core/viabilidade');
const { buscarSlotsDisponiveis, agendarSlot } = require('./core/agendamento'); // Novo módulo
const { criarOrdemServico } = require('./core/ordemServico'); // Novo módulo <--- Importação correta
const multer = require('multer'); // Importar multer
const { processarPlanilhaViabilidade } = require('./core/viabilidadeLoteProcessor'); 
const app = express();
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando em http://0.0.0.0:${PORT}`);
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Contador para gerar subscriberId único
let globalSubscriberIdCounter = 103;
const createdOrders = [];

app.get('/api/cps', (req, res) => {
    try {
        const cpList = Object.keys(CLIENTS); // Pega as chaves do objeto CLIENTS
        console.log('[APP] CPs disponíveis:', cpList); // Log para depuração
        res.json(cpList);
    } catch (error) {
        console.error('[APP] Erro ao listar CPs:', error);
        res.status(500).json({ status: 'erro', message: 'Erro ao listar CPs.' });
    }
});

app.post('/api/consultar-endereco', async (req, res) => {
    const { cp_selection, cep, numero } = req.body;

    if (!cp_selection || !cep || !numero) {
        return res.status(400).json({ status: 'erro', message: 'CP, CEP e Número são obrigatórios.' });
    }

    try {
        const tokenData = await getTokenForCp(cp_selection, CLIENTS);
        console.log('[APP] Dados do Token recebidos:', JSON.stringify(tokenData, null, 2));

        if (!tokenData || !tokenData.access_token) {
            return res.status(401).json({ status: 'erro', message: 'Não foi possível obter o token de autenticação.' });
        }
        const accessToken = tokenData.access_token;

        const enderecoResult = await buscarEndereco(cep, numero, accessToken);
        console.log('[APP] Resposta completa de buscarEndereco:', JSON.stringify(enderecoResult, null, 2));

        let addressId = null;
        let enderecoDetalhes = null;
        if (enderecoResult && enderecoResult.addresses && enderecoResult.addresses.address && enderecoResult.addresses.address.length > 0) {
            enderecoDetalhes = enderecoResult.addresses.address[0];
            addressId = enderecoDetalhes.id;
        } else {
            return res.status(404).json({
                status: 'erro',
                message: 'Endereço não encontrado ou sem detalhes.',
                endereco: enderecoResult
            });
        }

        // --- CHAMADA E ATRIBUIÇÃO CORRIGIDA ---
        const complementos = addressId ? await buscarComplementos(addressId, accessToken) : [];
        console.log('[APP] Complementos enviados para o frontend:', complementos); // Log para verificar

        // Mapeia os campos do endereço para o formato esperado pelo frontend
        const enderecoFormatado = {
            id: enderecoDetalhes.id,
            description: enderecoDetalhes.description, // Adicionado para exibir no frontend
            streetName: enderecoDetalhes.streetName,
            streetNr: enderecoDetalhes.number,
            neighborhood: enderecoDetalhes.neighborhood,
            locality: enderecoDetalhes.city,
            stateOrProvince: enderecoDetalhes.stateAbbreviation,
            postcode: enderecoDetalhes.zipCode
        };

        // Gerar um subscriberId único para este fluxo
        globalSubscriberIdCounter++;
        const subscriberId = `TDMQUALIDADEOSS${String(globalSubscriberIdCounter).padStart(3, '0')}`;

        res.json({
            status: 'sucesso',
            endereco: enderecoFormatado,
            addressId: addressId,
            complementos: complementos, // <--- AGORA PASSA O ARRAY DIRETAMENTE
            accessToken: accessToken, // Retorna o token para uso posterior no frontend
            subscriberId: subscriberId // Retorna o subscriberId gerado
        });

    } catch (error) {
        console.error('[APP] Erro no backend ao consultar endereço:', error);
        res.status(500).json({ status: 'erro', message: error.message });
    }
});

// Rota para verificar disponibilidade
app.post('/api/verificar-disponibilidade', async (req, res) => {
    const { cp_selection, addressId, complementoSelecionado, accessToken, subscriberId } = req.body;

    if (!cp_selection || !addressId || !accessToken || !subscriberId) {
        return res.status(400).json({ status: 'erro', message: 'CP, ID do Endereço, Token e SubscriberId são obrigatórios.' });
    }
    if (typeof accessToken !== 'string') {
        return res.status(401).json({ status: 'erro', message: 'Token de autenticação inválido ou ausente.' });
    }

    try {
        const disponibilidadeResult = await verificarDisponibilidade(addressId, complementoSelecionado, cp_selection, accessToken, subscriberId);

        const control = disponibilidadeResult.control;
        const resource = disponibilidadeResult.resource;

        if (control && control.type === 'S') {
            res.json({
                status: 'sucesso',
                message: control.message,
                products: resource.products ? resource.products.product : [],
                inventoryId: resource.inventoryId,
                accessToken: accessToken, // Retorna o token atualizado
                subscriberId: subscriberId // Retorna o subscriberId
            });
        } else {
            res.status(400).json({
                status: 'erro',
                message: control && control.message ? control.message : 'Erro desconhecido ao verificar disponibilidade.',
                control: control
            });
        }
    } catch (error) {
        console.error('[APP] Erro no backend ao verificar disponibilidade:', error);
        res.status(500).json({ status: 'erro', message: error.message });
    }
});

// Rota para buscar slots de agendamento
app.post('/api/buscar-slots', async (req, res) => {
    const { cp_selection, addressId, subscriberId, productType, accessToken } = req.body;

    if (!cp_selection || !addressId || !subscriberId || !productType || !accessToken) {
        return res.status(400).json({ status: 'erro', message: 'Dados incompletos para buscar slots.' });
    }

    try {
        const slotsResult = await buscarSlotsDisponiveis(addressId, subscriberId, productType, accessToken, cp_selection);

        if (slotsResult && slotsResult.slots && slotsResult.slots.length > 0) {
            res.json({
                status: 'sucesso',
                message: 'Slots disponíveis encontrados.',
                slots: slotsResult.slots // Retorna o array de slots
            });
        } else {
            res.status(404).json({ status: 'erro', message: 'Nenhum slot disponível encontrado.' });
        }
    } catch (error) {
        console.error('[APP] Erro no backend ao buscar slots:', error);
        res.status(500).json({ status: 'erro', message: error.message });
    }
});

// Rota para agendar um slot
app.post('/api/agendar-slot', async (req, res) => {
    const { cp_selection, slotId, accessToken } = req.body;

    if (!cp_selection || !slotId || !accessToken) {
        return res.status(400).json({ status: 'erro', message: 'CP, ID do Slot e Token são obrigatórios.' });
    }

    try {
        const agendamentoResult = await agendarSlot(slotId, accessToken, cp_selection);

        if (agendamentoResult && agendamentoResult.control && agendamentoResult.control.type === 'S') {
            res.json({
                status: 'sucesso',
                message: agendamentoResult.control.message,
                agendamentoId: agendamentoResult.appointment ? agendamentoResult.appointment.id : null,
                accessToken: accessToken
            });
        } else {
            res.status(400).json({
                status: 'erro',
                message: agendamentoResult && agendamentoResult.control && agendamentoResult.control.message ? agendamentoResult.control.message : 'Erro desconhecido ao agendar slot.',
                control: agendamentoResult ? agendamentoResult.control : null
            });
        }
    } catch (error) {
        console.error('[APP] Erro no backend ao agendar slot:', error);
        res.status(500).json({ status: 'erro', message: error.message });
    }
});

// Rota para criar Ordem de Serviço
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
        enderecoDetalhes // <--- Certifique-se de que o frontend está enviando isso
    } = req.body;

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
            inventoryId
        );

        // A API de productOrder retorna o ID da OS em `order.id`
        if (osResult && osResult.order && osResult.order.id) {
            // --- INÍCIO DA CORREÇÃO: Criar e armazenar a nova OS para o Bolsão ---
            const newOrder = {
                orderId: osResult.order.id,
                saId: agendamentoId, // O ID do agendamento que foi usado
                correlationOrder: osResult.order.correlationOrder,
                associatedDocument: osResult.order.associatedDocument, // Usar o associatedDocument retornado pela API
                cp: cp_selection,
                subscriberId: subscriberId,
                productName: produtoSelecionado.name,
                productCatalogId: produtoSelecionado.catalogId,
                address: { // Mapear os detalhes do endereço para exibição
                    streetName: enderecoDetalhes.streetName,
                    streetNr: enderecoDetalhes.streetNr,
                    neighborhood: enderecoDetalhes.neighborhood,
                    locality: enderecoDetalhes.locality,
                    stateOrProvince: enderecoDetalhes.stateOrProvince,
                    postcode: enderecoDetalhes.postcode,
                    description: enderecoDetalhes.description // A descrição completa do endereço
                },
                complement: complementoSelecionado, // Objeto completo do complemento
                slotDate: slotSelecionado.startDate, // Data de início do slot
                creationDate: new Date().toISOString() // Data de criação da OS no formato ISO
            };
            createdOrders.push(newOrder); // Adiciona a nova OS ao array global

            console.log('[APP] Ordem de Serviço armazenada no Bolsão:', newOrder);
            // --- FIM DA CORREÇÃO ---

            res.json({
                status: 'sucesso',
                message: 'Ordem de Serviço criada com sucesso!',
                orderId: osResult.order.id,
                saId: agendamentoId, // Retorna o ID do agendamento
                associatedDocument: osResult.order.associatedDocument // Retorna o associatedDocument da API
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

app.get('/api/ordens-servico', (req, res) => {
    console.log('[APP] Requisição para listar Ordens de Serviço. Total:', createdOrders.length);
    res.json({
        status: 'sucesso',
        orders: createdOrders
    });
});

const upload = multer({
    dest: 'uploads/' // Pasta temporária para armazenar os arquivos enviados
});

app.post('/api/upload-viabilidade-lote', upload.single('spreadsheet'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 'erro', message: 'Nenhum arquivo enviado.' });
  }

  const cp_selection = String(req.body.cp_selection || '').trim();
  if (!cp_selection) {
    return res.status(400).json({ status: 'erro', message: 'CP de seleção é obrigatório.' });
  }

  if (!CLIENTS[cp_selection]) {
    return res.status(400).json({ status: 'erro', message: `CP inválido: ${cp_selection}` });
  }

  try {
    console.log('[UPLOAD] arquivo:', req.file.originalname, 'cp:', cp_selection);

    const result = await processarPlanilhaViabilidade(req.file.path, cp_selection, CLIENTS);
    const fileName = path.basename(result.resultFilePath || result);

    return res.json({
      status: 'sucesso',
      message: 'Planilha processada com sucesso!',
      fileName
    });
  } catch (error) {
    console.error('[APP] Erro ao processar planilha de viabilidade em lote:', error);
    return res.status(500).json({ status: 'erro', message: error.message });
  } finally {
    // aqui pode remover req.file.path se você usa arquivo temporário
  }
});

app.get('/api/download-viabilidade-lote', (req, res) => {
  const fileName = String(req.query.fileName || '').trim();
  if (!fileName) {
    return res.status(400).json({ status: 'erro', message: 'Nome do arquivo não fornecido.' });
  }

  // proteção básica contra path traversal
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

app.use(express.static('public')); 
