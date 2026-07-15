// core/fsl/steps/encerramento.js
//
// Step 8/8 — Encerramento (Closing) da SA.
//
// MAPEAMENTO DOS CAMPOS (label visivel, nao ID — IDs do tipo
// #input-XXXX sao DINAMICOS no Lightning e mudam a cada render):
//   Senha                         -> ctx.senhaInstalacao (do verSenha)
//   RSR (Registro Servico Reparo) -> "102030"
//   Codigo de encerramento        -> "00"
//   Observacoes                   -> "instalacao"
//   Motivo do nao Reaproveitamento -> "Sem drop no local" (dropdown)
//
// ORDEM DO FLUXO:
//   1) Clica "Closing" / "Encerramento" / "Finalizar" (direto OU
//      via Show more actions se necessario)
//   2) Aguarda modal abrir
//   3) Preenche os 4 campos de texto (por aria-label / HTML label)
//   4) Seleciona a opcao do dropdown "Motivo"
//   5) Clica "Avancar"
//   6) Clica "Concluir"
//   7) Garante que o modal fechou de verdade

const { makeLogger, takeScreenshot, smartLocator } = require('../utils');
const FSL_CONFIG = require('../config');

const STEP_NAME = 'encerramento';

// ====================================================================
// MAPEAMENTO: inputId -> funcao que retorna o valor a preencher
//
// 4 text + 1 combobox. A ordem do array = ordem de preenchimento.
// ====================================================================
const CAMPOS = [
  {
    tipo: 'text',
    label: /Senha/i,
    labelLog: 'Senha',
    valor: (ctx) => ctx.senhaInstalacao || ctx.senha || '',
  },
  {
    tipo: 'text',
    label: /RSR|Registro.*Servi[\u00e7c]o.*Reparo/i,
    labelLog: 'RSR (Registro Servico Reparo)',
    valor: () => '102030',
  },
  {
    tipo: 'text',
    label: /C[o\u00f3]digo.*[Ee]ncerramento/i,
    labelLog: 'Codigo de Encerramento',
    valor: () => '00',
  },
  {
    tipo: 'text',
    label: /Observa[\u00e7c][o\u00f5]es/i,
    labelLog: 'Observacoes',
    valor: () => 'instalacao',
  },
  {
    tipo: 'combobox',
    label: /Motivo.*Reaproveitamento/i,
    labelLog: 'Motivo do nao Reaproveitamento',
    valor: () => 'Sem drop no local',
  },
];

// ====================================================================
// Helpers
// ====================================================================

