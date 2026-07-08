// core/fsl/utils.js
//
// Helpers compartilhados pelos 8 steps e pelo runner.
// Tudo aqui é "puro" (não conhece Page nem IMAP) — recebe a page
// como argumento para ficar fácil de testar com mocks.

const path = require('path');
const FSL_CONFIG = require('./config');
const fs = require('fs');

/**
 * Logger estruturado: prefixa [FSL][STEP_NAME] e adiciona timestamp ISO.
 */
function makeLogger(stepName) {
  const tag = `[FSL][${stepName}]`;
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
 * Espera um locator (Page ou Locator) satisfazer uma condição.
 */
async function waitForCondition(page, checkFn, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? FSL_CONFIG.TIMEOUTS.NAVIGATION;
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
 * Tira screenshot e salva em ARTIFACTS_DIR/{stepName}/.
 */
async function takeScreenshot(page, stepName, suffix = 'state') {
  try {
    const dir = path.join(FSL_CONFIG.ARTIFACTS_DIR, stepName);
    const fs = require('fs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const file = path.join(dir, `${Date.now()}-${suffix}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch (e) {
    console.warn('[FSL] screenshot falhou:', e.message);
    return null;
  }
}

/**
 * Espera navegação (domcontentloaded) com timeout.
 */
async function waitForNav(page, opts = {}) {
  const label = opts.label ?? 'navegação';
  await waitForCondition(page, async (p) => {
    try {
      await p.waitForLoadState('domcontentloaded', { timeout: 1500 });
      return true;
    } catch (_) {
      return false;
    }
  }, {
    timeoutMs: opts.timeoutMs ?? FSL_CONFIG.TIMEOUTS.NAVIGATION,
    pollMs:    800,
    label,
  });
}

/**
 * Helper "modo descoberta".
 *
 * Aceita UMA hint (objeto) ou VÁRIAS (array). O retorno é um **Proxy**
 * que se comporta como o PRIMEIRO locator MAS também expõe métodos de
 * grupo:
 *
 *   smartLocator(page, h1)                 → funciona como Locator direto
 *     .fill(x), .click(), .isVisible(), .waitFor()
 *   smartLocator(page, [h1, h2, h3])
 *     .anyVisible({timeoutMs})             → primeiro que estiver visível
 *     .nth(i)                              → i-ésimo candidato
 *     .all()                               → array com todos
 *     .first()                             → primeiro candidato
 *
 * Estratégias (dentro de UMA hint, primeira que casa):
 *  1) hints.css        → page.locator(css)
 *  2) hints.role       → page.getByRole(role, { name, exact })
 *  3) hints.text       → page.getByText(text, { exact })
 *  4) hints.label      → page.getByLabel(label, { exact })
 *  5) hints.placeholder→ page.getByPlaceholder(placeholder, { exact })
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
    nth(i) { return locators[i]; },
    all() { return locators; },
    /**
     * Tenta cada candidato em ordem; devolve o primeiro que estiver visível
     * dentro do timeout (default 5s). Lança erro descritivo se nenhum aparecer.
     */
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

  // Proxy: o default é o PRIMEIRO locator (preenche, clica, etc.);
  // mas .anyVisible/.nth/.first/.all vêm do grupo.
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

/**
 * Tenta vários locators em paralelo (polling) e devolve o PRIMEIRO que
 * estiver visível. É muito mais robusto que encadear .or().or().first(),
 * porque o .or() nativo do Playwright espera o timeout de cada um antes
 * de tentar o próximo.
 *
 * @param {Page} page
 * @param {Locator[]} locators
 * @param {Object} opts
 * @param {number} opts.timeoutMs  - tempo total de espera (default 10s)
 * @param {number} opts.pollMs     - intervalo entre tentativas (default 500ms)
 * @returns {Promise<Locator|null>}
 */
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
  makeLogger,
  waitForCondition,
  takeScreenshot,
  smartLocator,
  readStableText,
  findFirstVisible,
  ensureDir,
};
