// core/auth.js
const axios = require('axios');
const https = require('https'); // Importar o módulo https
const config = require('../config');
// Configuração do agente HTTPS para ignorar erros de certificado (para ambiente de desenvolvimento/teste)
// CUIDADO: NÃO USE rejectUnauthorized: false EM PRODUÇÃO!
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function getTokenForCp(cpId, clientsConfig) {
    const cpInfo = clientsConfig[cpId];
    if (!cpInfo) {
        console.error(`[AUTH] Configurações não encontradas para o CP: ${cpId}`);
        return null;
    }

    const { client_id, client_secret, grant_type, scope } = cpInfo; // Pegar grant_type e scope do cpInfo

    // Usar a URL correta do Postman
    const tokenBaseUrl = process.env.TOKEN_URL || 'https://apitrg.vtal.com.br/auth/oauth/v2/token';

    try {
        // Buffer com as credenciais para Basic Auth
        const auth = Buffer.from(`${client_id}:${client_secret}`).toString('base64');

        // Construir a URL com os query parameters, como no Postman
        const tokenUrlWithParams = `${tokenBaseUrl}?grant_type=${grant_type}&scope=${scope}`;

        const response = await axios.post(tokenUrlWithParams, // URL com query parameters
            null, // Corpo da requisição é null, pois os parâmetros estão na URL
            {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    // 'Content-Type': 'application/x-www-form-urlencoded' // Não é necessário se o corpo é null
                },
                httpsAgent: httpsAgent, // Usar o agente HTTPS configurado
                // Adicionar validateStatus para ver a resposta da API mesmo em caso de erro 4xx
                validateStatus: function (status) {
                    return status >= 200 && status < 500; // Não lança erro para status 4xx
                }
            }
        );

        // Verificar o status da resposta para erros de autenticação
        if (response.status >= 400) {
            console.error(`[AUTH] Erro de autenticação para CP ${cpId} (Status: ${response.status}):`, response.data);
            return null;
        }

        console.log(`[AUTH] Token obtido com sucesso para CP: ${cpId}`);
        return response.data;
    } catch (error) {
        console.error(`[AUTH] Erro ao obter token para ${cpId}:`);
        if (error.response) {
            console.error('  Status:', error.response.status);
            console.error('  Dados:', error.response.data);
        } else if (error.request) {
            console.error('  Requisição feita, mas sem resposta. Possível problema de rede/proxy.');
            console.error('  Detalhes da requisição:', error.request);
        } else {
            console.error('  Erro na configuração da requisição:', error.message);
        }
        return null;
    }
}

module.exports = { getTokenForCp };