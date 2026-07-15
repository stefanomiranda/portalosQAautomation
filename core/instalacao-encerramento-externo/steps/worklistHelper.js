// core/instalacao-encerramento-externo/steps/worklistHelper.js
//
// Helper compartilhado para navegação na Worklist do Oracle OSM.
// Extraído do buscarWorklist.js pra ser reaproveitado pelo t017.js.
//
// FIX 3 (bug introduzido pela versão anterior): o `buscarPorReference`
// estava usando ENTER-first e validação frouxa (`count > 0`), o que
// dava falso-positivo quando a referência já aparecia na lista
// não-filtrada de 200 registros (ENTER não disparava o filtro, mas
// a validação passava porque 1 linha da lista default continha o
// texto). Agora:
//   - Submit: Refresh PRIMÁRIO (igual ao buscarWorklist.js que funciona),
//     ENTER como fallback.
//   - Validação: AMBAS as condições precisam ser verdadeiras —
//     (a) pelo menos 1 linha visível contém a referência, E
//     (b) o total de linhas visíveis é ≤ 20 (indicando que o filtro
//     foi aplicado; a lista não-filtrada tem 14 linhas / 200 registros).
//
// FIX 4: `abrirPrimeiraOrdem` com `taskName` agora LANÇA ERRO se a
// linha da task não for encontrada (antes caía no fallback da 1ª
// linha, o que abria uma OS errada).

const { smartLocator, takeScreenshot, waitForCondition } = require('../utils');

const WORKLIST_URL = 'http://osmsqx12a.local:7003/OrderManagement/control/Worklist';

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

  const chegou = await waitForCondition(async () => {
    return await isOnWorklist(page, onLog);
  }, { timeoutMs: 10000, intervalMs: 300, label: 'Worklist carregar' }).then(() => true).catch(() => false);

  if (!chegou) {
    await takeScreenshot(page, 'worklistHelper__worklist_nao_carregou', onLog);
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
    ['input[name="referenceFilter"]',     (p) => p.locator('input[name="referenceFilter"]')],
    ['input[name="referenceNumber"]',     (p) => p.locator('input[name="referenceNumber"]')],
    ['input[name="reference"]',           (p) => p.locator('input[name="reference"]')],
    ['input[id*="referenceFilter" i]',   (p) => p.locator('input[id*="referenceFilter" i]')],
    ['input[id*="reference" i]',          (p) => p.locator('input[id*="reference" i]')],
    ['input[type="text"]:nth(1)',         (p) => p.locator('input[type="text"]').nth(1)],
  ], { timeout: 8000 });
  log(`campo Reference localizado via: ${refField.strategy}`);

  await refField.locator.first().fill('');
  await refField.locator.first().fill(reference);
  await refField.locator.first().evaluate((el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Submit: Refresh PRIMÁRIO (igual ao buscarWorklist.js)
  const submit = await smartLocator(page, [
    ['input[value="Refresh" i]',     (p) => p.locator('input[value="Refresh" i]')],
    ['button:has-text("Refresh")',   (p) => p.locator('button:has-text("Refresh")')],
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
    await waitForCondition(async () => {
      const temLinhaComRef = await page.locator(`table tbody tr:visible:has-text("${reference}")`).count() > 0;
      const totalLinhas = await page.locator('table tbody tr:visible').count();
      const filtroAplicado = totalLinhas > 0 && totalLinhas <= 20;
      return temLinhaComRef && filtroAplicado;
    }, { timeoutMs: 15000, intervalMs: 300, label: 'filtro por Reference # (validação estrita)' });
    filtroAplicou = true;
  } catch (e) {
    log('⚠ validação estrita falhou — tentando ENTER como fallback...');
    await refField.locator.first().press('Enter');
    await page.waitForTimeout(800).catch(() => null);
    try {
      await waitForCondition(async () => {
        const temLinhaComRef = await page.locator(`table tbody tr:visible:has-text("${reference}")`).count() > 0;
        const totalLinhas = await page.locator('table tbody tr:visible').count();
        const filtroAplicado = totalLinhas > 0 && totalLinhas <= 20;
        return temLinhaComRef && filtroAplicado;
      }, { timeoutMs: 10000, intervalMs: 300, label: 'filtro ENTER (validação estrita)' });
      filtroAplicou = true;
    } catch (e2) { /* cai no erro abaixo */ }
  }

  if (!filtroAplicou) {
    await takeScreenshot(page, 'worklistHelper__filtro_nao_aplicou', onLog);
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
      // SEM FALLBACK: a taskName precisa estar na grade filtrada.
      await takeScreenshot(page, 'worklistHelper__linha_task_nao_encontrada', onLog);
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
      await takeScreenshot(page, 'worklistHelper__linha_sem_botao', onLog);
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
  await takeScreenshot(page, 'worklistHelper__worklist_carregada', onLog);
  await buscarPorReference(page, reference, onLog);
  await takeScreenshot(page, 'worklistHelper__worklist_filtrada', onLog);
  await abrirPrimeiraOrdem(page, onLog, taskName);
  await takeScreenshot(page, 'worklistHelper__os_reaberta', onLog);
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