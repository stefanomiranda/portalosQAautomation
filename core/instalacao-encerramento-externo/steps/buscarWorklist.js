// core/instalacao-encerramento-externo/steps/buscarWorklist.js
//
// Step 2 — localizar a OS na Worklist do SOM.
//
// AJUSTE bug #1 (opção c — "Os dois"):
//   - Pula page.goto se já estamos na Worklist (evita reload que
//     quebra o handler refreshWorklist do OSM).
//   - Submeter prioriza ENTER no campo Reference (mais confiável);
//     click no botão Refresh vira fallback.
// O resto do fluxo (campo name=referenceFilter, clique no link do
// Order ID da 1ª linha) continua igual ao que já estava validado.

const { smartLocator, takeScreenshot, waitForCondition } = require('../utils');

/** Heurística para a URL da Worklist a partir da URL atual. */
function urlWorklist(page) {
  const u = new URL(page.url());
  const path = u.pathname.replace(/Login\.jsp.*$/i, 'Worklist.jsp');
  u.pathname = path;
  u.search = '';
  u.hash = '';
  return u.toString();
}

/** AJUSTE bug #1: detecta se já estamos em alguma página da Worklist. */
function isOnWorklist(page) {
  const url = page.url();
  return /\/OrderManagement\/?(\?|$|#)/i.test(url)
      || /\/OrderManagement\/control\/Worklist/i.test(url)
      || /\/OrderManagement\/Worklist\.jsp/i.test(url);
}

async function buscarWorklist({ page, sa, associatedDocument, onLog = () => {} }) {
  const log = (m) => onLog(`[buscarWorklist] ${m}`);

  if (!sa && !associatedDocument) {
    throw new Error('buscarWorklist: precisa de `sa` ou `associatedDocument`');
  }
  const refValue = associatedDocument || sa;
  log(`Reference de busca: ${refValue} (SA=${sa || '?'})`);

  // 1) Garantir que estamos na Worklist (pula goto se já estiver)
  if (isOnWorklist(page)) {
    log(`já estamos na Worklist (URL: ${page.url()}) — pulando goto`);
  } else {
    const wlUrl = urlWorklist(page);
    log(`navegando para a Worklist: ${wlUrl}`);
    await page.goto(wlUrl, { waitUntil: 'domcontentloaded' });
  }
  await takeScreenshot(page, 'buscarWorklist__worklist_carregada', onLog);

  // 2) Localizar o campo "Reference"
  const refField = await smartLocator(page, [
    ['input[name="referenceFilter"]',        (p) => p.locator('input[name="referenceFilter"]')],
    ['input[name="referenceNumber"]',        (p) => p.locator('input[name="referenceNumber"]')],
    ['input[name="reference"]',             (p) => p.locator('input[name="reference"]')],
    ['input[id*="referenceFilter" i]',      (p) => p.locator('input[id*="referenceFilter" i]')],
    ['input[id*="reference" i]',             (p) => p.locator('input[id*="reference" i]')],
    ['input[aria-label*="Reference" i]',    (p) => p.locator('input[aria-label*="Reference" i]')],
    ['input[type="text"]:nth(1)',           (p) => p.locator('input[type="text"]').nth(1)],
  ], { timeout: 8000 });
  log(`campo Reference localizado via: ${refField.strategy}`);

  await refField.locator.first().fill('');
  await refField.locator.first().fill(refValue);

  // 3) Submeter a busca — AJUSTE bug #1: ENTER primeiro, Refresh como fallback
  const submit = await smartLocator(page, [
    ['input[value="Refresh" i]',     (p) => p.locator('input[value="Refresh" i]')],
    ['input[value="Search" i]',      (p) => p.locator('input[value="Search" i]')],
    ['input[value="Buscar" i]',      (p) => p.locator('input[value="Buscar" i]')],
    ['input[value="Find" i]',        (p) => p.locator('input[value="Find" i]')],
    ['input[value="Filtrar" i]',     (p) => p.locator('input[value="Filtrar" i]')],
    ['button:has-text("Refresh")',   (p) => p.locator('button:has-text("Refresh")')],
    ['button:has-text("Search")',    (p) => p.locator('button:has-text("Search")')],
    ['button:has-text("Buscar")',    (p) => p.locator('button:has-text("Buscar")')],
    ['button:has-text("Find")',      (p) => p.locator('button:has-text("Find")')],
    ['input[type="submit"]',         (p) => p.locator('input[type="submit"]')],
    ['button[type="submit"]',        (p) => p.locator('button[type="submit"]')],
  ], { timeout: 4000 }).then((r) => r.locator).catch(() => null);

  if (submit) {
    const btnText = (await submit.first().getAttribute('value').catch(() => null))
                 || (await submit.first().textContent().catch(() => null))
                 || '?';
    log(`submetendo busca na Worklist (click no botão "${String(btnText).trim()}")`);
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => null),
      submit.first().click(),
    ]);
  } else {
    log('botão de busca não encontrado — usando ENTER no campo Reference');
    await refField.locator.first().press('Enter');
  }

  // 4) Esperar o resultado da busca
  await waitForCondition(
    async () => {
      const hasOurRow = await page.locator(`table tbody tr:visible:has-text("${refValue}")`).count();
      if (hasOurRow > 0) return true;
      const rowCount = await page.locator('table tbody tr:visible').count();
      return rowCount === 1;
    },
    { timeoutMs: 15000, intervalMs: 300, label: 'resultado da busca na Worklist' }
  );
  await takeScreenshot(page, 'buscarWorklist__resultado_busca', onLog);

  // 5) Clicar na primeira linha (link do Order ID)
  const primeiraLinha = page.locator('table tbody tr:visible').first();

  const primeiraLinhaHtml = await primeiraLinha.evaluate((el) => el.outerHTML).catch(() => '?');
  log(`DEBUG primeiraLinha HTML (${primeiraLinhaHtml.length} chars, primeiros 400): ${primeiraLinhaHtml.substring(0, 400)}`);

  let orderIdLink = null;
  for (const col of [4, 3, 5, 2, 6]) {
    const candidates = primeiraLinha.locator(`td:nth-child(${col}) a`);
    const count = await candidates.count();
    for (let i = 0; i < count; i++) {
      const link = candidates.nth(i);
      const text = (await link.textContent() || '').trim();
      if (text && /^\d+$/.test(text)) {
        orderIdLink = link;
        log(`link do Order ID encontrado na coluna ${col}: "${text}"`);
        break;
      }
    }
    if (orderIdLink) break;
  }

  if (orderIdLink) {
    const linkText = (await orderIdLink.textContent() || '').trim();
    log(`clicando no link do Order ID (${linkText})`);
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => null),
      orderIdLink.click(),
    ]);
  } else {
    const ellipsisBtn = primeiraLinha.locator('td:nth-child(1) button, td:nth-child(1) a, td:nth-child(1) img').first();
    if ((await ellipsisBtn.count()) > 0) {
      log('sem link do Order ID — clicando no botão "..." da 1ª coluna');
      await Promise.all([
        page.waitForLoadState('domcontentloaded').catch(() => null),
        ellipsisBtn.click(),
      ]);
    } else {
      log('nenhum link encontrado — clicando na própria linha');
      await Promise.all([
        page.waitForLoadState('domcontentloaded').catch(() => null),
        primeiraLinha.click(),
      ]);
    }
  }

  // 6) Confirma que chegamos na tela de detalhes da OS
  await waitForCondition(
    async () => {
      const url = page.url();
      if (/OrderDetail|Order\/\d+/i.test(url)) return true;
      const temTarefa = await page.locator('text=/T0(17|37|46)/').first().isVisible().catch(() => false);
      return temTarefa;
    },
    { timeoutMs: 15000, intervalMs: 300, label: 'abrir detalhe da OS' }
  );
  await takeScreenshot(page, 'buscarWorklist__ordem_aberta', onLog);
  log(`OS aberta — URL: ${page.url()}`);
}

module.exports = buscarWorklist;