// core/fsl/steps/anteciparStatus.js
//
// Step 3/8 — Antecipar Status da SA.
//
// LÓGICA DE PERÍODO + RETRY (ciclo de períodos):
//   Regra de fallback: se a combinação Data+Período for rejeitada
//   pelo Lightning, tenta a próxima:
//     - Tarde rejeitado → próximo: Manhã do DIA SEGUINTE
//     - Manhã rejeitado → próximo: Tarde do MESMO DIA
//
//   Limite: 8 tentativas (cobre até ~4 dias para frente).
//
// REGRA DO FSL (confirmada em 2026-07-09, sem chute):
//   - Manhã: 6h às 11h59
//   - Tarde: 12h às 23h59
//
//   chuteInicial():
//     0h-11h59  → Manhã de hoje
//     12h-23h59 → Tarde de hoje
//
// TRATAMENTO DO MODAL DE AVISO "Não é possível antecipar" + botão "Finish":
//   Quando a SA está em "Em deslocamento" (ou em estado que não permite
//   antecipação), o Lightning abre um modal de aviso em vez do modal de
//   preenchimento normal. Esse modal tem APENAS um botão "Finish" (em
//   inglês). Precisamos clicar nele e seguir o fluxo — sem erro.
//
// FIX DO DROPDOWN (2026-07-09, segundo run da SA 915698):
//   O dropdown de Motivo abria e fechava antes da lista de opções
//   conseguir aparecer. Aumentamos a espera de 500ms para 1500ms após
//   o click no combobox, e adicionamos retry: se a primeira tentativa
//   de abrir a lista falhar, clicamos de novo no combobox.

const { makeLogger, takeScreenshot, smartLocator, findFirstVisible, waitForSAReady } = require('../utils');
const FSL_CONFIG = require('../config');

const STEP_NAME = 'anteciparStatus';

const MAX_TENTATIVAS = 8;
const MOTIVO_FIXO = 'Pedido de Teste';

/**
 * Formata uma data como DD/MM/YYYY.
 */
