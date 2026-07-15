// core/fsl/steps/buscarSA.js
//
// Step 2/8 — Localizar a SA no Lightning.
//
// ESTRATÉGIA NEW PAGE (zero regressão):
//   - Login acontece no Service Console (page original do runner).
//   - Após obter o saId via SOQL, abrimos uma NOVA Page standalone
//     via ctx.context.newPage(), e navegamos para a SA nela.
//   - A nova page renderiza a SA FORA do Service Console: sem iframe
//     aninhado, sem sub-tab, sem frame invisível.
//   - ctx.page é atualizado para a nova page.
//   - A page original do Console é fechada.
//   - FALLBACK: page.goto na page original se new page falhar.

const STEP_NAME = 'buscarSA';
const SA_ID_RE = /\/lightning\/r\/(?:ServiceAppointment\/)?([a-zA-Z0-9]{15,18})/;

async function step(ctx) {
  const { makeLogger, takeScreenshot, waitForSAReady } = require('../utils');
  const FSL_CONFIG = require('../config');

  const log = makeLogger(STEP_NAME);
  const { page, input } = ctx;

  if (!input.sa) throw new Error('buscarSA: input.sa é obrigatório');

  const saDigits = String(input.sa).replace(/\D+/g, '');
  if (!saDigits) {
    throw new Error(`buscarSA: input.sa="${input.sa}" não parece um número de SA válido.`);
  }
  const saQuery = `SA-${saDigits}`;
  log.log(`buscando ${saQuery}`);

  // ETAPA 0 — atalho
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
      const body = await page.locator('body').innerText().catch(() => '');
      if (body.includes(saQuery) || body.includes(saDigits)) {
        log.log(`[buscarSA] ✅ atalho: já estamos na SA correta (${saIdOnPage})`);
        ctx.saId = saIdOnPage;
        try {
          await waitForSAReady(page, saQuery, {
            timeoutMs: 30_000,
            stepName: STEP_NAME,
            label: 'buscarSA-atalho',
          });
        } catch (e) {
          log.log(`[buscarSA] atalho OK, mas waitForSAReady falhou: ${e.message.slice(0, 200)}`);
        }
        ctx.steps = ctx.steps || [];
        ctx.steps.push({ step: STEP_NAME, sa: input.sa, status: 'ok', atalho: true, saId: saIdOnPage });
        return ctx;
      }
      log.log(`[buscarSA] atalho falhou: body não contém ${saQuery} — seguindo via REST`);
    } else {
      log.log(`[buscarSA] URL é sub-rota (TITLE="${titleNow}") — via REST resolve`);
    }
  }

  // ETAPA 1 — overlay auraLoadingBox
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

  // ETAPA 2 — recordId via SOQL
  log.log(`[buscarSA] consultando recordId via SOQL: ${saQuery}`);

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
  const sid = sidCookie.value;
  const sidDomain = sidCookie.domain.replace(/^\./, '');
  log.log(`[buscarSA] SID extraído (${sid.length} chars, dom="${sidDomain}")`);

  const soql = `SELECT Id FROM ServiceAppointment WHERE AppointmentNumber = '${saQuery}' LIMIT 1`;
  const apiUrl = `https://${sidDomain}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`;
  log.log(`[buscarSA] chamando ${apiUrl.slice(0, 100)}...`);

  const queryResult = await page.evaluate(
    async function ({ url, bearer }) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'omit',
          mode: 'cors',
          headers: {
            'Authorization': 'Bearer ' + bearer,
            'Accept': 'application/json',
          },
        });
        if (res.status === 401) return { error: 'Sessão inválida (HTTP 401). sid pode estar expirado.' };
        if (res.status === 403) return { error: 'Sem permissão de API (HTTP 403). Usuário precisa de "API Enabled".' };
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          return { error: 'HTTP ' + res.status + ': ' + body.slice(0, 200) };
        }
        const json = await res.json();
        if (!json.records || json.records.length === 0) {
          return { error: 'Nenhum ServiceAppointment com AppointmentNumber = ' + saQuery };
        }
        return { id: json.records[0].Id };
      } catch (e) {
        return { error: 'Exceção no fetch: ' + e.message };
      }
    },
    { url: apiUrl, bearer: sid }
  );

  if (queryResult.error) {
    await takeScreenshot(page, STEP_NAME, 'soql-failed');
    throw new Error(
      'buscarSA: falha na consulta SOQL — ' + queryResult.error + '. ' +
      'Veja screenshot debug-buscarSA-soql-failed.png'
    );
  }

  const saId = queryResult.id;
  log.log(`[buscarSA] ✅ recordId obtido: ${saId}`);

  // ETAPA 3 — abrir a SA em uma NOVA PAGE
  const hostMatch = currentUrl.match(/https?:\/\/([^\/]+)/);
  const saHost = hostMatch ? hostMatch[1] : sidDomain;
  const saUrl = `https://${saHost}/lightning/r/ServiceAppointment/${saId}/view`;
  log.log(`[buscarSA] URL alvo: ${saUrl}`);

  let saPage = null;

  if (ctx.context && typeof ctx.context.newPage === 'function') {
    try {
      log.log('[buscarSA] tentando abrir SA em nova page (fora do Service Console)');
      saPage = await ctx.context.newPage();
      saPage.setDefaultTimeout(FSL_CONFIG.TIMEOUTS.ACTION);
      saPage.setDefaultNavigationTimeout(FSL_CONFIG.TIMEOUTS.NAVIGATION);

      await saPage.goto(saUrl, {
        waitUntil: 'domcontentloaded',
        timeout: FSL_CONFIG.TIMEOUTS.NAVIGATION,
      });

      log.log(`[buscarSA] nova page aberta, URL atual: ${saPage.url()}`);

      const ready = await waitForSAReady(saPage, saQuery, {
        timeoutMs: 30_000,
        stepName: STEP_NAME,
        label: 'buscarSA-nova-page',
      });
      log.log(`[buscarSA] ✅ SA pronta na nova page | h1="${ready.h1}" | appt="${ready.appointmentNode}"`);

      const oldPage = ctx.page;
      ctx.page = saPage;
      try {
        if (oldPage && !oldPage.isClosed()) await oldPage.close();
        log.log('[buscarSA] page antiga do Service Console fechada');
      } catch (e) {
        log.log(`[buscarSA] ⚠️ erro ao fechar page antiga: ${e.message.slice(0, 100)}`);
      }

      await takeScreenshot(ctx.page, STEP_NAME, 'sa-details');
      log.log(`[buscarSA] SA aberta: ${saId} | URL: ${ctx.page.url()}`);

      ctx.saId = saId;
      ctx.steps = ctx.steps || [];
      ctx.steps.push({
        step: STEP_NAME, sa: input.sa, status: 'ok', saId,
        standalone: true,
      });
      return ctx;
    } catch (e) {
      log.log(`[buscarSA] ⚠️ falhou ao abrir em nova page: ${e.message.slice(0, 200)}`);
      log.log('[buscarSA] caindo no fallback (page.goto na page original)');
      try {
        if (saPage && !saPage.isClosed()) await saPage.close();
      } catch (_) { /* ignore */ }
      saPage = null;
    }
  } else {
    log.log('[buscarSA] ctx.context.newPage indisponível — usando page original');
  }

  // FALLBACK
  log.log(`[buscarSA] navegando para ${saUrl} (fallback, page original)`);
  await page.goto(saUrl, {
    waitUntil: 'domcontentloaded',
    timeout: FSL_CONFIG.TIMEOUTS.NAVIGATION,
  });

  try {
    const ready = await waitForSAReady(page, saQuery, {
      timeoutMs: 30_000,
      stepName: STEP_NAME,
      label: 'buscarSA-fallback',
    });
    log.log(`[buscarSA] ✅ SA pronta (fallback) | h1="${ready.h1}" | appt="${ready.appointmentNode}"`);
  } catch (e) {
    await takeScreenshot(page, STEP_NAME, 'sa-load-failed');
    throw new Error(
      'buscarSA: a SA ' + saId + ' (' + saQuery + ') não ficou pronta após o goto (fallback). ' +
      e.message
    );
  }

  await takeScreenshot(page, STEP_NAME, 'sa-details');
  log.log(`[buscarSA] SA aberta (fallback): ${saId} | URL: ${page.url()}`);

  ctx.saId = saId;
  ctx.steps = ctx.steps || [];
  ctx.steps.push({
    step: STEP_NAME, sa: input.sa, status: 'ok', saId,
    standalone: false,
  });
  return ctx;
}

module.exports = { step, name: STEP_NAME };