// core/instalacao-encerramento-externo/config.js
const path = require('path');

const SOM_URLS = {
  TI:   process.env.SOM_URL_TI   || 'http://osmsqx02a.local:7003/OrderManagement/Login.jsp',
  TRG:  process.env.SOM_URL_TRG  || 'http://osmsqx12a.local:7003/OrderManagement/Login.jsp',
  TRG2: process.env.SOM_URL_TRG2 || 'http://osmsqx22a.local:7003/OrderManagement/Login.jsp',
};

const INSTALACAO_ENCERRAMENTO_CONFIG = {
  SOM_URLS,
  MATRICULA_TECNICA: process.env.SOM_MATRICULA_TECNICA || 'TR101010',
  CABO_DROP_NAO: 'NÃO',
  ENCERRAMENTO_EXTERNO_LABEL: 'Encerramento externo com sucesso',
  ARTIFACTS_DIR: path.resolve(
    process.env.IE_ARTIFACTS_DIR || path.join(__dirname, '..', '..', 'internal', 'instalacao-encerramento-artifacts')
  ),
  TIMEOUTS: { NAVIGATION: 60_000, ACTION: 15_000, STEP_LOOP_MAX: 10 },
  BROWSER: {
    HEADLESS: process.env.IE_HEADLESS !== 'false',
    SLOW_MO:  Number(process.env.IE_SLOW_MO) || 0,
    RECORD_VIDEO: process.env.IE_RECORD_VIDEO === 'true',
  },
  CREDENTIALS: {
    USER: process.env.SOM_USER || 'vt419418',
    PASS: process.env.SOM_PASS || '123teste',
  },
};

function getSomUrl(ambiente) {
  const upper = String(ambiente || 'TRG').toUpperCase();
  return SOM_URLS[upper] || SOM_URLS.TRG;
}

module.exports = INSTALACAO_ENCERRAMENTO_CONFIG;
module.exports.getSomUrl = getSomUrl;