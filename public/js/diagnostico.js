// public/js/diagnostico.js

let countdownInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    loadCps();
    loadDiagnosticos();
    bindEvents();
});

function bindEvents() {
    const btn = document.getElementById('prepararMockBtn');
    if (btn) btn.addEventListener('click', prepararMock);

    const exec = document.getElementById('executarDiagnosticoBtn');
    if (exec) exec.addEventListener('click', executarDiagnostico);
}

function getAmbiente() {
    const sel = document.getElementById('ambienteSelect');
    return sel ? String(sel.value || 'TRG').toUpperCase() : 'TRG';
}

async function loadCps() {
    const sel = document.getElementById('cpSelect');
    if (!sel) return;
    try {
        const resp = await fetch('/api/cps');
        const cps  = await resp.json();
        sel.innerHTML = '<option value="">Selecione um CP...</option>';
        (Array.isArray(cps) ? cps : []).forEach((cp) => {
            const opt = document.createElement('option');
            opt.value = cp; opt.textContent = cp;
            sel.appendChild(opt);
        });
    } catch (err) {
        sel.innerHTML = '<option value="">Erro ao carregar CPs</option>';
        console.error('[DIAG] Erro loadCps:', err);
    }
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

function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(id);
    if (target) target.classList.remove('hidden');
}

function setStep(activeStep) {
    for (let i = 1; i <= 4; i++) {
        const stepEl = document.getElementById('step' + i);
        const lineEl = document.getElementById('line' + i);
        if (!stepEl) continue;
        stepEl.classList.remove('active', 'done');
        if (i < activeStep)        stepEl.classList.add('done');
        else if (i === activeStep) stepEl.classList.add('active');
        if (lineEl) lineEl.classList.toggle('done', i < activeStep);
    }
}

async function prepararMock() {
    clearMessage();
    const cp           = (document.getElementById('cpSelect') || {}).value;
    const subscriberId = (document.getElementById('subscriberIdInput') || {}).value || '';
    const gpon         = (document.getElementById('gponInput') || {}).value || '';
    const ambiente     = getAmbiente();

    if (!cp) { showMessage('Selecione um CP.', 'error'); return; }
    if (!subscriberId) { showMessage('Informe o Subscriber ID.', 'error'); return; }
    if (!gpon) { showMessage('Informe o GPON.', 'error'); return; }

    showMessage('🔧 Preparando MOCK (login + parametrizacao)...', 'info');

    try {
        const resp = await fetch('/api/diagnostico/suite1/mock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ambiente,
                login: 'netq',
                senha: 'netq',
                subscriberId,
                gpon
            })
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data && (data.status === 'sucesso' || data.ok)) {
            showMessage('✅ MOCK parametrizado com sucesso.', 'success');
            const status = document.getElementById('mockStatus');
            if (status) {
                status.textContent = 'OK';
                status.className = 'env-tag ' + ambiente;
            }
            document.getElementById('execSubscriber').textContent = subscriberId;
            document.getElementById('execGpon').textContent = gpon;
            showSection('execucaoSection');
            setStep(2);
        } else {
            showMessage('❌ Falha ao preparar MOCK: ' + ((data && data.message) || ('Erro HTTP ' + resp.status)), 'error');
        }
    } catch (err) {
        showMessage('❌ Erro: ' + err.message, 'error');
        console.error('[DIAG] Erro prepararMock:', err);
    }
}

