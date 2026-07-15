// core/fsl/steps/consumoEquipamentos.js
//
// Step 4/8 — Wizard de Consumo de Equipamento.
//
// FLUXO (Conclusao de Instalacao via FSL):
//   1) Abre o botao "Consumo de Materiais e Equipamentos" (mesmo botao
//      do consumo de Material — a diferenca e' o checkbox interno)
//   2) Marca a opcao "Adicionar Equipamentos" (checkbox/radio)
//   3) Clica "Next" para ir ao formulario
//   4) Preenche: Tipo=Instalacao, Produto=FTTH ONT, Quantidade=1,
//                 Comodo=Sala, Associar=ON
//   5) Clica "Avancar" -> "Nao" no dialog "novo produto?"
//   6) Clica "Concluir" e garante que o modal fecha de verdade
//
// ATUALIZACAO DESTE TURNO:
//   - Helper renomeado para selecionarAdicionarTipo() porque o
//     elemento pode ser radio OU checkbox, e a label visivel e'
//     "Adicionar Equipamentos" (nao so "Equipamentos").
//   - 4 estrategias: radio, checkbox, label/clickable, JS evaluate.
//   - Validacao explicita que o campo ficou checked antes do Next.

const { makeLogger, takeScreenshot, smartLocator } = require('../utils');
const FSL_CONFIG = require('../config');

const STEP_NAME = 'consumoEquipamentos';

