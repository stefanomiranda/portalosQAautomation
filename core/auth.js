// core/auth.js
const axios = require('axios');
const https = require('https');
const { getConfigForEnv } = require('../config');

// CUIDADO: NÃO USE rejectUnauthorized: false EM PRODUÇÃO!
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ✅ Resolve as credenciais corretas para o CP e ambiente
function resolveCredentials(cpInfo, ambiente) {
    // Se o CP tem credenciais específicas por ambiente, usa elas
    if (cpInfo.credentials_by_env && cpInfo.credentials_by_env[ambiente]) {
        const envCreds = cpInfo.credentials_by_env[ambiente];
        console.log(`[AUTH] Usando credenciais específicas para ambiente ${ambiente}`);
        return {
            client_id:     envCreds.client_id,
            client_secret: envCreds.client_secret,
            grant_type:    cpInfo.grant_type,
            scope:         cpInfo.scope
        };
    }

    // Caso contrário, usa as credenciais padrão do CP
    console.log(`[AUTH] Usando credenciais padrão (sem override para ${ambiente})`);
    return {
        client_id:     cpInfo.client_id,
        client_secret: cpInfo.client_secret,
        grant_type:    cpInfo.grant_type,
        scope:         cpInfo.scope
    };
}

async function getTokenForCp(cpId, clientsConfig, ambiente = 'TRG') {
    const cpInfo = clientsConfig[cpId];
    if (!cpInfo) {
        console.error(`[AUTH] Configurações não encontradas para o CP: ${cpId}`);
        return null;
    }

    // ✅ Resolve credenciais corretas para o ambiente
    const { client_id, client_secret, grant_type, scope } = resolveCredentials(cpInfo, ambiente);

    // ✅ Resolve a URL do token dinamicamente com base no ambiente
    const config = getConfigForEnv(ambiente);
    const tokenBaseUrl = config.TOKEN_URL;

    console.log(`[AUTH] Ambiente selecionado: ${ambiente}`);
    console.log(`[AUTH] Token URL: ${tokenBaseUrl}`);
    console.log(`[AUTH] client_id utilizado: ${client_id}`);

    try {
        const auth = Buffer.from(`${client_id}:${client_secret}`).toString('base64');
        const tokenUrlWithParams = `${tokenBaseUrl}?grant_type=${grant_type}&scope=${scope}`;

        const response = await axios.post(
            tokenUrlWithParams,
            null,
            {
                headers: {
                    'Authorization': `Basic ${auth}`
                },
                httpsAgent: httpsAgent,
                validateStatus: function (status) {
                    return status >= 200 && status < 500;
                }
            }
        );

        if (response.status >= 400) {
            console.error(`[AUTH] Erro de autenticação para CP ${cpId} (Status: ${response.status}):`, response.data);
            return null;
        }

        console.log(`[AUTH] Token obtido com sucesso para CP: ${cpId} | Ambiente: ${ambiente}`);
        return response.data;

    } catch (error) {
        console.error(`[AUTH] Erro ao obter token para ${cpId}:`);
        if (error.response) {
            console.error('  Status:', error.response.status);
            console.error('  Dados:', error.response.data);
        } else if (error.request) {
            console.error('  Requisição feita, mas sem resposta. Possível problema de rede/proxy.');
        } else {
            console.error('  Erro na configuração da requisição:', error.message);
        }
        return null;
    }
}

module.exports = { getTokenForCp };