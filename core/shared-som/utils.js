// core/shared-som/utils.js
//
// Helpers compartilhados pelas esteiras que automatizam tarefas no Oracle SOM
// (Instalação com Encerramento Externo, Retirada com Encerramento Externo,
// e quaisquer futuras esteiras de Worklist).
//
// Tudo aqui é "puro" (não conhece Page nem IMAP) — recebe a page como
// argumento para ficar fácil de testar com mocks.
//
// Diferenças em relação a core/fsl/utils.js:
//   - Não depende de FSL_CONFIG (este módulo é o "irmão" para SOM)
//   - Não tem waitForSAReady (específico do Lightning/FSL)
//   - Tem SOM_CONFIG com timeouts padrão para automação SOM

const path = require('path');
const fs = require('fs');

/** Configuração padrão. Pode ser sobrescrita via require('./config') em cada esteira. */
const SOM_CONFIG = {
  TIMEOUTS: {
    NAVIGATION: 30_000,
    ELEMENT:    15_000,
  },
  ARTIFACTS_DIR: path.resolve(process.cwd(), 'internal/som-artifacts'),
  urlsPorAmbiente: {
    TI:   'http://osmsqx02a.local:7003/OrderManagement/Login.jsp',
    TRG:  'http://osmsqx12a.local:7003/OrderManagement/Login.jsp',
    TRG2: 'http://osmsqx22a.local:7003/OrderManagement/Login.jsp',
  },
  WORKLIST_URL: 'http://osmsqx12a.local:7003/OrderManagement/control/Worklist',
};

/**
 * Logger estruturado: prefixa [SOM][STEP_NAME] e adiciona timestamp ISO.
 */
function makeLogger(stepName) {
  const tag = `[SOM][${stepName}]`;
  const stamp = () => new Date().toISOString();
  return {
    log:   (...a) => console.log(stamp(), tag, ...a),
    warn:  (...a) => console.warn(stamp(), tag, ...a),
    error: (...a) => console.error(stamp(), tag, ...a),
    info:  (...a) => console.log(stamp(), tag, ...a),
  };
}

function ensureDir(dir) {
  if (!dir) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Normaliza uma SA para o formato canônico "SA-NNNNNN".
 * Aceita "123456", "SA-123456", "sa-123456", " 123456 ".
 */
function normalizeSa(input) {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const m = raw.match(/^SA[-\s]*(\d+)$/i) || raw.match(/^(\d+)$/);
  if (!m) return raw;
  return `SA-${m[1]}`;
}

/**
 * Espera um locator (Page ou Locator) satisfazer uma condição.
 */
async function waitForCondition(page, checkFn, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? SOM_CONFIG.TIMEOUTS.NAVIGATION;
  const pollMs    = opts.pollMs    ?? 500;
  const label     = opts.label     ?? 'condição';

  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      if (await checkFn(page)) return true;
    } catch (e) {
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, pollMs));
  }

  let hint = '';
  try {
    const url = page.url();
    const title = await page.title().catch(() => '?');
    hint = `\n  url:   ${url}\n  title: ${title}`;
  } catch (_) { /* ignore */ }

  const msg = `Timeout (${Math.round(timeoutMs/1000)}s) esperando ${label}.${hint}`;
  if (lastErr) throw new Error(`${msg}\n  último erro: ${lastErr.message}`);
  throw new Error(msg);
}

/**
 * Tira screenshot e salva em SOM_CONFIG.ARTIFACTS_DIR/{stepName}/.
 */
async function takeScreenshot(page, stepName, suffix = 'state', onLog = () => {}) {
  try {
    const dir = path.join(SOM_CONFIG.ARTIFACTS_DIR, stepName);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${suffix}.png`);
    await page.screenshot({ path: file, fullPage: true });
    if (typeof onLog === 'function') onLog(`screenshot salvo: ${file}`);
    return file;
  } catch (e) {
    console.warn('[SOM] screenshot falhou:', e.message);
    return null;
  }
}

/**
 * Helper "modo descoberta".
 */
function buildLocator(page, hints) {
  if (hints.css)        return page.locator(hints.css);
  if (hints.role) {
    return page.getByRole(hints.role, { name: hints.name, exact: !!hints.exact });
  }
  if (hints.text) {
    return hints.exact
      ? page.getByText(hints.text, { exact: true })
      : page.getByText(hints.text);
  }
  if (hints.label)  return page.getByLabel(hints.label, { exact: !!hints.exact });
  if (hints.placeholder) return page.getByPlaceholder(hints.placeholder, { exact: !!hints.exact });
  throw new Error('smartLocator: nenhuma hint fornecida (css/role/text/label/placeholder)');
}

function smartLocator(page, hintsOrArray) {
  const arr = Array.isArray(hintsOrArray) ? hintsOrArray : [hintsOrArray];
  if (arr.length === 0) {
    throw new Error('smartLocator: pelo menos uma hint é obrigatória');
  }
  const locators = arr.map(h => buildLocator(page, h));

  const first = locators[0];
  const group = {
    strategy: arr[0]._strategy || (Object.keys(arr[0])[0]) || 'unknown',
    nth(i) { return locators[i]; },
    all() { return locators; },
    async anyVisible({ timeoutMs = 5000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      let lastErr = null;
      while (Date.now() < deadline) {
        for (const l of locators) {
          try {
            if (await l.first().isVisible({ timeout: 200 })) return l;
          } catch (e) { lastErr = e; }
        }
        await new Promise(r => setTimeout(r, 200));
      }
      throw new Error(
        `Nenhum candidato visível em ${timeoutMs}ms (${locators.length} testados)` +
        (lastErr ? `: ${lastErr.message}` : '')
      );
    },
  };

  return new Proxy(first, {
    get(target, prop) {
      if (prop in group) return group[prop];
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/**
 * Lê um campo N vezes, devolve o valor que ficou estável.
 */
async function readStableText(page, locator, opts = {}) {
  const tries = opts.tries ?? 3;
  const gap   = opts.gapMs ?? 300;
  let prev = null;
  for (let i = 0; i < tries; i++) {
    const t = (await locator.textContent().catch(() => null) || '').trim();
    if (t && t === prev) return t;
    prev = t;
    await new Promise(r => setTimeout(r, gap));
  }
  return prev || '';
}

async function findFirstVisible(page, locators, { timeoutMs = 10_000, pollMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const loc of locators) {
      try {
        const visible = await loc.isVisible({ timeout: 200 }).catch(() => false);
        if (visible) return loc;
      } catch (_) { /* ignore */ }
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  return null;
}

module.exports = {
  SOM_CONFIG,
  makeLogger,
  waitForCondition,
  takeScreenshot,
  smartLocator,
  readStableText,
  findFirstVisible,
  ensureDir,
  normalizeSa,
};
