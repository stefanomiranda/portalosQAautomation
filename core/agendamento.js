// core/agendamento.js
const axios = require('axios');
const https = require('https');
const config = require('../config'); // Importar as configurações

// CUIDADO: NÃO USE rejectUnauthorized: false EM PRODUÇÃO!
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function buscarSlotsDisponiveis(addressId, subscriberId, productType, accessToken, cp_selection) {
    const apiUrl = config.BASE_APPOINTMENT_SEARCH_SLOT_URL;

    // Calcular datas para 5 dias a partir de hoje
    const now = new Date();
    // Ajuste: startDate para o dia seguinte, e formatar sem 'Z' e com horário fixo
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1); // Começa a busca a partir do dia seguinte
    const startDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}T11:00:00`;

    const finishDateObj = new Date(now);
    finishDateObj.setDate(now.getDate() + 5); // 5 dias à frente
    const finishDate = `${finishDateObj.getFullYear()}-${String(finishDateObj.getMonth() + 1).padStart(2, '0')}-${String(finishDateObj.getDate()).padStart(2, '0')}T18:00:00`;


    console.log(`[AGENDAMENTO] Chamando buscarSlotsDisponiveis para addressId: ${addressId}, subscriberId: ${subscriberId}`);
    console.log(`  CP Selecionado: ${cp_selection}`);
    console.log(`  Product Type: ${productType}`);
    console.log(`  Datas: ${startDate} a ${finishDate}`);
    console.log('  AccessToken (primeiros 10 chars):', accessToken ? accessToken.substring(0, 10) + '...' : 'N/A');

    try {
        const response = await axios.get(apiUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            params: {
                addressId: addressId,
                subscriberId: subscriberId,
                associatedDocument: subscriberId, // AGORA USA O subscriberId
                startDate: startDate,
                finishDate: finishDate,
                orderType: "Instalacao", // Para este fluxo, sempre instalação
                addressChangeFlag: false, // Nome do parâmetro corrigido
                productType: productType, // Tipo do produto selecionado
                priorityFlag: false,
                priorityReason: "" // Deixando vazio conforme o payload de sucesso
            },
            httpsAgent: httpsAgent,
            validateStatus: function (status) {
                return status >= 200 && status < 500;
            }
        });

        if (response.status >= 400) {
            console.error(`[AGENDAMENTO] Erro ao buscar slots (Status: ${response.status}):`);
            console.error('  Dados da resposta:', response.data);
            throw new Error(`Erro na API de agendamento (slots): ${JSON.stringify(response.data)}`);
        }

        if (response.data.control && response.data.control.type === 'E') {
            console.error(`[AGENDAMENTO] Erro de controle na API de slots: ${response.data.control.message}`);
            throw new Error(`Erro na API de agendamento (slots): ${response.data.control.message}`);
        }

        console.log('[AGENDAMENTO] Slots encontrados com sucesso:', response.data);
        return response.data; // Retorna os dados dos slots
    } catch (error) {
        console.error(`[AGENDAMENTO] Erro na requisição de buscarSlotsDisponiveis:`);
        if (error.response) {
            console.error('  Status:', error.response.status);
            console.error('  Dados:', error.response.data);
            const errorMessage = error.response.data.control && error.response.data.control.message ? error.response.data.control.message : error.message;
            throw new Error('Erro ao buscar slots: ' + errorMessage);
        } else if (error.request) {
            console.error('  Requisição feita, mas sem resposta. Possível problema de rede/proxy.');
            throw new Error('Erro ao buscar slots: Sem resposta do servidor.');
        } else {
            console.error('  Erro na configuração da requisição:', error.message);
            throw new Error('Erro ao buscar slots: ' + error.message);
        }
    }
}

async function agendarSlot(slotId, accessToken, cp_selection) {
    const apiUrl = config.BASE_APPOINTMENT_CREATE_URL;

    const requestBody = {
        appointment: {
            slot: {
                id: slotId
            },
            reason: "Agendamento para Instalação de Fibra" // Razão padrão
        }
    };

    console.log(`[AGENDAMENTO] Chamando agendarSlot para slotId: ${slotId}`);
    console.log(`  CP Selecionado: ${cp_selection}`);
    console.log('  AccessToken (primeiros 10 chars):', accessToken ? accessToken.substring(0, 10) + '...' : 'N/A');
    console.log('[AGENDAMENTO] Request Body para agendarSlot:', JSON.stringify(requestBody, null, 2));

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
            console.error(`[AGENDAMENTO] Erro ao agendar slot (Status: ${response.status}):`);
            console.error('  Dados da resposta:', response.data);
            throw new Error(`Erro na API de agendamento: ${JSON.stringify(response.data)}`);
        }

        if (response.data.control && response.data.control.type === 'E') {
            console.error(`[AGENDAMENTO] Erro de controle na API de agendamento: ${response.data.control.message}`);
            throw new Error(`Erro na API de agendamento: ${response.data.control.message}`);
        }

        console.log('[AGENDAMENTO] Slot agendado com sucesso:', response.data);
        return response.data; // Retorna os dados do agendamento criado
    } catch (error) {
        console.error(`[AGENDAMENTO] Erro na requisição de agendarSlot:`);
        if (error.response) {
            console.error('  Status:', error.response.status);
            console.error('  Dados:', error.response.data);
            const errorMessage = error.response.data.control && error.response.data.control.message ? error.response.data.control.message : error.message;
            throw new Error('Erro ao agendar slot: ' + errorMessage);
        } else if (error.request) {
            console.error('  Requisição feita, mas sem resposta. Possível problema de rede/proxy.');
            throw new Error('Erro ao agendar slot: Sem resposta do servidor.');
        } else {
            console.error('  Erro na configuração da requisição:', error.message);
            throw new Error('Erro ao agendar slot: ' + error.message);
        }
    }
}

module.exports = { buscarSlotsDisponiveis, agendarSlot };