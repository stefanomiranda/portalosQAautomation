// public/js/criar-os-retirada.js
// Front completo da tela "Criar OS de Retirada".
// Casa com public/criar-os-retirada.html (atributosTextarea + bloco de agendamento).

const el = (id) => document.getElementById(id);

let instalacoesAtivas = [];
let currentAmbiente   = 'TRG';
let currentCp         = '';
let novoSubscriberId  = '';
let slotSelecionado   = null;
let agendamentoId     = null;
let accessToken       = null;
let slotsCache        = [];

function resolverProductType(produtos) {
    const BANDA_LARGA_KEYS = ['BL_', 'VELOC_', 'FTTR_', 'MESH_'];
    const TELEFONIA_KEYS   = ['VOIP', 'VOLTE', 'TELEFONIA', 'PHONE'];
    const isBandaLarga = (p) => {
        const id = (typeof p === 'string' ? p : (p.catalogId || '')).toUpperCase();
        return BANDA_LARGA_KEYS.some(k => id.startsWith(k));
    };
    const isTelefonia = (p) => {
        const id = (typeof p === 'string' ? p : (p.catalogId || '')).toUpperCase();
        return TELEFONIA_KEYS.some(k => id.includes(k));
    };
    if (produtos.some(isBandaLarga)) return 'Banda Larga';
    if (produtos.some(isTelefonia))  return 'Telefonia';
    const first = produtos[0];
    return typeof first === 'string' ? first : (first?.catalogId || 'Banda Larga');
}

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const ambURL = (params.get('ambiente') || '').toUpperCase();
    if (['TRG', 'TI', 'TRG2'].includes(ambURL)) {
        currentAmbiente = ambURL;
        el('ambienteSelect').value = ambURL;
    }

    el('ambienteSelect').addEventListener('change', () => {
        currentAmbiente = el('ambienteSelect').value;
        carregarInstalacoesAtivas();
        gerarNovoSubscriberId();
        atualizarPreview();
    });
    el('cpSelect').addEventListener('change', () => {
        currentCp = el('cpSelect').value;
        atualizarPreview();
    });
    el('instalacaoBolsaoSelect').addEventListener('change', () => {
        const idx = el('instalacaoBolsaoSelect').value;
        if (idx === '') return;
        const it = instalacoesAtivas[Number(idx)];
        el('correlationOrderOriginalInput').value = it.subscriberId || '';
        el('associatedDocumentInput').value       = it.associatedDocument || it.subscriberId || '';
        el('produtosTextarea').value = (it.produtos && it.produtos.length)
            ? it.produtos.join('\n')
            : (it.productCatalogId || '');
        if (it.cp && !currentCp) {
            currentCp = it.cp;
            el('cpSelect').value = it.cp;
        }
        atualizarAtributosAuto();
        atualizarPreview();
    });
    el('correlationOrderOriginalInput').addEventListener('input', () => {
        el('instalacaoBolsaoSelect').value = '';
        atualizarPreview();
    });
    el('associatedDocumentInput').addEventListener('input', atualizarPreview);
    el('produtosTextarea').addEventListener('input', () => {
        atualizarAtributosAuto();
        atualizarPreview();
    });
    el('temAgendamentoCheckbox').addEventListener('change', () => {
        const marcado = el('temAgendamentoCheckbox').checked;
        el('blocoAgendamento').style.display = marcado ? '' : 'none';
        if (marcado && !novoSubscriberId) gerarNovoSubscriberId();
        if (!marcado) {
            slotSelecionado = null;
            agendamentoId   = null;
            el('slotsSelect').innerHTML = '<option value="">— Busque slots primeiro —</option>';
            el('agendamentoInfo').textContent = '';
        }
        atualizarPreview();
    });
    el('btnBuscarSlots').addEventListener('click', buscarSlots);
    el('btnAgendarSlot').addEventListener('click', agendarSlotSelecionado);
    el('btnRecarregarBolsao').addEventListener('click', carregarInstalacoesAtivas);
    el('btnCriar').addEventListener('click', criarOSRetirada);
    el('btnLimpar').addEventListener('click', limparFormulario);

    loadCps();
    carregarInstalacoesAtivas();
    gerarNovoSubscriberId();
    atualizarPreview();
});