function formatarData(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Próximo período no ciclo:
 *   Tarde → Manhã do dia seguinte
 *   Manhã → Tarde do mesmo dia
 */
function proximoPeriodo(periodoAtual, dataAtual) {
  if (periodoAtual === 'Tarde') {
    const amanha = new Date(dataAtual);
    amanha.setDate(amanha.getDate() + 1);
    return { periodo: 'Manhã', data: amanha };
  }
  return { periodo: 'Tarde', data: new Date(dataAtual) };
}

/**
 * Chute inicial: data + período baseado na hora atual.
 *
 * Regra do FSL (confirmada em 2026-07-09):
 *   - Manhã: 6h às 11h59  (h >= 6 && h < 12)
 *   - Tarde: 12h às 23h59 (h >= 12 && h < 24)
 *
 *   0h-11h59  → Manhã de hoje
 *   12h-23h59 → Tarde de hoje
 */
function chuteInicial(date = new Date()) {
  const h = date.getHours();
  if (h >= 12 && h <= 23) {
    return { periodo: 'Tarde', data: new Date(date) };
  }
  // 0h-11h59 → Manhã de hoje
  return { periodo: 'Manhã', data: new Date(date) };
}

// ===========================================================================
// Detector de modal de AVISO (Em deslocamento, etc.)
// ===========================================================================
/**
 * Detecta se o modal aberto é o modal de AVISO (sem campos de preenchimento)
 * em vez do modal normal de Antecipação (com Data/Período/Motivo).
 *
 * @returns {Promise<{isAviso: boolean, texto: string}>}
 */
async function detectarModalAviso(page, log, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  const PADROES_TEXTO = [
    /n[ãa]o [ée] poss[íi]vel antecipar/i,
    /n[ãa]o [ée] poss[íi]vel encontrar/i,
    /n[ãa]o [ée] poss[íi]vel realizar/i,
    /em deslocamento/i,
    /sa [ée] inv[áa]lida/i,
    /j[áa] foi antecipad/i,
    /opera[çc][ãa]o n[ãa]o permitid/i,
  ];

  while (Date.now() < deadline) {
    for (const re of PADROES_TEXTO) {
      try {
        const el = page.locator('text=' + re.source).first();
        if (await el.isVisible({ timeout: 200 }).catch(() => false)) {
          const texto = (await el.textContent().catch(() => '') || '').trim();
          const finishBtn = page.getByRole('button', { name: /^Finish$/i }).first();
          const temFinish = await finishBtn.isVisible({ timeout: 200 }).catch(() => false);
          if (temFinish) {
            log.log(`[anteciparStatus] ⚠️ modal de AVISO detectado: "${texto.slice(0, 100)}" (botão Finish presente)`);
            return { isAviso: true, texto };
          }
          if (texto.length < 200) {
            const temDataField = await page.getByLabel(/Data de antecipa[çc][aã]o/i).first()
              .isVisible({ timeout: 200 }).catch(() => false);
            if (!temDataField) {
              log.log(`[anteciparStatus] ⚠️ modal de AVISO detectado (sem campo Data): "${texto.slice(0, 100)}"`);
              return { isAviso: true, texto };
            }
          }
        }
      } catch (_) { /* ignore */ }
    }
    await page.waitForTimeout(200);
  }
  return { isAviso: false, texto: '' };
}

/**
 * Detecta se o Lightning mostrou erro de "turno não encontrado"
 * após clicar no 1º Confirmar.
 */
async function detectarErroTurno(page, log, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  const PADROES_ERRO = [
    /n[ãa]o [ée] poss[íi]vel encontrar/i,
    /n[ãa]o [ée] poss[íi]vel antecipar/i,
    /turno n[ãa]o encontrad/i,
    /combina[çc][ãa]o de data e per[íi]odo/i,
    /turno noturno/i,
    /sem turno dispon[íi]vel/i,
  ];
  while (Date.now() < deadline) {
    for (const re of PADROES_ERRO) {
      try {
        const el = page.locator('text=' + re.source).first();
        if (await el.isVisible({ timeout: 200 }).catch(() => false)) {
          const texto = (await el.textContent().catch(() => '') || '').trim();
          log.log(`[anteciparStatus] ⚠️ erro detectado: "${texto.slice(0, 120)}"`);
          return true;
        }
      } catch (_) { /* ignore */ }
    }
    await page.waitForTimeout(200);
  }
  return false;
}

/**
 * Espera o modal "Antecipação" abrir.
 */
async function esperarModalAntecipacao(page, log, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const visible = await page
        .locator('h1, h2, .slds-modal__title, [class*="modal"] [class*="title"]')
        .filter({ hasText: /Antecipa[çc][aã]o/i })
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (visible) return true;
    } catch (_) { /* ignore */ }
    await page.waitForTimeout(300);
  }
  return false;
}

/**
 * Detecta o modal de confirmação definitiva (segundo modal).
 */
async function modalConfirmacaoAberto(page, log, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const visible = await page
        .locator('text=/Confirma a antecipa[çc][aã]o do agendamento/i')
        .first()
        .isVisible({ timeout: 400 })
        .catch(() => false);
      if (visible) return true;
    } catch (_) { /* ignore */ }
    await page.waitForTimeout(200);
  }
  return false;
}

// ===========================================================================
// Clique no botão "Finish" (modal de aviso)
// ===========================================================================
/**
 * Clica no botão "Finish" do modal de aviso.
 */
async function clicarFinish(page, log) {
  log.log('[anteciparStatus] clicando no botão "Finish" do modal de aviso');

  const finishBtn = page.getByRole('button', { name: /^Finish$/i }).first();

  const deadline = Date.now() + 5_000;
  let botao = null;
  while (Date.now() < deadline) {
    if (await finishBtn.isVisible({ timeout: 400 }).catch(() => false)) {
      botao = finishBtn;
      break;
    }
    await page.waitForTimeout(200);
  }

  if (!botao) {
    await takeScreenshot(page, STEP_NAME, 'finish-nao-encontrado');
    throw new Error(
      'Botão "Finish" do modal de aviso não foi encontrado em 5s. ' +
      'Veja screenshot debug-anteciparStatus-finish-nao-encontrado.png'
    );
  }

  await botao.click();
  log.log('[anteciparStatus] ✅ botão "Finish" clicado');
  await page.waitForTimeout(1_500);
}

