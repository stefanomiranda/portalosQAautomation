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

/**
 * Espera a SA ficar "pronta para interação" no Lightning.
 *
 * NOTA: a partir do patch newPage (buscarSA abre uma Page standalone
 * fora do Service Console), a SA é renderizada DIRETAMENTE no main
 * frame. Por isso esta função olha o document do main frame
 * (page.evaluate, sem iterar page.frames()). Isso elimina a classe de
 * falso positivo que apareceu quando a SA estava em iframe aninhado
 * do Service Console.
 *
 * Critérios de "ready":
 *   (a) Skeleton VISÍVEL ignorado se offsetWidth/Height === 0.
 *   (b) appointmentText !== '' → PRONTO (sinal forte, basta).
 *   (c) bodyHasIt && !hasSkeleton → PRONTO (fallback).
 */
async function waitForSAReady(page, saQuery, opts = {}) {
  const timeoutMs       = opts.timeoutMs       ?? 45_000;
  const pollMs          = opts.pollMs          ?? 500;
  const label           = opts.label           ?? 'SA pronta';
  const screenshotOnTimeout = opts.screenshotOnTimeout ?? true;
  const stepName        = opts.stepName        ?? 'waitForSAReady';

  if (!saQuery || typeof saQuery !== 'string') {
    throw new Error('waitForSAReady: saQuery é obrigatório (ex.: "SA-914073")');
  }

  const saDigits = saQuery.replace(/\D+/g, '');
  if (!saDigits) {
    throw new Error(`waitForSAReady: saQuery="${saQuery}" não contém dígitos.`);
  }

  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;

  while (Date.now() < deadline) {
    let status;
    try {
      status = await page.evaluate(
        function ({ queryFull, queryDigits }) {
          // 1) Skeleton/spinner VISÍVEL (offsetWidth/Height > 0)
          const skeletonCandidates = document.querySelectorAll(
            '.slds-skeleton, lightning-spinner, .aura-spinner, ' +
            '.placeholder, .slds-spinner_container, ' +
            'lightning-spinner[class*="slds"], [data-aura-class*="placeholder"], ' +
            '.forceBlockingPanel, .slds-is-relative.slds-spinner_container, ' +
            'aura-spinner, .auraLoadingBox'
          );
          let hasSkeleton = false;
          for (const el of skeletonCandidates) {
            if (el.offsetWidth > 0 && el.offsetHeight > 0) {
              hasSkeleton = true;
              break;
            }
          }
          if (document.body && document.body.classList && document.body.classList.contains('auraLoadingBox')) {
            hasSkeleton = true;
          }

          // 2) <lightning-formatted-text> visível com o número da SA
          const nodes = Array.from(
            document.querySelectorAll(
              'lightning-formatted-text, .slds-form-element__static, span.uiOutputText'
            )
          );
          let appointmentText = '';
          for (const n of nodes) {
            const t = (n.textContent || '').trim();
            if (!t) continue;
            if (t === queryFull ||
                (t.includes(queryDigits) && t.length < 80 &&
                 /SA[-\s]?\d/i.test(t))) {
              const r = n.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                appointmentText = t;
                break;
              }
            }
          }

          // 3) Bônus: número aparece no body inteiro?
          const bodyText = (document.body && document.body.innerText) || '';
          const bodyHasIt =
            bodyText.includes(queryFull) ||
            (bodyText.includes(queryDigits) && /SA[-\s]?\d/i.test(bodyText));

          // 4) h1 atual
          const h1El = document.querySelector(
            'h1, .slds-page-header__title, .entityNameTitle'
          );
          const h1 = h1El ? (h1El.textContent || '').trim() : '';

          return { hasSkeleton, appointmentText, bodyHasIt, h1 };
        },
        { queryFull: saQuery, queryDigits: saDigits }
      );
    } catch (e) {
      lastStatus = { hasSkeleton: true, appointmentText: '', bodyHasIt: false, h1: `[evaluate-falhou: ${(e && e.message || '').slice(0, 80)}]` };
      await new Promise(r => setTimeout(r, pollMs));
      continue;
    }

    lastStatus = status;

    const ready =
      status.appointmentText !== '' ||
      (status.bodyHasIt && !status.hasSkeleton);

    if (ready) {
      return {
        ready: true,
        h1: status.h1,
        appointmentNode: status.appointmentText,
        bodyHasIt: status.bodyHasIt,
      };
    }

    await new Promise(r => setTimeout(r, pollMs));
  }

  // Timeout — monta diagnóstico rico
  let file = null;
  if (screenshotOnTimeout) {
    try {
      file = await takeScreenshot(page, stepName, 'sa-not-ready');
    } catch (_) { /* ignore */ }
  }

  const url = page.url();
  const title = await page.title().catch(() => '?');
  const errLines = [
    `waitForSAReady: timeout (${Math.round(timeoutMs/1000)}s) esperando SA "${saQuery}" ficar pronta.`,
    `  step:       ${stepName}`,
    `  url:        ${url}`,
    `  title:      "${title}"`,
    `  h1:         "${(lastStatus && lastStatus.h1) || ''}"`,
    `  appointmentNode observado: "${(lastStatus && lastStatus.appointmentText) || '(vazio)'}"`,
    `  bodyHasIt:  ${(lastStatus && lastStatus.bodyHasIt) || false}`,
    `  skeleton:   ${(lastStatus && lastStatus.hasSkeleton) || false}`,
    `  screenshot: ${file || '(falhou)'}`,
    `  Causa provável: a SA pode estar num iframe (Service Console) que o page.frames() não lista.`,
  ];
  throw new Error(errLines.join('\n'));
}

module.exports = {
  makeLogger,
  waitForCondition,
  waitForSAReady,
  takeScreenshot,
  smartLocator,
  readStableText,
  findFirstVisible,
  ensureDir,
};