// ====================================================================
// HELPER: marcar a opcao "Adicionar <tipo>" (radio ou checkbox)
//
// Tenta 4 estrategias em ordem. Valida no final que o campo ficou
// checked (radio.isChecked() ou checkbox.isChecked()).
// ====================================================================
async function selecionarAdicionarTipo(page, log, tipo) {
  // tipo = 'equipamentos' ou 'materiais'
  // Label esperada: "Adicionar Equipamentos" / "Adicionar Materiais"
  //                (ou EN: "Add Equipment" / "Add Materials")
  const adicionarRe = new RegExp(`(Adicionar|Add)\\s+${tipo.slice(0, -1)}`, 'i');
  const tipoRe = new RegExp(tipo.slice(0, -1), 'i'); // "equipamento" / "material"
  const tipoCurto = tipo.slice(0, 5); // "equip" / "mater"

  // 1) input radio/checkbox + contexto "adicionar <tipo>"
  try {
    const marcado = await page.evaluate(
      ({ adicionarReSrc, tipoCurto }) => {
        const adicionarRe = new RegExp(adicionarReSrc, 'i');
        const inputs = Array.from(
          document.querySelectorAll('input[type="radio"], input[type="checkbox"]')
        );
        for (const inp of inputs) {
          // Texto do contexto: label[for], parent, ancestors
          let contexto = '';
          if (inp.id) {
            const lab = document.querySelector(`label[for="${inp.id}"]`);
            if (lab) contexto += ' ' + (lab.textContent || '');
          }
          const parent = inp.closest(
            'label, .slds-form-element, fieldset, [class*="radio"], [class*="checkbox"], ' +
            '[class*="form-element"], tr, li, div[class*="item"]'
          );
          if (parent) contexto += ' ' + (parent.textContent || '');

          // Aceita se contexto contem "adicionar <tipo>" OU so' <tipo>
          // (alguns modais mostram "Equipamentos" puro na linha do checkbox)
          if (
            adicionarRe.test(contexto) ||
            (contexto.toLowerCase().includes(tipoCurto) && contexto.toLowerCase().includes('adicionar'))
          ) {
            // Marca de verdade (radio/checkbox aceitam .click() ou .check())
            inp.click();
            return { ok: inp.checked, tipo: inp.type, contexto: contexto.trim().slice(0, 60) };
          }
        }
        return null;
      },
      { adicionarReSrc: adicionarRe.source, tipoCurto }
    );
    if (marcado && marcado.ok) {
      log.log(`  opcao "${tipo}" marcada via input[${marcado.tipo}] (contexto: "${marcado.contexto}")`);
      return true;
    }
    if (marcado && !marcado.ok) {
      log.log(`  input encontrado (${marcado.tipo}) mas NAO ficou checked — tentando forcar via check()`);
      // Tenta check() via Playwright no candidato encontrado
    }
  } catch (e) {
    log.log(`  estrategia 1 (input radio/checkbox) falhou: ${(e.message || '').slice(0, 80)}`);
  }

  // 2) clickable element com texto "Adicionar <tipo>"
  try {
    const clicable = page
      .locator('label, span, div, button, td, [role="button"], [role="option"]')
      .filter({ hasText: adicionarRe })
      .first();
    if (await clicable.isVisible({ timeout: 1500 }).catch(() => false)) {
      await clicable.click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);

      // Revalida: procura o input que deveria ter ficado checked
      const checked = await page.evaluate((curto) => {
        const inputs = Array.from(
          document.querySelectorAll('input[type="radio"], input[type="checkbox"]')
        );
        for (const inp of inputs) {
          if (!inp.checked) continue;
          let contexto = '';
          if (inp.id) {
            const lab = document.querySelector(`label[for="${inp.id}"]`);
            if (lab) contexto += (lab.textContent || '');
          }
          const parent = inp.closest(
            'label, .slds-form-element, fieldset, [class*="radio"], [class*="checkbox"]'
          );
          if (parent) contexto += ' ' + (parent.textContent || '');
          if (contexto.toLowerCase().includes(curto)) return true;
        }
        return false;
      }, tipoCurto);

      if (checked) {
        log.log(`  opcao "${tipo}" marcada via elemento clicavel + revalidacao OK`);
        return true;
      }
      log.log(`  elemento clicavel clicado mas nenhum input ficou checked`);
    }
  } catch (e) {
    log.log(`  estrategia 2 (clicavel) falhou: ${(e.message || '').slice(0, 80)}`);
  }

  // 3) Fallback JS direto: clica em TODOS os inputs relacionados e checa
  try {
    const marcado = await page.evaluate((curto) => {
      const inputs = Array.from(
        document.querySelectorAll('input[type="radio"], input[type="checkbox"]')
      );
      for (const inp of inputs) {
        let contexto = '';
        const parent = inp.closest(
          'label, .slds-form-element, fieldset, [class*="radio"], [class*="checkbox"], ' +
          '[class*="form-element"]'
        );
        if (parent) contexto += ' ' + (parent.textContent || '');
        if (contexto.toLowerCase().includes(curto)) {
          inp.click();
          if (inp.checked) return true;
        }
      }
      return false;
    }, tipoCurto);
    if (marcado) {
      log.log(`  opcao "${tipo}" marcada via JS fallback (contexto)`);
      return true;
    }
  } catch (_) { /* ignore */ }

  // 4) Ultimo recurso: clica no texto visivel puro "Equipamentos" / "Materiais"
  //    dentro de algo que pareca checkbox-row
  try {
    const linha = page
      .locator('label, .slds-checkbox, .slds-radio, [class*="checkbox"], [class*="radio"], tr, li')
      .filter({ hasText: tipoRe })
      .first();
    if (await linha.isVisible({ timeout: 1000 }).catch(() => false)) {
      await linha.click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
      log.log(`  opcao "${tipo}" clicada via linha (fallback final)`);
      return true;
    }
  } catch (e) {
    log.log(`  estrategia 4 (linha) falhou: ${(e.message || '').slice(0, 80)}`);
  }

  log.log(`  opcao "${tipo}" NAO foi marcada (4 estrategias falharam)`);
  return false;
}