/**
 * Preenche a data no modal (DD/MM/YYYY).
 */
async function preencherData(page, log, valor) {
  log.log(`[anteciparStatus] preenchendo data: "${valor}"`);

  let input = page.getByLabel(/Data de antecipa[çc][aã]o/i).first();
  let found = false;
  try {
    if (await input.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await input.fill('');
      await input.fill(valor);
      await input.press('Tab');
      found = true;
    }
  } catch (_) { /* ignore */ }

  if (!found) {
    try {
      const label = page.getByText(/Data de antecipa[çc][aã]o/i).first();
      const container = label.locator('xpath=ancestor::*[contains(@class,"slds-form-element") or contains(@class,"modal")][1]');
      input = container.locator('input').first();
      if (await input.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await input.fill('');
        await input.fill(valor);
        await input.press('Tab');
        found = true;
      }
    } catch (_) { /* ignore */ }
  }

  if (!found) {
    try {
      input = page.locator('input[placeholder*="DD" i], input[placeholder*="data" i]').first();
      if (await input.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await input.fill('');
        await input.fill(valor);
        await input.press('Tab');
        found = true;
      }
    } catch (_) { /* ignore */ }
  }

  if (!found) {
    throw new Error('Campo "Data de antecipação" não encontrado no modal.');
  }

  log.log(`[anteciparStatus] data preenchida: ${valor}`);
}

// ===========================================================================
// NOVO: Helper de dropdown com retry (2 tentativas com 1.5s de espera)
// ===========================================================================
/**
 * Abre o dropdown e clica na opção desejada. Tenta 2 vezes: na primeira
 * clica no combobox e espera 1.5s para a lista abrir; se a opção não
 * aparecer, clica de novo (algumas vezes o Lightning fecha a lista no
 * primeiro click e só abre no segundo).
 *
 * @param {Page} page
 * @param {Object} log  logger
 * @param {string} label  nome do campo ("Período" ou "Motivo"), usado para
 *                        diagnóstico em caso de falha
 * @param {string} valor  valor exato da opção ("Tarde", "Manhã", "Pedido de Teste")
 * @returns {Promise<void>}
 * @throws Error se a opção não for encontrada em nenhuma das 2 tentativas
 */
async function selecionarDropdown(page, log, label, valor) {
  log.log(`[anteciparStatus] selecionando ${label}: "${valor}"`);

  // Localiza o combobox (2 estratégias)
  let combo = page.getByRole('combobox', { name: new RegExp(`^${label}$`, 'i') }).first();
  let opened = false;

  if (await combo.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await combo.click();
    opened = true;
  } else {
    try {
      const labelEl = page.getByText(new RegExp(`^\\s*${label}\\s*$`, 'i')).first();
      const container = labelEl.locator('xpath=ancestor::*[contains(@class,"slds-form-element")][1]');
      combo = container.locator('lightning-combobox, [role="combobox"], button.slds-combobox__input, lightning-base-combobox').first();
      if (await combo.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await combo.click();
        opened = true;
      }
    } catch (_) { /* ignore */ }
  }

  if (!opened) {
    throw new Error(`Dropdown "${label}" não encontrado no modal.`);
  }

  // Tenta até 2 vezes abrir a lista e clicar na opção
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    // Espera maior (1.5s) para a lista de opções pintar — antes era 500ms
    await page.waitForTimeout(1_500);

    // Tenta 1: getByRole option
    const opcao = page
      .getByRole('option', { name: new RegExp(`^${valor}$`, 'i') })
      .first();
    if (await opcao.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await opcao.click();
      log.log(`[anteciparStatus] ${label} selecionado (tentativa ${tentativa}): ${valor}`);
      return;
    }

    // Tenta 2: fallback por text dentro da listbox
    const fallback = page
      .locator('[role="listbox"], .slds-listbox, lightning-base-combobox-item')
      .getByText(new RegExp(`^${valor}$`, 'i'))
      .first();
    if (await fallback.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await fallback.click();
      log.log(`[anteciparStatus] ${label} selecionado via fallback (tentativa ${tentativa}): ${valor}`);
      return;
    }

    // Se foi a 1ª tentativa, clica de novo no combobox e tenta de novo
    if (tentativa === 1) {
      log.log(`[anteciparStatus] lista de ${label} não abriu na 1ª tentativa, clicando de novo no combobox`);
      try {
        await combo.click();
      } catch (_) { /* ignore */ }
    }
  }

  throw new Error(`Opção "${valor}" não encontrada no dropdown de ${label} após 2 tentativas.`);
}

