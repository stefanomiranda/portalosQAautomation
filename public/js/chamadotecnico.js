// public/js/chamadoTecnico.js

let currentDiagnostico = null;
let currentSlot        = null;
let currentAgendamento = null;
let currentTtExternoId = null;
let currentTtProtocolo = null;
let currentLocalTtId   = null;
let countdownInterval  = null;

document.addEventListener('DOMContentLoaded', () => {
    loadCps();
    loadDiagnosticos();
    bindEvents();
});

function bindEvents() {
    const av = document.getElementById('avancarSlotBtn');
    if (av) av.addEventListener('click', () => { showSection('slotSection'); setStep(2); });

    const bs = document.getElementById('buscarSlotsBtn');
    if (bs) bs.addEventListener('click', buscarSlots);

    const aatt = document.getElementById('avancarAbrirTtBtn');
    if (aatt) aatt.addEventListener('click', () => { showSection('abrirTtSection'); setStep(3); });

    const att = document.getElementById('abrirTtBtn');
    if (att) att.addEventListener('click', abrirTt);

    const ac1 = document.getElementById('avancarCheckpoint1Btn');
    if (ac1) ac1.addEventListener('click', () => { showSection('checkpoint1Section'); setStep(4); });

    const cp1 = document.getElementById('checkpoint1ConcluidoBtn');
    if (cp1) cp1.addEventListener('click', () => {
        document.getElementById('checkpoint1Escolha').classList.remove('hidden');
    });

    const ac2 = document.getElementById('avancarCheckpoint2Btn');
    if (ac2) ac2.addEventListener('click', () => {
        const tipo = (document.getElementById('ttResultadoTipo') || {}).value;
        showSection('checkpoint2Section');
        setStep(5);
        if (tipo === 'pendencia') {
            document.getElementById('patchNecessario').classList.remove('hidden');
            document.getElementById('t088FinalPanel').classList.add('hidden');
        } else {
            document.getElementById('patchNecessario').classList.add('hidden');
            document.getElementById('t088FinalPanel').classList.remove('hidden');
        }
    });

    const ap = document.getElementById('aplicarPatchBtn');
    if (ap) ap.addEventListener('click', aplicarPatch);

    const ef = document.getElementById('encerrarT088FinalBtn');
    if (ef) ef.addEventListener('click', () => {
        document.getElementById('notificacoesList').classList.remove('hidden');
        carregarNotificacoes();
    });
}

function getAmbiente() {
    return String(new URLSearchParams(window.location.search).get('ambiente') || 'TRG').toUpperCase();
}

function setStep(activeStep) {
    for (let i = 1; i <= 5; i++) {
        const stepEl = document.getElementById('step' + i);
        const lineEl = document.getElementById('line' + i);
        if (!stepEl) continue;
        stepEl.classList.remove('active', 'done');
        if (i < activeStep)        stepEl.classList.add('done');
        else if (i === activeStep) stepEl.classList.add('active');
        if (lineEl) lineEl.classList.toggle('done', i < activeStep);
    }
}

function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(id);
    if (target) target.classList.remove('hidden');
}

function showMessage(message, type) {
    const box = document.getElementById('statusMessage');
    if (!box) return;
    box.className = 'message ' + (type || 'info');
    box.classList.remove('hidden');
    box.textContent = message;
}
function clearMessage() {
    const box = document.getElementById('statusMessage');
    if (box) { box.classList.add('hidden'); box.textContent = ''; }
}

async function loadCps() {
    return;
}

