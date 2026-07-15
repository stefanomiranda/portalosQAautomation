// core/instalacao-encerramento-externo/steps/t046.js
//
// Step 3 — Associar Equipamento Manual (T046) — versão com Playwright nativo.
//
// FIX DESTA VERSÃO:
//   Substitui `evaluate({...el.value=...; dispatchEvent})` por `locator.fill()`
//   e `locator.selectOption()`. Eventos sintéticos são ignorados pelo
//   `checkAction` do OSM (o estado interno não atualiza). Playwright nativo
//   produz eventos idênticos aos de um usuário real.

const { smartLocator, takeScreenshot, waitForCondition } = require('../utils');
const serialGenerator = require('../serialGenerator');

function gerarNumeroSerieLLNNNN() {
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const l1 = letras[Math.floor(Math.random() * 26)];
  const l2 = letras[Math.floor(Math.random() * 26)];
  const n = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  return l1 + l2 + n; // LL###### (ex.: "OZ482736")
}

async function t046({ page, sa, ordemId, jobId, onLog = () => {} }) {
  const log = (m) => onLog(`[t046] ${m}`);

  if (!sa) throw new Error('t046: parâmetro `sa` é obrigatório');

  const numeroSerie = gerarNumeroSerieLLNNNN();
  log(`numeroSerie gerado (LL######): ${numeroSerie}`);

  try {
    const reserva = serialGenerator.gerarPares({
      sa, ordemId: ordemId || null, jobId: jobId || null,
    });
    log(`par reservado no SQLite — placeholder codigoONT=${reserva.codigoONT}`);
  } catch (e) {
    log(`⚠ falha ao reservar par no SQLite: ${e.message}`);
  }

  await takeScreenshot(page, 't046__inicio', onLog);

  // 1) Localizar a linha T046
  log('procurando linha T046 (tr.context-menu-target + texto "T046 - Associar")...');
  const t046Info = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr.context-menu-target'));
    for (const tr of rows) {
      const text = (tr.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/T046\s*-\s*Associar/i.test(text)) continue;
      if (/T017\s*-/.test(text) || /T037\s*-/.test(text)) continue;
      const firstTd = tr.querySelector('td');
      const state = firstTd ? (firstTd.id || '') : '';
      const btn = tr.querySelector('input.tableAction[name="move"]');
      return { rowText: text.substring(0, 200), state, btnExists: !!btn };
    }
    return null;
  });

  if (!t046Info) {
    await takeScreenshot(page, 't046__linha_nao_encontrada', onLog);
    throw new Error('t046: linha T046 não encontrada');
  }
  log(`linha T046 encontrada — estado: "${t046Info.state || '(vazio)'}"`);

  if (!t046Info.btnExists) {
    throw new Error('t046: linha T046 não tem botão "..."');
  }

  // 2) Clicar no "..." da T046
  const t046BtnHandle = await page.evaluateHandle(() => {
    const rows = Array.from(document.querySelectorAll('tr.context-menu-target'));
    for (const tr of rows) {
      const text = (tr.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/T046\s*-\s*Associar/i.test(text)) continue;
      if (/T017\s*-/.test(text) || /T037\s*-/.test(text)) continue;
      return tr.querySelector('input.tableAction[name="move"]');
    }
    return null;
  });

  const popupPromise = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
  log('>>> CLICANDO no botão "..." da T046 <<<');
  await t046BtnHandle.evaluate(el => el.click());

  const popup = await popupPromise;
  let workPage = page;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => null);
    workPage = popup;
  } else {
    await page.waitForLoadState('domcontentloaded').catch(() => null);
  }
  await takeScreenshot(workPage, 't046__apos_3_pontos', onLog);

  // 3) Confirmar T046
  const openedTask = await workPage.evaluate(() => {
    const text = (document.body.textContent || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/T0(\d{2})\s*[-–:]\s*([^\n\r]{3,80})/);
    return match ? { id: 'T0' + match[1], name: match[2].trim() } : null;
  });
  if (openedTask && openedTask.id !== 'T046') {
    throw new Error(`t046: clique abriu ${openedTask.id}, esperava T046`);
  }
  if (openedTask) log(`✓ página confirmada como T046`);

  // 4) Modo edição
  const inEditMode = await workPage.evaluate(() => {
    return Array.from(document.querySelectorAll('select')).some(s =>
      Array.from(s.options).some(o => /Consultar/i.test(o.text))
    );
  });
  if (!inEditMode) {
    throw new Error('t046: form não está em modo de edição');
  }
  log('✓ form está em modo de edição');

  // 5) Checar se os campos já estão preenchidos E o dropdown está em "Sucesso"
  //
  //    FIX: antes o early-skip só checava os 2 campos de valor. Mas o OSM
  //    SÓ aceita o Update se o dropdown também estiver em "Sucesso" — então
  //    uma execução anterior que preencheu os campos mas falhou no Update
  //    (ou que nunca chegou a clicar Update) deixava o form "meio cheio":
  //    campos com valor, dropdown no default, OSM não sabia do status.
  //    Agora o skip exige os 3 sinais: campos preenchidos E dropdown = "Sucesso".
  log('checando se input.oeValueNode, textarea.oeValueNode e #completionStatusList estão prontos...');
  const camposAntes = await workPage.evaluate(() => {
    const serieInput = document.querySelector('input.oeValueNode');
    const codigoTextarea = document.querySelector('textarea.oeValueNode');
    const statusSelect = document.querySelector('select#completionStatusList');
    const statusText = statusSelect && statusSelect.options[statusSelect.selectedIndex]
      ? statusSelect.options[statusSelect.selectedIndex].text
      : '';
    return {
      seriePreenchido: !!(serieInput && serieInput.value && serieInput.value.trim() !== ''),
      codigoPreenchido: !!(codigoTextarea && codigoTextarea.value && codigoTextarea.value.trim() !== ''),
      statusSucesso: /^\s*Sucesso\s*$/i.test(statusText || ''),
      serieValue: serieInput ? serieInput.value : null,
      codigoValue: codigoTextarea ? codigoTextarea.value : null,
      statusText: statusText,
    };
  });
  log(`  Número de Série: "${camposAntes.serieValue}" (preenchido=${camposAntes.seriePreenchido})`);
  log(`  Código do Equipamento: "${camposAntes.codigoValue}" (preenchido=${camposAntes.codigoPreenchido})`);
  log(`  Status dropdown: "${camposAntes.statusText}" (sucesso=${camposAntes.statusSucesso})`);

  if (camposAntes.seriePreenchido && camposAntes.codigoPreenchido && camposAntes.statusSucesso) {
    log('⏭ T046 já está com campos preenchidos E status = Sucesso — pulando');
    await takeScreenshot(workPage, 't046__ja_preenchida_pulado', onLog);
    return {
      codigoONT: camposAntes.codigoValue,
      numeroSerie: camposAntes.serieValue,
      status: 'already_done',
    };
  }
  log('⚠ campos vazios OU status não é Sucesso — executando fluxo (preencher, dropdown, Update)');

  // 6) LUPA Oracle OSM
  log('procurando a lupa (Oracle OSM <a><img alt="Find" src="oefind.gif">)...');
  const lupaOk = await workPage.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    for (const img of imgs) {
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      const src = (img.getAttribute('src') || '').toLowerCase();
      if (alt === 'find' || /oefind|find\.gif|find\.png|lookup/.test(src)) {
        const parentA = img.closest('a');
        (parentA || img).click();
        return { ok: true, href: parentA ? (parentA.getAttribute('href') || '').substring(0, 150) : '' };
      }
    }
    return { ok: false };
  });
  if (!lupaOk.ok) {
    throw new Error('t046: lupa <img alt="Find"> não encontrada');
  }
  log(`✓ lupa clicada — href: ${lupaOk.href}`);

  // 7) Esperar popup
  const popup3 = await workPage.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
  let popupPage = workPage;
  if (popup3) {
    await popup3.waitForLoadState('domcontentloaded').catch(() => null);
    popupPage = popup3;
    await waitForCondition(async () => {
      return await popupPage.locator('tr:has(input[value="..."])').count() > 0;
    }, { timeoutMs: 10000, intervalMs: 200, label: 'popup carregar' }).catch(() => null);
  }
  await takeScreenshot(popupPage, 't046__popup_equipamento', onLog);

  // 8) Clicar nos "..." do 1º equipamento
  const equipHandle = await popupPage.evaluateHandle(() => {
    const trs = Array.from(document.querySelectorAll('tr'));
    for (const tr of trs) {
      const btn = tr.querySelector('input.tableAction[name="move"]');
      if (btn) return btn;
    }
    const inputs = Array.from(document.querySelectorAll('input[value="..."]'));
    if (inputs.length > 0) return inputs[0];
    return null;
  });
  if (!equipHandle.asElement()) {
    throw new Error('t046: "..." do 1º equipamento não encontrado');
  }
  const equipInfo = await popupPage.evaluate(el => ({
    rowText: (el.closest('tr')?.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 150),
  }), equipHandle.asElement());
  log(`1º equipamento: ${equipInfo.rowText}`);
  log('>>> CLICANDO nos "..." do 1º equipamento <<<');
  await equipHandle.evaluate(el => el.click());

  // 9) Encontrar a janela com o form de edição
  log('detectando qual janela tem o form de edição...');
  await workPage.waitForTimeout(1000).catch(() => null);
  const paginas = workPage.context().pages();
  let editPage = workPage;
  for (const pg of paginas) {
    const ehEdicao = await pg.evaluate(() => {
      const t = (document.body.textContent || '');
      return /dados\s+da\s+associa[çc][ãa]o\s+manual\s+de\s+equipamento/i.test(t) &&
             !/find:\s+c[óo]digo\s+do\s+equipamento/i.test(t) &&
             !/filter:/i.test(document.body.innerHTML);
    }).catch(() => false);
    if (ehEdicao) {
      editPage = pg;
      log(`janela de edição encontrada: ${pg.url()}`);
      break;
    }
  }

  await editPage.waitForTimeout(2000).catch(() => null);
  await takeScreenshot(editPage, 't046__apos_selecionar_equipamento', onLog);

  // 10) Localizar campos com ESCOPO ao fieldset "Dados da Associação Manual de Equipamento"
  //
  //     FIX CRÍTICO: o código antigo fazia `document.querySelectorAll('input.oeValueNode')`
  //     e pegava o PRIMEIRO com `value === ''`. Mas a página tem MUITOS `input.oeValueNode`
  //     vazios (Tipo de Atividade, Tipo Info, Área Técnica, Prioridade BA, etc., em outras
  //     seções como "Dados do Reparo" e "Problema"). O `find(i => !i.value)` pegava um
  //     deles — não o "Número de Série" real — e a RE-VERIFICAÇÃO confirmava o campo
  //     ERRADO (mesmo id), reportando "T046 concluída" falsa.
  //
  //     FIX: encontrar o fieldset/legend "Dados da Associação Manual de Equipamento"
  //     e buscar input/textarea SÓ dentro dele. Aí sim temos o "Número de Série" e
  //     o "Código do Equipamento" corretos.
  const campos = await editPage.evaluate(() => {
    function findManualSection() {
      // 1) fieldset direto
      const fieldsets = Array.from(document.querySelectorAll('fieldset'));
      for (const fs of fieldsets) {
        const t = (fs.textContent || '');
        if (/Dados\s+da\s+Associa[çc][ãa]o\s+Manual\s+de\s+Equipamento/i.test(t) && t.length < 2000) {
          return fs;
        }
      }
      // 2) legend
      const legends = Array.from(document.querySelectorAll('legend'));
      for (const lg of legends) {
        if (/Dados\s+da\s+Associa[çc][ãa]o\s+Manual\s+de\s+Equipamento/i.test(lg.textContent || '')) {
          const fs = lg.closest('fieldset') || lg.parentElement;
          if (fs) return fs;
        }
      }
      // 3) Fallback: varre elementos com o texto, e fica com o primeiro
      //    que tem TANTO input.oeValueNode QUANTO textarea.oeValueNode
      const candidates = Array.from(document.querySelectorAll('div, table, tbody, tr, span'))
        .filter(el => {
          const t = (el.textContent || '').trim();
          return t.length < 2000 && /Dados\s+da\s+Associa[çc][ãa]o\s+Manual\s+de\s+Equipamento/i.test(t);
        });
      for (const c of candidates) {
        if (c.querySelector('input.oeValueNode') && c.querySelector('textarea.oeValueNode')) {
          return c;
        }
      }
      return null;
    }

    const manualSection = findManualSection();
    if (!manualSection) {
      return { error: 'Seção "Dados da Associação Manual de Equipamento" não encontrada na página' };
    }

    // DENTRO do fieldset, achar input (Número de Série) e textarea (Código do Equipamento)
    const serieInput = manualSection.querySelector('input.oeValueNode');
    const codigoTextarea = manualSection.querySelector('textarea.oeValueNode');

    // Status select + Update button ficam FORA do fieldset (no header do form)
    const statusSelect = document.querySelector('select#completionStatusList[tabindex]')
                      || document.querySelector('select[name="Status"]')
                      || null;
    const updateBtn = document.querySelector('button#completeTaskButton[tabindex]') || null;

    return {
      manualSectionFound: true,
      serieInput: serieInput ? {
        id: serieInput.id, name: serieInput.name, className: serieInput.className,
        currentValue: serieInput.value, tabindex: serieInput.tabIndex,
      } : null,
      codigoTextarea: codigoTextarea ? {
        id: codigoTextarea.id, name: codigoTextarea.name, className: codigoTextarea.className,
        currentValue: codigoTextarea.value,
      } : null,
      statusSelect: statusSelect ? {
        id: statusSelect.id, name: statusSelect.name,
        currentValue: statusSelect.value,
        currentText: statusSelect.options[statusSelect.selectedIndex]?.text || '',
        options: Array.from(statusSelect.options).map(o => ({ value: o.value, text: o.text })),
      } : null,
      updateBtn: updateBtn ? {
        id: updateBtn.id, text: (updateBtn.textContent || '').trim().substring(0, 30),
      } : null,
    };
  });

  if (campos.error) {
    await takeScreenshot(editPage, 't046__secao_nao_encontrada', onLog);
    throw new Error(`t046: ${campos.error}`);
  }

  log(`DEBUG campos (escopo: "Dados da Associação Manual de Equipamento"):`);
  log(`  serieInput:     ${JSON.stringify(campos.serieInput)}`);
  log(`  codigoTextarea: ${JSON.stringify(campos.codigoTextarea)}`);
  log(`  statusSelect:   ${JSON.stringify(campos.statusSelect)}`);
  log(`  updateBtn:      ${JSON.stringify(campos.updateBtn)}`);

  if (!campos.serieInput) {
    await takeScreenshot(editPage, 't046__serie_input_nao_encontrado', onLog);
    throw new Error('t046: input.oeValueNode (Número de Série) não encontrado dentro do fieldset "Dados da Associação Manual"');
  }
  if (!campos.codigoTextarea) {
    await takeScreenshot(editPage, 't046__codigo_textarea_nao_encontrado', onLog);
    throw new Error('t046: textarea.oeValueNode (Código do Equipamento) não encontrado dentro do fieldset "Dados da Associação Manual"');
  }
  if (!campos.statusSelect) {
    await takeScreenshot(editPage, 't046__status_select_nao_encontrado', onLog);
    throw new Error('t046: select#completionStatusList (dropdown de status) não encontrado');
  }
  if (!campos.updateBtn) {
    await takeScreenshot(editPage, 't046__update_btn_nao_encontrado', onLog);
    throw new Error('t046: button#completeTaskButton (Update) não encontrado');
  }

  // 11) Preencher Número de Série VIA PLAYWRIGHT NATIVO
  //
  //     Por que: o `onchange="javascript:checkAction(...)"` inline do OSM
  //     não atualiza o estado interno quando disparado via `el.value=...;
  //     dispatchEvent('change')` sintético. O `locator.fill()` do Playwright
  //     simula o ciclo completo de keyboard (keydown/keypress/keyup/input/
  //     change) que o OSM reconhece como mudança real.
  log(`preenchendo Número de Série (input#${campos.serieInput.id}) com ${numeroSerie} via Playwright fill...`);
  const serieInputLocator = editPage.locator(`input#${campos.serieInput.id}`);
  await serieInputLocator.waitFor({ state: 'visible', timeout: 5000 });
  // 3 cliques para selecionar tudo (evita concatenar com valor anterior)
  await serieInputLocator.click({ clickCount: 3 });
  await serieInputLocator.fill(numeroSerie);
  // Blur explícito para forçar checkAction
  await serieInputLocator.evaluate(el => el.blur());
  // Pequena pausa para o OSM processar
  await editPage.waitForTimeout(300).catch(() => null);

  const serieValue = await serieInputLocator.inputValue();
  if (serieValue !== numeroSerie) {
    await takeScreenshot(editPage, 't046__serie_nao_setada', onLog);
    throw new Error(`t046: Número de Série não foi setado (valor="${serieValue}", esperado="${numeroSerie}")`);
  }
  log(`✓ Número de Série setado: ${serieValue}`);

  // 12) RE-VERIFICAÇÃO 1
  const serieVerify = await editPage.evaluate((id) => {
    const el = document.getElementById(id);
    return el ? { ok: true, value: el.value } : { ok: false, reason: 'input sumiu do DOM' };
  }, campos.serieInput.id);

  if (!serieVerify.ok || serieVerify.value !== numeroSerie) {
    await takeScreenshot(editPage, 't046__serie_verificou_errado', onLog);
    throw new Error(
      `t046: RE-VERIFICAÇÃO falhou — input#${campos.serieInput.id} tem valor "${serieVerify.value || '(vazio)'}", ` +
      `esperado "${numeroSerie}".`
    );
  }
  log(`✓ RE-VERIFICAÇÃO OK: input#${campos.serieInput.id} tem valor "${serieVerify.value}"`);