// Clica no botao de acao (direto OU via "Show more actions")
async function clickActionButton(page, log, nameRegex) {
  // 1) Botao direto
  const direct = smartLocator(page, [
    { role: 'button', name: nameRegex },
    { text: nameRegex },
  ]).first();
  if (await direct.isVisible({ timeout: 1500 }).catch(() => false)) {
    await direct.click();
    return 'direto';
  }
  // 2) Show more actions
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

// Preenche campo de texto. 4 estrategias em ordem:
//   1) aria-name (textbox role + name)
//   2) label HTML adjacente com atributo for=
//   3) label HTML adjacente com input seguinte
//   4) input com name/id/placeholder que bata com o label
async function fillTextField(page, log, labelRegex, labelLog, value) {
  // 1) aria-name
  try {
    const byAria = smartLocator(page, [
      { role: 'textbox', name: labelRegex },
    ]).first();
    if (await byAria.isVisible({ timeout: 2000 }).catch(() => false)) {
      await byAria.fill(value);
      log.log(`  [${labelLog}] OK via aria-name (${String(value).length} chars)`);
      return true;
    }
  } catch (_) { /* tenta proxima */ }

  // 2/3) label HTML adjacente
  try {
    const labelText = labelRegex.source
      .replace(/^\//, '')
      .replace(/\/[a-z]*$/, '')
      .replace(/[.*+?^${}()|[\]\\]/g, '');
    const label = page.locator('label').filter({ hasText: new RegExp(labelText, 'i') }).first();
    if (await label.isVisible({ timeout: 1000 }).catch(() => false)) {
      // 2a) usa o atributo for= do label
      const forId = await label.getAttribute('for').catch(() => null);
      if (forId) {
        const input = page.locator(`#${forId}`).first();
        if (await input.isVisible({ timeout: 1000 }).catch(() => false)) {
          await input.fill(value);
          log.log(`  [${labelLog}] OK via label[for] (${String(value).length} chars)`);
          return true;
        }
      }
      // 2b) input/textarea seguinte
      const next = label.locator('xpath=following::input[1] | following::textarea[1]').first();
      if (await next.isVisible({ timeout: 1000 }).catch(() => false)) {
        await next.fill(value);
        log.log(`  [${labelLog}] OK via label seguinte (${String(value).length} chars)`);
        return true;
      }
    }
  } catch (_) { /* tenta proxima */ }

  // 4) input com name/id/placeholder que bata
  try {
    const words = labelRegex.source
      .replace(/^\//, '')
      .replace(/\/[a-z]*$/, '')
      .split(/[^A-Za-z0-9]+/)
      .filter((w) => w.length >= 3)
      .slice(0, 2);
    if (words.length > 0) {
      const input = page
        .locator('input, textarea')
        .filter({
          has: page.locator(
            `[name*="${words[0]}" i], [id*="${words[0]}" i], [placeholder*="${words[0]}" i]` +
            (words[1] ? `, [name*="${words[1]}" i], [id*="${words[1]}" i], [placeholder*="${words[1]}" i]` : '')
          ),
        })
        .first();
      if (await input.isVisible({ timeout: 1000 }).catch(() => false)) {
        await input.fill(value);
        log.log(`  [${labelLog}] OK via input[name/id/placeholder] (${String(value).length} chars)`);
        return true;
      }
    }
  } catch (_) { /* ignore */ }

  log.log(`  [${labelLog}] campo NAO encontrado (verifique o label exato na UI)`);
  return false;
}

// Seleciona opcao de dropdown. 3 etapas:
//   1) acha o combobox pelo aria-name
//   2) clica pra abrir o dropdown
//   3) match exato, depois parcial
async function selectComboboxOption(page, log, labelRegex, labelLog, optionText) {
  const combo = smartLocator(page, [
    { role: 'combobox', name: labelRegex },
  ]).first();

  if (!(await combo.isVisible({ timeout: 3_000 }).catch(() => false))) {
    log.log(`  [${labelLog}] combobox NAO encontrado (verifique o label exato na UI)`);
    return false;
  }

  await combo.click();
  await page.waitForTimeout(600);

  const escaped = optionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let option = smartLocator(page, [
    { role: 'option', name: new RegExp(`^${escaped}$`, 'i') },
    { text: new RegExp(`^${escaped}$`, 'i') },
  ]).first();

  if (!(await option.isVisible({ timeout: 2_000 }).catch(() => false))) {
    option = smartLocator(page, [
      { role: 'option', name: new RegExp(escaped, 'i') },
      { text: new RegExp(escaped, 'i') },
    ]).first();
  }

  if (await option.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await option.click();
    log.log(`  [${labelLog}] opcao "${optionText}" selecionada`);
    return true;
  }

  // Debug: dump das opcoes visiveis
  const visible = await page
    .locator('[role="option"]:visible, lightning-base-combobox-item:visible')
    .allInnerTexts()
    .catch(() => []);
  log.log(
    `  [${labelLog}] opcao "${optionText}" NAO encontrada. Disponiveis: ` +
    JSON.stringify(visible).slice(0, 200)
  );
  return false;
}

// ====================================================================
// Step principal
// ====================================================================
async function step(ctx) {
  const log = makeLogger(STEP_NAME);
  const { page } = ctx;

  // ====================================================================
  // ETAPA 0 — sanity check da senha
  // ====================================================================
  const senha = ctx.senhaInstalacao || ctx.senha;
  if (!senha) {
    throw new Error('encerramento: ctx.senhaInstalacao ausente (verSenha nao rodou?)');
  }
  log.log(`senha disponivel em ctx (length=${senha.length})`);

  // ====================================================================
  // ETAPA 1 — abrir o wizard "Closing"
  // ====================================================================
  log.log('abrindo Closing / Encerramento / Finalizar');
  const how = await clickActionButton(
    page, log, /Closing|Encerramento|Encerrar|Finalizar|Finish|Complete/i
  );
  if (!how) {
    await takeScreenshot(page, STEP_NAME, 'no-closing-button').catch(() => {});
    throw new Error('encerramento: botao de fechamento nao encontrado (direto nem em Show more actions)');
  }
  log.log(`Closing aberto (via ${how})`);

  await page
    .locator('[role="dialog"]:visible, .slds-modal--open')
    .first()
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => log.log('modal Closing nao detectada explicitamente (continuando)'));

  // LWC costuma montar em ondas; pausa para todos os campos renderizarem
  await page.waitForTimeout(1_500);

  // ====================================================================
  // ETAPA 2 — preencher os 5 campos (4 text + 1 combobox)
  // ====================================================================
  log.log(`preenchendo ${CAMPOS.length} campos do wizard (por label visivel)`);

  const resultado = [];
  for (let i = 0; i < CAMPOS.length; i++) {
    const campo = CAMPOS[i];
    const valor = campo.valor(ctx);
    log.log(`campo ${i + 1}/${CAMPOS.length}: tipo=${campo.tipo}, label=${campo.labelLog}`);

    let ok = false;
    if (campo.tipo === 'combobox') {
      ok = await selectComboboxOption(page, log, campo.label, campo.labelLog, valor);
    } else {
      ok = await fillTextField(page, log, campo.label, campo.labelLog, valor);
    }
    resultado.push({ campo: campo.labelLog, ok });
  }

  // Resumo do preenchimento
  const total = resultado.length;
  const preenchidos = resultado.filter((r) => r.ok).length;
  const faltando = resultado.filter((r) => !r.ok).map((r) => r.campo);
  log.log(`preenchimento: ${preenchidos}/${total} OK`);
  if (faltando.length > 0) {
    log.log(`  campos nao preenchidos: ${faltando.join(', ')}`);
  }

  await takeScreenshot(page, STEP_NAME, 'campos-preenchidos').catch(() => {});

  // ====================================================================
  // ETAPA 3 — Avancar (se wizard de 2 etapas)
  // ====================================================================
  log.log('clicando Avancar');
  const avancarBtn = smartLocator(page, [
    { role: 'button', name: /^(Avancar|Next|Continue)$/i },
  ]).first();
  if (await avancarBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await avancarBtn.click();
    log.log('Avancar clicado');
    await page.waitForTimeout(1_500);
  } else {
    log.log('botao Avancar nao encontrado (pode ser wizard de 1 etapa)');
  }

  // ====================================================================
  // ETAPA 4 — Concluir
  // ====================================================================
  log.log('clicando Concluir');
  const concluirBtn = smartLocator(page, [
    { role: 'button', name: /^(Concluir|Done|Finish|Complete|Close)$/i },
  ]).last();
  if (await concluirBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await concluirBtn.click();
    log.log('Concluir clicado');
  } else {
    log.log('botao Concluir nao encontrado');
  }

  // ====================================================================
  // ETAPA 5 — espera modal fechar de verdade (com fallback no X)
  // ====================================================================
  log.log('aguardando modal fechar');
  try {
    await page
      .locator('[role="dialog"]:visible, .slds-modal--open')
      .first()
      .waitFor({ state: 'hidden', timeout: 10_000 });
    log.log('modal Closing fechou');
  } catch (e) {
    log.log(`modal NAO fechou em 10s — tentando X como fallback (${(e.message || '').slice(0, 100)})`);
    const xBtn = page.locator(
      'button[aria-label="Close"], ' +
      'lightning-button-icon[aria-label*="Close" i], ' +
      'button[title*="Close" i]'
    ).first();
    if (await xBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await xBtn.click().catch(() => {});
      log.log('X clicado manualmente');
    } else {
      log.log('botao X nao encontrado (modal pode estar preso)');
    }
  }

  await takeScreenshot(page, STEP_NAME, 'pos-concluir').catch(() => {});

  // Resumo final no ctx para o orquestrador saber o que rolou
  log.log(`encerramento OK (${preenchidos}/${total} campos preenchidos)`);

  ctx.steps = ctx.steps || [];
  ctx.steps.push({
    step: STEP_NAME,
    status: 'ok',
    camposPreenchidos: preenchidos,
    camposTotal: total,
    camposFaltando: faltando,
  });
  return ctx;
}

module.exports = { step, name: STEP_NAME };