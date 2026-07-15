// core/shared-som/worklistHelper.js
//
// Helper compartilhado para navegação na Worklist do Oracle OSM.
// Reaproveitável por qualquer esteira (Instalação, Retirada, futuras).
//
// Extraído das esteiras individuais (instalacao-encerramento, etc.) para
// ser reaproveitado. Validação ESTRITA do filtro (pega o do FORM, não o
// do HEADER), e o abrirPrimeiraOrdem LANÇA ERRO quando a taskName
// passada não está na grade filtrada.

const { SOM_CONFIG, smartLocator, takeScreenshot, waitForCondition } = require('./utils');

const WORKLIST_URL = SOM_CONFIG.WORKLIST_URL;

async function isOnWorklist(page, onLog = () => {}) {
  const log = (m) => onLog(`[worklistHelper] ${m}`);
  const url = page.url();
  const temCampo = await page.locator('input[name="referenceFilter"]').count().catch(() => 0);
  const temTexto = await page.evaluate(() => {
    return /Reference\s*#/i.test(document.body.textContent || '');
  }).catch(() => false);
  const ok = temCampo > 0 && temTexto;
  log(`isOnWorklist? url=${url}, temCampo=${temCampo}, temTexto=${temTexto}, ok=${ok}`);
  return ok;
}


async function isErro445(page) {
  return await page.evaluate(() => {
    const t = document.body.textContent || '';
    return /Message\s*Code\s*:?\s*445/i.test(t) || /Resource\s+not\s+found/i.test(t);
  }).catch(() => false);
}


async function clickWorklistLinkHeader(page) {
  const link = page.locator('a').filter({ hasText: /^Worklist$/i }).first();
  if ((await link.count()) === 0) return false;
  await link.click();
  return true;
}


async function abrirWorklist(page, onLog = () => {}) {
  const log = (m) => onLog(`[worklistHelper] ${m}`);

  if (await isOnWorklist(page, onLog)) {
    log(`✓ já estamos na Worklist real — pulando navegação`);
    return;
  }

  const erro445 = await isErro445(page);
  if (erro445) {
    log(`⚠ página de erro 445 detectada — clicando no link "Worklist" do header`);
  } else {
    log(`não estamos na Worklist (URL=${page.url()}) — clicando no link "Worklist" do header`);
  }

  let clicked = false;
  try {
    clicked = await clickWorklistLinkHeader(page);
  } catch (e) {
    log(`⚠ click no link "Worklist" do header falhou: ${e.message}`);
  }

  if (!clicked) {
    log(`link "Worklist" do header não encontrado — fallback com page.goto`);
    await page.goto(WORKLIST_URL, { waitUntil: 'domcontentloaded' });
  } else {
    await page.waitForLoadState('domcontentloaded').catch(() => null);
  }
  await page.waitForTimeout(500).catch(() => null);

  const chegou = await waitForCondition(page, async (p) => {
    return await isOnWorklist(p, onLog);
  }, { timeoutMs: 10000, pollMs: 300, label: 'Worklist carregar' }).then(() => true).catch(() => false);

  if (!chegou) {
    await takeScreenshot(page, 'worklistHelper__worklist_nao_carregou', 'state', onLog);
    log(`URL atual: ${page.url()}`);
    log(`Body preview: ${(await page.evaluate(() => document.body.textContent || '').catch(() => '')).substring(0, 300)}`);
    throw new Error(`worklistHelper: não consegui chegar na Worklist real (campo referenceFilter não apareceu)`);
  }
  log(`✓ Worklist real carregada — campo referenceFilter presente`);
}


/**
 * Filtra a Worklist por Reference #.
 * Submit: Refresh PRIMÁRIO, ENTER fallback.
 * Validação ESTRITA: precisa ter (a) linha com a referência E (b) total ≤ 20 linhas.
 */
