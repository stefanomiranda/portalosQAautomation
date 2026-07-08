// core/suiteDiagnostico.js
//
// Stub da Suite 1 (Diagnostico).
// Por enquanto NAO usa Playwright - retorna mockOk:true para o MOCK.
// O botao "Preparar MOCK" no front vai funcionar (retorna OK simulado).
// Quando o Playwright for integrado, basta substituir o corpo de
// parametrizarMockViaBrowser mantendo a mesma assinatura.
//
// Contrato consumido pelo app.js (linhas 245-260):
//   parametrizarMockViaBrowser({ ambiente, login, senha, subscriberId })
//   executarDiagnosticoCompletoV2({ ambiente, payload, accessToken })
//   conferirNokAuditoria({ ambiente, correlationId, accessToken })

const { DIAG_V2_URL, AUDITORIA_URL } = require('../config');

async function parametrizarMockViaBrowser(params) {
  // STUB: em producao, aqui entra Playwright/Puppeteer que:
  //   1) faz login no MOCK (mocknetq.local) com {login,senha}
  //   2) seta GPON_ESTADO_ONT = GPON_08 para o {subscriberId}
  //   3) confirma
  return {
    mockOk: true,
    ambiente: params.ambiente,
    subscriberId: params.subscriberId,
    gponEstadoOnt: 'GPON_08',
    observacao: 'STUB - Playwright ainda nao integrado'
  };
}

async function executarDiagnosticoCompletoV2(params) {
  const url = (DIAG_V2_URL || 'http://localhost:9999/diag/v2/executar') + '?ambiente=' + encodeURIComponent(params.ambiente || 'TRG');
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (params.accessToken || '')
    },
    body: JSON.stringify(params.payload || {})
  });
  const data = await resp.json().catch(() => ({}));
  return {
    httpStatus: resp.status,
    data: data
  };
}

async function conferirNokAuditoria(params) {
  const url = (AUDITORIA_URL || 'http://localhost:9999/auditoria') + '?correlationId=' + encodeURIComponent(params.correlationId || '') + '&ambiente=' + encodeURIComponent(params.ambiente || 'TRG');
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + (params.accessToken || '')
    }
  });
  const data = await resp.json().catch(() => ({}));
  return {
    httpStatus: resp.status,
    data: data
  };
}

module.exports = {
  parametrizarMockViaBrowser,
  executarDiagnosticoCompletoV2,
  conferirNokAuditoria
};