async function garantirToken() {
    if (accessToken) return accessToken;
    if (!currentCp) throw new Error('Selecione um CP antes.');
    const res = await fetch('/api/gerar-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cp_selection: currentCp, ambiente: currentAmbiente })
    });
    const data = await res.json();
    if (!data.accessToken) throw new Error(data.message || 'Falha ao gerar token.');
    accessToken = data.accessToken;
    return accessToken;
}

async function loadCps() {
    try {
        const res = await fetch('/api/cps');
        const cps = await res.json();
        const sel = el('cpSelect');
        sel.innerHTML = '';
        cps.forEach(cp => {
            const opt = document.createElement('option');
            opt.value = cp;
            opt.textContent = cp;
            sel.appendChild(opt);
        });
        if (cps.length > 0) {
            currentCp = cps[0];
            sel.value = cps[0];
        }
    } catch (err) {
        console.error('Erro ao carregar CPs:', err);
        mostrarResultado('erro', '❌ Erro ao carregar CPs: ' + err.message);
    }
}

async function carregarInstalacoesAtivas() {
    el('instalacaoBolsaoSelect').innerHTML = '<option value="">— Carregando instalações ativas... —</option>';
    try {
        const res  = await fetch('/api/instalacoes-ativas?ambiente=' + encodeURIComponent(currentAmbiente));
        const data = await res.json();
        if (data.status !== 'sucesso') {
            el('instalacaoBolsaoSelect').innerHTML = '<option value="">Erro: ' + (data.message || 'desconhecido') + '</option>';
            return;
        }
        instalacoesAtivas = data.items || [];
        const sel = el('instalacaoBolsaoSelect');
        sel.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = instalacoesAtivas.length === 0
            ? '— Nenhuma Instalação ativa encontrada no bolsão —'
            : '— Selecione uma Instalação (ou digite manualmente abaixo) —';
        sel.appendChild(placeholder);
        instalacoesAtivas.forEach((it, idx) => {
            const opt = document.createElement('option');
            opt.value = String(idx);
            const prods = (it.produtos && it.produtos.length) ? it.produtos.join(', ') : (it.productCatalogId || '—');
            opt.textContent = it.subscriberId + ' · CP ' + (it.cp || '—') + ' · ' + prods;
            sel.appendChild(opt);
        });
    } catch (err) {
        console.error('Erro ao listar instalações ativas:', err);
        el('instalacaoBolsaoSelect').innerHTML = '<option value="">Erro ao carregar: ' + err.message + '</option>';
    }
}

async function gerarNovoSubscriberId() {
    try {
        const res  = await fetch('/api/gerar-subscriber-id');
        const data = await res.json();
        if (data.subscriberId) {
            novoSubscriberId = data.subscriberId;
            atualizarPreview();
        }
    } catch (err) {
        console.error('Erro ao gerar subscriberId:', err);
    }
}

async function buscarSlots() {
    if (!currentCp) return mostrarResultado('erro', 'Selecione um CP antes de buscar slots.');
    if (!novoSubscriberId) await gerarNovoSubscriberId();
    const instalacao = instalacaoSelecionada();
    if (!instalacao || !instalacao.addressId) {
        return mostrarResultado('erro', 'Selecione uma Instalação do dropdown (precisamos do addressId) ou preencha manualmente.');
    }
    el('btnBuscarSlots').disabled    = true;
    el('btnBuscarSlots').textContent = '⏳ Buscando...';
    el('slotsSelect').innerHTML      = '<option value="">— Carregando slots... —</option>';
    try {
        const token = await garantirToken();
        const res   = await fetch('/api/buscar-slots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cp_selection: currentCp,
                ambiente:     currentAmbiente,
                addressId:    instalacao.addressId,
                subscriberId: novoSubscriberId,
                productType:  resolverProductType(parseProdutos()),
                orderType:    'Retirada',
                accessToken:  token
            })
        });
        const data  = await res.json();
        const slots = data.slots || data.items || data;
        const sel   = el('slotsSelect');
        sel.innerHTML = '';
        if (!Array.isArray(slots) || slots.length === 0) {
            sel.innerHTML = '<option value="">— Nenhum slot disponível —</option>';
            renderizarTabelaSlots([]);
            return;
        }
        const ph = document.createElement('option');
        ph.value = ''; ph.textContent = '— Selecione um slot —';
        sel.appendChild(ph);
        slotsCache = slots;
        slots.forEach((s, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = (s.startDate || s.date || s.slotDate || '—') + ' → ' + (s.finishDate || '') + ' · ' + (s.id || s.slotId || s.workOrderId || '');
            sel.appendChild(opt);
        });
        sel.onchange = () => {
            const i = sel.value;
            slotSelecionado = (i === '') ? null : slots[Number(i)];
            atualizarPreview();
            renderizarTabelaSlots(slots, slotSelecionado);
        };
        renderizarTabelaSlots(slots, null);
    } catch (err) {
        console.error('Erro ao buscar slots:', err);
        mostrarResultado('erro', '❌ Erro ao buscar slots: ' + err.message);
    } finally {
        el('btnBuscarSlots').disabled    = false;
        el('btnBuscarSlots').textContent = '📅 Buscar Slots';
    }
}

