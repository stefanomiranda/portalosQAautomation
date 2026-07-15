// core/ordemServico.js
const axios = require('axios');
const https = require('https');
const { getConfigForEnv } = require('../config');

// CUIDADO: NÃO USE rejectUnauthorized: false EM PRODUÇÃO!
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function criarOrdemServico(
    cp_selection,
    addressId,
    complementoSelecionado,
    produtoSelecionado,
    slotSelecionado,
    agendamentoId,
    accessToken,
    subscriberId,
    inventoryId,
    ambienteOuOpcoes = 'TRG',
    opcoesParam = {}
) {
    let ambiente = 'TRG';
    let opcoes = {};

    if (typeof ambienteOuOpcoes === 'string') {
        ambiente = ambienteOuOpcoes || 'TRG';
        opcoes = opcoesParam || {};
    } else if (ambienteOuOpcoes && typeof ambienteOuOpcoes === 'object') {
        opcoes = ambienteOuOpcoes;
        ambiente = ambienteOuOpcoes.ambiente || 'TRG';
    }

    const config = getConfigForEnv(ambiente);
    const apiUrl = config.BASE_PRODUCT_ORDER_URL;

    const correlationOrder = subscriberId;

    const now = new Date();
    const offsetMinutes = now.getTimezoneOffset();
    const offsetSign = offsetMinutes > 0 ? '-' : '+';
    const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
    const offsetRemainingMinutes = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
    const timezoneOffset = `${offsetSign}${offsetHours}:${offsetRemainingMinutes}`;

    const associatedDocumentDate = `${now.toISOString().split('.')[0]}${timezoneOffset}`;

    const orderTypeFinal = opcoes.orderType || "Instalacao";
    const infraTypeFinal = opcoes.infraType || 'FTTH';
    const addressReferenceFinal = opcoes.reference || "Próximo ao ponto de ônibus";

    const associatedDocumentFinal =
        orderTypeFinal === 'Retirada' && opcoes.associatedDocument
            ? opcoes.associatedDocument
            : correlationOrder;

    const hasAppointment = !!(slotSelecionado && agendamentoId);

    // ============================================================
    // ✅ FIX CHAVE — normalizarProdutos lê de 3 fontes:
    //   1) opcoes.produtos (array de 2 com VoIP) ← PREFERÊNCIA
    //   2) produtoSelecionado como array (legado)
    //   3) produtoSelecionado como objeto singular (legado)
    // ============================================================
    const produtosParaPayload = normalizarProdutos(
        produtoSelecionado,
        opcoes.produtos,
        orderTypeFinal
    );

    const requestBody = {
        order: {
            correlationOrder: correlationOrder,
            associatedDocument: associatedDocumentFinal,
            associatedDocumentDate: associatedDocumentDate,
            type: orderTypeFinal,
            infraType: infraTypeFinal,
            ...(orderTypeFinal === 'Instalacao' && opcoes.addressChangeFlag && {
                addressChange: { flag: true }
            }),
            ...(opcoes.correlationOrderOriginal && {
                correlationOrderOriginal: opcoes.correlationOrderOriginal
            }),
            customer: {
                name: "Cliente Teste Portal OS",
                subscriberId: subscriberId,
                ...(opcoes.subscriberIdOld && { subscriberIdOld: opcoes.subscriberIdOld }),
                businessUnity: "varejo",
                fantasyName: "Portal OS",
                phoneNumber: {
                    phoneNumbers: [
                        "999999999",
                        "999999999"
                    ]
                },
                workContact: {
                    name: "",
                    email: "",
                    phone: ""
                }
            },
            ...(hasAppointment && {
                appointment: {
                    hasSlot: true,
                    date: slotSelecionado.startDate,
                    mandatoryType: "Obrigatorio",
                    workOrderId: agendamentoId
                }
            }),
            addresses: {
                address: {
                    id: addressId,
                    inventoryId: inventoryId,
                    reference: addressReferenceFinal,
                    complement: {
                        complements: []
                    }
                }
            },
            products: {
                product: produtosParaPayload
            }
        }
    };

    if (complementoSelecionado && complementoSelecionado.value && complementoSelecionado.type) {
        requestBody.order.addresses.address.complement.complements.push({
            type: complementoSelecionado.type,
            value: complementoSelecionado.value
        });
    }

    console.log(`[ORDEM_SERVICO] Chamando criarOrdemServico para correlationOrder: ${correlationOrder}`);
    console.log(`  Ambiente: ${ambiente}`);
    console.log(`  URL Base: ${apiUrl}`);
    console.log(`  CP Selecionado: ${cp_selection}`);
    console.log(`  associatedDocument final: ${associatedDocumentFinal}`);
    console.log(`  orderType final: ${orderTypeFinal}`);
    console.log(`  hasAppointment: ${hasAppointment}`);
    // ✅ ESTA LINHA é a prova de que a versão nova está rodando
    console.log(`  produtos (${produtosParaPayload.length}): ${produtosParaPayload.map(p => p.catalogId).join(', ')}`);
    if (opcoes.subscriberIdOld) {
        console.log(`  subscriberIdOld: ${opcoes.subscriberIdOld}`);
    }
    if (opcoes.correlationOrderOriginal) {
        console.log(`  correlationOrderOriginal: ${opcoes.correlationOrderOriginal}`);
    }
    console.log('  AccessToken (primeiros 10 chars):', accessToken ? accessToken.substring(0, 10) + '...' : 'N/A');
    console.log('[ORDEM_SERVICO] Request Body para productOrder:', JSON.stringify(requestBody, null, 2));

    try {
        const response = await axios.post(apiUrl, requestBody, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            httpsAgent: httpsAgent,
            validateStatus: function (status) {
                return status >= 200 && status < 500;
            }
        });

        if (response.status >= 400) {
            console.error(`[ORDEM_SERVICO] Erro ao criar OS (Status: ${response.status}):`);
            console.error('  Dados da resposta:', response.data);
            throw new Error(`Erro na API de Ordem de Serviço: ${JSON.stringify(response.data)}`);
        }

        if (response.data.control && response.data.control.type === 'E') {
            console.error(`[ORDEM_SERVICO] Erro de controle na API de OS: ${response.data.control.message}`);
            throw new Error(`Erro na API de Ordem de Serviço: ${response.data.control.message}`);
        }

        console.log('[ORDEM_SERVICO] Ordem de Serviço criada com sucesso:', response.data);

        return {
            ...response.data,
            correlationOrder: correlationOrder,
            associatedDocument: associatedDocumentFinal,
            subscriberId: subscriberId
        };

    } catch (error) {
        console.error(`[ORDEM_SERVICO] Erro na requisição de criarOrdemServico:`);
        if (error.response) {
            console.error('  Status:', error.response.status);
            console.error('  Dados:', error.response.data);
            const errorMessage = error.response.data.control && error.response.data.control.message
                ? error.response.data.control.message
                : error.message;
            throw new Error('Erro ao criar Ordem de Serviço: ' + errorMessage);
        } else if (error.request) {
            console.error('  Requisição feita, mas sem resposta. Possível problema de rede/proxy.');
            throw new Error('Erro ao criar Ordem de Serviço: Sem resposta do servidor.');
        } else {
            console.error('  Erro na configuração da requisição:', error.message);
            throw new Error('Erro ao criar Ordem de Serviço: ' + error.message);
        }
    }
}

// ============================================================
// ✅ normalizarProdutos — 3 fontes, com attributes preservados
// ============================================================
function normalizarProdutos(produtoSelecionado, opcoesProdutos, orderTypeFinal) {
    const actionDefault = orderTypeFinal === 'Retirada' ? 'remover' : 'adicionar';

    // 1) Preferência: opcoes.produtos (array vindo da rota /api/criar-os)
    // 2) Fallback: produtoSelecionado (array legado)
    // 3) Fallback: produtoSelecionado (objeto singular legado)
    let lista = [];
    if (Array.isArray(opcoesProdutos) && opcoesProdutos.length > 0) {
        lista = opcoesProdutos;
    } else if (Array.isArray(produtoSelecionado) && produtoSelecionado.length > 0) {
        lista = produtoSelecionado;
    } else if (produtoSelecionado && typeof produtoSelecionado === 'object') {
        lista = [produtoSelecionado];
    }

    return lista
        .filter(p => p && p.catalogId)
        .map(p => {
            const item = {
                catalogId: p.catalogId,
                action: p.action || actionDefault
            };
            if (p.attributes && typeof p.attributes === 'object') {
                item.attributes = p.attributes;
            }
            return item;
        });
}

module.exports = { criarOrdemServico };