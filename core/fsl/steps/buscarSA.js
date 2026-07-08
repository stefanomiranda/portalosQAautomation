// core/fsl/steps/buscarSA.js
//
// Step 2/8 — Localizar a SA no Lightning.
//
// ABORDAGEM: Salesforce REST API (SOQL) com Bearer auth (SID extraído
// dos cookies via Playwright) para obter o recordId, depois navegação
// direta. Resolve o problema de 401 do credentials:'include' em
// cross-domain (lightning.force.com vs salesforce.com).

const STEP_NAME = 'buscarSA';
const SA_ID_RE = /\/lightning\/r\/(?:ServiceAppointment\/)?([a-zA-Z0-9]{15,18})/;

async function step(ctx) {
  const { makeLogger, takeScreenshot } = require('../utils');
  const FSL_CONFIG = require('../config');

  const log = makeLogger(STEP_NAME);
  const { page, input } = ctx;

  if (!input.sa) throw new Error('buscarSA: input.sa é obrigatório');

  const saQuery = `SA-${input.sa}`;
  log.log(`buscando ${saQuery}`);

  // ====================================================================
  // ETAPA 0 — atalho: se a URL já é da SA, validar e sair
  // ====================================================================
  const currentUrl = page.url();
  const titleNow = await page.title().catch(() => '');
  log.log(`[STATE] URL: ${currentUrl}`);
  log.log(`[STATE] TITLE: ${titleNow}`);

  function isOnSAHomePage(url, title) {
    const isSA = SA_ID_RE.test(url);
    const titleSaysNotHome = /history|related|chatter|activity/i.test(title);
    return isSA && !titleSaysNotHome;
  }

  const saUrlMatch = currentUrl.match(SA_ID_RE);
  if (saUrlMatch) {
    const saIdOnPage = saUrlMatch[1];

    if (isOnSAHomePage(currentUrl, titleNow)) {
      log.log(`[buscarSA] URL já contém ServiceAppointment (${saIdOnPage}) — validando`);
      const body = await page.locator('body').innerText().catch(() => '');
      if (body.includes(saQuery) || body.includes(input.sa)) {
        log.log(`[buscarSA] ✅ atalho: já estamos na SA correta (${saIdOnPage})`);
        ctx.saId = saIdOnPage;
        ctx.steps = ctx.steps || [];
        ctx.steps.push({ step: STEP_NAME, sa: input.sa, status: 'ok', atalho: true });
        return ctx;
      }
      log.log(`[buscarSA] atalho falhou: SA na página ≠ ${saQuery} — seguindo via REST`);
    } else {
      log.log(`[buscarSA] URL é sub-rota (TITLE="${titleNow}") — via REST resolve`);
    }
  }

  // ====================================================================
  // ETAPA 1 — esperar overlay auraLoadingBox sumir
  // ====================================================================
  log.log('aguardando overlay auraLoadingBox sumir');
  try {
    await page.waitForSelector('.auraLoadingBox.oneLoadingBox', {
      state: 'hidden',
      timeout: 60_000,
    });
    log.log('overlay sumiu');
  } catch (e) {
    log.log(`overlay não sumiu em 60s: ${e.message} (continuando)`);
  }

  // ====================================================================
  // ETAPA 2 — obter recordId via Salesforce REST API (SOQL)
  //
  // CORREÇÃO: usa Bearer auth com o SID extraído via page.context().cookies()
  // (que pega cookies HttpOnly). Resolve o 401 do credentials:'include'.
  // ====================================================================
  log.log(`[buscarSA] consultando recordId via SOQL: ${saQuery}`);

  // (a) Extrai o SID via Playwright (vê HttpOnly, diferente de document.cookie)
  const allCookies = await page.context().cookies();
  const sidCookie = allCookies.find((c) => c.name === 'sid');
  if (!sidCookie) {
    await takeScreenshot(page, STEP_NAME, 'no-sid-cookie');
    throw new Error(
      'buscarSA: cookie "sid" não encontrado no contexto do browser. ' +
      'A sessão do Salesforce não foi estabelecida corretamente. ' +
      'Veja screenshot debug-buscarSA-no-sid-cookie.png'
    );
  }
  const sid = decodeURIComponent(sidCookie.value);
  log.log(`[buscarSA] SID extraído (${sid.length} chars, dom="${sidCookie.domain}")`);

  // (b) Faz a query SOQL via fetch in-browser com Bearer
  const soql = `SELECT Id FROM ServiceAppointment WHERE AppointmentNumber = '${saQuery}' LIMIT 1`;
  const queryResult = await page.evaluate(async ({ q, bearer }) => {
    try {
      const url = `/services/data/v59.0/query?q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        credentials: 'omit',
        headers: {
          'Authorization': `Bearer ${bearer}`,
          'Accept': 'application/json',
        },
      });

      if (res.status === 401) {
        return { error: `Sessão inválida (HTTP 401). sid pode estar expirado.` };
      }
      if (res.status === 403) {
        return { error: `Sem permissão de API (HTTP 403). Usuário precisa de "API Enabled".` };
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
      }

      const json = await res.json();
      if (!json.records || json.records.length === 0) {
        return { error: `Nenhum ServiceAppointment com AppointmentNumber = ${q.match(/'([^']+)'/)?.[1]}` };
      }
      return { id: json.records[0].Id };
    } catch (e) {
      return { error: `Exceção no fetch: ${e.message}` };
    }
  }, { q: soql, bearer: sid });

  if (queryResult.error) {
    await takeScreenshot(page, STEP_NAME, 'soql-failed');
    throw new Error(
      `buscarSA: falha na consulta SOQL — ${queryResult.error}. ` +
      'Veja screenshot debug-buscarSA-soql-failed.png'
    );
  }

  const saId = queryResult.id;
  log.log(`[buscarSA] ✅ recordId obtido: ${saId}`);

  // ====================================================================
  // ETAPA 3 — navegar direto para a SA
  // ====================================================================
  const hostMatch = currentUrl.match(/https?:\/\/([^/]+)/);
  const saHost = hostMatch
    ? hostMatch[1]
    : 'oimoveltrialorg2021--trg.sandbox.lightning.force.com';
  const saUrl = `https://${saHost}/lightning/r/ServiceAppointment/${saId}/view`;

  log.log(`[buscarSA] navegando para ${saUrl}`);
  await page.goto(saUrl, {
    waitUntil: 'domcontentloaded',
    timeout: FSL_CONFIG.TIMEOUTS.NAVIGATION,
  });

  // ====================================================================
  // ETAPA 4 — validar que a SA correta foi carregada
  // ====================================================================
  try {
    await page.waitForSelector(`a[href*="${saId}"][href*="/view"]`, {
      state: 'visible',
      timeout: 15_000,
    });
    log.log('[buscarSA] ✅ SA carregada no DOM');
  } catch (e) {
    await takeScreenshot(page, STEP_NAME, 'sa-load-failed');
    throw new Error(
      `buscarSA: a SA ${saId} não carregou após o goto. ` +
      `URL atual=${page.url()}. Veja screenshot debug-buscarSA-sa-load-failed.png`
    );
  }

  const h1 = await page.locator('h1').first().innerText().catch(() => '');
  log.log(`[buscarSA] h1: "${h1}"`);

  if (!h1.includes(saQuery) && !h1.includes(input.sa)) {
    log.log(`[buscarSA] ⚠️ h1 não contém ${saQuery} — possível bug de tab focus`);
    log.log('[buscarSA] recarregando a página para forçar foco');
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.waitForSelector(`a[href*="${saId}"][href*="/view"]`, {
      state: 'visible',
      timeout: 15_000,
    });
  }

  await takeScreenshot(page, STEP_NAME, 'sa-details');
  log.log(`[buscarSA] SA aberta: ${saId} | URL: ${page.url()}`);

  ctx.saId = saId;
  ctx.steps = ctx.steps || [];
  ctx.steps.push({ step: STEP_NAME, sa: input.sa, status: 'ok', saId });
  return ctx;
}

module.exports = { step, name: STEP_NAME };