async function agendarSlotSelecionado() {
    if (!slotSelecionado) return mostrarResultado('erro', 'Selecione um slot antes de agendar.');
    el('btnAgendarSlot').disabled    = true;
    el('btnAgendarSlot').textContent = '⏳ Agendando...';
    try {
        const token = await garantirToken();
        const res   = await fetch('/api/agendar-slot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cp_selection: currentCp,
                ambiente:     currentAmbiente,
                slotId:       slotSelecionado.slotId || slotSelecionado.id || slotSelecionado.workOrderId,
                accessToken:  token
            })
        });
        const data = await res.json();
        if (!data.agendamentoId) {
            throw new Error(data.message || 'Resposta sem agendamentoId.');
        }
        agendamentoId = data.agendamentoId;
        el('agendamentoInfo').innerHTML = '✅ Agendamento confirmado: <strong>' + agendamentoId + '</strong>';
        atualizarPreview();
    } catch (err) {
        console.error('Erro ao agendar slot:', err);
        mostrarResultado('erro', '❌ Erro ao agendar slot: ' + err.message);
    } finally {
        el('btnAgendarSlot').disabled    = false;
        el('btnAgendarSlot').textContent = '📌 Agendar este slot';
    }
}

function atualizarAtributosAuto() {
    const produtos = parseProdutos();
    const card  = el('atributosCard');
    const textarea = el('atributosTextarea');
    if (!card || !textarea) return;

    const VoIP_KEYWORDS = ['voip', 'volte', 'telefonia'];
    const needsAttributes = produtos.some(p => {
        const id = (typeof p === 'string' ? p : (p.catalogId || '')).toLowerCase();
        return VoIP_KEYWORDS.some(kw => id.includes(kw));
    });

    if (!needsAttributes) {
        card.style.display = 'none';
        if (!textarea.value.trim()) textarea.value = '';
        return;
    }

    if (!textarea.value.trim()) {
        const template = {};
        produtos.forEach(p => {
            const id = typeof p === 'string' ? p : (p.catalogId || '');
            const lowId = id.toLowerCase();
            if (VoIP_KEYWORDS.some(kw => lowId.includes(kw))) {
                template[id] = { attribute: [ { name: 'voipNumber', value: '' } ] };
            }
        });
        textarea.value = JSON.stringify(template, null, 2);
    }
    card.style.display = '';
    parseAtributos();
}

function instalacaoSelecionada() {
    const idx = el('instalacaoBolsaoSelect').value;
    return (idx === '') ? null : instalacoesAtivas[Number(idx)];
}

function selecionarSlotPorTabela(idx) {
    const slot = slotsCache[Number(idx)];
    if (!slot) return;
    slotSelecionado = slot;
    const sel = el('slotsSelect');
    if (sel) {
        const opt = Array.from(sel.options).find(o => Number(o.value) === Number(idx));
        if (opt) sel.value = String(idx);
    }
    renderizarTabelaSlots(slotsCache, slot);
    atualizarPreview();
}

