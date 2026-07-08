// core/fsl/steps/verSenha.js
//
// Step 7/8 — Captura da senha de instalação.

const { makeLogger, takeScreenshot, smartLocator } = require('../utils');
const FSL_CONFIG = require('../config');

const STEP_NAME = 'verSenha';

async function step(ctx) {
  const log = makeLogger(STEP_NAME);
  const { page } = ctx;

  log.log('abrindo Ver Senha');
  const verSenha = smartLocator(page, [
    { role: 'button', name: /Ver Senha/i },
    { text: /Ver Senha/i },
  ]).first();
  await verSenha.click();

  const senhaField = page.locator(
    'input[readonly], input[disabled][value], [data-testid*="senha" i], [data-testid*="password" i]'
  ).first();

  await senhaField.waitFor({ timeout: FSL_CONFIG.TIMEOUTS.ACTION });

  const tagName = await senhaField.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
  let senha = '';
  if (tagName === 'input' || tagName === 'textarea') {
    senha = (await senhaField.inputValue() || '').trim();
  } else {
    senha = (await senhaField.textContent() || '').trim();
  }

  if (!senha) {
    const fallback = page.locator('*').filter({ hasText: /[A-Za-z0-9!@#$%^&*]{6,}/ }).first();
    senha = (await fallback.textContent() || '').trim().split('\n')[0];
  }

  if (!senha) throw new Error('verSenha: não foi possível extrair a senha');
  log.log(`senha capturada (${senha.length} caracteres)`);
  // NÃO loga o valor da senha em produção (LGPD / compliance)

  await takeScreenshot(page, STEP_NAME, 'ver-senha');

  ctx.senha = senha;
  ctx.steps = ctx.steps || [];
  ctx.steps.push({ step: STEP_NAME, status: 'ok', senhaLength: senha.length });
  return ctx;
}

module.exports = { step, name: STEP_NAME };
