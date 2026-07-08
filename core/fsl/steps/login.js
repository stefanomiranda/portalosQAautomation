// core/fsl/steps/login.js
// Step 1/8 — Login no FSL (Salesforce Lightning) com 2 etapas + 2FA via webhook.
//
// Fluxo: Username → Next → Password → Log In → (opcional) 2FA → Lightning pronto
//
// Após o 2FA, o Salesforce pode cair em 6 estados:
//   • EMAIL_VERIFICATION_ERROR  → erro terminal (serviço de email Salesforce fora) → aborta
//   • EMAIL_VERIFICATION_FLOW   → Identity Verification ativo (enviou código) → espera
//   • CONCURRENT_SESSIONS       → Login Flow pedindo decisão → espera auto-redirect
//   • LIGHTNING_LOADING         → URL intermediária → espera montar
//   • LIGHTNING_CANDIDATE       → URL em lightning.force.com → confirma com DOM
//   • UNKNOWN                   → checa DOM mesmo assim
//
// Só declaramos "login OK" depois de chegar em LIGHTNING_CANDIDATE + DOM confirmado.

const { makeLogger, takeScreenshot, smartLocator, findFirstVisible } = require('../utils');
const webhookEmail = require('../webhookEmail');
const FSL_CONFIG = require('../config');

const STEP_NAME = 'login';
const READY_MAX_MS = 90 * 1000;
const READY_POLL_MS = 1500;
const CODE_2FA_RECHECK_MS = 12_000;

// ====================================================================
// getPageState — classifica a página atual em um estado discreto.
// A ordem das verificações importa: estados mais específicos primeiro.
// ====================================================================
function getPageState(url, title) {
  // 1) Erro terminal — Salesforce tentou enviar código de email e o
  // serviço retornou erro. Só acontece quando o título contém "Problem".
  if (/problem verifying your identity/i.test(title)) {
    return 'EMAIL_VERIFICATION_ERROR';
  }

  // 2) Identity Verification Flow está ativo (enviou código, esperando
  // input OU auto-validando). Estado intermediário — o loop espera.
  if (
    url.includes('EmailVerificationStartUi') ||
    url.includes('EmailVerificationBegin') ||
    url.includes('EmailVerificationVerify') ||
    /verify your identity/i.test(title)
  ) {
    return 'EMAIL_VERIFICATION_FLOW';
  }

  // 3) Login Flow pedindo decisão humana (ex: Concurrent Sessions)
  if (
    /loginflow|concurrent/i.test(url) ||
    /concurrent sessions/i.test(title)
  ) {
    return 'CONCURRENT_SESSIONS';
  }

  // 4) Lightning em processo de montar (URL intermediária ou título "Loading...")
  if (
    url.includes('/home/home.jsp') ||
    url.includes('visualforce/recsession') ||
    /^loading/i.test(title)
  ) {
    return 'LIGHTNING_LOADING';
  }

  // 5) URL em domínio Lightning — provavelmente pronto, mas precisa
  // confirmar com DOM.
  if (/lightning\.force\.com|lightning\.localhost/i.test(url)) {
    return 'LIGHTNING_CANDIDATE';
  }

  return 'UNKNOWN';
}

// ====================================================================
// clickLogOutAndWait — clica no link "Log Out" e espera redirect para
// tela de login. Retorna true se conseguiu, false se link não existe.
// ====================================================================
async function clickLogOutAndWait(page, log) {
  const logOutLink = page.locator('a').filter({ hasText: /^Log Out$/i });
  const linkCount = await logOutLink.count();
  if (linkCount === 0) {
    log.log('[login] link "Log Out" não encontrado');
    return false;
  }
  await logOutLink.first().click({ timeout: 5_000 });
  await page
    .waitForURL(/login|logout|secur/i, { timeout: 30_000 })
    .catch(() => {});
  return true;
}

