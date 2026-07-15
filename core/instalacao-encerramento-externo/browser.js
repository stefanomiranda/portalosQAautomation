// core/instalacao-encerramento-externo/browser.js
// Fábrica de sessões Playwright para a esteira de Instalação com Encerramento Externo.
//
// Usa await import('playwright') (dinâmico ESM) — mesmo padrão do FSL.
// Em ambientes onde o require() cai num stub quebrado, o import dinâmico
// resolve pro módulo completo.

const config = require('./config');

const noop = () => {};

/**
 * Cria uma sessão Playwright isolada (browser + context + page + helpers).
 */
async function createSession(opts = {}) {
  const { ambiente, jobId, onLog = noop } = opts;
  const log = (msg) => onLog(`[browser] ${msg}`);

  // FIX: o config real tem `config.BROWSER.HEADLESS` (aninhado) e
  // `config.TIMEOUTS` (maiúsculo). O código antigo lia `config.headless`
  // (inexistente) → sempre caía em `true`, ignorando IE_HEADLESS=false.
  const timeouts = (config.TIMEOUTS && typeof config.TIMEOUTS === 'object')
    ? config.TIMEOUTS
    : { action: 15000, navigation: 30000 };
  const headless = (config.BROWSER && typeof config.BROWSER.HEADLESS === 'boolean')
    ? config.BROWSER.HEADLESS
    : true;

  log(`lançando chromium (ambiente=${ambiente || '?'}, jobId=${jobId || '?'}, headless=${headless})`);

  // Import dinâmico — mesmo padrão do FSL. Resolve o módulo completo.
  const { chromium } = await import('playwright');

  const browser = await chromium.launch({
    headless,
    channel: 'msedge',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  /** Fecha page, context e browser silenciosamente (idempotente). */
  async function close() {
    try { await page.close(); } catch (_) { /* ignora */ }
    try { await context.close(); } catch (_) { /* ignora */ }
    try { await browser.close(); } catch (_) { /* ignora */ }
    log('sessão encerrada');
  }

  return { browser, context, page, close, log };
}

/**
 * Helper: cria sessão, executa `fn(session)`, garante fechamento mesmo em erro.
 *
 * FIX: se `createSession` lançar (ex.: channel:'msedge' não disponível),
 * o `finally` antigo chamava `session.close()` em `undefined` → TypeError,
 * mascarando o erro real. Agora o `finally` só age se a sessão chegou a
 * existir, e captura falhas internas do próprio close.
 */
async function withSession(opts, fn) {
  let session;
  try {
    session = await createSession(opts);
    return await fn(session);
  } finally {
    if (session) {
      try { await session.close(); } catch (_) { /* ignora */ }
    }
  }
}

module.exports = { createSession, withSession };