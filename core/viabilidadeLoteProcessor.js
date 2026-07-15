// core/viabilidadeLoteProcessor.js
//
// ✅ CORREÇÕES APLICADAS (zero regressão, contrato externo idêntico):
//    1. Refresh de token a cada BATCH_SIZE linhas (não reinicia o processo).
//    2. Retry automático para 401, 429 e timeouts de rede (uma única retentativa).
//    3. Detecção de "tem slot" robusta — testa vários formatos conhecidos
//       da API e grava SIM/NÃO. Preserva JSON bruto em SLOTS_RAW.
//    4. Logs de progresso a cada BATCH_SIZE linhas para telemetria.
//    5. Retorna o mesmo formato (string com o caminho) — app.js não muda.
//
// 🟢 NOVO (rodada 3 de diagnóstico): parsing inteligente do complemento
//    da planilha (separa type+value) + match por type+value na lista da API
//    + fallback para o primeiro complemento disponível quando a planilha
//    está vazia mas o endereço exige um.
//
// 🟢 FIX 1-linha (rodada 4): usar `buscarSlotsDisponiveis` (nome exportado
//    em produção pelo agendamento.js) em vez de `buscarSlots` (que não existe
//    no módulo). Assinatura idêntica, só o nome.

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { getTokenForCp } = require('./auth');
const { buscarEndereco, buscarComplementos, verificarDisponibilidade } = require('./viabilidade');
// 🟢 FIX: import do nome correto exportado pelo agendamento.js
const { buscarSlotsDisponiveis } = require('./agendamento');

const BATCH_SIZE = 10;

function gerarSubscriberIdLocal() {
    const tsPart   = String(Date.now()).slice(-8);
    const randPart = String(Math.floor(Math.random() * 100)).padStart(2, '0');
    return `TDMQAOSS${tsPart}${randPart}`;
}

function norm(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

function clean(v) {
    const s = String(v ?? '').trim();
    if (s === '"' || s === '""') return '';
    return s;
}

function pick(row, aliases) {
    const map = {};
    for (const k of Object.keys(row)) map[norm(k)] = row[k];
    for (const a of aliases) {
        const v = map[norm(a)];
        if (v !== undefined) return clean(v);
    }
    return '';
}

function mapRow(row) {
    const cep = pick(row, ['CEP']);
    const fachada = pick(row, ['Nº FACHADA', 'N° FACHADA', 'NUMERO FACHADA', 'FACHADA']);
    const endereco = pick(row, ['LOGRADOURO', 'ENDEREÇO', 'ENDERECO']);
    const comp1 = pick(row, ['COMPLEMENTO 1', 'COMPLEMENTOS']);
    const comp2 = pick(row, ['COMPLEMENTO 2']);
    const comp3 = pick(row, ['COMPLEMENTO 3']);
    const complementos = [comp1, comp2, comp3].filter(Boolean).join(' | ');

    return {
        cep,
        fachada,
        endereco,
        complementos,
        municipio: pick(row, ['MUNICÍPIO', 'MUNICIPIO']),
        bairro: pick(row, ['BAIRRO']),
        uf: pick(row, ['UF']),
        codigoLogradouro: pick(row, ['CÓDIGO LOGRADOURO', 'CODIGO LOGRADOURO']),
        codigoCDO: pick(row, ['CÓDIGO CDO', 'CODIGO CDO']),
        raw: row
    };
}

function getSubscriberId(clientsConfig, cp_selection) {
    const cpCfg = clientsConfig?.[cp_selection] || {};
    return (
        cpCfg.subscriberId ||
        cpCfg.subscriber_id ||
        cpCfg.subscriber ||
        ''
    );
}

function getProductType(clientsConfig, cp_selection) {
    const cpCfg = clientsConfig?.[cp_selection] || {};
    return cpCfg.productType || 'Banda Larga';
}

function extrairSlots(slots) {
    if (!slots) return [];
    if (Array.isArray(slots)) return slots;
    if (Array.isArray(slots.slots)) return slots.slots;
    if (Array.isArray(slots.appointmentSlot)) return slots.appointmentSlot;
    if (Array.isArray(slots.slotList)) return slots.slotList;
    if (Array.isArray(slots.appointments)) return slots.appointments;
    if (slots.appointment && Array.isArray(slots.appointment.slots)) return slots.appointment.slots;
    if (slots.appointment && Array.isArray(slots.appointment.appointmentSlot)) {
        return slots.appointment.appointmentSlot;
    }
    console.warn('[VIAB-LOTE] Formato de slots desconhecido:', JSON.stringify(slots).slice(0, 200));
    return [];
}

function normalizarValue(v) {
    return String(v || '').trim().replace(/^0+/, '').toUpperCase();
}

function parseComplementoTexto(texto) {
    if (!texto) return null;
    const t = String(texto).trim();
    if (!t) return null;

    if (t.includes('|') || t.includes(',')) {
        return { type: null, value: t.toUpperCase(), composed: true };
    }

    const m = t.match(/^([A-Za-z]{1,3})[\s\-_]*(\d+\w*)$/);
    if (m) {
        return { type: m[1].toUpperCase(), value: m[2].toUpperCase(), composed: false };
    }

    return { type: null, value: t.toUpperCase(), composed: false };
}

function escolherComplemento(listaComplementos, parsed) {
    if (!Array.isArray(listaComplementos) || listaComplementos.length === 0) {
        return { complemento: null, estrategia: 'vazio' };
    }

    if (!parsed) {
        return { complemento: listaComplementos[0], estrategia: 'fallback-primeiro' };
    }

    const valueNorm = normalizarValue(parsed.value);

    if (parsed.type) {
        const exato = listaComplementos.find(c => {
            const typeOk = String(c.type || '').toUpperCase() === parsed.type;
            const valueOk = normalizarValue(c.value) === valueNorm;
            return typeOk && valueOk;
        });
        if (exato) return { complemento: exato, estrategia: 'exato-type-value' };
    }

    const porValue = listaComplementos.find(c =>
        normalizarValue(c.value) === valueNorm
    );
    if (porValue) return { complemento: porValue, estrategia: 'so-value' };

    return { complemento: listaComplementos[0], estrategia: 'fallback-primeiro' };
}

async function withRetry(fn, { label, onUnauthorized } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            return await fn(attempt);
        } catch (e) {
            lastErr = e;
            const status = e.status || e.response?.status;
            const isNetwork = !e.response && (e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED');

            if (status === 401 && onUnauthorized && attempt === 1) {
                console.warn(`[VIAB-LOTE] ${label} → 401, tentando renovar token e refazer...`);
                const novo = await onUnauthorized();
                if (novo) continue;
            }
            if (status === 429 && attempt === 1) {
                const espera = 2000;
                console.warn(`[VIAB-LOTE] ${label} → 429, aguardando ${espera}ms e tentando de novo...`);
                await new Promise(r => setTimeout(r, espera));
                continue;
            }
            if (isNetwork && attempt === 1) {
                console.warn(`[VIAB-LOTE] ${label} → erro de rede (${e.code}), tentando de novo em 1s...`);
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }
            throw e;
        }
    }
    throw lastErr;
}

