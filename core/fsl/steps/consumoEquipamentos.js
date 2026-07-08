// core/fsl/steps/consumoEquipamentos.js
//
// Step 5/8 — Consumo de Equipamentos.

const { makeLogger, takeScreenshot, smartLocator } = require('../utils');
const FSL_CONFIG = require('../config');

const STEP_NAME = 'consumoEquipamentos';

async function step(ctx) {
  const log = makeLogger(STEP_NAME);
  const { page } = ctx;

  log.log('abrindo Consumo de Materiais e Equipamentos');
  const abrirConsumo = smartLocator(page, [
    { role: 'button', name: /Consumo de Materiais e Equipamentos/i },
    { text: /Consumo de Materiais e Equipamentos/i },
  ]).first();
  await abrirConsumo.click();

  log.log('clica na aba Equipamentos → Avançar');
  await smartLocator(page, [
    { role: 'tab', name: /Equipamentos/i },
    { text: /Equipamentos/i },
  ]).first().click();
  await smartLocator(page, { role: 'button', name: /^Avançar$/i }).first().click();

  log.log('seleciona FTTH ONT → Avançar');
  const ftth = smartLocator(page, [
    { role: 'option', name: /FTTH ONT/i },
    { text: /FTTH ONT/i },
  ]).first();
  await ftth.click();
  await smartLocator(page, { role: 'button', name: /^Avançar$/i }).first().click();

  log.log('consumir 1 unidade → cômodo sala → Associar → Avançar');
  const qtdField = page.locator('input[type="number"]').first();
  await qtdField.fill('1');

  const comodo = smartLocator(page, [
    { role: 'combobox', name: /C[oô]modo/i },
    { label: /C[oô]modo/i },
    { css: 'select[name*="comodo" i]' },
  ]).first();
  const tagName = await comodo.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
  if (tagName === 'select') {
    const opts = await comodo.locator('option').evaluateAll(os =>
      os.map(o => ({ v: o.value, t: o.textContent.trim() })).filter(o => o.v)
    );
    const sala = opts.find(o => /^sala$/i.test(o.t));
    await comodo.selectOption((sala || opts[0]).v);
  } else {
    await comodo.fill('sala');
  }

  const associar = smartLocator(page, [
    { role: 'checkbox', name: /Associar/i },
    { css: 'input[type="checkbox"][name*="associ" i]' },
  ]).first();
  if (await associar.isVisible({ timeout: 2000 }).catch(() => false)) {
    const checked = await associar.isChecked().catch(() => false);
    if (!checked) await associar.check();
  }

  await smartLocator(page, { role: 'button', name: /^Avançar$/i }).first().click();

  log.log('modal "novo produto?" → Não → Concluir');
  const nao = smartLocator(page, { role: 'button', name: /^N[aã]o$/i }).first();
  if (await nao.isVisible({ timeout: 3000 }).catch(() => false)) {
    await nao.click();
  }
  const concluir = smartLocator(page, { role: 'button', name: /Concluir/i }).first();
  await concluir.click();

  await takeScreenshot(page, STEP_NAME, 'after-equipamentos');
  log.log('consumo de equipamentos OK');

  ctx.steps = ctx.steps || [];
  ctx.steps.push({ step: STEP_NAME, status: 'ok' });
  return ctx;
}

module.exports = { step, name: STEP_NAME };