// ====================================================================
// waitForLightningReady — loop que espera o Lightning ficar pronto.
//
// Retorna { ok: true, ... } se o Lightning montou.
// Retorna { ok: false, state: 'EMAIL_VERIFICATION_ERROR' | 'TIMEOUT' }
//   em caso de erro terminal ou timeout.
//
// Estados intermediários (EMAIL_VERIFICATION_FLOW, CONCURRENT_SESSIONS,
// LIGHTNING_LOADING) apenas esperam e continuam. UNKNOWN / LIGHTNING_CANDIDATE
// fazem checagem de DOM para confirmar.
// ====================================================================
async function waitForLightningReady(page, log) {
  const start = Date.now();
  let lastPhase = null;

  while (Date.now() - start < READY_MAX_MS) {
    const url = page.url();
    const title = await page.title();
    const state = getPageState(url, title);

    // 0) Erro terminal — aborta imediatamente
    if (state === 'EMAIL_VERIFICATION_ERROR') {
      log.log(`[login] estado de erro detectado: ${state} (URL=${url})`);
      return { ok: false, state, url, title };
    }

    // 1) Identity Verification Flow ativo — espera auto-resolver
    if (state === 'EMAIL_VERIFICATION_FLOW') {
      if (lastPhase !== 'email-verification') {
        lastPhase = 'email-verification';
        log.log(
          `[login] Identity Verification Flow ativo — aguardando (URL=${url}, TITLE="${title}")`
        );
        const bodyText = await page
          .locator('body')
          .innerText()
          .catch(() => '(falhou)');
        log.log(`[login] body (primeiros 400 chars): ${bodyText.slice(0, 400)}`);
        await takeScreenshot(page, STEP_NAME, 'email-verification-flow');
      }
      await page.waitForTimeout(READY_POLL_MS);
      continue;
    }

    // 2) Login Flow pedindo decisão (ex: Concurrent Sessions)
    if (state === 'CONCURRENT_SESSIONS') {
      if (lastPhase !== 'loginflow') {
        lastPhase = 'loginflow';
        log.log(
          `[login] tela de verificação detectada — aguardando auto-redirect (URL=${url}, TITLE="${title}")`
        );
        const bodyText = await page
          .locator('body')
          .innerText()
          .catch(() => '(falhou ao ler body)');
        log.log(`[login] body (primeiros 500 chars): ${bodyText.slice(0, 500)}`);
        await takeScreenshot(page, STEP_NAME, 'verify-identity');
      }
      await page.waitForTimeout(READY_POLL_MS);
      continue;
    }

    // 3) Lightning montando
    if (state === 'LIGHTNING_LOADING') {
      if (lastPhase !== 'lightning-load') {
        lastPhase = 'lightning-load';
        log.log(`[login] aguardando Lightning carregar (URL=${url}, TITLE="${title}")`);
      }
      await page.waitForTimeout(READY_POLL_MS);
      continue;
    }

    // 4) LIGHTNING_CANDIDATE ou UNKNOWN — confirma com DOM
    const onLightningDomain = /lightning\.force\.com|lightning\.localhost/i.test(url);
    const hasLightningDom = await page
      .locator('oneGlobalNav, .slds-global-header, [data-aura-class*="oneApp"]')
      .first()
      .isVisible()
      .catch(() => false);

    if (onLightningDomain && hasLightningDom) {
      log.log(`[login] Lightning pronto (URL=${url})`);
      return { ok: true, state, url, title };
    }

    if (lastPhase !== 'other') {
      lastPhase = 'other';
      log.log(
        `[login] URL fora dos padrões conhecidos — checando DOM (URL=${url}, TITLE="${title}")`
      );
    }
    await page.waitForTimeout(READY_POLL_MS);
  }

  // Retorno explícito em caso de timeout (antes faltava → crash no caller)
  const finalUrl = page.url();
  const finalTitle = await page.title();
  log.log(
    `[login] timeout após ${READY_MAX_MS / 1000}s (URL=${finalUrl}, TITLE="${finalTitle}")`
  );
  return { ok: false, state: 'TIMEOUT', url: finalUrl, title: finalTitle };
}