async function loadDiagnosticos() {
    const sel  = document.getElementById('diagnosticoSelector');
    const list = document.getElementById('diagnosticosList');
    if (!sel || !list) return;

    try {
        const resp = await fetch('/api/diagnostico');
        const data = await resp.json().catch(() => ({}));
        const diagnosticos = (data && data.diagnosticos) || (Array.isArray(data) ? data : []);
        const validos = (diagnosticos || []).filter((d) => {
            const expira = d.expiraEm ? new Date(d.expiraEm) : null;
            return d.resultado === 'NOK' && expira && expira.getTime() > Date.now();
        });

        sel.innerHTML = '<option value="">Selecione um diagnostico...</option>';
        validos.forEach((d) => {
            const opt = document.createElement('option');
            opt.value = String(d.diagnosticoId || d.id);
            opt.textContent = `[${d.diagnosticoId || d.id}] ${d.subscriberId || ''} - ${new Date(d.creationDate).toLocaleString('pt-BR')}`;
            sel.appendChild(opt);
        });

        sel.onchange = () => {
            const id = sel.value;
            const diag = validos.find((d) => String(d.diagnosticoId || d.id) === id);
            if (diag) onDiagnosticoSelecionado(diag);
        };

        const idFromUrl = new URLSearchParams(window.location.search).get('diagnosticoId');
        if (idFromUrl) {
            const diag = validos.find((d) => String(d.diagnosticoId || d.id) === idFromUrl);
            if (diag) {
                sel.value = idFromUrl;
                onDiagnosticoSelecionado(diag);
            }
        }

        list.innerHTML = '';
        if (validos.length === 0) {
            list.innerHTML = '<p class="info">Nenhum diagnostico NOK dentro da janela de 15 minutos.</p>';
            return;
        }
        validos.forEach((d) => {
            const expira = d.expiraEm ? new Date(d.expiraEm) : null;
            const card = document.createElement('div');
            card.className = 'diag-card valido';
            card.innerHTML = `
                <p><strong>ID:</strong> ${d.diagnosticoId || d.id} <span class="badge-nok">NOK</span></p>
                <p><strong>Subscriber:</strong> ${d.subscriberId || 'N/A'}</p>
                <p><strong>GPON:</strong> ${d.gpon || 'N/A'}</p>
                <p><strong>Expira em:</strong> ${expira ? expira.toLocaleString('pt-BR') : 'N/A'}</p>
                <div style="margin-top:10px;">
                    <button class="action-button" onclick="usarDiagnostico(${JSON.stringify(d).replace(/"/g, '&quot;')})">🎫 Usar este diagnostico</button>
                </div>
            `;
            list.appendChild(card);
        });
    } catch (err) {
        list.innerHTML = '<p class="error">Erro ao carregar diagnosticos: ' + err.message + '</p>';
        console.error('[TT] Erro loadDiagnosticos:', err);
    }
}

function usarDiagnostico(d) {
    const sel = document.getElementById('diagnosticoSelector');
    if (sel) {
        sel.value = String(d.diagnosticoId || d.id);
        onDiagnosticoSelecionado(d);
    }
}

function onDiagnosticoSelecionado(diag) {
    currentDiagnostico = diag;
    const info = document.getElementById('diagnosticoSelecionadoInfo');
    if (info) info.classList.remove('hidden');
    document.getElementById('diagSubscriber').textContent = diag.subscriberId || 'N/A';
    document.getElementById('diagGpon').textContent     = diag.gpon || 'N/A';
    document.getElementById('diagResultado').innerHTML   = '<span class="badge-nok">NOK</span>';

    const expira = diag.expiraEm ? new Date(diag.expiraEm) : null;
    const badge = document.getElementById('diagExpira');
    if (expira && badge) startCountdown(expira, badge);

    const av = document.getElementById('avancarSlotBtn');
    if (av) av.disabled = false;
}

function startCountdown(expiraDate, badgeEl) {
    if (countdownInterval) clearInterval(countdownInterval);
    function tick() {
        const now = Date.now();
        const diff = expiraDate.getTime() - now;
        if (diff <= 0) {
            badgeEl.textContent = 'EXPIRADO';
            badgeEl.className = 'countdown-badge expired';
            clearInterval(countdownInterval);
            return;
        }
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        badgeEl.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
        if (diff < 5 * 60 * 1000) badgeEl.className = 'countdown-badge warn';
        else badgeEl.className = 'countdown-badge';
    }
    tick();
    countdownInterval = setInterval(tick, 1000);
}

async function buscarSlots() {
    clearMessage();
    if (!currentDiagnostico) {
        showMessage('Selecione um diagnostico primeiro.', 'error');
        return;
    }

    const addressId   = Number((document.getElementById('addressIdInput') || {}).value);
    const inventoryId = Number((document.getElementById('inventoryIdInput') || {}).value);
    if (!addressId || !inventoryId) {
        showMessage('Informe Address ID e Inventory ID.', 'error');
        return;
    }

    const ambiente = getAmbiente();
    const cp       = currentDiagnostico.cp || 'ALGAR';
    const subscriberId = currentDiagnostico.subscriberId;

    showMessage('🔍 Buscando slots...', 'info');

    try {
        const resp = await fetch('/api/chamado/suite2/executar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cp_selection: cp,
                ambiente,
                addressId,
                subscriberId,
                productType: 'Fibra',
                ttPayload: {},
                diagnosticoId: currentDiagnostico.diagnosticoId || currentDiagnostico.id,
                createdOrderId: null
            })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data || (data.status === 'erro' && data.ok !== true)) {
            showMessage('❌ Falha ao buscar/agendar: ' + ((data && data.message) || ('Erro HTTP ' + resp.status)), 'error');
            return;
        }

        currentSlot        = data.slot || null;
        currentAgendamento = data.agendamentoResp || null;
        currentTtExternoId = data.troubleTicketExternoId || data.troubleTicketId || null;
        currentTtProtocolo = data.protocolo || null;
        currentLocalTtId   = data.troubleTicketLocalId || null;

        if (currentTtExternoId) {
            document.getElementById('cp1TtId').textContent = currentTtExternoId;
        }

        const agendamentoIdEl = document.getElementById('agendamentoId');
        const agendamentoDataEl = document.getElementById('agendamentoData');
        if (agendamentoIdEl)   agendamentoIdEl.textContent   = (currentAgendamento && currentAgendamento.appointment && currentAgendamento.appointment.id) || (currentSlot && currentSlot.id) || 'N/A';
        if (agendamentoDataEl) agendamentoDataEl.textContent = (currentSlot && currentSlot.startDate) ? new Date(currentSlot.startDate).toLocaleString('pt-BR') : 'N/A';

        document.getElementById('agendamentoConfirmado').classList.remove('hidden');
        document.getElementById('abrirTtResultado').classList.remove('hidden');
        document.getElementById('ttExternoId').textContent = currentTtExternoId || 'N/A';
        document.getElementById('ttProtocolo').textContent = currentTtProtocolo || 'N/A';

        const av = document.getElementById('avancarAbrirTtBtn');
        if (av) av.disabled = false;
        const ac1 = document.getElementById('avancarCheckpoint1Btn');
        if (ac1) ac1.disabled = false;

        showMessage('✅ Slot agendado e TT criado.', 'success');
    } catch (err) {
        showMessage('❌ Erro: ' + err.message, 'error');
        console.error('[TT] Erro buscarSlots:', err);
    }
}

