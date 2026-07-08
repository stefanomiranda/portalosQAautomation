// core\fsl\webhookEmail.js
//
// Mecanismo de 2FA baseado em WEBHOOK (substitui o imapReader).
//
// Fluxo:
//   1) O step de login chama registerPending(token, timeoutMs) e obtém uma Promise
//   2) O robô faz o submit da senha no Salesforce
//   3) O Outlook dispara o webhook /api/fsl/email-2fa com o mesmo token
//   4) O routes/fsl.js chama deliverCode(token, code) e a Promise resolve
//   5) O login preenche o campo de 2FA com o código recebido
//
// Se o timeout expirar antes do webhook, rejeita com erro.

const FSL_CONFIG = require('./config');

const pending = new Map(); // token -> { resolve, reject, timeoutHandle, createdAt }

function registerPending(token, timeoutMs = FSL_CONFIG.TIMEOUTS.CODE_2FA_WAIT) {
  if (!token) throw new Error('webhookEmail: token é obrigatório');

  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      const entry = pending.get(token);
      if (entry) {
        pending.delete(token);
        // timeout = 2FA ERA esperado e não chegou → erro real
        reject(new Error(`webhookEmail: 2FA não recebido em ${Math.round(timeoutMs / 1000)}s`));
      }
    }, timeoutMs);

    pending.set(token, { resolve, reject, timeoutHandle, createdAt: Date.now() });
  });
}

function deliverCode(token, code, meta = {}) {
  const entry = pending.get(token);
  if (!entry) return { ok: false, reason: 'token_nao_encontrado' };

  clearTimeout(entry.timeoutHandle);
  pending.delete(token);
  entry.resolve({ code, meta });
  return { ok: true };
}

function cancelPending(token, reason = 'cancelled') {
  const entry = pending.get(token);
  if (!entry) return false;

  clearTimeout(entry.timeoutHandle);
  pending.delete(token);
  entry.resolve({ code: null, skipped: true, reason });
  return true;
}

function listPending() {
  return Array.from(pending.entries()).map(([token, e]) => ({
    token,
    createdAt: e.createdAt,
    ageMs: Date.now() - e.createdAt,
  }));
}

module.exports = {
  registerPending,
  deliverCode,
  cancelPending,
  listPending,
};