/**
 * Seleciona o período no dropdown.
 */
async function selecionarPeriodo(page, log, valor) {
  return selecionarDropdown(page, log, 'Período', valor);
}

/**
 * Seleciona o motivo no dropdown.
 */
async function selecionarMotivo(page, log, valor) {
  return selecionarDropdown(page, log, 'Motivo', valor);
}

/**
 * Clica no botão "Confirmar" do modal de Antecipação (PRIMEIRO modal).
 */
async function tentarConfirmarAntecipacao(page, log) {
  log.log('[anteciparStatus] aguardando 1º Confirmar ficar habilitado');

  const deadline = Date.now() + 10_000;
  let botao = null;
  while (Date.now() < deadline) {
    botao = page.getByRole('button', { name: /^Confirmar$/i }).first();
    const visible = await botao.isVisible({ timeout: 500 }).catch(() => false);
    const disabled = await botao.isDisabled().catch(() => true);
    if (visible && !disabled) break;
    botao = null;
    await page.waitForTimeout(300);
  }

  if (!botao) {
    const erroTurno = await detectarErroTurno(page, log, 1_500);
    if (erroTurno) {
      return { ok: true, confirmado: false, erro: 'turno_indisponivel' };
    }
    await takeScreenshot(page, STEP_NAME, 'confirmar-disabled');
    return { ok: false, confirmado: false, erro: 'confirmar-nao-habilitou' };
  }

  await botao.click();
  log.log('[anteciparStatus] 1º Confirmar clicado');

  await page.waitForTimeout(800);
  const erroPosClique = await detectarErroTurno(page, log, 1_500);
  if (erroPosClique) {
    return { ok: true, confirmado: false, erro: 'turno_indisponivel' };
  }

  return { ok: true, confirmado: true };
}

/**
 * Clica no botão "Confirmar" do SEGUNDO modal (confirmação definitiva).
 */
async function confirmarModalDefinitivo(page, log) {
  log.log('[anteciparStatus] aguardando 2º modal (confirmação definitiva)');

  const aberto = await modalConfirmacaoAberto(page, log, 5_000);
  if (!aberto) {
    log.log('[anteciparStatus] ⚠️ 2º modal não apareceu em 5s');
    return false;
  }
  log.log('[anteciparStatus] ✅ 2º modal de confirmação detectado');

  await takeScreenshot(page, STEP_NAME, 'segundo-modal-confirmacao');

  const deadline = Date.now() + 10_000;
  let botao = null;
  while (Date.now() < deadline) {
    const candidates = page.getByRole('button', { name: /^Confirmar$/i });
    const count = await candidates.count().catch(() => 0);
    if (count > 0) {
      botao = candidates.nth(count - 1);
      const visible = await botao.isVisible({ timeout: 500 }).catch(() => false);
      const disabled = await botao.isDisabled().catch(() => true);
      if (visible && !disabled) break;
    }
    botao = null;
    await page.waitForTimeout(300);
  }

  if (!botao) {
    await takeScreenshot(page, STEP_NAME, 'segundo-confirmar-disabled');
    log.log('[anteciparStatus] ⚠️ 2º Confirmar não habilitou em 10s');
    return false;
  }

  await botao.click();
  log.log('[anteciparStatus] 2º Confirmar clicado (antecipação efetivada)');
  return true;
}

/**
 * Espera todos os modais abertos fecharem.
 */