async function processarPlanilhaViabilidade(filePath, cp_selection, clientsConfig, ambiente = 'TRG', jobStore = null) {
    function updateJob(patch) {
        if (jobStore) Object.assign(jobStore, patch);
    }
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

            if (!clientsConfig?.[cp_selection]) {
        throw new Error(`Config do CP não encontrada: ${cp_selection}`);
    }

    console.log(`[VIAB-LOTE] Iniciando processamento | CP: ${cp_selection} | Ambiente: ${ambiente} | Linhas: ${rows.length} | BATCH_SIZE: ${BATCH_SIZE}`);

    updateJob({ total: rows.length, jobStatus: 'processando' });

    let tokenData = await getTokenForCp(cp_selection, clientsConfig, ambiente);
    let accessToken = tokenData?.access_token;

    if (!accessToken) {
        throw new Error('Não foi possível obter token inicial.');
    }

    const productType = getProductType(clientsConfig, cp_selection);

    const refreshToken = async () => {
        const t = await getTokenForCp(cp_selection, clientsConfig, ambiente);
        if (t?.access_token) {
            accessToken = t.access_token;
            console.log(`[VIAB-LOTE] Token renovado.`);
            return true;
        }
        return false;
    };

    const results = [];
    let total = 0, ok = 0, erro = 0, ignorado = 0;

    for (let i = 0; i < rows.length; i++) {
        const raw = rows[i];
        total++;

        if (i > 0 && i % BATCH_SIZE === 0) {
            console.log(`[VIAB-LOTE] Refresh de token antes da linha ${i + 1} (${i} processadas até agora).`);
            const t = await getTokenForCp(cp_selection, clientsConfig, ambiente);
            if (t?.access_token) {
                accessToken = t.access_token;
                console.log(`[VIAB-LOTE] Token renovado com sucesso antes da linha ${i + 1}.`);
            } else {
                console.warn(`[VIAB-LOTE] ⚠️ Não foi possível renovar o token antes da linha ${i + 1}. Segurando com o anterior.`);
            }
        }

        const r = mapRow(raw);

        if (!r.cep || !r.endereco) {
            ignorado++;
            results.push({
                ...raw,
                STATUS: 'IGNORADO',
                MOTIVO: 'CEP/Logradouro ausente após mapeamento'
            });
            continue;
        }

        try {
            const token = accessToken;
            if (!token) {
                throw new Error('Token vazio antes de buscar endereço');
            }

            const enderecoResp = await withRetry(
                () => buscarEndereco(r.cep, r.fachada, token, ambiente),
                { label: 'buscarEndereco', onUnauthorized: refreshToken }
            );

            const addressId = enderecoResp?.addresses?.address?.[0]?.id;
            const complementoTexto = r.complementos || '';

            if (!addressId) {
                throw new Error('addressId não encontrado no retorno de buscarEndereco');
            }

            const subscriberId = gerarSubscriberIdLocal();
            console.log(`[VIAB-LOTE] subscriberId gerado: ${subscriberId} | addressId: ${addressId}`);

            let complementoObj = { id: null, type: '', description: '', value: '' };
            try {
                const listaComplementos = await withRetry(
                    () => buscarComplementos(addressId, token, ambiente),
                    { label: 'buscarComplementos', onUnauthorized: refreshToken }
                );

                if (Array.isArray(listaComplementos) && listaComplementos.length > 0) {
                    if (complementoTexto && (complementoTexto.includes('|') || complementoTexto.includes(','))) {
                        console.warn(`[VIAB-LOTE] complemento composto "${complementoTexto}" detectado. Usando o 1º disponível: ${listaComplementos[0].value} (${listaComplementos[0].type}).`);
                        complementoObj = listaComplementos[0];
                    } else {
                        const parsed = parseComplementoTexto(complementoTexto);
                        const { complemento, estrategia } = escolherComplemento(listaComplementos, parsed);

                        if (complemento) {
                            complementoObj = complemento;
                            const parsedStr = parsed ? `${parsed.type || '?'}:${parsed.value}` : 'null';
                            console.log(`[VIAB-LOTE] complemento escolhido: ${complementoObj.value} (${complementoObj.type}) [parsed=${parsedStr}, estrategia=${estrategia}]`);
                        }
                    }
                } else {
                    console.log(`[VIAB-LOTE] endereço ${addressId} sem complementos opcionais.`);
                }
            } catch (e) {
                console.warn(`[VIAB-LOTE] falha ao buscar complementos (não fatal): ${e.message}`);
            }

            console.log('[VIAB-LOTE] verificarDisponibilidade params:', {
                addressId,
                complementoObj,
                cp_selection,
                subscriberId,
                ambiente,
                tokenPreview: token ? `${token.slice(0, 10)}...` : 'N/A'
            });

            const disponibilidade = await withRetry(
                () => verificarDisponibilidade(
                    addressId,
                    complementoObj,
                    cp_selection,
                    token,
                    subscriberId,
                    ambiente
                ),
                { label: 'verificarDisponibilidade', onUnauthorized: refreshToken }
            );

            // 🟢 FIX: usar o nome correto exportado em produção
            const slots = await withRetry(
                () => buscarSlotsDisponiveis(
                    addressId,
                    subscriberId,
                    productType,
                    token,
                    cp_selection,
                    ambiente,
                    {}
                ),
                { label: 'buscarSlots', onUnauthorized: refreshToken }
            );

            const listaSlots = extrairSlots(slots);
            const slotStatus = listaSlots.length > 0 ? 'SIM' : 'NÃO';

            ok++;
            // 🟢 FIX polling: atualiza contadores no job store
            updateJob({ processadas: total, ok });

            ok++;
            results.push({
                ...raw,
                CEP_NORMALIZADO: r.cep,
                FACHADA_NORMALIZADA: r.fachada,
                ENDERECO_NORMALIZADO: r.endereco,
                COMPLEMENTOS_NORMALIZADOS: r.complementos,
                COMPLEMENTO_TIPO: complementoObj.type || '',
                COMPLEMENTO_VALOR: complementoObj.value || '',
                SUBSCRIBER_ID_GERADO: subscriberId,
                AMBIENTE: ambiente,
                STATUS: 'PROCESSADO',
                DISPONIBILIDADE: JSON.stringify(disponibilidade || {}),
                SLOTS: slotStatus,
                SLOTS_RAW: JSON.stringify(slots || {}),
                SLOTS_QTD: listaSlots.length
            });

            if (total % BATCH_SIZE === 0) {
                console.log(`[VIAB-LOTE] Progresso: ${total}/${rows.length} | ok: ${ok} | erro: ${erro} | ignorado: ${ignorado}`);
            }

        } catch (e) {
            erro++;
            results.push({
                ...raw,
                AMBIENTE: ambiente,
                STATUS: 'ERRO',
                MOTIVO: e.message
            });
            if (total % BATCH_SIZE === 0) {
                console.log(`[VIAB-LOTE] Progresso: ${total}/${rows.length} | ok: ${ok} | erro: ${erro} | ignorado: ${ignorado}`);
            }
        }
    }

    console.log(`[VIAB-LOTE] Ambiente: ${ambiente} | total: ${total} | ok: ${ok} | erro: ${erro} | ignorado: ${ignorado} | saida: ${results.length}`);

    const outDir = path.join(__dirname, '../processed_spreadsheets');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outPath = path.join(outDir, `viabilidade_resultado_${Date.now()}.xlsx`);
    const outWb = XLSX.utils.book_new();
    const outWs = XLSX.utils.json_to_sheet(results);
    XLSX.utils.book_append_sheet(outWb, outWs, 'Resultados Viabilidade');
    XLSX.writeFile(outWb, outPath);

    return outPath;
}

module.exports = { processarPlanilhaViabilidade };
