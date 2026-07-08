// public/js/api-action.js
//
// Lógica do template único api-action.html (recebe ?action=xxx&ambiente=xxx).
// Carrega a lista de OS do bolsão, renderiza o form conforme a ação,
// monta o payload no formato do Postman e envia para /api/execute-api-action.

(function () {
  'use strict';

  // ──────────────────────────────────────────────────────────────────────
  // 1. Metadados das ações
  // ──────────────────────────────────────────────────────────────────────
  const ACTION_META = {
    bloqueioParcial:     { tipo: 'api',  titulo: '🔒 Bloqueio Parcial',    descricao: 'Bloqueia parcialmente um serviço de uma Ordem de Serviço existente.' },
    bloqueioTotal:       { tipo: 'api',  titulo: '🚫 Bloqueio Total',      descricao: 'Bloqueia totalmente todos os serviços de uma Ordem de Serviço existente.' },
    desbloqueio:         { tipo: 'api',  titulo: '🔓 Desbloqueio',         descricao: 'Desbloqueia um serviço ou todos os serviços de uma Ordem de Serviço existente.' },
    mudancaEnderecoLink: { tipo: 'link', titulo: '🏠 Mudança de Endereço', descricao: '', href: 'mudancaendereco.html' },
    diagnosticoLink:     { tipo: 'link', titulo: '🔬 Diagnóstico',         descricao: '', href: 'diagnostico.html' },
    chamadoTecnicoLink:  { tipo: 'link', titulo: '🎫 Chamado Técnico',     descricao: '', href: 'chamadotecnico.html' }
  };

  const ACTION_MAP = {
    bloqueioParcial: { productAction: 'bloquear parcial',  orderType: 'Bloqueio'    },
    bloqueioTotal:   { productAction: 'bloquear total',    orderType: 'Bloqueio'    },
    desbloqueio:     { productAction: 'desbloquear total', orderType: 'Desbloqueio' }
  };

  // ──────────────────────────────────────────────────────────────────────
  // 2. Endpoints
  // ──────────────────────────────────────────────────────────────────────
  const ORDERS_ENDPOINTS  = ['/api/ordens-servico', '/api/orders'];
  const EXECUTE_ENDPOINTS = ['/api/execute-api-action'];

  // ──────────────────────────────────────────────────────────────────────
  // 3. Estado
  // ──────────────────────────────────────────────────────────────────────
  let ordersCache   = [];
  let currentAction = null;

  // ──────────────────────────────────────────────────────────────────────
  // 4. Helpers
  // ──────────────────────────────────────────────────────────────────────
  function qs(name) { return new URLSearchParams(window.location.search).get(name); }
  function getAmbiente() { return String(qs('ambiente') || 'TRG').toUpperCase(); }
  function getEl(id) { return document.getElementById(id); }
  function setText(id, value) { const el = getEl(id); if (el) el.textContent = value; }

  function showMessage(message, tipo) {
    const box = getEl('apiMessage');
    if (!box) return;
    box.style.display = 'block';
    box.className = 'message ' + (tipo || 'info');
    box.textContent = message;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function clearMessage() {
    const box = getEl('apiMessage');
    if (!box) return;
    box.style.display = 'none';
    box.textContent = '';
    box.className = 'message';
  }
  function toggleSpinner(show) {
    const sp = getEl('apiSpinner');
    if (sp) sp.style.display = show ? 'inline-block' : 'none';
  }
  function decodeBase64Safe(v) { if (!v) return null; try { return atob(v); } catch (e) { return null; } }

  async function fetchJsonWithFallback(urls, options) {
    options = options || {};
    let lastError = null;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        const resp = await fetch(url, options);
        if (resp.status === 404) continue;
        const data = await resp.json().catch(function () { return {}; });
        if (!resp.ok) throw new Error((data && data.message) || ('Erro HTTP ' + resp.status + ' em ' + url));
        return { url: url, data: data };
      } catch (err) { lastError = err; }
    }
    throw lastError || new Error('Nenhum endpoint respondeu com sucesso.');
  }

  // ──────────────────────────────────────────────────────────────────────
  // 5. Normalização da OS
  // ──────────────────────────────────────────────────────────────────────
  function normalizeOrder(raw, index) {
    const order = raw.order || raw;
    return {
      index: index,
      id:            raw.id || raw.orderId || order.id || order.saId || '',
      saId:          order.saId || raw.saId || '',
      subscriberId:  order.subscriberId || raw.subscriberId || '',
      cp:            order.cp || raw.cp || raw.cp_selection || order.cp_selection || '',
      ambiente:      String(raw.ambiente || order.ambiente || getAmbiente()).toUpperCase(),
      productName:   order.productName || raw.productName || '',
      productCatalogId: order.productCatalogId || raw.productCatalogId || '',
      address:       order.address || raw.address || null,
      complement:    order.complement || raw.complement || null,
      addressText:   [
        order && order.address && order.address.streetType,
        order && order.address && order.address.streetName,
        order && order.address && order.address.number
      ].filter(Boolean).join(' ')
    };
  }

  function buildOrderLabel(o) {
    const id  = o.saId || o.id || ('#' + o.index);
    const sub = o.subscriberId ? ' | SUB: ' + o.subscriberId : '';
    const cp  = o.cp ? ' | CP: ' + o.cp : '';
    const amb = o.ambiente ? ' | ' + o.ambiente : '';
    return id + sub + cp + amb;
  }

  function renderOrdersSelect(orders) {
    const select = getEl('osSelector');
    if (!select) return;
    select.innerHTML = '<option value="">Selecione uma OS...</option>';
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      const opt = document.createElement('option');
      opt.value = String(o.index);
      opt.textContent = buildOrderLabel(o);
      select.appendChild(opt);
    }
    const badge = getEl('osCountBadge');
    if (badge) {
      badge.textContent = orders.length + (orders.length === 1 ? ' OS disponível' : ' OS disponíveis');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // 6. Carrega OS do bolsão
  // ──────────────────────────────────────────────────────────────────────
  async function loadOrders() {
    const ambiente = getAmbiente();
    const urlList = ORDERS_ENDPOINTS.map(function (u) {
      return u + '?ambiente=' + encodeURIComponent(ambiente);
    });
    try {
      const result = await fetchJsonWithFallback(urlList);
      const rawOrders = (result.data && (result.data.orders || result.data.data)) || [];
      ordersCache = rawOrders.map(function (r, i) { return normalizeOrder(r, i); });
      renderOrdersSelect(ordersCache);

      const select = getEl('osSelector');
      if (select) {
        const encoded = qs('osIndex');
        const decoded = decodeBase64Safe(encoded);
        if (decoded !== null && decoded !== '') {
          select.value = String(decoded);
          loadOsDetails();
          return;
        }
        if (ordersCache.length > 0) {
          select.value = String(ordersCache[0].index);
          loadOsDetails();
        }
      }
    } catch (err) {
      showMessage('❌ Erro ao carregar OS: ' + err.message, 'error');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // 7. Handler do onchange do <select id="osSelector">
  // ──────────────────────────────────────────────────────────────────────
  function loadOsDetails() {
    const select = getEl('osSelector');
    const box    = getEl('osDetails');
    if (!select || !box) return;

    const index = select.value;
    if (index === '' || index === null || index === undefined) {
      box.innerHTML = '<div class="field"><span class="field-label">Selecione uma OS</span><span class="field-value text-muted">Aguardando seleção...</span></div>';
      showComplementFromOs(false);
      showProductFromOs(false);
      return;
    }
    const o = ordersCache.find(function (x) { return String(x.index) === String(index); });
    if (!o) {
      box.innerHTML = '<div class="field"><span class="field-label">OS não encontrada</span><span class="field-value text-muted">-</span></div>';
      return;
    }

    box.innerHTML = [
      '<div class="field"><span class="field-label">SA ID</span><span class="field-value">' + (o.saId || 'N/A') + '</span></div>',
      '<div class="field"><span class="field-label">Order ID</span><span class="field-value">' + (o.id || 'N/A') + '</span></div>',
      '<div class="field"><span class="field-label">Subscriber ID</span><span class="field-value">' + (o.subscriberId || 'N/A') + '</span></div>',
      '<div class="field"><span class="field-label">CP</span><span class="field-value">' + (o.cp || 'N/A') + '</span></div>',
      '<div class="field"><span class="field-label">Ambiente</span><span class="field-value">' + (o.ambiente || 'N/A') + '</span></div>',
      '<div class="field"><span class="field-label">Endereço</span><span class="field-value">' + (o.addressText || 'N/A') + '</span></div>'
    ].join('');

    const compEl = getEl('complementDisplay');
    if (compEl) {
      compEl.value = (o.complement && (o.complement.type || o.complement.value))
        ? (o.complement.type || '') + ': ' + (o.complement.value || '')
        : 'N/A';
    }
    showComplementFromOs(!!(o.complement && (o.complement.type || o.complement.value)));

    const catEl = getEl('productCatalogDisplay');
    if (catEl) catEl.value = o.productCatalogId || o.productName || 'N/A';
    showProductFromOs(!!o.productCatalogId);

    const toggle = getEl('manualSubscriberIdToggle');
    if (toggle && toggle.checked) {
      const subInput = getEl('manualSubscriberIdInput');
      if (subInput && !subInput.value) subInput.value = o.subscriberId || '';
    }
  }

  function showComplementFromOs(show) {
    const fromOs = getEl('complementFromOs');
    const manual = getEl('complementManual');
    if (fromOs) fromOs.style.display = show ? 'grid' : 'none';
    if (manual) manual.style.display = show ? 'none' : 'grid';
  }

  function showProductFromOs(show) {
    const fromOs = getEl('productFromOs');
    const manual = getEl('productManual');
    if (fromOs) fromOs.style.display = show ? 'grid' : 'none';
    if (manual) manual.style.display = show ? 'grid' : 'none';
  }

  // ──────────────────────────────────────────────────────────────────────
  // 8. Handler do toggle "Usar OS manual"
  // ──────────────────────────────────────────────────────────────────────
  function toggleManualSubscriberId() {
    const toggle = getEl('manualSubscriberIdToggle');
    if (!toggle) return;
    const manualOn = !!toggle.checked;

    const subGroup = getEl('manualSubscriberIdGroup');
    if (subGroup) {
      if (manualOn) subGroup.classList.add('is-open');
      else subGroup.classList.remove('is-open');
      subGroup.setAttribute('aria-hidden', manualOn ? 'false' : 'true');
    }
    const subInput = getEl('manualSubscriberIdInput');
    if (subInput) subInput.disabled = !manualOn;

    const osDetails = getEl('osDetails');
    const osSelector = getEl('osSelector');
    if (osDetails) osDetails.style.display = manualOn ? 'none' : 'block';
    if (osSelector) osSelector.disabled = manualOn;

    if (manualOn) {
      showComplementFromOs(false);
      showProductFromOs(false);
    } else {
      const select = getEl('osSelector');
      if (select && select.value !== '') {
        loadOsDetails();
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // 9. Constrói o payload no formato do Postman
  // ──────────────────────────────────────────────────────────────────────
  function getPayload() {
    const select = getEl('osSelector');
    const selectedIndex = select ? select.value : '';
    const selectedOrder = ordersCache.find(function (o) { return String(o.index) === String(selectedIndex); });

    const isManual = !!(getEl('manualSubscriberIdToggle') && getEl('manualSubscriberIdToggle').checked);

    const subscriberId = isManual
      ? ((getEl('manualSubscriberIdInput') && getEl('manualSubscriberIdInput').value) || '').trim()
      : ((selectedOrder && selectedOrder.subscriberId) || '').trim();

    const customerName = ((getEl('customerNameInput') && getEl('customerNameInput').value) || '').trim();
    const addressId   = ((getEl('addressIdInput')   && getEl('addressIdInput').value)   || '').trim();
    const inventoryId = ((getEl('inventoryIdInput') && getEl('inventoryIdInput').value) || '').trim();

    let complementType = '';
    let complementValue = '';
    if (!isManual && selectedOrder && selectedOrder.complement) {
      complementType  = selectedOrder.complement.type  || '';
      complementValue = selectedOrder.complement.value || '';
    } else {
      complementType  = ((getEl('complementTypeInput')  && getEl('complementTypeInput').value)  || '').trim();
      complementValue = ((getEl('complementValueInput') && getEl('complementValueInput').value) || '').trim();
    }

    let catalogId = '';
    if (!isManual && selectedOrder) {
      catalogId = selectedOrder.productCatalogId || '';
    } else {
      catalogId = ((getEl('catalogIdSelect') && getEl('catalogIdSelect').value) || '').trim();
    }

    const actionInfo = ACTION_MAP[currentAction] || { productAction: '', orderType: '' };
    const correlationOrder       = 'PORTAL-API-' + Date.now();
    const associatedDocumentDate = new Date().toISOString();

    return {
      order: {
        correlationOrder: correlationOrder,
        associatedDocument: subscriberId,
        associatedDocumentDate: associatedDocumentDate,
        type: actionInfo.orderType,
        infraType: 'FTTH',
        customer: {
          name: customerName,
          subscriberId: subscriberId,
          businessUnity: 'varejo',
          fantasyName: 'InterHome Internet',
          phoneNumber: { phoneNumbers: ['000000000'] },
          workContact: { name: '', email: '', phone: '' }
        },
        addresses: {
          address: {
            id: parseInt(addressId, 10) || 0,
            inventoryId: inventoryId,
            reference: '',
            complement: {
              complements: [{ type: complementType, value: complementValue }]
            }
          }
        },
        products: {
          product: [{ catalogId: catalogId, action: actionInfo.productAction }]
        }
      }
    };
  }

  function validatePayload(payload) {
    const order = payload && payload.order;
    if (!order) throw new Error('Payload inválido.');
    if (!order.customer || !order.customer.subscriberId) throw new Error('Subscriber ID é obrigatório.');
    if (!order.customer.name) throw new Error('Nome do Cliente é obrigatório.');
    if (!order.addresses || !order.addresses.address) throw new Error('Endereço é obrigatório.');
    if (!order.addresses.address.id) throw new Error('Address ID é obrigatório.');
    if (!order.addresses.address.inventoryId) throw new Error('Inventory ID é obrigatório.');
    if (!order.products.product[0].catalogId) throw new Error('Catalog ID é obrigatório.');
    if (!order.type) throw new Error('Type é obrigatório.');
    if (!order.infraType) throw new Error('InfraType é obrigatório.');
    if (!order.associatedDocumentDate) throw new Error('Associated Document Date é obrigatório.');
  }

  // ──────────────────────────────────────────────────────────────────────
  // 10. Handler do botão "Executar"
  // ──────────────────────────────────────────────────────────────────────
  async function executeApiAction() {
    const btn = getEl('executeApiButton');
    clearMessage();
    try {
      if (btn) { btn.disabled = true; }
      toggleSpinner(true);

      const payload = getPayload();
      validatePayload(payload);

      const result = await fetchJsonWithFallback(
        EXECUTE_ENDPOINTS,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );

      showMessage(
        '✅ Operação executada com sucesso.\nEndpoint: ' + result.url + '\n\n' + JSON.stringify(result.data, null, 2),
        'success'
      );
    } catch (err) {
      showMessage('❌ Falha na execução: ' + err.message, 'error');
    } finally {
      toggleSpinner(false);
      if (btn) { btn.disabled = false; }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // 11. Ambiente
  // ──────────────────────────────────────────────────────────────────────
  function onAmbienteChange() {
    const envSelect = getEl('ambienteSelect');
    if (!envSelect) return;
    const value = envSelect.value;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('ambiente', value);
      window.history.replaceState({}, '', url);
    } catch (e) {}
    updateAmbienteBanner(value);
    loadOrders().catch(function (err) {
      showMessage('❌ Erro ao recarregar OS: ' + err.message, 'error');
    });
  }

  function updateAmbienteBanner(value) {
    const banner = getEl('envBanner');
    if (!banner) return;
    const amb = String(value || 'TRG').toUpperCase();
    banner.textContent = amb;
    banner.dataset.ambiente = amb;
    banner.className = 'env-banner ambiente-' + amb;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 12. Expor funções no window
  // ──────────────────────────────────────────────────────────────────────
  window.loadOsDetails            = loadOsDetails;
  window.toggleManualSubscriberId = toggleManualSubscriberId;
  window.executeApiAction         = executeApiAction;
  window.onAmbienteChange         = onAmbienteChange;

  // ──────────────────────────────────────────────────────────────────────
  // 13. Boot
  // ──────────────────────────────────────────────────────────────────────
  function boot() {
    const actionFromUrl = qs('action');
    const meta = actionFromUrl ? ACTION_META[actionFromUrl] : null;

    if (!meta) {
      setText('actionTitle', '⚠️ Ação não encontrada');
      const descEl = getEl('actionDescription');
      if (descEl) descEl.textContent = 'A ação solicitada não existe. Volte para a lista de APIs.';
      const formContainer = getEl('formContainer');
      if (formContainer) formContainer.style.display = 'none';
      return;
    }

    // Ações "link" → redireciona para a página própria (preserva comportamento atual)
    if (meta.tipo === 'link') {
      window.location.href = meta.href + '?ambiente=' + encodeURIComponent(getAmbiente());
      return;
    }

    currentAction = actionFromUrl;
    setText('actionTitle', meta.titulo);
    setText('buttonActionText', meta.titulo.replace(/^[^a-zA-ZÀ-ÿ]+/, '').trim() || 'Executar');
    const desc = getEl('actionDescription');
    if (desc) desc.textContent = meta.descricao;

    const actionInfo = ACTION_MAP[actionFromUrl];
    const metaType = getEl('metaType');
    if (metaType) metaType.textContent = actionInfo ? actionInfo.orderType : '—';
    const prodActEl = getEl('productActionDisplay');
    if (prodActEl) prodActEl.value = actionInfo ? actionInfo.productAction : '—';

    const initialAmb = getAmbiente();
    const envSelect = getEl('ambienteSelect');
    if (envSelect) envSelect.value = initialAmb;
    updateAmbienteBanner(initialAmb);

    loadOrders();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();