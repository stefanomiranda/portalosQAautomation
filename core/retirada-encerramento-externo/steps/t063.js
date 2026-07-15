// core/retirada-encerramento-externo/steps/t063.js
//
// Step "t063" — T063 (Retirar Equipamento / Encerramento Externo) — DO MANUAL.
//
// FLUXO (espelho do t017.js da Instalação, validado pelo manual + screenshots):
//   0) Worklist + Filtro por associatedDocument
//   1) Radio "Change State/Status" (value="changeState")
//   2) "..." da T063 → OSM abre "Task State/Status" (NÃO é menu)
//   3) Radio da linha "Assign To User" (value$="/assignOrder")
//   4) <select name="AssignToUser"> → selectOption(matricula)
//   5) Update do Assign
//   6) Reabrir Worklist + Filtro
//   7) Radio "Editor" (value="oe")
//   8) "..." da T063 → form abre
//   9) Validar cabeçalho "T063 - Retirar Equipamento"
//  10) DEBUG: dump do form (URL + selects + botões)
//  11) #completionStatusList → "Encerramento externo com sucesso"
//  12) ESPERAR o form re-renderizar
//  13) Preencher Pendência com "RETIRADA"  (vs. "INSTALACAO" do t017.js)
//  14) Preencher Matrícula do Técnico (TR101010)
//  15) #completeTaskButton → Update
//  16) Pós-Update: esperar página mudar
//
// FIX CRÍTICOS herdados do t017.js (a mesma técnica funciona aqui):
//   - selectOption nativo do Playwright (não `s.value = ...`)
//   - locator.fill() para Pendência e Matrícula (não `el.value = ...`)
//   - Validação ESTRITA: ler o valor de volta após o fill
//   - Aguardar AJAX do OSM (5s) antes do Update
//   - Detecção honesta de sucesso vs. erro no pós-Update

const { smartLocator, takeScreenshot, waitForCondition } = require('../../shared-som/utils');
const worklist = require('../../shared-som/worklistHelper');

const TASK_HEADER_REGEX = /T063\s*-\s*Retirar/i;
const TASK_NAME = 'T063 - Retirar Equipamento';

async function marcarRadioWorklist(page, value, onLog) {
  const log = (m) => onLog(`[t063] ${m}`);
  log(`marcando radio name="orderListOption" value="${value}"...`);

  const result = await page.evaluate((radioValue) => {
    const radios = Array.from(document.querySelectorAll('input.radio[name="orderListOption"]'));
    for (const r of radios) {
      if (r.value === radioValue) {
        r.click();
        r.checked = true;
        r.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: r.value, name: r.name, isChecked: r.checked };
      }
    }
    return { ok: false, allValues: radios.map(r => r.value) };
  }, value);

  if (result.ok) {
    log(`✓ radio marcado: value="${result.value}" checked=${result.isChecked}`);
  } else {
    log(`✗ radio "${value}" NÃO encontrado. Opções disponíveis: [${result.allValues.join(', ')}]`);
  }
  return result;
}


