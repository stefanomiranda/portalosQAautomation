// core/fsl/steps/consumoMateriais.js
//
// Step 6/8 — Consumo de Materiais.

const { makeLogger, takeScreenshot, smartLocator } = require('../utils');
const FSL_CONFIG = require('../config');

const STEP_NAME = 'consumoMateriais';

async function step(ctx) {
  const log = makeLogger(STEP_NAME);
  const { page } = ctx;

  log.log('reabrindo Consumo de Materiais e Equipamentos');
  const abrirConsumo = smartLocator(page, [
    { role: 'button', name: /Consumo de Materiais e Equipamentos/i },
    { text: /Consumo de Materiais e Equipamentos/i },
  ]).first();
  const visivel = await abrirConsumo.isVisible({ timeout: 1500 }).catch(() => false);
  if (visivel) await abrirConsumo.click();

  log.log('aba Materiais → Avançar');
  await smartLocator(page, [
    { role: 'tab', name: /^Materiais$/i },
    { text: /^Materiais$/i },
  ]).first().click();
  await smartLocator(page, { role: 'button', name: /^Avançar$/i }).first().click();

  log.log('Adicionar materiais → Avançar');
  const addMat = smartLocator(page, [
    { role: 'button', name: /Adicionar materiais/i },
    { text: /Adicionar materiais/i },
  ]).first();
  await addMat.click();
  await smartLocator(page, { role: 'button', name: /^Avançar$/i }).first().click();

  log.log('Home Gateway → Avançar');
  const hg = smartLocator(page, [
    { role: 'option', name: /Home Gateway/i },
    { text: /Home Gateway/i },
  ]).first();
  await hg.click();
  await smartLocator(page, { role: 'button', name: /^Avançar$/i }).first().click();

  log.log('Adicionar 1 → Avançar');
  const add1 = smartLocator(page, [
    { role: 'button', name: /Adicionar 1/i },
    { text: /Adicionar 1/i },
  ]).first();
  await add1.click();
  await smartLocator(page, { role: 'button', name: /^Avançar$/i }).first().click();

  log.log('modal "novo produto?" → Não → Concluir');
  const nao = smartLocator(page, { role: 'button', name: /^N[aã]o$/i }).first();
  if (await nao.isVisible({ timeout: 3000 }).catch(() => false)) {
    await nao.click();
  }
  const concluir = smartLocator(page, { role: 'button', name: /Concluir/i }).first();
  await concluir.click();

  await takeScreenshot(page, STEP_NAME, 'after-materiais');
  log.log('consumo de materiais OK');

  ctx.steps = ctx.steps || [];
  ctx.steps.push({ step: STEP_NAME, status: 'ok' });
  return ctx;
}

module.exports = { step, name: STEP_NAME };
