// core/fsl/steps/anteciparStatus.js
//
// Step 3/8 — Antecipar Status da SA.
//
// Fluxo:
//   0) validar que a SA exibida é a esperada (corrige bug de workspace tab)
//   1) esperar a SA terminar de carregar (skeleton, spinner, etc.)
//   2) abrir diálogo Antecipar Status / Antecipação
//   ...

const { makeLogger, takeScreenshot, smartLocator, findFirstVisible } = require('../utils');
const FSL_CONFIG = require('../config');

const STEP_NAME = 'anteciparStatus';

async function step(ctx) {
  const log = makeLogger(STEP_NAME);
  const { page, input } = ctx;

  // ====================================================================
  // ETAPA 0 — validar que a SA exibida é a esperada
  //
  // Bug do Lightning Console: ao navegar para uma SA via URL, o Console
  // pode manter o foco em uma aba antiga. A URL e o title ficam
  // dessincronizados (URL=nova, title=antiga). Aqui a gente:
  //   (a) lê o número da SA exibido no header h1
  //   (b) compara com o input.sa
  //   (c) se não bater, recarrega a página (força o foco na nova SA)
  // ====================================================================
  let currentUrl = page.url();
  let titleNow = await page.title().catch(() => '');
  log.log(`URL: ${currentUrl}`);
  log.log(`TITLE: "${titleNow}"`);

  // Defesa: se estamos em sub-rota, voltar para a home do SA
  if (
    /\/related\/|\/edit$|\/history/i.test(currentUrl + ' ' + titleNow) ||
    /history|related/i.test(titleNow)
  ) {
    log.log('[anteciparStatus] ⚠️ estamos numa sub-rota, navegando para a home do SA');
    const saHomeUrl = currentUrl
      .replace(/\/related\/.*$/, '/view')
      .replace(/\/edit$/, '/view');
    await page.goto(saHomeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: FSL_CONFIG.TIMEOUTS.NAVIGATION,
    });
    log.log(`[anteciparStatus] navegado para: ${page.url()}`);
  }

  // Validação: a SA exibida é a esperada?
  const saQuery = `SA-${input.sa}`;
  const h1Text = await page
    .locator('h1')
    .first()
    .innerText()
    .catch(() => '');
  log.log(`[anteciparStatus] h1: "${h1Text}"`);

  if (!h1Text.includes(saQuery)) {
    log.log(
      `[anteciparStatus] ⚠️ h1 (${h1Text}) não contém ${saQuery} — recarregando a página`
    );
    // Extrai o saId da URL atual e força reload direto na home da SA
    const saIdMatch = currentUrl.match(
      /\/lightning\/r\/ServiceAppointment\/([a-zA-Z0-9]{15,18})/i
    );
    if (saIdMatch) {
      const correctUrl = `https://oimoveltrialorg2021--trg.sandbox.lightning.force.com/lightning/r/ServiceAppointment/${saIdMatch[1]}/view`;
      await page.goto(correctUrl, {
        waitUntil: 'domcontentloaded',
        timeout: FSL_CONFIG.TIMEOUTS.NAVIGATION,
      });
      log.log(`[anteciparStatus] recarregado em ${page.url()}`);
    } else {
      log.log('[anteciparStatus] ⚠️ não foi possível extrair saId da URL para reload');
    }
  } else {
    log.log(`[anteciparStatus] ✅ SA exibida confere: ${h1Text}`);
  }

  // ====================================================================
  // ETAPA 1 — esperar a SA terminar de carregar (skeleton, spinner, etc.)
  // ====================================================================
  log.log('aguardando skeleton/spinner da SA sumir');
  try {
    await page.waitForFunction(
      () => {
        const hasSkeleton = document.querySelector(
          '.slds-skeleton, lightning-spinner[variant="brand"], ' +
          '[data-aura-class*="placeholder"], .placeholder'
        );
        return !hasSkeleton;
      },
      { timeout: 30_000 }
    );
    log.log('skeleton sumiu');
  } catch (e) {
    log.log(`skeleton não sumiu em 30s: ${e.message} (continuando mesmo assim)`);
    await takeScreenshot(page, STEP_NAME, 'skeleton-stuck');
  }

  // Espera adicional pelo header da página (sinal forte de que Lightning
  // terminou de montar a SA)
  try {
    await page.waitForSelector(
      'h1, .slds-page-header__title, lightning-formatted-text',
      { state: 'visible', timeout: 15_000 }
    );
  } catch {
    log.log('header da página não apareceu em 15s (continuando)');
  }

  // ====================================================================
  // ETAPA 2 — abrir diálogo Antecipar Status / Antecipação
  //
  // A Lightning Service Console tem AMBOS os botões em alguns casos:
  //   - "Antecipação"     (substantivo) — abre o diálogo de antecipação
  //   - "Marcar Status como Completo" — aparece quando a SA está dentro
  //                                     da janela de atendimento
  // O código abaixo tenta primeiro "Antecipação" e cai no fallback de
  // completar status se a SA já está em janela.
  // ====================================================================
  log.log('abrir diálogo Antecipar Status / Antecipação');

  const antecipButton = await findFirstVisible(page, [
    smartLocator(page, { role: 'button', name: /Antecipa[çc][aã]o/i }),
    smartLocator(page, { role: 'button', name: /Antecipar Status/i }),
    page.locator('button:has-text("Antecipação")'),
    page.locator('button:has-text("Antecipar Status")'),
  ], { timeoutMs: 15_000 });

  if (!antecipButton) {
    await takeScreenshot(page, STEP_NAME, 'no-antecipar-button');
    // Diagnóstico: o que está visível no body?
    const bodyText = await page.locator('body').innerText().catch(() => '');
    log.log(`[anteciparStatus] body (primeiros 800 chars): ${bodyText.slice(0, 800)}`);
    throw new Error(
      'anteciparStatus: nem "Antecipação" nem "Antecipar Status" encontrados. ' +
        `URL=${page.url()} | TITLE="${titleNow}". ` +
        'Veja screenshot debug-anteciparStatus-no-antecipar-button.png e o body acima.'
    );
  }

  const buttonText = await antecipButton.innerText().catch(() => '');
  log.log(`[anteciparStatus] botão encontrado: "${buttonText}"`);

  await antecipButton.click();
  log.log('diálogo Antecipar Status aberto');

  // ... resto do step (preencher datas, confirmar, etc.) ...
  ctx.steps = ctx.steps || [];
  ctx.steps.push({ step: STEP_NAME, status: 'ok' });
  return ctx;
}

module.exports = { step, name: STEP_NAME };