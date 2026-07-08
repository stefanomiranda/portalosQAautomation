// core/fsl/config.js
//
// Configurações centralizadas do módulo FSL.
// Toda credencial sensível DEVE vir de process.env — nunca hardcode.

const path = require('path');

const FSL_CONFIG = {
  FSL_URL: process.env.FSL_URL || 'https://oimoveltrialorg2021--trg.sandbox.my.salesforce.com/',

  ARTIFACTS_DIR: path.resolve(
    process.env.FSL_ARTIFACTS_DIR || path.join(__dirname, '..', '..', 'internal', 'fsl-artifacts')
  ),

  TIMEOUTS: {
    NAVIGATION:        60_000,
    ACTION:            15_000,
    CODE_2FA_WAIT:    120_000,
    IMAP_POLL_INTERVAL: 5_000,
    STEP_LOOP_MAX:        10,
  },

  IMAP: {
    HOST:     process.env.FSL_IMAP_HOST     || 'outlook.office365.com',
    PORT:     Number(process.env.FSL_IMAP_PORT) || 993,
    SECURE:   true,
    AUTH_TYPE:'LOGIN',
    FROM_FILTER: process.env.FSL_IMAP_FROM_FILTER || 'noreply@',
    SUBJECT_REGEX: process.env.FSL_IMAP_SUBJECT_REGEX ||
                   '(c[oó]digo|code|2fa|verifica[cç][aã]o)',
    CODE_REGEX:     process.env.FSL_IMAP_CODE_REGEX || '\\b(\\d{4,8})\\b',
  },

  BROWSER: {
    HEADLESS: process.env.FSL_HEADLESS !== 'false',
    SLOW_MO:  Number(process.env.FSL_SLOW_MO) || 0,
    RECORD_VIDEO: process.env.FSL_RECORD_VIDEO === 'true',
  },
};

module.exports = FSL_CONFIG;
