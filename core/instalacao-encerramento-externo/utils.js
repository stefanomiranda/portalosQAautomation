// core/instalacao-encerramento-externo/utils.js
// Helpers reusáveis pelos steps do Encerramento Externo.
// Sem dependência de FSL — multi-esteira.

const fs = require('fs');
const path = require('path');

/** Diretório onde as screenshots são gravadas (interno, não é deliverable). */
const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'internal', 'instalacao-encerramento', 'screenshots');

/** Garante que o diretório de screenshots existe. Idempotente. */
function ensureScreenshotDir() {
  try {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  } catch (_) {
    /* ignora — se a pasta já existe ou não há permissão, o takeScreenshot falha abaixo */
  }
}

/**
 * Normaliza o input do front (`sa`).
 * Aceita: "SA-123456", "123456", "sa 123456". Retorna o canônico "SA-NNNNNN".
 *
 * @param {string} raw
 * @returns {string}  canônico no formato SA-NNNNNN
 * @throws {Error}    se o valor não tiver 4+ dígitos
 */
function normalizeSa(raw) {
  if (raw == null) throw new Error('SA não informada');
  const digits = String(raw).replace(/\D+/g, '');
  if (digits.length < 4) {
    throw new Error(`SA inválida: "${raw}" (esperado pelo menos 4 dígitos)`);
  }
  return `SA-${digits}`;
}

/**
 * Tenta várias estratégias de seletor Playwright até uma delas achar 1+ elementos.
 * Cada estratégia é uma tupla [descrição, locatorFn]. A primeira que resolver vence.
 *
 * @param {import('playwright').Page} page
 * @param {Array<[string, (page: import('playwright').Page) => import('playwright').Locator]>} strategies
 * @param {object} [opts]
 * @param {number} [opts.timeout=5000]   timeout por estratégia
 * @returns {Promise<import('playwright').Locator>}  locator vencedor
 * @throws {Error} se nenhuma estratégia casar
 */
async function smartLocator(page, strategies, opts = {}) {
  const timeout = opts.timeout || 5000;
  const tried = [];

  for (const [desc, build] of strategies) {
    try {
      const loc = build(page);
      const count = await loc.count();
      if (count > 0) {
        return { locator: loc, strategy: desc, count };
      }
      tried.push(`${desc} (count=0)`);
    } catch (e) {
      tried.push(`${desc} (${(e && e.message) || e})`);
    }
  }

  // Fallback: espera mais um pouco no último seletor (caso a tela ainda esteja renderizando)
  try {
    const [, lastBuild] = strategies[strategies.length - 1];
    const loc = lastBuild(page);
    await loc.first().waitFor({ timeout, state: 'attached' });
    return { locator: loc, strategy: `${strategies[strategies.length - 1][0]} (delayed)`, count: await loc.count() };
  } catch (e) {
    throw new Error(`Nenhum seletor casou. Tentativas: ${tried.join(' | ')}. Último erro: ${(e && e.message) || e}`);
  }
}

/**
 * Captura screenshot e devolve o caminho. Loga via `onLog` se fornecido.
 *
 * @param {import('playwright').Page} page
 * @param {string} label
 * @param {(msg: string) => void} [onLog]
 * @returns {Promise<string>} path absoluto da screenshot
 */
async function takeScreenshot(page, label, onLog) {
  ensureScreenshotDir();
  const safe = String(label).replace(/[^a-zA-Z0-9._-]+/g, '_');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(SCREENSHOT_DIR, `${ts}__${safe}.png`);
  try {
    await page.screenshot({ path: file, fullPage: false });
    if (onLog) onLog(`[screenshot] ${file}`);
  } catch (e) {
    if (onLog) onLog(`[screenshot] falhou: ${(e && e.message) || e}`);
  }
  return file;
}

/**
 * Espera uma condição arbitrária até ficar true, ou estourar timeout.
 *
 * @template T
 * @param {() => T | Promise<T>} probe        função que retorna truthy quando "pronto"
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=10000]
 * @param {number} [opts.intervalMs=250]
 * @param {string}  [opts.label='condição']
 * @returns {Promise<T>}
 */
async function waitForCondition(probe, opts = {}) {
  const timeoutMs = opts.timeoutMs || 10000;
  const intervalMs = opts.intervalMs || 250;
  const label = opts.label || 'condição';
  const start = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const v = await probe();
    if (v) return v;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout (${timeoutMs}ms) esperando: ${label}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Pausa explícita (em ms). Use com moderação — preferir `waitForCondition`.
 */
async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  SCREENSHOT_DIR,
  ensureScreenshotDir,
  normalizeSa,
  smartLocator,
  takeScreenshot,
  waitForCondition,
  sleep,
};