// config.js

const ENVIRONMENTS = {
    TRG:  'https://apitrg.vtal.com.br',
    TI:   'https://api-ti1.vtal.com.br',
    TRG2: 'https://api-reg.vtal.com.br'
};

function getConfigForEnv(ambiente = 'TRG') {
    const BASE_HOST = ENVIRONMENTS[ambiente] || ENVIRONMENTS['TRG'];

    return {
        TOKEN_URL:                        `${BASE_HOST}/auth/oauth/v2/token`,
        BASE_ADDRESS_URL:                 `${BASE_HOST}/api/geographicAddressManagement/v1/geographicAddress`,
        BASE_ADDRESS_COMPLEMENTS_URL:     `${BASE_HOST}/api/geographicAddressManagement/v1/addressComplements`,
        BASE_AVAILABILITY_URL:            `${BASE_HOST}/api/resourcePoolManagement/v2/availabilityCheck`,
        BASE_APPOINTMENT_SEARCH_SLOT_URL: `${BASE_HOST}/api/appointment/v2/searchTimeSlot`,
        BASE_APPOINTMENT_CREATE_URL:      `${BASE_HOST}/api/appointment/v2/appointment`,
        BASE_PRODUCT_ORDER_URL:           `${BASE_HOST}/api/productOrdering/v2/productOrder`
    };
}

// Mantém compatibilidade com imports legados (config.BASE_ADDRESS_URL, etc.)
// Qualquer arquivo que ainda não foi migrado continuará funcionando com TRG como default
const _default = getConfigForEnv('TRG');

module.exports = { getConfigForEnv, ..._default };