async function esperarModaisFecharem(page, log, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let stillOpen = false;
    try {
      stillOpen = await page
        .locator('.slds-modal--open:visible, [role="dialog"]:visible')
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);
    } catch (_) { /* ignore */ }
    if (!stillOpen) {
      log.log('[anteciparStatus] ✅ modais fecharam');
      return true;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

/**
 * Fecha o modal de Antecipação.
 * PRIORIDADE: Finish > Cancelar > X (do modal) > ESC
 */
async function fecharModalAntecipacao(page, log) {
  // 1) Finish (modal de aviso "Em deslocamento" / "Não é possível antecipar")
  try {
    const finish = page.getByRole('button', { name: /^Finish$/i }).first();
    if (await finish.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await finish.click();
      log.log('[anteciparStatus] modal fechado via Finish');
      await page.waitForTimeout(500);
      return true;
    }
  } catch (_) { /* ignore */ }

  // 2) Cancelar
  try {
    const cancelar = page.getByRole('button', { name: /^Cancelar$/i }).first();
    if (await cancelar.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await cancelar.click();
      log.log('[anteciparStatus] modal fechado via Cancelar');
      await page.waitForTimeout(500);
      return true;
    }
  } catch (_) { /* ignore */ }

  // 3) X de fechar do MODAL (escopo restrito)
  try {
    const closeX = page.locator('.slds-modal .slds-modal__close, [role="dialog"] button[title*="Fechar" i]').first();
    if (await closeX.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await closeX.click();
      log.log('[anteciparStatus] modal fechado via X (escopo do modal)');
      await page.waitForTimeout(500);
      return true;
    }
  } catch (_) { /* ignore */ }

  // 4) ESC
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    log.log('[anteciparStatus] modal fechado via ESC');
    return true;
  } catch (_) { /* ignore */ }

  return false;
}

/**
 * Reabre o modal de Antecipação.
 */
async function reabrirModalAntecipacao(page, log) {
  const btn = await findFirstVisible(page, [
    smartLocator(page, { role: 'button', name: /Antecipa[çc][aã]o/i }),
    smartLocator(page, { role: 'button', name: /Antecipar Status/i }),
    page.locator('button:has-text("Antecipação")'),
    page.locator('button:has-text("Antecipar Status")'),
  ], { timeoutMs: 5_000 });

  if (!btn) {
    throw new Error('Não conseguiu reabrir o modal de Antecipação para nova tentativa');
  }
  await btn.click();
  const abriu = await esperarModalAntecipacao(page, log, 10_000);
  if (!abriu) {
    throw new Error('Modal de Antecipação não abriu após re-clique');
  }
}

