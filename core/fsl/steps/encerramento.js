// core/fsl/steps/encerramento.js
//
// Step 8/8 — Encerramento do SA.

const { makeLogger, takeScreenshot, smartLocator } = require('../utils');
const FSL_CONFIG = require('../config');

const STEP_NAME = 'encerramento';

const ENCERRAMENTO_TEXT = (senha) => `Senha de instalação: ${senha}
Atendimento concluído conforme procedimento padrão.
Equipamentos consumidos e associados conforme checklist.`;

async function step(ctx) {
  const log = makeLogger(STEP_NAME);
  const { page } = ctx;

  if (!ctx.senha) {
    throw new Error('encerramento: ctx.senha ausente (verSenha não rodou?)');
  }

  log.log('abrindo Encerramento');
  const enc = smartLocator(page, [
    { role: 'button', name: /^Encerramento$/i },
    { text: /^Encerramento$/i },
  ]).first();
  await enc.click();

  const inputs = page.locator(
    'textarea:visible, input[type="text"]:visible, input:not([type]):visible'
  );
  const n = await inputs.count();
  log.log(`preenchendo ${n} campo(s) do formulário de encerramento`);

  for (let i = 0; i < n; i++) {
    const el = inputs.nth(i);
    try {
      await el.fill(ENCERRAMENTO_TEXT(ctx.senha));
    } catch (e) {
      log.warn(`campo #${i} não editável: ${e.message}`);
    }
  }

  const senhaField = page.locator('input[name*="senha" i], input[id*="senha" i]').first();
  if (await senhaField.isVisible({ timeout: 1000 }).catch(() => false)) {
    await senhaField.fill(ctx.senha);
  }

  await smartLocator(page, { role: 'button', name: /^Avançar$/i }).first().click();
  const concluir = smartLocator(page, { role: 'button', name: /Concluir/i }).first();
  await concluir.click();

  await takeScreenshot(page, STEP_NAME, 'after-encerramento');
  log.log('encerramento OK');

  ctx.steps = ctx.steps || [];
  ctx.steps.push({ step: STEP_NAME, status: 'ok' });
  return ctx;
}

module.exports = { step, name: STEP_NAME };
