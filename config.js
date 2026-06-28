// config.js
const BASE_HOST = process.env.BASE_HOST || 'https://apitrg.vtal.com.br';

module.exports = {
    TOKEN_URL: `${BASE_HOST}/auth/oauth/v2/token`, // Busca Token
    BASE_ADDRESS_URL: `${BASE_HOST}/api/geographicAddressManagement/v1/geographicAddress`, // Busca endereços
    BASE_ADDRESS_COMPLEMENTS_URL: `${BASE_HOST}/api/geographicAddressManagement/v1/addressComplements`, // Busca complementos
    BASE_AVAILABILITY_URL: `${BASE_HOST}/api/resourcePoolManagement/v2/availabilityCheck`, // Busca viabilidade
    BASE_APPOINTMENT_SEARCH_SLOT_URL: `${BASE_HOST}/api/appointment/v2/searchTimeSlot`, // Para buscar slots
    BASE_APPOINTMENT_CREATE_URL: `${BASE_HOST}/api/appointment/v2/appointment`, // Para criar agendamento
    BASE_PRODUCT_ORDER_URL: `${BASE_HOST}/api/productOrdering/v2/productOrder` // Para criar OS
};