document.addEventListener('DOMContentLoaded', () => {
    const box = el('slotsTabela');
    if (!box) return;
    box.addEventListener('click', (ev) => {
        const tr = ev.target.closest('tr[data-slot-idx]');
        if (!tr) return;
        const idx = tr.getAttribute('data-slot-idx');
        if (idx !== null) selecionarSlotPorTabela(idx);
    });
});

function renderizarTabelaSlots(slots, selecionado) {
    const box = el('slotsTabela');
    if (!box) return;
    if (!Array.isArray(slots) || slots.length === 0) {
        box.innerHTML = '<div class="empty-state">Nenhum slot disponivel para o intervalo solicitado.</div>';
        return;
    }
    const selId = selecionado ? (selecionado.id || selecionado.slotId || '') : null;
    const rows = slots.map((s, i) => {
        const inicio = s.startDate || s.date || s.slotDate || '—';
        const fim    = s.finishDate || '';
        const idSlot = s.id || s.slotId || s.workOrderId || '';
        const isSel  = selId && idSlot === selId;
        const estilo = isSel
            ? 'cursor:pointer; background:#fce4ec; font-weight:600;'
            : 'cursor:pointer;';
        return [
            '<tr class="', (isSel ? 'slot-selecionado' : 'slot-linha'), '" data-slot-idx="', i, '" style="', estilo, '">',
            '  <td style="text-align:center; font-weight:600;">', (i + 1), '</td>',
            '  <td>', inicio, (fim ? ' → ' + fim : ''), '</td>',
            '  <td><code style="font-size:0.78em; color:#666;">', idSlot, '</code></td>',
            '  <td style="text-align:center;">', (isSel ? '✅ Selecionado' : '👆 clique aqui'), '</td>',
            '</tr>'
        ].join('');
    }).join('');
    const cab = [
        '<table class="slots-tabela" style="width:100%; border-collapse:collapse; margin-top:10px; font-size:0.88em;">',
        '  <thead><tr style="background:#fce4ec; color:#880e4f;">',
        '    <th style="padding:8px; border:1px solid #f48fb1; width:40px;">#</th>',
        '    <th style="padding:8px; border:1px solid #f48fb1;">Horario</th>',
        '    <th style="padding:8px; border:1px solid #f48fb1;">Slot ID</th>',
        '    <th style="padding:8px; border:1px solid #f48fb1; width:120px;">Status</th>',
        '  </tr></thead>',
        '  <tbody>', rows, '</tbody>',
        '</table>'
    ].join('');
    box.innerHTML = cab;
}

function parseProdutos() {
    return el('produtosTextarea').value
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
}

function parseAtributos() {
    const card     = el('atributosCard');
    const textarea = el('atributosTextarea');
    const validacao = el('atributosValidacao');
    if (!card || !textarea) return null;
    if (card.style.display === 'none') return null;
    const raw = textarea.value.trim();
    if (!raw) {
        if (validacao) validacao.innerHTML = '';
        return null;
    }
    try {
        const obj = JSON.parse(raw);
        if (validacao) {
            validacao.innerHTML = '<span style="color:#28a745;">✅ JSON válido</span>';
        }
        return obj;
    } catch (err) {
        if (validacao) {
            validacao.innerHTML = '<span style="color:#c62828;">❌ JSON inválido: ' + err.message + '</span>';
        }
        return null;
    }
}

function atualizarPreview() {
    const corrOrig = el('correlationOrderOriginalInput').value.trim();
    const assocDoc = el('associatedDocumentInput').value.trim();
    const prods    = parseProdutos();
    const temAg    = el('temAgendamentoCheckbox').checked;

    el('prevAmb').textContent         = currentAmbiente   || '—';
    el('prevCp').textContent          = currentCp         || '—';
    el('prevCorrOrig').textContent    = corrOrig          || '—';
    el('prevAssoc').textContent       = assocDoc          || '—';
    el('prevProds').textContent       = prods.length ? prods.join(', ') : '—';
    el('prevSlot').textContent        = (temAg && slotSelecionado)
        ? (slotSelecionado.date || slotSelecionado.slotDate || 'slot selecionado')
        : (temAg ? '— (busque e selecione um slot)' : '— (sem agendamento)');
    el('prevAgendamento').textContent = (temAg && agendamentoId) ? agendamentoId : '—';

    const okBase = corrOrig && assocDoc && prods.length > 0 && currentCp;
    const okAg   = !temAg || (temAg && agendamentoId);
    el('btnCriar').disabled = !(okBase && okAg);
}

