// core/fsl/steps/concluirStatus.js
//
// Step 4/8 — Loop "Marcar Status como Completo" até chegar em "Em Execução".

const { makeLogger, takeScreenshot, smartLocator, readStableText } = require('../utils');
const FSL_CONFIG = require('../config');

const STEP_NAME = 'concluirStatus';

// Regex para os valores possíveis de Status de uma SA no FSL.
// Casa: "Em Execução", "Em Execucao", "Em Execuçao" (typos), e similares.
const STATUS_RE = /Em execu[cç][aã]o/i;
const STATUS_VALUE_RE = /Em execu|Conclu[ií]d|Pendente|Aguard|Inici|Andament|Schedul|Assigned|None|Canceled|Dispatched|In Progress|Completed/i;

/**
 * Lê o valor do campo Status na SA usando seletores específicos do
 * Lightning. Fallback explícito para diagnóstico se nenhum casar.
 */
async function readStatus(page, log) {
  // Estratégia 1: campo Status do layout de registro (mais confiável).
  // O Lightning renderiza cada campo como um <records-record-layout-item>
  // com data-fieldname="Status" e o valor dentro de um lightning-formatted-text.
  try {
    const layoutField = page
      .locator(
        'records-record-layout-item[data-fieldname="Status"] lightning-formatted-text, ' +
        '[data-fieldname="Status"] span[part="formatted-text"], ' +
        '[data-fieldname="Status"] lightning-formatted-text'
      )
      .first();

    if (await layoutField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const text = (await layoutField.textContent() || '').trim();
      if (text && text.length < 200) {
        log.log(`[status] campo Status do layout: "${text}"`);
        return text;
      }
    }
  } catch (err) {
    log.log(`[status] estratégia 1 falhou: ${err.message.slice(0, 80)}`);
  }

  // Estratégia 2: pill/badge de status (alguns layouts FSL mostram como pill).
  try {
    const statusPill = page
      .locator('lightning-pill, .slds-pill, [class*="status-pill" i]')
      .filter({ hasText: STATUS_VALUE_RE })
      .first();

    if (await statusPill.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const text = (await statusPill.textContent() || '').trim();
      if (text) {
        log.log(`[status] pill de status: "${text}"`);
        return text;
      }
    }
  } catch (err) {
    log.log(`[status] estratégia 2 falhou: ${err.message.slice(0, 80)}`);
  }

  // Estratégia 3: highligthed panel do FSL (cabeçalho da SA).
  // Em SAs com FSL Mobile/Field Service, o status aparece em um painel
  // destacado no topo. Esse é o formato "Status: <value>".
  try {
    const headerStatus = page
      .locator('[class*="slds-page-header"] [class*="status" i], [class*="highlightPanel" i]')
      .filter({ hasText: STATUS_VALUE_RE })
      .first();

    if (await headerStatus.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const text = (await headerStatus.textContent() || '').trim();
      if (text) {
        log.log(`[status] painel de header: "${text}"`);
        return text;
      }
    }
  } catch (err) {
    log.log(`[status] estratégia 3 falhou: ${err.message.slice(0, 80)}`);
  }

  // Diagnóstico: dump dos candidatos para entender o que existe na página.
  log.log('[status] ⚠️ campo Status não localizado nas 3 estratégias');
  const allCandidates = await page
    .locator('[data-fieldname="Status"], lightning-pill, [class*="status" i]')
    .evaluateAll((els) => els
      .filter((el) => el.offsetWidth > 0)
      .slice(0, 10)
      .map((el) => ({
        tag: el.tagName,
        fieldname: el.getAttribute('data-fieldname'),
        classname: (el.className || '').toString().slice(0, 80),
        text: (el.innerText || '').slice(0, 100),
      })));
  log.log(`[status] candidatos: ${JSON.stringify(allCandidates)}`);
  return '';
}

function isEmExecucao(text) {
  return STATUS_RE.test(text);
}

/**
 * Espera qualquer modal/dialog do Lightning fechar.
 * Retorna true se fechou (ou se nunca esteve aberto), false se timeout.
 */