async function t063({ page, sa, associatedDocument, ordemId, jobId, matricula, onLog = () => {} }) {
  const log = (m) => onLog(`[t063] ${m}`);

  if (!sa) throw new Error('t063: `sa` obrigatório');
  if (!associatedDocument) throw new Error('t063: `associatedDocument` obrigatório (filtro da worklist)');

  const userMatricula = (matricula || 'vt419418').toUpperCase();
  const tecnicoMatricula = 'TR101010';

  // ════════════════════════════════════════════════════════════════════════
  // 0) WORKLIST + FILTRO
  // ════════════════════════════════════════════════════════════════════════
  log('0) abrindo Worklist + filtrando por associatedDocument...');
  await worklist.abrirWorklist(page, onLog);
  await worklist.buscarPorReference(page, associatedDocument, onLog);
  log(`✓ Worklist filtrada`);

  // ════════════════════════════════════════════════════════════════════════
  // 1) RADIO "Change State/Status"
  // ════════════════════════════════════════════════════════════════════════
  log('1) marcando radio "Change State/Status"...');
  const csResult = await marcarRadioWorklist(page, 'changeState', onLog);
  if (!csResult.ok) throw new Error('t063: radio "Change State/Status" não encontrado');
  await page.waitForTimeout(500).catch(() => null);

  // ════════════════════════════════════════════════════════════════════════
  // 2) LOCALIZAR "..." DA T063
  // ════════════════════════════════════════════════════════════════════════
  log('2) localizando botão "..." da T063...');
  const t063BtnHandle = await page.evaluateHandle(() => {
    const rows = Array.from(document.querySelectorAll('tr.context-menu-target'));
    for (const tr of rows) {
      const text = (tr.textContent || '').replace(/\s+/g, ' ').trim();
      if (/T063\s*-\s*Retirar/i.test(text)) {
        const firstTd = tr.querySelector('td');
        return firstTd ? firstTd.querySelector('input.tableAction[name="move"]') : null;
      }
    }
    return null;
  });
  const t063Btn = t063BtnHandle.asElement();
  if (!t063Btn) throw new Error('t063: botão "..." da T063 não encontrado');
  log('✓ botão "..." da T063 encontrado');

  // ════════════════════════════════════════════════════════════════════════
  // 3) CLICAR "..." → abre página "Task State/Status" (NÃO menu)
  // ════════════════════════════════════════════════════════════════════════
  log('3) clicando no "..." da T063...');
  const popupPromise = page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await t063BtnHandle.evaluate(el => el.click());
  const popup = await popupPromise;
  let assignPage = page;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => null);
    assignPage = popup;
  } else {
    await page.waitForLoadState('domcontentloaded').catch(() => null);
  }
  log(`DEBUG assignPage: url=${assignPage.url()}`);
  await takeScreenshot(assignPage, 't063__assign_page', 'state', onLog);

  log('3.5) esperando "Task State/Status" carregar...');
  await waitForCondition(
    assignPage,
    async (p) => {
      return await p.evaluate(() => {
        const body = document.body.textContent || '';
        return /Task\s+State\s*\/?\s*Status/i.test(body) ||
               !!document.querySelector('select[name="AssignToUser"]');
      });
    },
    { timeoutMs: 15000, pollMs: 300, label: 'página de assign' }
  ).catch(() => null);

  // ════════════════════════════════════════════════════════════════════════
  // 4) MARCAR RADIO "Assign To User" (via value, não texto)
  // ════════════════════════════════════════════════════════════════════════
  log('4) marcando radio "Assign To User" (value$="/assignOrder")...');
  const radioClicado = await assignPage.evaluate(() => {
    const radiosByValue = Array.from(document.querySelectorAll('input[type="radio"]'));
    for (const r of radiosByValue) {
      if (r.value && /\/assignOrder$/i.test(r.value)) {
        r.click();
        r.checked = true;
        r.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: r.value, name: r.name, by: 'value' };
      }
    }
    const trs = Array.from(document.querySelectorAll('tr'));
    for (const tr of trs) {
      const text = (tr.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^Assign\s+To\s+User$/i.test(text)) {
        const radio = tr.querySelector('input[type="radio"]');
        if (radio) {
          radio.click();
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, value: radio.value, name: radio.name, by: 'exact-text' };
        }
      }
    }
    return { ok: false, allRadios: radiosByValue.map(r => r.value).slice(0, 20) };
  });
  if (!radioClicado.ok) {
    await takeScreenshot(assignPage, 't063__assign_radio_nao_encontrado', 'state', onLog);
    throw new Error(`t063: radio "Assign To User" não encontrado (radios: ${radioClicado.allRadios.join(', ')})`);
  }
  log(`✓ radio Assign To User marcado: value="${radioClicado.value}" (by=${radioClicado.by})`);
  await assignPage.waitForTimeout(500).catch(() => null);

  // ════════════════════════════════════════════════════════════════════════
  // 5) SELECIONAR USUÁRIO
  // ════════════════════════════════════════════════════════════════════════
  log(`5) selecionando usuário "${userMatricula}"...`);
  const selectOk = await assignPage.evaluate((matricula) => {
    const sel = document.querySelector('select[name="AssignToUser"]');
    if (!sel) return { ok: false, reason: 'select[name="AssignToUser"] não encontrado' };
    for (const opt of sel.options) {
      if ((opt.value || '').toUpperCase() === matricula.toUpperCase() ||
          (opt.text || '').trim().toUpperCase() === matricula.toUpperCase()) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: sel.value, text: opt.text.trim() };
      }
    }
    return { ok: false, reason: `matrícula "${matricula}" não está nas options`, opcoes: Array.from(sel.options).slice(0, 10).map(o => o.value) };
  }, userMatricula);
  if (!selectOk.ok) {
    await takeScreenshot(assignPage, 't063__select_usuario_nao_encontrado', 'state', onLog);
    throw new Error(`t063: ${selectOk.reason}`);
  }
  log(`✓ usuário selecionado: value="${selectOk.value}" text="${selectOk.text}"`);

  // ════════════════════════════════════════════════════════════════════════
  // 6) UPDATE DO ASSIGN
  // ════════════════════════════════════════════════════════════════════════
  log('6) clicando Update do assign...');
  const updAssign = await smartLocator(assignPage, [
    { role: 'button', name: 'Update' },
    { css: 'input.button[value="Update" i]' },
    { css: 'input[value="Update" i]' },
  ], { timeout: 5000 });
  await updAssign.locator.first().click();
  log('✓ Update do assign clicado');
  await page.waitForLoadState('domcontentloaded').catch(() => null);
  await takeScreenshot(page, 't063__apos_update_assign', 'state', onLog);
  log('✓ T063 reatribuída');

  // ════════════════════════════════════════════════════════════════════════
  // 7) REABRIR WORKLIST + FILTRAR
  // ════════════════════════════════════════════════════════════════════════
  log('7) reabrindo Worklist + filtrando...');
  await worklist.abrirWorklist(page, onLog);
  await worklist.buscarPorReference(page, associatedDocument, onLog);
  log('✓ Worklist reaberta e filtrada');

  // ════════════════════════════════════════════════════════════════════════
  // 8) RADIO "Editor" (value="oe")
  // ════════════════════════════════════════════════════════════════════════
  log('8) marcando radio "Editor" (value="oe")...');
  let edResult = await marcarRadioWorklist(page, 'oe', onLog);
  if (!edResult.ok) edResult = await marcarRadioWorklist(page, 'editor', onLog);
  if (!edResult.ok) throw new Error('t063: radio "Editor" não encontrado');
  await page.waitForTimeout(500).catch(() => null);

  // ════════════════════════════════════════════════════════════════════════
  // 9) CLICAR "..." DA T063 (modo Editor) → form abre
  // ════════════════════════════════════════════════════════════════════════
  log('9) localizando botão "..." da T063 (modo Editor)...');
  const t063BtnHandle2 = await page.evaluateHandle(() => {
    const rows = Array.from(document.querySelectorAll('tr.context-menu-target'));
    for (const tr of rows) {
      const text = (tr.textContent || '').replace(/\s+/g, ' ').trim();
      if (/T063\s*-\s*Retirar/i.test(text)) {
        const firstTd = tr.querySelector('td');
        return firstTd ? firstTd.querySelector('input.tableAction[name="move"]') : null;
      }
    }
    return null;
  });
  const t063Btn2 = t063BtnHandle2.asElement();
  if (!t063Btn2) throw new Error('t063: botão "..." da T063 não encontrado (modo Editor)');

  log('10) clicando no "..." da T063 (modo Editor)...');
  const popupPromise2 = page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await t063BtnHandle2.evaluate(el => el.click());
  const popup2 = await popupPromise2;

  let editPage = page;
  if (popup2) {
    await popup2.waitForLoadState('domcontentloaded').catch(() => null);
    editPage = popup2;
  } else {
    await page.waitForLoadState('domcontentloaded').catch(() => null);
    await page.waitForTimeout(2000).catch(() => null);
  }

  if (!popup2) {
    const allPages = page.context().pages();
    log(`DEBUG: ${allPages.length} páginas abertas no context:`);
    for (let i = 0; i < allPages.length; i++) {
      log(`  [${i}] url=${allPages[i].url()}`);
    }
    if (allPages.length > 1) {
      const lastPage = allPages[allPages.length - 1];
      if (lastPage.url() !== page.url()) {
        editPage = lastPage;
        log(`→ usando página mais recente: ${editPage.url()}`);
      }
    }
  }

  log(`DEBUG editPage: url=${editPage.url()}`);
  await takeScreenshot(editPage, 't063__form_edicao_aberto', 'state', onLog);

  log('10.5) esperando #completionStatusList aparecer...');
  await waitForCondition(
    editPage,
    async (p) => {
      return await p.evaluate(() => !!document.querySelector('#completionStatusList'));
    },
    { timeoutMs: 15000, pollMs: 300, label: 'form da T063 carregar' }
  ).catch(() => null);

  // ════════════════════════════════════════════════════════════════════════
  // 11) VALIDAR CABEÇALHO
  // ════════════════════════════════════════════════════════════════════════
  log('11) confirmando cabeçalho "T063 - Retirar Equipamento"...');
  const t063Header = await editPage.evaluate(() => {
    const txt = (document.body.textContent || '').replace(/\s+/g, ' ').trim();
    const match = txt.match(/T0(\d{2})\s*[-–:]\s*([^\n\r]{3,80})/);
    return match ? { id: 'T0' + match[1], name: match[2].trim() } : null;
  });
  if (!t063Header) {
    await takeScreenshot(editPage, 't063__task_nao_aberta', 'state', onLog);
    throw new Error(`t063: cabeçalho "T0XX - ..." não encontrado (url=${editPage.url()})`);
  }
  if (t063Header.id !== 'T063') {
    throw new Error(`t063: abriu ${t063Header.id} (${t063Header.name}), esperava T063`);
  }
  log(`✓ T063 confirmada: "${t063Header.id} - ${t063Header.name}"`);

  // ════════════════════════════════════════════════════════════════════════
  // 12) DEBUG: dump do form
  // ════════════════════════════════════════════════════════════════════════
  log('12) DEBUG: dump do form (URL, selects, botões)...');
  const debugForm = await editPage.evaluate(() => {
    return {
      url: location.href,
      selects: Array.from(document.querySelectorAll('select')).map(s => ({
        id: s.id || '(sem id)',
        name: s.name,
        value: s.value,
        currentText: s.options[s.selectedIndex]?.text || '',
        options: Array.from(s.options).slice(0, 10).map(o => o.text.trim()),
      })),
      botoes: Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]')).map(b => ({
        tag: b.tagName,
        type: b.type,
        id: b.id || '(sem id)',
        text: (b.textContent || '').trim().substring(0, 30),
        value: b.value,
      })).slice(0, 15),
    };
  });
  log(`DEBUG form: url=${debugForm.url}`);
  log(`  ${debugForm.selects.length} selects:`);
  debugForm.selects.forEach(s => log(`    select#${s.id} name="${s.name}" value="${s.value}" currentText="${s.currentText}" options=[${s.options.join(' | ')}]`));
  log(`  ${debugForm.botoes.length} botões:`);
  debugForm.botoes.forEach(b => log(`    ${b.tag}[type=${b.type}] id="${b.id}" value="${b.value}" text="${b.text}"`));
  await takeScreenshot(editPage, 't063__apos_form_aberto', 'state', onLog);

  // ════════════════════════════════════════════════════════════════════════
  // 13) DROPDOWN STATUS — selectOption nativo do Playwright
  // ════════════════════════════════════════════════════════════════════════
  log('13) selecionando status "Encerramento externo com sucesso" via selectOption nativo...');
  const statusSelect = editPage.locator('#completionStatusList').first();
  await statusSelect.waitFor({ state: 'visible', timeout: 5000 });
  await statusSelect.selectOption({ label: 'Encerramento externo com sucesso' });
  await statusSelect.dispatchEvent('blur').catch(() => null);
  log('✓ status selecionado via selectOption');

  // ════════════════════════════════════════════════════════════════════════
  // 13.5) ESPERAR O AJAX DO OSM PROCESSAR A MUDANÇA
  // ════════════════════════════════════════════════════════════════════════
  log('13.5) aguardando AJAX do OSM processar a mudança de status (5s)...');
  await editPage.waitForTimeout(5000).catch(() => null);

  // Re-validar que o status foi aceito pelo OSM
  const statusValidado = await editPage.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('#completionStatusList'));
    return selects.map(s => ({
      value: s.value,
      text: s.options[s.selectedIndex]?.text || '',
      visible: !!(s.offsetWidth || s.offsetHeight),
    }));
  });
  log(`DEBUG status após AJAX: ${JSON.stringify(statusValidado)}`);

  const statusOk = statusValidado.some(
    s => s.visible && (s.value === '10224' || /Encerramento\s+externo\s+com\s+sucesso/i.test(s.text))
  );
  if (!statusOk) {
    await takeScreenshot(editPage, 't063__status_nao_aceito', 'state', onLog);
    throw new Error(`t063: status não foi aceito pelo OSM (status: ${JSON.stringify(statusValidado)})`);
  }
  log(`✓ status aceito pelo OSM`);

  // ════════════════════════════════════════════════════════════════════════
  // 14) PENDÊNCIA — "RETIRADA" (vs. "INSTALACAO" do t017.js da Instalação)
  // ════════════════════════════════════════════════════════════════════════
  log('14) preenchendo Pendência via Playwright (find+click+fill+Tab)...');
  await editPage.waitForTimeout(2000).catch(() => null);

  const pendSelector = await editPage.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('td, th, label, span, div, font'));
    for (const c of cells) {
      const t = (c.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (/^Pend[êe]ncia[\s*:.]*$/i.test(t) && t.length < 50) {
        const tr = c.closest('tr');
        if (tr) {
          const field = tr.querySelector(
            'input:not([type="hidden"]):not([readonly]):not([disabled]), ' +
            'select:not([readonly]):not([disabled]), ' +
            'textarea:not([readonly]):not([disabled])'
          );
          if (field) {
            if (field.id) return `#${CSS.escape(field.id)}`;
            if (field.name) return `${field.tagName.toLowerCase()}[name="${field.name}"]`;
          }
        }
      }
    }
    return null;
  });

  if (pendSelector) {
    try {
      const pendLoc = editPage.locator(pendSelector).first();
      await pendLoc.waitFor({ state: 'visible', timeout: 5000 });
      await pendLoc.click();
      await pendLoc.fill('');
      await pendLoc.fill('RETIRADA');
      await pendLoc.press('Tab');
      const pendFinal = await pendLoc.inputValue();
      if (pendFinal === 'RETIRADA') {
        log(`✓ Pendência preenchida via Playwright (seletor: ${pendSelector})`);
      } else {
        log(`⚠ Pendência: valor lido de volta é "${pendFinal}" (esperado "RETIRADA")`);
      }
    } catch (e) {
      log(`⚠ Pendência: erro ao preencher via Playwright (${e.message})`);
    }
  } else {
    log('⚠ Pendência: seletor não encontrado (label ausente ou input não está na TR)');
  }
  await takeScreenshot(editPage, 't063__apos_pendencia', 'state', onLog);

  // ════════════════════════════════════════════════════════════════════════
  // 15) MATRÍCULA DO TÉCNICO
  // ════════════════════════════════════════════════════════════════════════
  log('15) preenchendo Matrícula do Técnico via Playwright (vcard_name=18266)...');
  const tecnicoSel = 'input[vcard_name="vCard.textNode.18266"]';
  const tecnicoLoc = editPage.locator(tecnicoSel).first();
  let matOk = false;
  try {
    await tecnicoLoc.waitFor({ state: 'visible', timeout: 5000 });
    await tecnicoLoc.click();
    await tecnicoLoc.fill('');
    await tecnicoLoc.fill(tecnicoMatricula);
    await tecnicoLoc.press('Tab');
    const matFinal = await tecnicoLoc.inputValue();
    if (matFinal === tecnicoMatricula) {
      log(`✓ Matrícula preenchida via Playwright (lido de volta: "${matFinal}")`);
      matOk = true;
    } else {
      log(`⚠ Matrícula: valor lido de volta é "${matFinal}" (esperado "${tecnicoMatricula}")`);
    }
  } catch (e) {
    log(`⚠ Matrícula: erro ao preencher via Playwright (${e.message})`);
  }
  await takeScreenshot(editPage, 't063__apos_matricula', 'state', onLog);

  if (!matOk) {
    throw new Error(`t063: Matrícula do Técnico não foi persistida pelo OSM (valor esperado: ${tecnicoMatricula})`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // 16) UPDATE — clicar #completeTaskButton (com validação honesta)
  // ════════════════════════════════════════════════════════════════════════
  log('16) clicando Update (#completeTaskButton)...');
  const updateBtn = editPage.locator('#completeTaskButton').first();
  await updateBtn.waitFor({ state: 'visible', timeout: 5000 });
  await updateBtn.click();
  log('✓ Update clicado');

  // ════════════════════════════════════════════════════════════════════════
  // 17) PÓS-UPDATE — detecção HONESTA de sucesso vs. erro
  // ════════════════════════════════════════════════════════════════════════
  log('17) aguardando pós-Update (2s para OSM processar)...');
  await editPage.waitForTimeout(2000).catch(() => null);

  const postResult = await editPage.evaluate(() => {
    const stillInForm = !!document.querySelector('#completeTaskButton');
    const stillInOrderList = /orderListMenu/.test(location.href);
    const errorElements = Array.from(document.querySelectorAll('font[color*="red"], span[style*="red"], .error, [class*="error"], [class*="Error"]'))
      .map(el => (el.textContent || '').trim())
      .filter(t => t && t.length > 3 && t.length < 300);
    const bodyText = document.body.textContent || '';
    const errorMatches = bodyText.match(/(Erro\s*:|Campo\s+obrigat[óo]rio|Invalid\s+\w+|Message\s+Code\s*:\s*\d+)[^\n]{0,200}/gi) || [];
    return {
      stillInForm,
      stillInOrderList,
      url: location.href,
      errorElements,
      errorMatches: errorMatches.slice(0, 5),
    };
  });
  log(`DEBUG pós-Update: ${JSON.stringify(postResult)}`);
  await takeScreenshot(editPage, 't063__concluida', 'state', onLog);

  if (postResult.stillInForm && !postResult.stillInOrderList) {
    const errTxt = [
      ...postResult.errorElements,
      ...postResult.errorMatches,
    ].filter(Boolean).join(' | ');
    throw new Error(`t063: Update rejeitado pelo OSM (form ainda aberto)${errTxt ? ` — erros: ${errTxt}` : ''}`);
  }
  if (postResult.errorMatches.length > 0) {
    throw new Error(`t063: Update pode ter sido rejeitado — erros detectados: ${postResult.errorMatches.join(' | ')}`);
  }

  log(`T063 concluída — SA=${sa}`);
  return { status: 'completed' };
}


module.exports = t063;