async function step(ctx) {
  const log = makeLogger(STEP_NAME);
  const { page, input } = ctx;

  // ====================================================================
  // ETAPA 0 — validar que a SA exibida é a esperada
  // ====================================================================
  const saDigits = String(input.sa).replace(/\D+/g, '');
  const saQuery = `SA-${saDigits}`;

  let currentUrl = page.url();
  const titleNow = await page.title().catch(() => '');
  log.log(`URL: ${currentUrl}`);
  log.log(`TITLE: "${titleNow}"`);

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

  const h1Text = await page.locator('h1').first().innerText().catch(() => '');
  log.log(`[anteciparStatus] h1: "${h1Text}"`);

  if (!h1Text.includes(saQuery)) {
    log.log(`[anteciparStatus] ⚠️ h1 (${h1Text}) não contém ${saQuery} — recarregando a página`);
    const saIdMatch = currentUrl.match(/\/lightning\/r\/ServiceAppointment\/([a-zA-Z0-9]{15,18})/i);
    if (saIdMatch) {
      const correctUrl = `https://oimoveltrialorg2021--trg.sandbox.lightning.force.com/lightning/r/ServiceAppointment/${saIdMatch[1]}/view`;
      await page.goto(correctUrl, {
        waitUntil: 'domcontentloaded',
        timeout: FSL_CONFIG.TIMEOUTS.NAVIGATION,
      });
      log.log(`[anteciparStatus] recarregado em ${page.url()}`);
    }
  } else {
    log.log(`[anteciparStatus] ✅ SA exibida confere: ${h1Text}`);
  }

  // ====================================================================
  // ETAPA 1 — esperar a SA ficar PRONTA
  // ====================================================================
  log.log('aguardando SA ficar pronta (painel Details pintado)');
  try {
    const ready = await waitForSAReady(page, saQuery, {
      timeoutMs: 45_000,
      stepName: STEP_NAME,
      label: 'anteciparStatus',
    });
    log.log(`[anteciparStatus] ✅ SA pronta | h1="${ready.h1}"`);
  } catch (e) {
    await takeScreenshot(page, STEP_NAME, 'sa-not-ready');
    throw new Error(
      `anteciparStatus: SA ${saQuery} não ficou pronta em 45s. ` +
      `Provável página em estado de carga/repaint. ${e.message}`
    );
  }

  // ====================================================================
  // ETAPA 2 — abrir diálogo Antecipar Status / Antecipação
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

  // ====================================================================
  // ETAPA 3 — esperar o modal abrir
  // ====================================================================
  const modalAbriu = await esperarModalAntecipacao(page, log, 10_000);
  if (!modalAbriu) {
    await takeScreenshot(page, STEP_NAME, 'modal-nao-abriu');
    throw new Error(
      'Modal "Antecipação" não abriu em 10s após clicar no botão. ' +
      'Veja screenshot debug-anteciparStatus-modal-nao-abriu.png'
    );
  }
  log.log('[anteciparStatus] ✅ modal "Antecipação" aberto');

  // ====================================================================
  // ETAPA 3.5 — VERIFICAÇÃO IMEDIATA: é modal de AVISO?
  // ====================================================================
  await page.waitForTimeout(800);
  const avisoInicial = await detectarModalAviso(page, log, 2_000);
  if (avisoInicial.isAviso) {
    log.log('[anteciparStatus] ⚠️ modal de AVISO detectado — antecipação não permitida neste momento');
    log.log(`[anteciparStatus] texto: "${avisoInicial.texto.slice(0, 150)}"`);
    await takeScreenshot(page, STEP_NAME, 'modal-aviso-em-deslocamento');
    try {
      await clicarFinish(page, log);
    } catch (e) {
      log.log(`[anteciparStatus] ⚠️ não conseguiu clicar Finish: ${e.message.slice(0, 200)}`);
    }

    ctx.steps = ctx.steps || [];
    ctx.steps.push({
      step: STEP_NAME,
      status: 'skipped_no_anticipation_needed',
      tentativas: [],
      motivo: `modal de aviso: ${avisoInicial.texto.slice(0, 100)}`,
    });
    return ctx;
  }

  // ====================================================================
  // ETAPA 4 — LOOP DE TENTATIVAS (ciclo de períodos)
  // ====================================================================
  const chute = chuteInicial(new Date());
  let tentativa = { data: chute.data, periodo: chute.periodo };
  const tentativasFeitas = [];

  let sucesso = false;
  let i = 0;
  for (i = 0; i < MAX_TENTATIVAS; i++) {
    const dataStr = formatarData(tentativa.data);
    log.log(`[anteciparStatus] ┌─ tentativa ${i + 1}/${MAX_TENTATIVAS}: data="${dataStr}", período="${tentativa.periodo}"`);
    tentativasFeitas.push({ data: dataStr, periodo: tentativa.periodo });

    // Checagem adicional: modal de aviso?
    const aviso = await detectarModalAviso(page, log, 800);
    if (aviso.isAviso) {
      log.log(`[anteciparStatus] └─ ⚠️ modal de AVISO detectado na iteração ${i + 1} — encerrando tentativas`);
      log.log(`[anteciparStatus] └─ texto: "${aviso.texto.slice(0, 100)}"`);
      try {
        await clicarFinish(page, log);
      } catch (_) { /* best effort */ }
      await takeScreenshot(page, STEP_NAME, 'modal-aviso-durante-loop');
      break;
    }

    try {
      await preencherData(page, log, dataStr);
    } catch (e) {
      await takeScreenshot(page, STEP_NAME, `preencher-data-falhou-tent-${i + 1}`);
      log.log(`[anteciparStatus] └─ ❌ falhou ao preencher data: ${e.message.slice(0, 120)}`);

      const avisoApos = await detectarModalAviso(page, log, 1_500);
      if (avisoApos.isAviso) {
        log.log(`[anteciparStatus] └─ ⚠️ modal de AVISO confirmado — clicando Finish`);
        try {
          await clicarFinish(page, log);
        } catch (_) { /* best effort */ }
      }
      break;
    }
    await page.waitForTimeout(400);

    try {
      await selecionarPeriodo(page, log, tentativa.periodo);
    } catch (e) {
      await takeScreenshot(page, STEP_NAME, `preencher-periodo-falhou-tent-${i + 1}`);
      log.log(`[anteciparStatus] └─ ❌ falhou ao selecionar período: ${e.message.slice(0, 120)}`);
      break;
    }
    await page.waitForTimeout(400);

    try {
      await selecionarMotivo(page, log, MOTIVO_FIXO);
    } catch (e) {
      await takeScreenshot(page, STEP_NAME, `preencher-motivo-falhou-tent-${i + 1}`);
      log.log(`[anteciparStatus] └─ ❌ falhou ao selecionar motivo: ${e.message.slice(0, 120)}`);
      break;
    }
    await page.waitForTimeout(400);

    await takeScreenshot(page, STEP_NAME, `tent-${i + 1}-preenchido`);

    const resultado = await tentarConfirmarAntecipacao(page, log);

    if (!resultado.ok) {
      log.log(`[anteciparStatus] └─ ❌ falha técnica: ${resultado.erro}`);
      await takeScreenshot(page, STEP_NAME, `falha-tecnica-tent-${i + 1}`);
      break;
    }

    if (resultado.confirmado) {
      const definitivoOk = await confirmarModalDefinitivo(page, log);
      if (definitivoOk) {
        await esperarModaisFecharem(page, log, 10_000);
        await takeScreenshot(page, STEP_NAME, `sucesso-tent-${i + 1}`);
        log.log(`[anteciparStatus] └─ ✅ antecipação CONFIRMADA em ${dataStr} ${tentativa.periodo}`);
        sucesso = true;
        break;
      } else {
        log.log(`[anteciparStatus] └─ ⚠️ 2º modal não confirmou`);
        break;
      }
    }

    log.log(`[anteciparStatus] └─ ⚠️ turno indisponível para ${dataStr} ${tentativa.periodo} — tentando próximo período`);
    await takeScreenshot(page, STEP_NAME, `rejeitado-tent-${i + 1}`);

    await fecharModalAntecipacao(page, log);
    await page.waitForTimeout(500);

    const proximo = proximoPeriodo(tentativa.periodo, tentativa.data);
    tentativa = { data: proximo.data, periodo: proximo.periodo };

    try {
      await reabrirModalAntecipacao(page, log);
      await page.waitForTimeout(500);
      const avisoReabrir = await detectarModalAviso(page, log, 1_500);
      if (avisoReabrir.isAviso) {
        log.log(`[anteciparStatus] └─ ⚠️ modal de AVISO após reabrir — encerrando`);
        await clicarFinish(page, log);
        break;
      }
    } catch (e) {
      log.log(`[anteciparStatus] └─ ❌ não conseguiu reabrir modal: ${e.message.slice(0, 120)}`);
      break;
    }
  }

  if (!sucesso && i >= MAX_TENTATIVAS) {
    log.log(`[anteciparStatus] ❌ esgotadas ${MAX_TENTATIVAS} tentativas — combinações testadas:`);
    for (const t of tentativasFeitas) {
      log.log(`[anteciparStatus]    - ${t.data} ${t.periodo}`);
    }
    await takeScreenshot(page, STEP_NAME, 'max-tentativas-atingido');
  }

  ctx.steps = ctx.steps || [];
  ctx.steps.push({
    step: STEP_NAME,
    status: sucesso ? 'ok' : 'failed',
    tentativas: tentativasFeitas,
    tentativaEscolhida: sucesso
      ? tentativasFeitas[tentativasFeitas.length - 1]
      : null,
    motivo: MOTIVO_FIXO,
  });

  if (!sucesso) {
    throw new Error(
      `anteciparStatus: não foi possível efetivar a antecipação após ${MAX_TENTATIVAS} tentativas. ` +
      `Combinações testadas: ${tentativasFeitas.map(t => `${t.data} ${t.periodo}`).join(', ')}. ` +
      `Veja screenshot debug-anteciparStatus-max-tentativas-atingido.png`
    );
  }

  return ctx;
}

module.exports = { step, name: STEP_NAME };