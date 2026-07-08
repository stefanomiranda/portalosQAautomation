// core/fsl/imapReader.js
//
// Lê o código 2FA do email via IMAP.
const FSL_CONFIG = require('./config');

class CodeNotFoundError extends Error {
  constructor(ms) {
    super(`Código 2FA não encontrado em ${Math.round(ms / 1000)}s`);
    this.name = 'CodeNotFoundError';
  }
}

async function fetch2FACode({
  user,
  password,
  fromAfter = new Date(Date.now() - 5 * 60_000),
  timeoutMs = FSL_CONFIG.TIMEOUTS.CODE_2FA_WAIT,
  logger = console,
} = {}) {
  if (!user || !password) {
    throw new Error('[IMAP] user e password são obrigatórios');
  }

  const { ImapFlow } = await import('imapflow');

  const client = new ImapFlow({
    host:     FSL_CONFIG.IMAP.HOST,
    port:     FSL_CONFIG.IMAP.PORT,
    secure:   FSL_CONFIG.IMAP.SECURE,
    auth:     { user, pass: password },
    logger:   false,
  });

  const deadline = Date.now() + timeoutMs;
  const subjectRe = new RegExp(FSL_CONFIG.IMAP.SUBJECT_REGEX, 'i');
  const codeRe    = new RegExp(FSL_CONFIG.IMAP.CODE_REGEX, 'g');
  const fromRe    = new RegExp(FSL_CONFIG.IMAP.FROM_FILTER, 'i');

  try {
    await client.connect();
    logger.log?.('[IMAP] conectado');

    let lock = await client.getMailboxLock('INBOX');
    try {
      while (Date.now() < deadline) {
        const uids = await client.search({ since: fromAfter });
        if (uids && uids.length) {
          const lastUid = uids[uids.length - 1];
          const msg = await client.fetchOne(String(lastUid), {
            envelope: true,
            source:   true,
          }, { uid: true });

          const subj = msg?.envelope?.subject || '';
          const from = msg?.envelope?.from?.[0]?.address || '';

          if (fromRe.test(from) || subjectRe.test(subj)) {
            const text = msg.source?.toString('utf8') || '';
            const matches = [...text.matchAll(codeRe)];
            if (matches.length) {
              const code = matches[0][1];
              logger.log?.(`[IMAP] código 2FA encontrado: ${code}`);
              return code;
            }
          }
        }

        await new Promise(r =>
          setTimeout(r, FSL_CONFIG.IMAP.IMAP_POLL_INTERVAL)
        );
      }
    } finally {
      lock.release();
    }

    throw new CodeNotFoundError(timeoutMs);
  } finally {
    try { await client.logout(); } catch (_) { /* ignore */ }
  }
}

module.exports = { fetch2FACode, CodeNotFoundError };
