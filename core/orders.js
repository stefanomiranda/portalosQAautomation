// core/orders.js
const axios = require('axios');
const https = require('https');
const { getConfigForEnv } = require('../config');

// CUIDADO: NÃO USE rejectUnauthorized: false EM PRODUÇÃO!
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Busca os dados de uma OS (Instalação original) pelo SubscriberId.
 * Necessário para preencher o payload da Retirada sistêmica (que precisa
 * do addressId, inventoryId e complement do ENDEREÇO ANTIGO, não do novo).
 *
 * @param {string} subscriberId  - SubscriberId da OS original (a que está sendo desfeita)
 * @param {string} accessToken   - Token OAuth do CP
 * @param {string} cpSelection   - CP selecionado
 * @param {string} ambiente      - 'TRG' | 'TI' | 'TRG2'
 * @returns {Promise<Object>}    - { orderId, addressId, inventoryId, complement, ... }
 */
async function buscarOrdemPorSubscriberId(subscriberId, accessToken, cpSelection, ambiente = 'TRG') {
    const config = getConfigForEnv(ambiente);
    // Endpoint da V.tal para consultar OS por subscriberId
    // ⚠️ AJUSTAR a URL conforme o endpoint real da V.tal que você usa
    const apiUrl = `${config.BASE_PRODUCT_ORDER_URL}/search?subscriberId=${encodeURIComponent(subscriberId)}`;

    console.log(`[ORDERS] Buscando OS por subscriberId: ${subscriberId}`);
    console.log('  Ambiente:', ambiente);
    console.log('  URL:', apiUrl);
    console.log(`  CP Selecionado: ${cpSelection}`);

    try {
        const response = await axios.get(apiUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'cp': cpSelection
            },
            httpsAgent: httpsAgent,
            validateStatus: function (status) {
                return status >= 200 && status < 500;
            }
        });

        if (response.status >= 400) {
            console.error(`[ORDERS] Erro ao buscar OS (Status: ${response.status}):`, response.data);
            throw new Error(`Erro ${response.status} ao buscar OS: ${JSON.stringify(response.data)}`);
        }

        // A resposta da V.tal geralmente vem em response.data com a estrutura
        // { order: { id, addresses: { address: { id, inventoryId, complement } } } }
        // ⚠️ AJUSTAR o parseamento conforme a estrutura real da resposta
        const data = response.data || {};
        const order = data.order || data;
        const address = (order.addresses && order.addresses.address) || order.address || {};

        return {
            orderId: order.id || order.orderId,
            associatedDocument: order.associatedDocument,
            addressId: address.id,
            inventoryId: address.inventoryId,
            complement: address.complement || { complements: [] },
            subscriberId: (order.customer && order.customer.subscriberId) || subscriberId
        };
    } catch (err) {
        console.error(`[ORDERS] Erro ao buscar OS por subscriberId: ${err.message}`);
        throw new Error(`Erro ao buscar OS por subscriberId: ${err.message}`);
    }
}

module.exports = { buscarOrdemPorSubscriberId };