async function executarDiagnostico() {
    clearMessage();
    const cp           = (document.getElementById('cpSelect') || {}).value;
    const subscriberId = (document.getElementById('subscriberIdInput') || {}).value || '';
    const gpon         = (document.getElementById('gponInput') || {}).value || '';
    const ambiente     = getAmbiente();

    showMessage('🧪 Executando Diagnostico Completo V2...', 'info');

    try {
        const payload = {
            ambiente,
            gpon,
            suite: 'SUITE_1',
            tipo: 'DiagnosticoCompletoV2',
            customer: { subscriberId }
        };

        const resp = await fetch('/api/diagnostico/suite1/executar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cp_selection: cp,
                ambiente,
                payload
            })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data || data.status === 'erro') {
            showMessage('❌ Falha no diagnostico: ' + ((data && data.message) || ('Erro HTTP ' + resp.status)), 'error');
            return;
        }

        const isNok = JSON.stringify(data.data || data).includes('"NOK"') || (data.data && data.data.resultado === 'NOK');
        const resultadoStatus = isNok ? 'NOK' : 'OK';

        document.getElementById('resultadoStatus').innerHTML =
            isNok
                ? '<span class="badge-nok">NOK</span>'
                : '<span class="badge-ok">OK</span>';
        document.getElementById('resultadoAuditoriaId').textContent = data.diagnosticoId || data.id || 'N/A';

        const now = new Date();
        const expira = new Date(now.getTime() + 15 * 60 * 1000);
        document.getElementById('resultadoCriadoEm').textContent = now.toLocaleString('pt-BR');
        document.getElementById('resultadoExpiraEm').textContent = '15:00';

        document.getElementById('resultadoDiagnostico').classList.remove('hidden');

        startCountdown(expira, document.getElementById('resultadoExpiraEm'));

        showMessage('✅ Diagnostico executado. Resultado: ' + resultadoStatus, 'success');
        showSection('listaSection');
        setStep(4);
        loadDiagnosticos();
    } catch (err) {
        showMessage('❌ Erro: ' + err.message, 'error');
        console.error('[DIAG] Erro executarDiagnostico:', err);
    }
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

async function loadDiagnosticos() {
    const list = document.getElementById('diagnosticosList');
    if (!list) return;
    list.innerHTML = 'Carregando...';
    try {
        const resp = await fetch('/api/diagnostico');
        const data = await resp.json().catch(() => ({}));
        const diagnosticos = (data && data.diagnosticos) || (Array.isArray(data) ? data : []);

        if (!diagnosticos || diagnosticos.length === 0) {
            list.innerHTML = '<p class="info">Nenhum diagnostico gerado ainda.</p>';
            return;
        }

        list.innerHTML = '';
        diagnosticos.forEach((d) => {
            const expira = d.expiraEm ? new Date(d.expiraEm) : null;
            const expired = expira ? expira.getTime() < Date.now() : false;

            const card = document.createElement('div');
            card.className = 'diag-card ' + (expired ? 'expired' : 'valido');
            card.innerHTML = `
                <p><strong>ID:</strong> ${d.diagnosticoId || d.id || 'N/A'}
                    <span class="${d.resultado === 'NOK' ? 'badge-nok' : 'badge-ok'}">${d.resultado || 'OK'}</span>
                </p>
                <p><strong>Subscriber:</strong> ${d.subscriberId || 'N/A'}</p>
                <p><strong>GPON:</strong> ${d.gpon || 'N/A'}</p>
                <p><strong>Criado em:</strong> ${d.creationDate ? new Date(d.creationDate).toLocaleString('pt-BR') : 'N/A'}</p>
                <p><strong>Status:</strong> ${expired ? '<span class="badge-warn">VENCIDO</span>' : '<span class="badge-ok">VALIDO</span>'}</p>
                <div style="margin-top:10px;">
                    ${!expired && d.resultado === 'NOK'
                        ? `<a href="chamadotecnico.html?diagnosticoId=${encodeURIComponent(d.diagnosticoId || d.id)}&ambiente=${getAmbiente()}" class="action-button" style="text-decoration:none;display:inline-block;">🎫 Ir para Chamado Tecnico</a>`
                        : ''}
                </div>
            `;
            list.appendChild(card);
        });
    } catch (err) {
        list.innerHTML = '<p class="error">Erro ao carregar diagnosticos: ' + err.message + '</p>';
        console.error('[DIAG] Erro loadDiagnosticos:', err);
    }
}