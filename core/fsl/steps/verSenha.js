// core/fsl/steps/verSenha.js
//
// Step 7/8 — Captura da senha de instalacao.
//
// MELHORIAS:
//   (A) ponte com o orquestrador (ctx.senha + ctx.senhaInstalacao)
//   (B) fallback especifico (sem page.locator('*'))
//   (C) log do valor real via FSL_LOG_SENHA=1
//   (D) Show more actions: tenta direto, se nao achar abre o menu
//   (E) fechamento do modal
//
// ATUALIZACAO: regex do botao ampliada para casar "View Password"
// (em ingles) alem de "Ver Senha de Consumo" / "View Consumption Password".

const { makeLogger, takeScreenshot, smartLocator } = require('../utils');
const FSL_CONFIG = require('../config');

const STEP_NAME = 'verSenha';
const LOG_SENHA_VALOR = process.env.FSL_LOG_SENHA === '1';
const SENHA_RE = /^[A-Za-z0-9!@#$%^&*()_+\-={}\[\]:;"'<>,.?\/\\|`~]{6,}$/;

async function clickActionButton(page, log, nameRegex) {
  const direct = smartLocator(page, [
    { role: 'button', name: nameRegex },
    { text: nameRegex },
  ]).first();
  if (await direct.isVisible({ timeout: 1500 }).catch(() => false)) {
    await direct.click();
    return 'direto';
  }
  const showMore = smartLocator(page, [
    { role: 'button', name: /Show more actions|Mostrar mais a[c\u00e7][o\u00f5]es|Mais a[c\u00e7][o\u00f5]es/i },
    { text: /Show more actions|Mostrar mais a[c\u00e7][o\u00f5]es|Mais a[c\u00e7][o\u00f5]es/i },
  ]).first();
  if (await showMore.isVisible({ timeout: 1000 }).catch(() => false)) {
    await showMore.click();
    await page.waitForTimeout(800);
    const inMenu = smartLocator(page, [
      { role: 'menuitem', name: nameRegex },
      { role: 'button', name: nameRegex },
      { text: nameRegex },
    ]).first();
    if (await inMenu.isVisible({ timeout: 2000 }).catch(() => false)) {
      await inMenu.click();
      return 'show_more';
    }
  }
  return null;
}

async function step(ctx) {
  const log = makeLogger(STEP_NAME);
  const { page } = ctx;

  // ====================================================================
  // ETAPA 1 — abrir o botao de senha (regex ampliada)
  // ====================================================================
  log.log('abrindo botao de senha da instalacao');
  const how = await clickActionButton(page, log,
    /Ver\s*Senha|View\s*(?:Consumption\s*)?Password/i
  );
  if (!how) {
    await takeScreenshot(page, STEP_NAME, 'no-ver-senha-button').catch(() => {});
    throw new Error('verSenha: botao de senha nao encontrado (direto nem em Show more actions)');
  }
  log.log(`botao de senha aberto (via ${how})`);

  // Espera o dialogo/painel abrir
  try {
    await page
      .locator('[role="dialog"]:visible, .slds-modal--open, .modal-container')
      .first()
      .waitFor({ state: 'visible', timeout: 8_000 });
  } catch (_) {
    log.log('dialogo de Ver Senha nao detectado explicitamente (continuando)');
  }

  // ====================================================================
  // ETAPA 2 — ler a senha (4 estrategias, em ordem de especificidade)
  // ====================================================================
  log.log('lendo senha');
  let senha = '';

  // 2.1 input field
  if (!senha) {
    try {
      const inputField = page
        .locator(
          'input[readonly], ' +
          'input[disabled][value], ' +
          'input[name*="senha" i], ' +
          'input[id*="senha" i], ' +
          'input[aria-label*="senha" i], ' +
          'input[name*="password" i], ' +
          'input[id*="password" i], ' +
          'input[aria-label*="password" i]'
        )
        .first();
      if (await inputField.isVisible({ timeout: 3_000 }).catch(() => false)) {
        const value = (await inputField.inputValue() || '').trim();
        if (value && SENHA_RE.test(value)) {
          senha = value;
          log.log('senha obtida via input field');
        }
      }
    } catch (err) {
      log.log(`estrategia 2.1 falhou: ${(err.message || '').slice(0, 80)}`);
    }
  }

  // 2.2 data-testid
  if (!senha) {
    try {
      const testIdField = page
        .locator('[data-testid*="senha" i], [data-testid*="password" i]')
        .first();
      if (await testIdField.isVisible({ timeout: 2_000 }).catch(() => false)) {
        const tag = await testIdField.evaluate(el => el.tagName.toLowerCase());
        const raw = (tag === 'input' || tag === 'textarea')
          ? await testIdField.inputValue().catch(() => '')
          : await testIdField.textContent().catch(() => '');
        const trimmed = (raw || '').trim();
        if (trimmed && SENHA_RE.test(trimmed)) {
          senha = trimmed;
          log.log('senha obtida via data-testid');
        }
      }
    } catch (err) {
      log.log(`estrategia 2.2 falhou: ${(err.message || '').slice(0, 80)}`);
    }
  }

  // 2.3 lightning-formatted-text
  if (!senha) {
    try {
      const field = page
        .locator('lightning-formatted-text')
        .filter({ hasText: SENHA_RE })
        .first();
      if (await field.isVisible({ timeout: 2_000 }).catch(() => false)) {
        const text = (await field.textContent() || '').trim();
        if (text && SENHA_RE.test(text)) {
          senha = text;
          log.log('senha obtida via lightning-formatted-text');
        }
      }
    } catch (err) {
      log.log(`estrategia 2.3 falhou: ${(err.message || '').slice(0, 80)}`);
    }
  }

  // 2.4 fallback especifico
  if (!senha) {
    try {
      const candidates = await page
        .locator('[class*="senha" i], [class*="password" i], [id*="senha" i], [id*="password" i]')
        .evaluateAll((els) => {
          const results = [];
          for (const el of els) {
            const text = (el.innerText || el.textContent || '').trim();
            if (!text) continue;
            const match = text.match(/[A-Za-z0-9!@#$%^&*()_+\-={}\[\]:;"'<>,.?\/\\|`~]{6,}/);
            if (match) {
              results.push({
                text: match[0],
                source: (el.className || el.id || el.tagName || '').toString().slice(0, 60),
              });
            }
          }
          return results;
        });
      if (candidates.length > 0) {
        senha = candidates[0].text;
        log.log(`senha obtida via fallback especifico (fonte: "${candidates[0].source}")`);
      }
    } catch (err) {
      log.log(`estrategia 2.4 falhou: ${(err.message || '').slice(0, 80)}`);
    }
  }

  if (!senha) {
    await takeScreenshot(page, STEP_NAME, 'senha-nao-encontrada').catch(() => {});
    throw new Error('verSenha: nao foi possivel extrair a senha apos 4 estrategias');
  }

  // ====================================================================
  // ETAPA 3 — log (mascarado por padrao, valor real se FSL_LOG_SENHA=1)
  // ====================================================================
  if (LOG_SENHA_VALOR) {
    log.log(`senha capturada (${senha.length} chars) | valor: ${senha}`);
  } else {
    log.log(`senha capturada (${'*'.repeat(Math.min(senha.length, 20))}, length=${senha.length})`);
  }

  await takeScreenshot(page, STEP_NAME, 'ver-senha').catch(() => {});

  // ====================================================================
  // ETAPA 4 — fechar o modal
  // ====================================================================
  log.log('fechando modal de Ver Senha');
  let closed = false;
  try {
    const closeBtn = smartLocator(page, [
      { role: 'button', name: /^(OK|Close|Fechar|Done|Concluir)$/i },
    ]).first();
    if (await closeBtn.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await closeBtn.click();
      closed = true;
    }
  } catch (_) { /* tenta proxima */ }

  if (!closed) {
    try {
      const cancelBtn = page
        .locator('lightning-button button:has-text("Cancel"), [data-id*="cancel" i] button')
        .first();
      if (await cancelBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await cancelBtn.click();
        closed = true;
      }
    } catch (_) { /* tenta proxima */ }
  }

  if (!closed) {
    try {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      closed = true;
    } catch (_) { /* ignore */ }
  }

  if (closed) {
    await page.waitForTimeout(500);
  } else {
    log.log('Nao foi possivel fechar o modal explicitamente');
  }

  // ====================================================================
  // ETAPA 5 — persistir a senha (OPCAO A)
  // ====================================================================
  ctx.senha = senha;
  ctx.senhaInstalacao = senha;
  ctx.steps = ctx.steps || [];
  ctx.steps.push({
    step: STEP_NAME,
    status: 'ok',
    senhaLength: senha.length,
  });
  return ctx;
}

module.exports = { step, name: STEP_NAME };