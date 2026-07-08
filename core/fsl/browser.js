// core/fsl/browser.js
//
// Factory de browser Playwright + page com timeouts seguros.

const fs = require('fs');
const path = require('path');
const FSL_CONFIG = require('./config');

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function launchBrowser({ logger = console, stepName = 'session' } = {}) {
  await ensureDir(FSL_CONFIG.ARTIFACTS_DIR);

  const videoDir = path.join(FSL_CONFIG.ARTIFACTS_DIR, stepName);
  await ensureDir(videoDir);

const { chromium } = await import('playwright');

const browser = await chromium.launch({
  headless: FSL_CONFIG.BROWSER.HEADLESS,
  slowMo:   FSL_CONFIG.BROWSER.SLOW_MO,
  channel:  'msedge',        // <-- usa o Edge instalado
  // Opcional: caminho fixo
  // executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
});

  const context = await browser.newContext({
    recordVideo: FSL_CONFIG.BROWSER.RECORD_VIDEO
      ? { dir: videoDir, size: { width: 1280, height: 720 } }
      : undefined,
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(FSL_CONFIG.TIMEOUTS.ACTION);
  page.setDefaultNavigationTimeout(FSL_CONFIG.TIMEOUTS.NAVIGATION);

  logger.log?.(`[BROWSER] launched (headless=${FSL_CONFIG.BROWSER.HEADLESS})`);
  logger.log?.(`[BROWSER] artifacts → ${videoDir}`);

  return { browser, context, page, videoDir };
}

async function closeBrowser({ browser, context }, { logger = console } = {}) {
  try {
    if (context) await context.close();
    if (browser) await browser.close();
    logger.log?.('[BROWSER] closed');
  } catch (e) {
    logger.warn?.(`[BROWSER] erro ao fechar: ${e.message}`);
  }
}

module.exports = { launchBrowser, closeBrowser, ensureDir };
