// config.js

const ENVIRONMENTS = {
  TRG: 'https://apitrg.vtal.com.br',
  TI: 'https://api-ti1.vtal.com.br',
  TRG2: 'https://api-reg.vtal.com.br'
};

function normalizeAmbiente(ambiente = 'TRG') {
  const a = String(ambiente || 'TRG').trim().toUpperCase();
  return ENVIRONMENTS[a] ? a : 'TRG';
}

function getEnvValue(keys = [], fallback = undefined) {
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return fallback;
}

function resolveBaseHost(ambienteNormalizado) {
  // Permite override opcional por ambiente:
  // TRG_BASE_HOST, TI_BASE_HOST, TRG2_BASE_HOST
  // ou BASE_HOST (global)
  return getEnvValue(
    [`${ambienteNormalizado}_BASE_HOST`, 'BASE_HOST'],
    ENVIRONMENTS[ambienteNormalizado]
  );
}

function route(ambienteNormalizado, key, defaultValue) {
  // Prioridade:
  // 1) <AMBIENTE>_<KEY>   (ex.: TRG_TOKEN_URL)
  // 2) <KEY>              (ex.: TOKEN_URL) [global]
  // 3) defaultValue
  return getEnvValue([`${ambienteNormalizado}_${key}`, key], defaultValue);
}

function getConfigForEnv(ambiente = 'TRG') {
  const env = normalizeAmbiente(ambiente);
  const BASE_HOST = resolveBaseHost(env);

  const config = {
    // =========================
    // ROTAS ATUAIS (inalteradas)
    // =========================
    TOKEN_URL: route(env, 'TOKEN_URL', `${BASE_HOST}/auth/oauth/v2/token`),
    BASE_ADDRESS_URL: route(
      env,
      'BASE_ADDRESS_URL',
      `${BASE_HOST}/api/geographicAddressManagement/v1/geographicAddress`
    ),
    BASE_ADDRESS_COMPLEMENTS_URL: route(
      env,
      'BASE_ADDRESS_COMPLEMENTS_URL',
      `${BASE_HOST}/api/geographicAddressManagement/v1/addressComplements`
    ),
    BASE_AVAILABILITY_URL: route(
      env,
      'BASE_AVAILABILITY_URL',
      `${BASE_HOST}/api/resourcePoolManagement/v2/availabilityCheck`
    ),
    BASE_APPOINTMENT_SEARCH_SLOT_URL: route(
      env,
      'BASE_APPOINTMENT_SEARCH_SLOT_URL',
      `${BASE_HOST}/api/appointment/v2/searchTimeSlot`
    ),
    BASE_APPOINTMENT_CREATE_URL: route(
      env,
      'BASE_APPOINTMENT_CREATE_URL',
      `${BASE_HOST}/api/appointment/v2/appointment`
    ),
    BASE_PRODUCT_ORDER_URL: route(
      env,
      'BASE_PRODUCT_ORDER_URL',
      `${BASE_HOST}/api/productOrdering/v2/productOrder`
    ),

    // ==================================
    // NOVAS ROTAS (Suite Diagnóstico / TT)
    // ==================================

    // MOCK (browser automation / parametrização)
    MOCK_URL: route(env, 'MOCK_URL', `${BASE_HOST}/mock`),
    BASE_MOCK_URL: route(env, 'BASE_MOCK_URL', `${BASE_HOST}/mock`),

    // Diagnóstico completo V2
    DIAG_V2_URL: route(
      env,
      'DIAG_V2_URL',
      `${BASE_HOST}/api/diagnostic/v2/diagnostic`
    ),
    BASE_DIAGNOSTICO_V2_URL: route(
      env,
      'BASE_DIAGNOSTICO_V2_URL',
      `${BASE_HOST}/api/diagnostic/v2/diagnostic`
    ),

    // Auditoria (conferir NOK)
    AUDITORIA_URL: route(
      env,
      'AUDITORIA_URL',
      `${BASE_HOST}/api/auditoria/v1/auditoria`
    ),
    BASE_AUDITORIA_URL: route(
      env,
      'BASE_AUDITORIA_URL',
      `${BASE_HOST}/api/auditoria/v1/auditoria`
    ),

    // Trouble Ticket - abertura
    TT_OPEN_URL: route(
      env,
      'TT_OPEN_URL',
      `${BASE_HOST}/api/troubleTicketManagement/v1/troubleTicket`
    ),
    BASE_TT_OPEN_URL: route(
      env,
      'BASE_TT_OPEN_URL',
      `${BASE_HOST}/api/troubleTicketManagement/v1/troubleTicket`
    ),

    // Trouble Ticket - patch v2
    TT_PATCH_V2_URL: route(
      env,
      'TT_PATCH_V2_URL',
      `${BASE_HOST}/api/troubleTicketManagement/v2/troubleTicket`
    ),
    BASE_TT_PATCH_V2_URL: route(
      env,
      'BASE_TT_PATCH_V2_URL',
      `${BASE_HOST}/api/troubleTicketManagement/v2/troubleTicket`
    ),

    // Notificações TT (interno)
    TT_NOTIF_URL: route(
      env,
      'TT_NOTIF_URL',
      `${BASE_HOST}/api/cw-troubleTicketManagement-v2_INTERNO/notification`
    ),
    BASE_TT_NOTIF_URL: route(
      env,
      'BASE_TT_NOTIF_URL',
      `${BASE_HOST}/api/cw-troubleTicketManagement-v2_INTERNO/notification`
    ),

    // Metadados úteis
    AMBIENTE: env,
    BASE_HOST
  };

  return config;
}

// Mantém compatibilidade com imports legados (config.BASE_ADDRESS_URL, etc.)
// Default TRG para quem ainda usa `require('../config').TOKEN_URL`
const _default = getConfigForEnv('TRG');

module.exports = {
  getConfigForEnv,
  ENVIRONMENTS,
  ..._default
};