async function waitForModalClose(page, log, timeoutMs = 10_000) {
  try {
    await page.waitForSelector(
      '[role="dialog"]:visible, .slds-modal--open, .modal-container',
      { state: 'hidden', timeout: timeoutMs }
    );
    log.log('[concluirStatus] modal fechou');
    return true;
  } catch {
    // Nenhum modal aberto OU não fechou — só loga, não falha
    return false;
  }
}

async function step(ctx) {
  const log = makeLogger(STEP_NAME);
  const { page } = ctx;

  // Garante que não há modal aberto vindo do anteciparStatus
  await waitForModalClose(page, log, 3_000);

  const maxIter = FSL_CONFIG.TIMEOUTS.STEP_LOOP_MAX;
  log.log(`loop de status (máx ${maxIter} iterações)`);

  for (let i = 1; i <= maxIter; i++) {
    // Defesa: re-checar modal a cada iteração (alguns fluxos abrem sub-modais)
    await waitForModalClose(page, log, 1_000);

    const status = await readStatus(page, log);
    log.log(`iteração ${i}: status="${status}"`);

    if (isEmExecucao(status)) {
      log.log('chegou em "Em Execução" — saindo do loop');
      ctx.steps = ctx.steps || [];
      ctx.steps.push({ step: STEP_NAME, iterations: i, status: 'ok', finalStatus: status });
      return ctx;
    }

    // Procura o botão "Marcar Status como Completo"
    let marcar = null;
    try {
      marcar = smartLocator(page, [
        { role: 'button', name: /Marcar Status como Completo/i },
        { text: /Marcar Status como Completo/i },
      ]).first();

      await marcar.waitFor({ state: 'visible', timeout: FSL_CONFIG.TIMEOUTS.ACTION });
    } catch (err) {
      log.log(`[concluirStatus] ⚠️ botão "Marcar Status como Completo" não encontrado (iteração ${i})`);
      log.log(`[concluirStatus] status atual: "${status}"`);

      await takeScreenshot(page, STEP_NAME, `no-marcar-button-iter-${i}`);

      throw new Error(
        `concluirStatus: botão "Marcar Status como Completo" não encontrado após ${i} iteração(ões). ` +
        `Status atual: "${status}". Isso geralmente significa que a SA está FORA DA JANELA ` +
        `de atendimento — nesse caso, é preciso ANTES chamar "Antecipação" (botão Antecipação) ` +
        `para mover a janela, e só depois "Marcar Status como Completo" fica disponível. ` +
        `Veja screenshot debug-concluirStatus-no-marcar-button-iter-${i}.png`
      );
    }

    await marcar.click();
    log.log(`[concluirStatus] botão "Marcar Status como Completo" clicado`);

    // Confirmação: pode haver mais de um "Confirmar" na tela (modal de sucesso).
    try {
      const confirms = page.getByRole('button', { name: /Confirmar/i });
      const count = await confirms.count();
      log.log(`[concluirStatus] ${count} botão(ões) "Confirmar" encontrados`);

      if (count > 1) {
        await confirms.nth(count - 1).click();
        log.log('[concluirStatus] último "Confirmar" clicado');
      } else if (count === 1) {
        await confirms.first().click();
        log.log('[concluirStatus] "Confirmar" clicado');
      } else {
        log.log('[concluirStatus] nenhum "Confirmar" — pode ser fluxo sem confirmação explícita');
      }
    } catch (err) {
      log.log(`[concluirStatus] erro no Confirmar: ${err.message.slice(0, 80)}`);
    }

    // Espera o modal de confirmação fechar e a página atualizar
    await waitForModalClose(page, log, 5_000);
    await new Promise(r => setTimeout(r, 1500));
  }

  const finalStatus = await readStatus(page, log);
  throw new Error(
    `Não chegou em "Em Execução" após ${maxIter} iterações. Último status: "${finalStatus}". ` +
    `Se a SA está fora da janela de atendimento, ela precisa ser antecipada antes.`
  );
}

module.exports = { step, name: STEP_NAME };