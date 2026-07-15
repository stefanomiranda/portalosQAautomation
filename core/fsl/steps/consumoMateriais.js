// core/fsl/steps/consumoMateriais.js
//
// Step 3/8 — Wizard de Consumo de Material.
//
// FLUXO:
//   1) Abre "Consumo de Materiais e Equipamentos"
//   2) Marca radio "Materiais" clicando no <label for="...">
//   3) Next → preenche Grupo=Home Gateway / Quantidade=1
//   4) Avancar → "Nao" no dialog → Concluir
//
// FIX DO RADIO (2026-07-10):
//   O SLDS esconde o <input type="radio"> com display:none e
//   mostra um <span class="slds-radio_faux"> como elemento visual.
//   .check() no input falha porque:
//     1) o input está hidden (actionability check falha sem force)
//     2) mesmo com force:true, o LWC não detecta o clique no input
//        escondido — o componente escuta change no input, mas o
//        click sintético em elemento hidden não dispara change.
//   SOLUÇÃO: clicar no <label for="<id>"> — o browser encaminha
//   o click pro input via associação for/id e dispara o change
//   corretamente. O id é dinâmico (RADIO-1-380, RADIO-1-414, etc.),
//   então pegamos em runtime a partir do value estável do input.

const { makeLogger, takeScreenshot, smartLocator } = require('../utils');
const FSL_CONFIG = require('../config');

const STEP_NAME = 'consumoMateriais';

// Map tipo interno → value do <input type="radio"> no Lightning.
// Confirmado via DevTools: value é estável entre execuções,
// id é dinâmico (RADIO-X-Y muda a cada render).
const RADIO_VALUES = {
  materiais: 'varChoice_TypeMaterials',
  equipamentos: 'varChoice_TypeEquipments',
};

// =============================================================================
// MARCAR RADIO — clique no <label for="<id>">, sem cascata
//
// 1) Acha o <input> pelo value estável
// 2) Pega o id dinâmico
// 3) Clica no <label for="<id>"> — comportamento HTML nativo
// 4) Valida isChecked() — se falso, throw claro
// =============================================================================
async function selecionarAdicionarTipo(page, log, tipo) {
  const value = RADIO_VALUES[tipo];
  if (!value) {
    throw new Error(`consumoMateriais: tipo desconhecido "${tipo}"`);
  }

  log.log(`  marcando radio "${tipo}" (input[value="${value}"])`);

  // 1) Localiza o <input> pelo value estável
  const radio = page.locator(`input[type="radio"][value="${value}"]`);
  if (await radio.count() === 0) {
    throw new Error(
      `consumoMateriais: input[value="${value}"] não encontrado no modal. ` +
      `Verifique se "Consumption of Materials and Equipment" está aberto.`
    );
  }

  // 2) Pega o id dinâmico (ex: "RADIO-1-380")
  const radioId = await radio.getAttribute('id');
  if (!radioId) {
    throw new Error(
      `consumoMateriais: input[value="${value}"] não tem atributo id. ` +
      `Não é possível localizar o label associado.`
    );
  }

  // 3) Clica no <label for="<id>">
  //    O browser encaminha o click pro input via for/id e dispara
  //    o evento change que o LWC escuta.
  const label = page.locator(`label[for="${radioId}"]`).first();
  if (await label.count() === 0) {
    throw new Error(
      `consumoMateriais: label[for="${radioId}"] não encontrado. ` +
      `O input existe (value="${value}") mas o label associado não.`
    );
  }

  await label.click({ force: true });
  log.log(`  clicou no label[for="${radioId}"]`);

  await page.waitForTimeout(500);

  // 4) Valida que o input ficou checked
  const checked = await radio.isChecked();
  if (!checked) {
    throw new Error(
      `consumoMateriais: clique no label não marcou o input. ` +
      `isChecked() retornou false após click.`
    );
  }

  log.log(`  radio "${tipo}" validado (isChecked=true)`);
  return true;
}