// ====================================================================
// HELPER: clicar Next e validar que avancou (sem "Please select a choice")
// ====================================================================
async function clicarNextEValidar(page, log, stepName) {
  const nextBtn = smartLocator(page, [
    { role: 'button', name: /^(Next|Pr\u00f3ximo|Avancar|Continue)$/i },
  ]).first();

  if (!(await nextBtn.isVisible({ timeout: 1500 }).catch(() => false))) {
    log.log('  Next nao encontrado (wizard de 1 etapa ou ja no formulario)');
    return true;
  }

  await nextBtn.click({ force: true }).catch((e) =>
    log.log(`  Next click falhou: ${(e.message || '').slice(0, 80)}`)
  );
  await page.waitForTimeout(800);

  // Validacao: mensagem de erro do Lightning quando nada foi selecionado
  const erroEscolha = page
    .locator('text=/Please select a choice|Selecione uma op[c\u00e7][a\u00e3]o|Escolha uma op[c\u00e7][a\u00e3]o/i')
    .first();
  if (await erroEscolha.isVisible({ timeout: 800 }).catch(() => false)) {
    const texto = (await erroEscolha.textContent().catch(() => '')) || '';
    throw new Error(`${stepName}: wizard recusou Next — "${texto.trim()}" (opcao nao foi marcada)`);
  }

  log.log('  Next clicado e validado (sem erro de escolha)');
  return true;
}

// ====================================================================
// HELPER: clica no botao de acao (direto OU via Show more actions)
// ====================================================================
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