async function buscarPorReference(page, reference, onLog = () => {}) {
  const log = (m) => onLog(`[worklistHelper] ${m}`);
  if (!reference) throw new Error('worklistHelper.buscarPorReference: `reference` é obrigatório');

  log(`preenchendo Reference # = ${reference}`);
  const refField = await smartLocator(page, [
    { css: 'input[name="referenceFilter"]' },
    { css: 'input[name="referenceNumber"]' },
    { css: 'input[name="reference"]' },
    { css: 'input[id*="referenceFilter" i]' },
    { css: 'input[id*="reference" i]' },
    { css: 'input[type="text"]:nth(1)' },
  ], { timeout: 8000 });
  log(`campo Reference localizado via: ${refField.strategy}`);

  await refField.locator.first().fill('');
  await refField.locator.first().fill(reference);
  await refField.locator.first().evaluate((el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Submit: Refresh PRIMÁRIO
  const submit = await smartLocator(page, [
    { css: 'input[value="Refresh" i]' },
    { role: 'button', name: 'Refresh' },
  ], { timeout: 4000 }).then(r => r.locator).catch(() => null);

  if (submit) {
    log('submetendo busca (click no botão "Refresh")...');
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => null),
      submit.first().click(),
    ]);
  } else {
    log('botão Refresh não encontrado — usando ENTER no campo Reference...');
    await refField.locator.first().press('Enter');
  }
  await page.waitForTimeout(500).catch(() => null);

  // Validação ESTRITA: precisa ter linha com a referência E total ≤ 20 linhas
  let filtroAplicou = false;
  try {
    await waitForCondition(page, async (p) => {
      const temLinhaComRef = await p.locator(`table tbody tr:visible:has-text("${reference}")`).count() > 0;
      const totalLinhas = await p.locator('table tbody tr:visible').count();
      const filtroAplicado = totalLinhas > 0 && totalLinhas <= 20;
      return temLinhaComRef && filtroAplicado;
    }, { timeoutMs: 15000, pollMs: 300, label: 'filtro por Reference # (validação estrita)' });
    filtroAplicou = true;
  } catch (e) {
    log('⚠ validação estrita falhou — tentando ENTER como fallback...');
    await refField.locator.first().press('Enter');
    await page.waitForTimeout(800).catch(() => null);
    try {
      await waitForCondition(page, async (p) => {
        const temLinhaComRef = await p.locator(`table tbody tr:visible:has-text("${reference}")`).count() > 0;
        const totalLinhas = await p.locator('table tbody tr:visible').count();
        const filtroAplicado = totalLinhas > 0 && totalLinhas <= 20;
        return temLinhaComRef && filtroAplicado;
      }, { timeoutMs: 10000, pollMs: 300, label: 'filtro ENTER (validação estrita)' });
      filtroAplicou = true;
    } catch (e2) { /* cai no erro abaixo */ }
  }

  if (!filtroAplicou) {
    await takeScreenshot(page, 'worklistHelper__filtro_nao_aplicou', 'state', onLog);
    const debugRows = await page.locator('table tbody tr:visible').count().catch(() => -1);
    log(`DEBUG: ${debugRows} linhas visíveis (esperado ≤ 20 se filtro aplicou)`);
    throw new Error(
      `worklistHelper: filtro por "${reference}" não aplicou após Refresh + ENTER ` +
      `(${debugRows} linhas visíveis — filtro provavelmente não foi aplicado). ` +
      `Verifique o screenshot worklistHelper__filtro_nao_aplicou.png.`
    );
  }
  log(`✓ filtro por "${reference}" aplicado`);
}


async function abrirPrimeiraOrdem(page, onLog = () => {}, taskName = null) {
  const log = (m) => onLog(`[worklistHelper] ${m}`);

  if (taskName) {
    log(`procurando linha "${taskName}" para abrir...`);

    const escaped = taskName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const handle = await page.evaluateHandle((pattern) => {
      const re = new RegExp(pattern + '\\s*[-–:]?\\s*', 'i');
      const rows = Array.from(document.querySelectorAll('tr.context-menu-target'));
      for (const tr of rows) {
        const text = (tr.textContent || '').replace(/\s+/g, ' ').trim();
        if (re.test(text)) {
          const firstTd = tr.querySelector('td');
          return firstTd ? firstTd.querySelector('input.tableAction[name="move"]') : null;
        }
      }
      return null;
    }, escaped);

    const btn = handle.asElement();
    if (!btn) {
      await takeScreenshot(page, 'worklistHelper__linha_task_nao_encontrada', 'state', onLog);
      const debugLinhas = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tr.context-menu-target'));
        return rows.map((tr, i) => ({
          idx: i,
          text: (tr.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 150),
        }));
      }).catch(() => []);
      log(`DEBUG: ${debugLinhas.length} linhas com classe 'tr.context-menu-target' visíveis na grade:`);
      debugLinhas.forEach(d => log(`  [${d.idx}] "${d.text}"`));
      throw new Error(
        `worklistHelper: linha "${taskName}" não encontrada na grade filtrada. ` +
        `O filtro provavelmente não foi aplicado (verifique o screenshot ` +
        `worklistHelper__linha_task_nao_encontrada.png — a grade ainda tem a ` +
        `lista default, não a filtrada por associatedDocument).`
      );
    }
    log(`✓ linha "${taskName}" encontrada — clicando no "..."`);
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => null),
      btn.click(),
    ]);
  } else {
    log('clicando no "..." (1ª coluna) da 1ª linha filtrada...');
    const primeiraLinha = page.locator('table tbody tr:visible').first();
    const btnHandle = await primeiraLinha.evaluateHandle((tr) => {
      const firstTd = tr.querySelector('td');
      return firstTd ? firstTd.querySelector('input.tableAction[name="move"]') : null;
    });
    const btn = btnHandle.asElement();
    if (!btn) {
      await takeScreenshot(page, 'worklistHelper__linha_sem_botao', 'state', onLog);
      throw new Error('worklistHelper: 1ª linha da grade não tem botão de ação');
    }
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => null),
      btn.click(),
    ]);
  }
  await page.waitForTimeout(1000).catch(() => null);
  log(`✓ OS aberta — URL: ${page.url()}`);
}


async function reabrirOrdemPorReference(page, reference, onLog = () => {}, opts = {}) {
  const log = (m) => onLog(`[worklistHelper] ${m}`);
  const taskName = opts.taskName || null;
  log(`reabrindo OS por associatedDocument = ${reference}${taskName ? ` (task="${taskName}")` : ''}`);
  await abrirWorklist(page, onLog);
  await takeScreenshot(page, 'worklistHelper__worklist_carregada', 'state', onLog);
  await buscarPorReference(page, reference, onLog);
  await takeScreenshot(page, 'worklistHelper__worklist_filtrada', 'state', onLog);
  await abrirPrimeiraOrdem(page, onLog, taskName);
  await takeScreenshot(page, 'worklistHelper__os_reaberta', 'state', onLog);
  log(`✓ OS reaberta via associatedDocument = ${reference}${taskName ? ` (task="${taskName}")` : ''}`);
}


module.exports = {
  WORKLIST_URL,
  isOnWorklist,
  abrirWorklist,
  buscarPorReference,
  abrirPrimeiraOrdem,
  reabrirOrdemPorReference,
};