// =============================================================================
// CLICAR NEXT E VALIDAR QUE AVANÇOU
// =============================================================================
async function clicarNextEValidar(page, log, stepName) {
  const nextBtn = smartLocator(page, [
    { role: 'button', name: /^(Next|Pr[óo]ximo|Avancar|Continue)$/i },
  ]).first();

  if (!(await nextBtn.isVisible({ timeout: 1_500 }).catch(() => false))) {
    log.log('  Next não encontrado (wizard de 1 etapa)');
    return true;
  }

  await nextBtn.click({ force: true }).catch((e) =>
    log.log(`  Next click falhou: ${(e.message || '').slice(0, 80)}`)
  );
  await page.waitForTimeout(800);

  const erroEscolha = page
    .locator('text=/Please select a choice|Selecione uma op[çc][ãa]o|Escolha uma op[çc][ãa]o/i')
    .first();
  if (await erroEscolha.isVisible({ timeout: 800 }).catch(() => false)) {
    const texto = (await erroEscolha.textContent().catch(() => '') || '').trim();
    throw new Error(
      `${stepName}: wizard recusou Next — "${texto}" ` +
      `(opção não foi marcada)`
    );
  }

  log.log('  Next clicado e validado');
  return true;
}

// =============================================================================
// CLICA NO BOTÃO DE AÇÃO (direto OU via Show more actions)
// =============================================================================
async function clickActionButton(page, log, nameRegex) {
  const direct = smartLocator(page, [
    { role: 'button', name: nameRegex },
    { text: nameRegex },
  ]).first();
  if (await direct.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await direct.click();
    return 'direto';
  }
  const showMore = smartLocator(page, [
    { role: 'button', name: /Show more actions|Mostrar mais a[çc][õo]es|Mais a[çc][õo]es/i },
    { text: /Show more actions|Mostrar mais a[çc][õo]es|Mais a[çc][õo]es/i },
  ]).first();
  if (await showMore.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await showMore.click();
    await page.waitForTimeout(800);
    const inMenu = smartLocator(page, [
      { role: 'menuitem', name: nameRegex },
      { role: 'button', name: nameRegex },
      { text: nameRegex },
    ]).first();
    if (await inMenu.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await inMenu.click();
      return 'show_more';
    }
  }
  return null;
}