async function criarOSRetirada() {
    const correlationOrderOriginal = el('correlationOrderOriginalInput').value.trim();
    const associatedDocument       = el('associatedDocumentInput').value.trim();
    const produtos                 = parseProdutos();
    const atributos                = parseAtributos();
    const temAgendamento           = el('temAgendamentoCheckbox').checked;

    if (!correlationOrderOriginal) return mostrarResultado('erro', 'Informe o correlationOrderOriginal.');
    if (!associatedDocument)       return mostrarResultado('erro', 'Informe o associatedDocument.');
    if (produtos.length === 0)     return mostrarResultado('erro', 'Informe ao menos 1 produto.');
    if (!currentCp)                return mostrarResultado('erro', 'Selecione um CP.');
    if (temAgendamento && !agendamentoId) {
        return mostrarResultado('erro', 'Você marcou "Tem agendamento?" mas ainda não agendou o slot.');
    }

    el('btnCriar').disabled    = true;
    el('btnCriar').textContent = '⏳ Criando...';
    try {
        const body = {
            correlationOrderOriginal,
            associatedDocument,
            cp_selection:     currentCp,
            ambiente:         currentAmbiente,
            produtos,
            orderType:        'Retirada',
            slotSelecionado:  temAgendamento ? slotSelecionado : null,
            agendamentoId:    temAgendamento ? agendamentoId   : null
        };
        if (atributos) body.atributos = atributos;

        const res  = await fetch('/api/criar-os-retirada', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.status === 'sucesso') {
            const prodsTxt = (data.produtos || []).map(p => p.catalogId || p).join(', ');
            let msg = '✅ OS de Retirada criada com sucesso!\n\n' +
                'Order ID: ' + data.orderId + '\n' +
                'SubscriberId: ' + data.subscriberId + '\n' +
                'AssociatedDocument: ' + data.associatedDocument + '\n' +
                'Produtos: ' + prodsTxt + '\n' +
                'Ambiente: ' + data.ambiente + '\n';
            if (temAgendamento) msg += 'Agendamento: ' + agendamentoId + '\n';
            mostrarResultado('sucesso', msg, data);
        } else {
            mostrarResultado('erro', '❌ Erro: ' + data.message, data);
        }
    } catch (err) {
        console.error(err);
        mostrarResultado('erro', '❌ Erro: ' + err.message);
    } finally {
        el('btnCriar').disabled    = false;
        el('btnCriar').textContent = '📤 Criar OS de Retirada';
        atualizarPreview();
    }
}

function mostrarResultado(tipo, mensagem, raw) {
    const box = el('resultado');
    const cls = tipo === 'sucesso' ? 'result-box' : 'result-box error';
    let html = '<div class="' + cls + '"><strong>' + (tipo === 'sucesso' ? 'Sucesso' : 'Erro') + '</strong><div>' + mensagem.replace(/\n/g, '<br>') + '</div>';
    if (raw) html += '<pre>' + JSON.stringify(raw, null, 2) + '</pre>';
    html += '</div>';
    box.innerHTML = html;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function limparFormulario() {
    el('correlationOrderOriginalInput').value = '';
    el('associatedDocumentInput').value       = '';
    el('produtosTextarea').value              = '';
    el('instalacaoBolsaoSelect').value        = '';
    el('temAgendamentoCheckbox').checked      = false;
    el('blocoAgendamento').style.display      = 'none';
    el('slotsSelect').innerHTML               = '<option value="">— Busque slots primeiro —</option>';
    el('agendamentoInfo').textContent         = '';
    el('atributosTextarea').value             = '';
    el('atributosValidacao').innerHTML        = '';
    el('atributosCard').style.display         = 'none';
    slotSelecionado  = null;
    agendamentoId    = null;
    slotsCache       = [];
    el('resultado').innerHTML = '';
    atualizarPreview();
}