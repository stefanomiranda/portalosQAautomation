// core/ordemServico.js
const axios = require('axios');
const https = require('https');
const { getConfigForEnv } = require('../config');

// CUIDADO: NÃO USE rejectUnauthorized: false EM PRODUÇÃO!
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function criarOrdemServico(cp_selection, addressId, complementoSelecionado, produtoSelecionado, slotSelecionado, agendamentoId, accessToken, subscriberId, inventoryId, ambiente = 'TRG') {
    const config = getConfigForEnv(ambiente);
    const apiUrl = config.BASE_PRODUCT_ORDER_URL;

    // Gerar correlationOrder único
    const correlationOrder = `PORTALOS-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

    // Formatar datas
    const now = new Date();
    const offsetMinutes = now.getTimezoneOffset();
    const offsetSign = offsetMinutes > 0 ? '-' : '+';
    const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
    const offsetRemainingMinutes = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
    const timezoneOffset = `${offsetSign}${offsetHours}:${offsetRemainingMinutes}`;

    const associatedDocumentDate = `${now.toISOString().split('.')[0]}${timezoneOffset}`;
    const appointmentDate = slotSelecionado.startDate;

    const requestBody = {
        order: {
            correlationOrder: correlationOrder,
            associatedDocument: subscriberId,
            associatedDocumentDate: associatedDocumentDate,
            type: "Instalacao",
            infraType: 'FTTH',
            customer: {
                name: "Cliente Teste Portal OS",
                subscriberId: subscriberId,
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
            appointment: {
                hasSlot: true,
                date: appointmentDate,
                mandatoryType: "Obrigatorio",
                workOrderId: agendamentoId
            },
            addresses: {
                address: {
                    id: addressId,
                    inventoryId: inventoryId,
                    reference: "Próximo ao ponto de ônibus",
                    complement: {
                        complements: []
                    }
                }
            },
            products: {
                product: [
                    {
                        catalogId: produtoSelecionado.catalogId,
                        action: "adicionar"
                    }
                ]
            }
        }
    };

    // Adicionar complemento se existir
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
        return response.data;

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

module.exports = { criarOrdemServico };