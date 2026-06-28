// core/viabilidade.js
const axios = require('axios');
const https = require('https');
const config = require('../config'); // Importar as configurações
// subscriberIdCounter será removido daqui, pois o subscriberId será gerado e gerenciado no app.js/frontend.
// let subscriberIdCounter = 0;

// Configuração do agente HTTPS para ignorar erros de certificado (para ambiente de desenvolvimento/teste)
// CUIDADO: NÃO USE rejectUnauthorized: false EM PRODUÇÃO!
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function buscarEndereco(cep, numero, accessToken) {
    // A URL correta para buscar endereço com CEP e número
    const apiUrl = config.BASE_ADDRESS_URL;

    // Logar o que está sendo enviado para depuração
    console.log('[VIABILIDADE] Chamando buscarEndereco com:');
    console.log('  URL Base:', apiUrl);
    console.log('  CEP:', cep);
    console.log('  Número:', numero);
    console.log('  AccessToken (primeiros 10 chars):', accessToken ? accessToken.substring(0, 10) + '...' : 'N/A');

    try {
        const response = await axios.get(apiUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            params: { // Os parâmetros 'address' e 'number' são passados como query parameters
                'address': cep, // O nome do parâmetro é 'address' para o CEP
                'number': numero // O nome do parâmetro é 'number' para o número da fachada
            },
            httpsAgent: httpsAgent, // Usar o agente HTTPS configurado
            // Adicionar validateStatus para ver a resposta da API mesmo em caso de erro 4xx
            validateStatus: function (status) {
                return status >= 200 && status < 500; // Não lança erro para status 4xx
            }
        });

        // Verificar o status da resposta para erros da API
        if (response.status >= 400) {
            console.error(`[VIABILIDADE] Erro ao buscar endereço (Status: ${response.status}):`);
            console.error('  Dados da resposta:', response.data);
            throw new Error(`Erro na API de endereço: ${JSON.stringify(response.data)}`);
        }

        console.log('[VIABILIDADE] Endereço encontrado com sucesso:', response.data);
        return response.data; // Retorna os dados do endereço
    } catch (error) {
        console.error(`[VIABILIDADE] Erro na requisição de buscarEndereco:`);
        if (error.response) {
            console.error('  Status:', error.response.status);
            console.error('  Dados:', error.response.data); // Isso deve mostrar o HTML de erro se ainda houver
        } else if (error.request) {
            console.error('  Requisição feita, mas sem resposta. Possível problema de rede/proxy.');
            console.error('  Detalhes da requisição:', error.request);
        } else {
            console.error('  Erro na configuração da requisição:', error.message);
        }
        throw new Error('Erro ao buscar endereço.');
    }
}

async function buscarComplementos(addressId, accessToken) {
    const apiUrl = `${config.BASE_ADDRESS_COMPLEMENTS_URL}/${addressId}`;

    console.log(`[VIABILIDADE] Chamando buscarComplementos para addressId: ${addressId}`);

    try {
        const response = await axios.get(apiUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            validateStatus: (status) => {
                return status >= 200 && status < 300 || status === 404;
            }
        });

        if (response.status === 404) {
            console.log(`[VIABILIDADE] Nenhum complemento encontrado para addressId: ${addressId} (Status: 404). Retornando array vazio.`);
            return [];
        }

        if (response.data.control && response.data.control.type === 'E') {
            console.error(`[VIABILIDADE] Erro de controle na API de complementos: ${response.data.control.message}`);
            throw new Error(`Erro na API de complementos: ${response.data.control.message}`);
        }

        // --- Lógica CORRIGIDA para extrair complementos da estrutura real da API ---
        const extractedComplementos = [];
        if (response.data && Array.isArray(response.data.complementList)) {
            response.data.complementList.forEach(item => {
                if (item.complement && Array.isArray(item.complement.complements)) {
                    item.complement.complements.forEach(compDetail => {
                        extractedComplementos.push({
                            id: item.id, // O ID do item na complementList
                            type: compDetail.type,
                            description: compDetail.description,
                            value: compDetail.value
                        });
                    });
                }
            });
        }

        if (extractedComplementos.length > 0) {
            console.log('[VIABILIDADE] Complementos encontrados e formatados com sucesso:', extractedComplementos);
            return extractedComplementos;
        } else {
            console.log('[VIABILIDADE] Resposta da API de complementos não contém a estrutura esperada ou está vazia. Retornando array vazio.');
            return [];
        }

    } catch (error) {
        console.error(`[VIABILIDADE] Erro na requisição de buscarComplementos:`);
        if (error.response) {
            console.error('  Status:', error.response.status);
            console.error('  Dados:', error.response.data);
            const errorMessage = error.response.data.control && error.response.data.control.message ? error.response.data.control.message : error.message;
            throw new Error('Erro na API de complementos: ' + errorMessage);
        } else if (error.request) {
            console.error('  Requisição feita, mas sem resposta. Possível problema de rede/proxy.');
            throw new Error('Erro na API de complementos: Sem resposta do servidor.');
        } else {
            console.error('  Erro na configuração da requisição:', error.message);
            throw new Error('Erro na API de complementos: ' + error.message);
        }
    }
}