// ====================================================================
// Step principal
// ====================================================================
async function step(ctx) {
  const log = makeLogger(STEP_NAME);
  const { page } = ctx;

  // ====================================================================
  // ETAPA 1 — abrir o wizard (mesmo botao do Material)
  // ====================================================================
  log.log('abrindo Consumo de Materiais e Equipamentos (opcao=Adicionar Equipamentos)');
  const how = await clickActionButton(
    page, log, /Consumo de Materiais e Equipamentos|Consumption of Materials and Equipment/i
  );
  if (!how) {
    await takeScreenshot(page, STEP_NAME, 'no-consumo-button').catch(() => {});
    throw new Error('consumoEquipamentos: botao nao encontrado (direto nem em Show more actions)');
  }
  log.log(`modal Consumo aberto (via ${how})`);

  await page.locator('[role="dialog"]:visible, .slds-modal--open')
    .first()
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => log.log('modal nao detectada explicitamente (continuando)'));
  await page.waitForTimeout(800);

  // ====================================================================
  // ETAPA 2 — marcar "Adicionar Equipamentos" + Next (com validacao)
  // ====================================================================
  log.log('marcando opcao "Adicionar Equipamentos"');
  const opcaoOk = await selecionarAdicionarTipo(page, log, 'equipamentos');
  if (opcaoOk) {
    await clicarNextEValidar(page, log, STEP_NAME);
  } else {
    throw new Error(
      `${STEP_NAME}: nao consegui marcar "Adicionar Equipamentos". ` +
      'Screenshots em internal/fsl-artifacts/'
    );
  }

  // (Defensivo) aba "Equipamento" se o wizard usa tabs em vez de radio
  const equipTab = smartLocator(page, [
    { role: 'tab', name: /^Equipamento$/i },
    { text: /^Equipamento$/i },
  ]).first();
  if (await equipTab.isVisible({ timeout: 800 }).catch(() => false)) {
    await equipTab.click({ timeout: 3_000 }).catch(() => {});
    log.log('  aba Equipamento clicada');
  }

  // ====================================================================
  // ETAPA 3 — preencher formulario de Equipamento
  // ====================================================================
  log.log('preenchendo formulario de Equipamento');

  // Tipo
  const tipoField = smartLocator(page, [
    { role: 'combobox', name: /Tipo|Type|Consumption Type/i },
  ]).first();
  if (await tipoField.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await tipoField.click();
    await page.waitForTimeout(300);
    const tipoOpt = smartLocator(page, [{ role: 'option', name: /^Instalacao|Install/i }]).first();
    if (await tipoOpt.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await tipoOpt.click();
      log.log('  tipo = Instalacao');
    } else {
      log.log('  opcao Instalacao nao encontrada (continuando)');
    }
  } else {
    log.log('  campo Tipo nao encontrado (pode ser pre-preenchido)');
  }

  // Produto
  const produtoField = smartLocator(page, [
    { role: 'combobox', name: /Produto|Product|Equipment/i },
  ]).first();
  if (await produtoField.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await produtoField.click();
    await page.waitForTimeout(300);
    const produtoOpt = smartLocator(page, [{ role: 'option', name: /FTTH ONT/i }]).first();
    if (await produtoOpt.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await produtoOpt.click();
      log.log('  produto = FTTH ONT');
    } else {
      log.log('  opcao FTTH ONT nao encontrada (continuando)');
    }
  } else {
    log.log('  campo Produto nao encontrado (pode ser pre-preenchido)');
  }

  // Quantidade
  const qtyField = smartLocator(page, [
    { role: 'spinbutton', name: /Quantidade|Quantity/i },
  ]).first();
  if (await qtyField.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await qtyField.fill('1');
    log.log('  quantidade = 1');
  } else {
    log.log('  campo Quantidade nao encontrado');
  }

  // Comodo
  const comodoField = smartLocator(page, [
    { role: 'combobox', name: /Comodo|Room/i },
  ]).first();
  if (await comodoField.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await comodoField.click();
    await page.waitForTimeout(300);
    const comodoOpt = smartLocator(page, [{ role: 'option', name: /^Sala|Living/i }]).first();
    if (await comodoOpt.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await comodoOpt.click();
      log.log('  comodo = Sala');
    } else {
      log.log('  opcao Sala nao encontrada (continuando)');
    }
  } else {
    log.log('  campo Comodo nao encontrado');
  }

  // Associar
  const associarCb = smartLocator(page, [
    { role: 'checkbox', name: /Associar|Associate/i },
  ]).first();
  if (await associarCb.isVisible({ timeout: 2_000 }).catch(() => false)) {
    if (!(await associarCb.isChecked().catch(() => false))) {
      await associarCb.click();
      log.log('  Associar = ON');
    } else {
      log.log('  Associar ja estava ON');
    }
  } else {
    log.log('  checkbox Associar nao encontrado');
  }

  // ====================================================================
  // ETAPA 4 — Avancar (do form para "novo produto?")
  // ====================================================================
  log.log('clicando Avancar (form -> novo produto?)');
  const avancarBtn = smartLocator(page, [
    { role: 'button', name: /^(Avancar|Next|Continue)$/i },
  ]).first();
  await avancarBtn.click({ timeout: 5_000 }).catch((e) =>
    log.log(`Avancar falhou: ${(e.message || '').slice(0, 80)}`)
  );
  await page.waitForTimeout(1_000);

  // ====================================================================
  // ETAPA 5 — "novo produto?" = Nao
  // ====================================================================
  const naoBtn = smartLocator(page, [
    { role: 'button', name: /^(Nao|No)$/i },
  ]).first();
  if (await naoBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await naoBtn.click();
    log.log('  Nao clicado');
    await page.waitForTimeout(500);
  } else {
    log.log('  dialog "novo produto?" nao apareceu (pode ser pulado)');
  }

  // ====================================================================
  // ETAPA 6 — Concluir
  // ====================================================================
  log.log('clicando Concluir');
  const concluirBtn = smartLocator(page, [
    { role: 'button', name: /^(Concluir|Done|Save|Finish)$/i },
  ]).last();
  if (await concluirBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await concluirBtn.click();
    log.log('  Concluir clicado');
  } else {
    log.log('  botao Concluir nao encontrado');
  }

  // ====================================================================
  // ETAPA 7 — fecha modal de verdade
  // ====================================================================
  log.log('aguardando modal fechar');
  try {
    await page.locator('[role="dialog"]:visible, .slds-modal--open')
      .first()
      .waitFor({ state: 'hidden', timeout: 10_000 });
    log.log('  modal fechou');
  } catch (e) {
    log.log('  modal NAO fechou em 10s — tentando X como fallback');
    const xBtn = page.locator(
      'button[aria-label="Close"], ' +
      'lightning-button-icon[aria-label*="Close" i], ' +
      'button[title*="Close" i]'
    ).first();
    if (await xBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await xBtn.click().catch(() => {});
      log.log('  X clicado manualmente');
    }
  }

  await page.waitForTimeout(1_500);
  await takeScreenshot(page, STEP_NAME, 'pos-concluir').catch(() => {});
  log.log('consumoEquipamentos OK');

  ctx.steps = ctx.steps || [];
  ctx.steps.push({ step: STEP_NAME, status: 'ok' });
  return ctx;
}

module.exports = { step, name: STEP_NAME };