async function abrirTt() {
    clearMessage();
    const externalId = (document.getElementById('ttExternalId') || {}).value || '';
    const payloadStr = (document.getElementById('ttPayload') || {}).value || '{}';
    if (!externalId) { showMessage('Informe o External ID do TT.', 'error'); return; }

    let ttPayload;
    try { ttPayload = JSON.parse(payloadStr); }
    catch (e) { showMessage('Payload invalido (nao e JSON).', 'error'); return; }

    showMessage('🎫 Abrindo TT...', 'info');
    try {
        const resp = await fetch('/api/suite2/trouble-ticket/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ambiente: getAmbiente(),
                cpId: 'ALGAR',
                payload: { externalId, ...ttPayload }
            })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            showMessage('❌ Falha ao abrir TT: ' + ((data && data.message) || ('Erro HTTP ' + resp.status)), 'error');
            return;
        }
        showMessage('✅ TT aberto.', 'success');
        const ac1 = document.getElementById('avancarCheckpoint1Btn');
        if (ac1) ac1.disabled = false;
    } catch (err) {
        showMessage('❌ Erro: ' + err.message, 'error');
    }
}

async function aplicarPatch() {
    clearMessage();
    if (!currentLocalTtId && !currentTtExternoId) {
        showMessage('Nenhum TT carregado para patch.', 'error');
        return;
    }
    const appointmentId = (document.getElementById('patchAppointmentId') || {}).value || '';
    if (!appointmentId) { showMessage('Informe o Appointment ID.', 'error'); return; }

    showMessage('🔧 Aplicando Patch TT V2...', 'info');
    try {
        const url = '/api/chamado/' + currentLocalTtId + '/patch-v2';
        const resp = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cp_selection: 'ALGAR',
                ambiente: getAmbiente(),
                ttIdExterno: currentTtExternoId,
                payload: { appointmentId, issuCode: '8010' }
            })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            showMessage('❌ Falha no patch: ' + ((data && data.message) || ('Erro HTTP ' + resp.status)), 'error');
            return;
        }
        showMessage('✅ Patch aplicado. Siga para a T088 final.', 'success');
        document.getElementById('patchNecessario').classList.add('hidden');
        document.getElementById('t088FinalPanel').classList.remove('hidden');
    } catch (err) {
        showMessage('❌ Erro: ' + err.message, 'error');
    }
}

async function carregarNotificacoes() {
    if (!currentLocalTtId && !currentTtExternoId) return;
    const content = document.getElementById('notificacoesContent');
    if (content) content.textContent = 'Carregando...';
    try {
        const url = '/api/chamado/' + (currentLocalTtId || 0) + '/notificacoes?cp_selection=ALGAR&ambiente=' + getAmbiente() + '&ttIdExterno=' + encodeURIComponent(currentTtExternoId || '');
        const resp = await fetch(url);
        const data = await resp.json().catch(() => ({}));
        if (content) {
            content.textContent = JSON.stringify(data, null, 2);
            content.style.background = '#f8f9fa';
            content.style.padding = '15px';
            content.style.borderRadius = '8px';
            content.style.border = '1px solid #dee2e6';
            content.style.whiteSpace = 'pre-wrap';
            content.style.fontFamily = 'monospace';
            content.style.fontSize = '0.85em';
        }
    } catch (err) {
        if (content) content.textContent = 'Erro: ' + err.message;
    }
}

window.usarDiagnostico = usarDiagnostico;