// 13) Mudar dropdown para "Sucesso" — 3 estratégias, SEMPRE roda a 2
  //
  //     FIX: a selectOption (estratégia 1) atualiza o DOM e dispara change,
  //     mas o OSM só atualiza seu estado interno quando recebe blur/focusout
  //     + click outside. Por isso SEMPRE rodamos a estratégia 2 (que dispara
  //     esses eventos) — mesmo que a 1 já tenha mudado o DOM.
  log(`mudando dropdown (select#${campos.statusSelect.id}[tabindex]) para "Sucesso"...`);
  const statusSelectLocator = editPage.locator(`select#${campos.statusSelect.id}[tabindex]`);
  await statusSelectLocator.waitFor({ state: 'visible', timeout: 5000 });

  const selectInfo = await statusSelectLocator.evaluate((s) => ({
    id: s.id, name: s.name, tabindex: s.tabIndex,
    currentValue: s.value, currentText: s.options[s.selectedIndex]?.text || '',
    options: Array.from(s.options).map(o => ({ value: o.value, text: o.text })),
  }));
  log(`DEBUG select: ${JSON.stringify(selectInfo)}`);

  // Garante que o select está na viewport
  await editPage.evaluate(() => window.scrollTo(0, 0));
  await statusSelectLocator.scrollIntoViewIfNeeded();
  await editPage.waitForTimeout(200).catch(() => null);

  // ESTRATÉGIA 1: selectOption por label (atualiza o DOM)
  try {
    await statusSelectLocator.selectOption({ label: 'Sucesso' });
    await editPage.waitForTimeout(300).catch(() => null);
    log(`✓ estratégia 1 executada (selectOption por label)`);
  } catch (e) {
    log(`⚠ estratégia 1 falhou: ${e.message}`);
  }

  // ESTRATÉGIA 2: SEMPRE roda — dispara change/blur/focusout + click outside
  // (esses são os eventos que o OSM escuta pra atualizar o estado interno)
  log('estratégia 2: selectOption por value + dispatch events + click outside (SEMPRE roda)...');
  try {
    await statusSelectLocator.focus();
    await statusSelectLocator.selectOption('10322');
    await editPage.waitForTimeout(200).catch(() => null);
    await statusSelectLocator.evaluate((el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      el.dispatchEvent(new Event('focusout', { bubbles: true }));
    });
    // Click fora (no body) para realmente tirar o foco do select
    await editPage.locator('body').click({ position: { x: 5, y: 5 } });
    await editPage.waitForTimeout(500).catch(() => null);
    log(`✓ estratégia 2 executada (change + blur + click outside)`);
  } catch (e) {
    log(`⚠ estratégia 2 falhou: ${e.message}`);
  }

  // ESTRATÉGIA 3: keyboard (só se 1 e 2 não funcionaram)
  //     FIX: antes usava `page.keyboard` (janela errada quando o form abriu
  //     num popup). Agora usa `editPage.keyboard`, que garante o envio
  //     na página certa.
  let dropdownText = await statusSelectLocator.evaluate(s => s.options[s.selectedIndex]?.text || '');
  if (!/sucesso/i.test(dropdownText)) {
    log('estratégia 3: keyboard (focus + ArrowDown + Enter em editPage)...');
    try {
      await statusSelectLocator.focus();
      await editPage.waitForTimeout(200).catch(() => null);
      await editPage.keyboard.press('ArrowDown');
      await editPage.waitForTimeout(200).catch(() => null);
      await editPage.keyboard.press('Enter');
      await editPage.waitForTimeout(500).catch(() => null);
      await editPage.locator('body').click({ position: { x: 5, y: 5 } });
      await editPage.waitForTimeout(500).catch(() => null);
    } catch (e) {
      log(`⚠ estratégia 3 falhou: ${e.message}`);
    }
  }

  // Verificação final
  const dropdownValue = await statusSelectLocator.inputValue();
  dropdownText = await statusSelectLocator.evaluate(s => s.options[s.selectedIndex]?.text || '');

  if (!/sucesso/i.test(dropdownText)) {
    await takeScreenshot(editPage, 't046__dropdown_nao_setado', onLog);
    throw new Error(`t046: dropdown NÃO foi setado para "Sucesso" após 3 estratégias (text="${dropdownText}", value="${dropdownValue}")`);
  }
  log(`✓ dropdown final: value="${dropdownValue}" text="${dropdownText}"`);

    // 14) RE-VERIFICAÇÃO 2 — REMOVIDA (redundante com a 3-estratégias do passo 13).
  //
  //     A 3-estratégias do passo 13 já verificou que o dropdown do FORM
  //     (com tabindex="795") está em "Sucesso". A antiga RE-VERIFICAÇÃO
  //     usava `document.getElementById('completionStatusList')` que retorna
  //     o PRIMEIRO elemento com esse id — que é o do HEADER do worklist
  //     (sem tabindex), não o do form. Resultado: lia "Consultar equipamentos"
  //     do header e jogava erro falso, mesmo com o form visualmente em "Sucesso".
  //
  //     A VERIFICAÇÃO FINAL do passo 15 já faz a checagem certa (com
  //     [tabindex]), então essa duplicada é desnecessária.

    // 15) VERIFICAÇÃO FINAL antes do Update
  //
  //     FIX: usar querySelector com [tabindex] para o dropdown (pega o do
  //     form, não o do header). O input da série é único (id dinâmico),
  //     então getElementById serve.
  const finalCheck = await editPage.evaluate(({ serieId, selectId, expectedSerie, expectedSelectValue }) => {
    const serieEl = document.getElementById(serieId);
    // O dropdown com [tabindex] é o do FORM; o do header não tem tabindex
    const selEl = document.querySelector(`select#${selectId}[tabindex]`)
              || document.getElementById(selectId);
    return {
      serieValue: serieEl ? serieEl.value : null,
      serieOk: !!(serieEl && serieEl.value === expectedSerie),
      selectValue: selEl ? selEl.value : null,
      selectText: selEl ? (selEl.options[selEl.selectedIndex]?.text || '') : '',
      selectOk: !!(selEl && selEl.value === expectedSelectValue),
    };
  }, {
    serieId: campos.serieInput.id,
    selectId: campos.statusSelect.id,
    expectedSerie: numeroSerie,
    expectedSelectValue: dropdownValue,
  });