// =============================================================================
// STEP PRINCIPAL
// =============================================================================
async function step(ctx) {
  const log = makeLogger(STEP_NAME);
  const { page } = ctx;

  // ETAPA 1 — abrir modal
  log.log('abrindo Consumo de Materiais e Equipamentos (opção=Adicionar Materiais)');

  let modalJaAberta = false;
  try {
    const m = page.locator('[role="dialog"]:visible, .slds-modal--open').first();
    modalJaAberta = await m.isVisible({ timeout: 500 }).catch(() => false);
  } catch (_) { /* ignore */ }

  if (!modalJaAberta) {
    const how = await clickActionButton(
      page, log, /Consumo de Materiais e Equipamentos|Consumption of Materials and Equipment/i
    );
    if (!how) {
      await takeScreenshot(page, STEP_NAME, 'no-consumo-button').catch(() => {});
      throw new Error('consumoMateriais: botão não encontrado (direto nem em Show more actions)');
    }
    log.log(`modal Consumo aberto (via ${how})`);

    await page.locator('[role="dialog"]:visible, .slds-modal--open')
      .first()
      .waitFor({ state: 'visible', timeout: 8_000 })
      .catch(() => log.log('modal não detectada explicitamente (continuando)'));
  } else {
    log.log('modal de Consumo já estava aberta — reutilizando');
  }
  await page.waitForTimeout(800);

  // ETAPA 2 — marcar radio "Materiais" + Next
  log.log('marcando opção "Adicionar Materiais"');
  await selecionarAdicionarTipo(page, log, 'materiais');
  await clicarNextEValidar(page, log, STEP_NAME);

  // (Defensivo) aba "Materiais" se o wizard usa tabs
  const matTab = smartLocator(page, [
    { role: 'tab', name: /^Materiais$|^Materials$/i },
    { text: /^Materiais$|^Materials$/i },
  ]).first();
  if (await matTab.isVisible({ timeout: 800 }).catch(() => false)) {
    await matTab.click({ timeout: 3_000 }).catch(() => {});
    log.log('  aba Materiais clicada');
  }

  // ETAPA 3 — Adicionar materiais
  log.log('preenchendo formulário de Material');
  const addBtn = smartLocator(page, [
    { role: 'button', name: /Adicionar materiais|Add materials|New material/i },
  ]).first();
  if (await addBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await addBtn.click();
    log.log('  Adicionar materiais clicado');
    await page.waitForTimeout(800);
  } else {
    log.log('  botão Adicionar materiais não encontrado (continuando)');
  }

  // Grupo
  const grupoField = smartLocator(page, [
    { role: 'combobox', name: /Grupo|Group|Category/i },
  ]).first();
  if (await grupoField.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await grupoField.click();
    await page.waitForTimeout(300);
    const grupoOpt = smartLocator(page, [{ role: 'option', name: /Home Gateway/i }]).first();
    if (await grupoOpt.isVisible({ timeout: 2_000 }.catch(() => false))) {
      await grupoOpt.click();
      log.log('  grupo = Home Gateway');
    } else {
      log.log('  opção Home Gateway não encontrada');
    }
  } else {
    log.log('  campo Grupo não encontrado (pode ser pré-preenchido)');
  }

  // Quantidade
  const qtyField = smartLocator(page, [
    { role: 'spinbutton', name: /Quantidade|Quantity/i },
  ]).first();
  if (await qtyField.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await qtyField.fill('1');
    log.log('  quantidade = 1');
  } else {
    log.log('  campo Quantidade não encontrado');
  }

  // ETAPA 4 — Avançar
  log.log('clicando Avançar (form -> novo material?)');
  const avancarBtn = smartLocator(page, [
    { role: 'button', name: /^(Avancar|Next|Continue)$/i },
  ]).first();
  await avancarBtn.click({ timeout: 5_000 }).catch((e) =>
    log.log(`Avancar falhou: ${(e.message || '').slice(0, 80)}`)
  );
  await page.waitForTimeout(1_000);

  // ETAPA 5 — "novo material?" = Não
  const naoBtn = smartLocator(page, [
    { role: 'button', name: /^(Nao|No)$/i },
  ]).first();
  if (await naoBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await naoBtn.click();
    log.log('  Não clicado');
    await page.waitForTimeout(500);
  } else {
    log.log('  dialog "novo material?" não apareceu (pode ser pulado)');
  }

  // ETAPA 6 — Concluir
  log.log('clicando Concluir');
  const concluirBtn = smartLocator(page, [
    { role: 'button', name: /^(Concluir|Done|Save|Finish)$/i },
  ]).last();
  if (await concluirBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await concluirBtn.click();
    log.log('  Concluir clicado');
  } else {
    log.log('  botão Concluir não encontrado');
  }

  // ETAPA 7 — fecha modal de verdade
  log.log('aguardando modal fechar');
  try {
    await page.locator('[role="dialog"]:visible, .slds-modal--open')
      .first()
      .waitFor({ state: 'hidden', timeout: 10_000 });
    log.log('  modal fechou');
  } catch (e) {
    log.log('  modal NÃO fechou em 10s — tentando X como fallback');
    const xBtn = page.locator(
      'button[aria-label="Close"], ' +
      'lightning-button-icon[aria-label*="Close" i], ' +
      'button[title*="Close" i]'
    ).first();
    if (await xBtn.isVisible({ timeout: 1_000 }.catch(() => false))) {
      await xBtn.click().catch(() => {});
      log.log('  X clicado manualmente');
    }
  }

  await page.waitForTimeout(1_500);
  await takeScreenshot(page, STEP_NAME, 'pos-concluir').catch(() => {});
  log.log('consumoMateriais OK');

  ctx.steps = ctx.steps || [];
  ctx.steps.push({ step: STEP_NAME, status: 'ok' });
  return ctx;
}

module.exports = { step, name: STEP_NAME };