// ====================================================================
// step — função principal do step
// ====================================================================
async function step(ctx) {
  const log = makeLogger(STEP_NAME);
  const { page, input } = ctx;

  if (!input.fslUrl) throw new Error('login: input.fslUrl é obrigatório');
  if (!input.fslUser) throw new Error('login: input.fslUser é obrigatório');
  if (!input.fslPass) throw new Error('login: input.fslPass é obrigatório');

  log.log(`navegando para ${input.fslUrl}`);
  await page.goto(input.fslUrl, {
    waitUntil: 'domcontentloaded',
    timeout: FSL_CONFIG.TIMEOUTS.NAVIGATION,
  });

  // ============ ETAPA 1: USERNAME ============
  log.log('etapa 1/2: campo Username');
  const userInput = await findFirstVisible(page, [
    smartLocator(page, { label: 'Username' }),
    smartLocator(page, { label: 'User Name' }),
    smartLocator(page, { label: 'Usuário' }),
    smartLocator(page, { label: 'Login' }),
    smartLocator(page, { label: 'E-mail' }),
    page.locator('input[type="email"]'),
    page.locator('input[name*="username" i]'),
    page.locator('input[id*="username" i]'),
    page.locator('input[name*="user" i]:not([type="password"])'),
    page.locator('input[id*="user" i]:not([type="password"])'),
  ], { timeoutMs: 20_000 });

  if (!userInput) throw new Error('login etapa 1: campo Username não encontrado');
  await userInput.fill(input.fslUser);
  log.log('Username preenchido');

  // Atalho: se App Launcher já está visível (sessão anterior preservada)
  const appCard = page.getByText(/Console de Serviço/i).first();
  const appVisible = await appCard.isVisible({ timeout: 1000 }).catch(() => false);
  if (appVisible) {
    log.log('App Launcher visível, pulando etapas de login');
    await appCard.click();
  } else {
    // Botão Next/Avançar
    const nextBtn = await findFirstVisible(page, [
      smartLocator(page, { role: 'button', name: /^(Log In|Avançar|Next|Continue)$/i }),
      page.locator('input[type="submit"][value*="Log" i]'),
      page.locator('input[type="submit"][value*="Entrar" i]'),
      page.locator('input[type="submit"]'),
    ], { timeoutMs: 5_000 });

    if (!nextBtn) throw new Error('login etapa 1: botão Next/Avançar não encontrado');
    await nextBtn.click();
    log.log('Username submetido');

    // ============ ETAPA 2: PASSWORD ============
    log.log('etapa 2/2: aguardando campo Password aparecer');
    const passInput = await findFirstVisible(page, [
      smartLocator(page, { label: 'Password' }),
      smartLocator(page, { label: 'Senha' }),
      page.locator('input[type="password"]'),
      page.locator('input[name*="password" i]'),
      page.locator('input[id*="password" i]'),
    ], { timeoutMs: 20_000 });

    if (!passInput) throw new Error('login etapa 2: campo Password não apareceu após Next');
    await passInput.fill(input.fslPass);
    log.log('Password preenchido');

    // Registrar webhook ANTES de submeter (caso o email chegue instantaneamente)
    let twoFaPromise = null;
    if (input.twoFaToken) {
      log.log(`registrando webhook 2FA (token=${input.twoFaToken})`);
      twoFaPromise = webhookEmail.registerPending(
        input.twoFaToken,
        FSL_CONFIG.TIMEOUTS.CODE_2FA_WAIT
      );
    }

    const submitBtn = await findFirstVisible(page, [
      smartLocator(page, { role: 'button', name: /^(Log In|Verificar|Confirmar|Entrar)$/i }),
      smartLocator(page, { role: 'button', name: /^(Sign In|Submit)$/i }),
      page.locator('input[type="submit"]'),
    ], { timeoutMs: 5_000 });

    if (!submitBtn) throw new Error('login etapa 2: botão submit não encontrado');
    await submitBtn.click();
    log.log('Password submetido');

    // ============ 2FA (OPCIONAL) ============
    if (twoFaPromise) {
      // Janela inicial: 12s (era 8s — aumentada para cobrir MFA/Identity
      // Verification que demoram pra renderizar)
      const codeField = await findFirstVisible(page, [
        smartLocator(page, { label: /Verification Code/i }),
        smartLocator(page, { label: /C[oó]digo de Verifica[cç][aã]o/i }),
        smartLocator(page, { label: /C[oó]digo/i }),
        smartLocator(page, { label: /Code/i }),
        page.locator('input[name*="code" i]'),
        page.locator('input[id*="code" i]'),
        page.locator('input[inputmode="numeric"]'),
      ], { timeoutMs: 12_000 });

      if (codeField) {
        log.log('2FA exigido — aguardando webhook do Outlook (até 2 min)');
        log.log(`>>> Para o time: token 2FA é ${input.twoFaToken}`);
        const { code } = await twoFaPromise;
        log.log(`código recebido (${code.length} dígitos), inserindo`);
        await codeField.fill(code);

        const confirm2FA = await findFirstVisible(page, [
          smartLocator(page, { role: 'button', name: /^(Verificar|Confirmar|Enviar|Verify)$/i }),
          page.locator('input[type="submit"]'),
        ], { timeoutMs: 5_000 });
        if (confirm2FA) await confirm2FA.click();
        log.log('2FA submetido');
      } else {
        // Não encontramos o campo em 12s. Pode ser:
        //   (a) Login sem 2FA (sessão já validada)
        //   (b) MFA/Identity Verification ainda renderizando
        //   (c) Email enviado, página de input ainda não chegou
        //
        // NÃO cancela o webhook ainda — espera mais 12s e re-checa.
        log.log('campo 2FA não apareceu em 12s — aguardando mais 12s para confirmar');

        // Diagnóstico do que está renderizado
        const urlAfterSubmit = page.url();
        const titleAfterSubmit = await page.title().catch(() => '');
        log.log(`[login] pós-Password: URL=${urlAfterSubmit}`);
        log.log(`[login] pós-Password: TITLE="${titleAfterSubmit}"`);

        await page.waitForTimeout(CODE_2FA_RECHECK_MS);

        const codeFieldRetry = await findFirstVisible(page, [
          smartLocator(page, { label: /Verification Code/i }),
          smartLocator(page, { label: /C[oó]digo de Verifica[cç][aã]o/i }),
          smartLocator(page, { label: /C[oó]digo/i }),
          smartLocator(page, { label: /Code/i }),
          page.locator('input[name*="code" i]'),
          page.locator('input[id*="code" i]'),
          page.locator('input[inputmode="numeric"]'),
        ], { timeoutMs: 5_000 });

        if (codeFieldRetry) {
          log.log('campo 2FA apareceu na segunda validação (12s+12s)');
          log.log('2FA exigido — aguardando webhook do Outlook (até 2 min)');
          log.log(`>>> Para o time: token 2FA é ${input.twoFaToken}`);
          const { code } = await twoFaPromise;
          log.log(`código recebido (${code.length} dígitos), inserindo`);
          await codeFieldRetry.fill(code);

          const confirm2FARetry = await findFirstVisible(page, [
            smartLocator(page, { role: 'button', name: /^(Verificar|Confirmar|Enviar|Verify)$/i }),
            page.locator('input[type="submit"]'),
          ], { timeoutMs: 5_000 });
          if (confirm2FARetry) await confirm2FARetry.click();
          log.log('2FA submetido');
        } else {
          // 24s totais sem ver campo de 2FA — confirma que não há
          const urlFinal = page.url();
          const titleFinal = await page.title().catch(() => '');
          log.log(
            `2FA confirmado como não exigido após 24s (URL=${urlFinal}, TITLE="${titleFinal}")`
          );
          webhookEmail.cancelPending(input.twoFaToken, 'sem_2fa_confirmado');
        }
      }
    }
  }

  // ============================================================
  // ETAPA 3 — esperar Lightning ficar pronto
  // ============================================================
  const result = await waitForLightningReady(page, log);

  if (result.ok) {
    await takeScreenshot(page, STEP_NAME, 'after-login');
    log.log('login OK');
    ctx.steps = ctx.steps || [];
    ctx.steps.push({ step: STEP_NAME, status: 'ok', twoFaToken: input.twoFaToken });
    return ctx;
  }

  // Erro terminal de email — não adianta tentar de novo
  if (result.state === 'EMAIL_VERIFICATION_ERROR') {
    await takeScreenshot(page, STEP_NAME, 'email-verification-error');
    throw new Error(
      'login: Salesforce exigiu verificação adicional por email, mas o serviço ' +
        'de envio retornou "can\'t send you a verification code right now". ' +
        'Isto é um problema do lado do Salesforce (não da automação). ' +
        'Aguarde 5-15 minutos e reenvie POST /instalar. ' +
        `URL final: ${result.url} | TITLE: "${result.title}"`
    );
  }

  // TIMEOUT (90s) — tenta recuperar com Log Out + novo login
  log.log('[login] Login Flow persistente após 90s — tentando Log Out');
  await takeScreenshot(page, STEP_NAME, 'concurrent-stuck');
  const loggedOut = await clickLogOutAndWait(page, log);
  if (!loggedOut) {
    throw new Error(
      'login: Login Flow persistente e link "Log Out" não encontrado. ' +
        'Verifique se a política da org permite logout via UI.'
    );
  }

  // Re-registra webhook para a 2ª tentativa
  if (input.twoFaToken) {
    webhookEmail.cancelPending(input.twoFaToken, 'retry');
    webhookEmail.registerPending(
      input.twoFaToken,
      FSL_CONFIG.TIMEOUTS.CODE_2FA_WAIT
    );
  }
  log.log('[login] reiniciando login (2ª tentativa)');
  await page.goto(input.fslUrl, {
    waitUntil: 'domcontentloaded',
    timeout: FSL_CONFIG.TIMEOUTS.NAVIGATION,
  });

  // 2ª tentativa: espera o Lightning montar de novo
  const result2 = await waitForLightningReady(page, log);

  // Mesmo tratamento de erro terminal na 2ª tentativa
  if (result2.state === 'EMAIL_VERIFICATION_ERROR') {
    await takeScreenshot(page, STEP_NAME, 'email-verification-error-2nd');
    throw new Error(
      'login: Salesforce exigiu verificação adicional por email (após 2 tentativas). ' +
        'Aguarde 5-15 minutos e reenvie POST /instalar. ' +
        `URL final: ${result2.url} | TITLE: "${result2.title}"`
    );
  }

  if (!result2.ok) {
    await takeScreenshot(page, STEP_NAME, 'concurrent-stuck-2nd');
    throw new Error(
      `login: Lightning não montou após 2 tentativas (${(2 * READY_MAX_MS) / 1000}s no total). ` +
        'Veja screenshots concurrent-stuck* e os logs acima. ' +
        'Se a org não restaurou a sessão automaticamente, reenvie POST /instalar.'
    );
  }

  await takeScreenshot(page, STEP_NAME, 'after-login');
  log.log('login OK');
  ctx.steps = ctx.steps || [];
  ctx.steps.push({ step: STEP_NAME, status: 'ok', twoFaToken: input.twoFaToken });
  return ctx;
}

module.exports = { step, name: STEP_NAME };