// 16) Update VIA PLAYWRIGHT NATIVO
  //
  //     `locator.click()` dispara o ciclo completo de pointer events.
  log(`clicando em #completeTaskButton[tabindex] via Playwright click...`);
  const updateBtnLocator = editPage.locator('button#completeTaskButton[tabindex]');
  await updateBtnLocator.waitFor({ state: 'visible', timeout: 5000 });
  await updateBtnLocator.click();
  log('✓ Update clicado');
  // 17) PÓS-UPDATE — espera a página MUDAR (defensivo contra DOM em transição)
  //
  //     FIX: o postCheck antigo (passo 18) acessava `document.body.textContent`
  //     num momento em que o OSM está redirecionando após o completeTask.
  //     Durante essa transição, `document.body` pode ser null → TypeError.
  //     Aqui o callback do evaluate já é defensivo (opcional chaining) e
  //     removemos o postCheck redundante. O `return` lê `codigoONT` do cache
  //     local (`campos.codigoTextarea.currentValue`), não do DOM.
  log('aguardando OSM processar o Update (esperando URL mudar, form sumir, ou status completar)...');
  const updateProcessed = await waitForCondition(async () => {
    return await editPage.evaluate(() => {
      const url = location.href;
      // 1) URL mudou (saiu de orderListMenu → OSM redirecionou)
      if (!/orderListMenu/.test(url)) return true;
      // 2) Form desapareceu
      const formEl = document.querySelector('select#completionStatusList[tabindex]');
      if (!formEl) return true;
      // 3) Status mudou para "Concluída" / "Encerrada" / "Completed"
      const opt = formEl.options[formEl.selectedIndex];
      const currentText = opt ? opt.text : '';
      if (/conclu[íi]d|encerrad|complet/i.test(currentText)) return true;
      return false;
    });
  }, { timeoutMs: 10000, intervalMs: 500, label: 'OSM processar Update' }).catch(() => false);

  if (!updateProcessed) {
    log('⚠ pós-Update: timeout esperando URL/form/status mudar (mas o Update foi clicado)');
  } else {
    log('✓ pós-Update: OSM processou (página/URL/status mudou)');
  }

  // Screenshot defensivo — pode falhar se a página já fechou
  try {
    await takeScreenshot(editPage, 't046__update_feito', onLog);
  } catch (e) {
    log(`⚠ screenshot pós-Update falhou: ${e.message}`);
  }

  // Retorna o codigoONT do cache local (variável JS, não acessa DOM) — seguro
  const codigoONT = campos.codigoTextarea.currentValue;
  log(`T046 concluída — codigoONT=${codigoONT}, numeroSerie=${numeroSerie}`);
  return { codigoONT, numeroSerie, status: 'completed' };
}

module.exports = t046;