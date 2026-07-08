// public/js/apis.js
//
// A lógica de form das 6 ações migrou para api-action.js (template único).
// Aqui fica apenas o seletor de ambiente da página apis.html.

(function () {
  'use strict';

  function qs(name) { return new URLSearchParams(window.location.search).get(name); }
  function getAmbiente() { return String(qs('ambiente') || 'TRG').toUpperCase(); }
  function getEl(id) { return document.getElementById(id); }

  function updateAmbienteBanner(value) {
    const banner = getEl('envBanner');
    if (!banner) return;
    const amb = String(value || 'TRG').toUpperCase();
    banner.textContent = amb;
    banner.dataset.ambiente = amb;
    banner.className = 'env-banner ambiente-' + amb;
  }

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
  }

  window.onAmbienteChange = onAmbienteChange;

  function boot() {
    const initialAmb = getAmbiente();
    const envSelect = getEl('ambienteSelect');
    if (envSelect) envSelect.value = initialAmb;
    updateAmbienteBanner(initialAmb);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();