async function verificarDisponibilidade(addressId, complementoSelecionado, cp_selection, accessToken, subscriberId) {
    // subscriberId agora é passado como parâmetro
    // subscriberIdCounter e sua geração foram removidos daqui.

    console.log(`[VIABILIDADE] Chamando verificarDisponibilidade para addressId: ${addressId}, Complemento: ${JSON.stringify(complementoSelecionado)}`);
    console.log(`  CP Selecionado: ${cp_selection}`);
    console.log(`  SubscriberId: ${subscriberId}`);
    console.log('  AccessToken (primeiros 10 chars):', accessToken ? accessToken.substring(0, 10) + '...' : 'N/A');

    let requestBody = {
        customer: {
            subscriberId: subscriberId
        },
        address: {
            id: addressId
        }
    };

    // APENAS ADICIONA O COMPLEMENTO SE UM FOI SELECIONADO E TEM VALOR/TIPO
    if (complementoSelecionado && complementoSelecionado.value && complementoSelecionado.type) {
        requestBody.address.complement = {
            complements: [
                {
                    type: complementoSelecionado.type, // Usa o tipo do complemento selecionado
                    value: complementoSelecionado.value // Usa o valor do complemento selecionado
                }
            ]
        };
    } else {
        // Se não há complemento selecionado ou ele não tem type/value, envia vazio conforme sua solicitação anterior
        // Isso pode ser ajustado se a V.tal exigir que o campo 'complement' não exista se não houver complemento.
        // Por enquanto, vamos manter o que você pediu.
        requestBody.address.complement = {
            complements: [
                {
                    type: "",
                    value: ""
                }
            ]
        };
    }

    console.log('[VIABILIDADE] Request Body para availabilityCheck:', JSON.stringify(requestBody, null, 2));

    try {
        const response = await axios.post(config.BASE_AVAILABILITY_URL, requestBody, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            httpsAgent: httpsAgent
        });

        if (response.status >= 200 && response.status < 300) {
            console.log(`[VIABILIDADE] Disponibilidade verificada com sucesso. Control: ${JSON.stringify(response.data.control)}`);
            return response.data;
        } else {
            console.error(`[VIABILIDADE] Erro ao verificar disponibilidade (Status: ${response.status}):`, response.data);
            const errorMessage = response.data.control && response.data.control.message ? response.data.control.message : 'Erro desconhecido na API de disponibilidade.';
            const err = new Error('Erro na API de disponibilidade: ' + errorMessage);
            err.status = response.status;
            throw err;
        }
    } catch (error) {
        console.error('[VIABILIDADE] Erro na requisição de disponibilidade:', error);
        if (error.response) {
            console.error('  Status:', error.response.status);
            console.error('  Dados:', error.response.data);
            const errorMessage = error.response.data.control && error.response.data.control.message ? error.response.data.control.message : error.message;
            const err = new Error('Erro na API de disponibilidade: ' + errorMessage);
            err.status = error.response.status;
            throw err;
        } else if (error.request) {
            console.error('  Requisição feita, mas sem resposta. Possível problema de rede/proxy.');
            console.error('  Detalhes da requisição:', error.request);
            const err = new Error('Erro na requisição: Sem resposta do servidor.');
            err.status = 503; // Service Unavailable
            throw err;
        } else {
            console.error('  Erro na configuração da requisição:', error.message);
            const err = new Error('Erro na configuração da requisição: ' + error.message);
            err.status = 500;
            throw err;
        }
    }
}

async function buscarSlots(cp_selection, addressId, subscriberId, productType, accessToken) {
    // ... (sua lógica existente para buscar slots) ...
    // Certifique-se de que esta função retorna o array de slots diretamente
    // ou um objeto com uma propriedade 'slots' que é um array.
    // Exemplo: return response.data.slots;
}

module.exports = { buscarEndereco, buscarComplementos, verificarDisponibilidade, buscarSlots };