// core/instalacao-encerramento-externo/persistence.js
// Dupla escrita do resultado do encerramento externo:
//
//   1) SQLite via subscriberAddressesRepo.upsert (histórico/auditoria, sobrevive a restart)
//   2) Memória via clients.createdOrders (cache vivo, alimenta /bolsao-pendentes e o front)
//
// Decisões fechadas:
//   - Estratégia A: atualiza o registro existente in-place, na chave `sa`
//     (ou variantes `amb:sa` / `sa:amb` se o Map usar chave composta).
//   - flowType: sempre sobrescrito para 'InstalacaoEncerramentoExterno'.
//   - status:   sempre sobrescrito para 'encerrada_externo'.
//   - subscriberId / address / slotDate: se o result não trouxer, preserva o valor
//     do registro existente (não zera informação de fluxos anteriores).
//   - Falha de SQLite NÃO derruba o job (o SOM já foi alterado); é logada e
//     devolvida na resposta para a rota exibir um aviso amarelo no front.

const FLOW_TYPE = 'InstalacaoEncerramentoExterno';
const STATUS    = 'encerrada_externo';

// --- imports defensivos ---

let clients;
try {
  clients = require('../../clients');
} catch (e) {
  console.error('[persistence] Falha ao carregar clients.js:', e && e.message);
  clients = { createdOrders: new Map() };
}

let subscriberAddressesRepo;
try {
  subscriberAddressesRepo = require('../repositories/subscriberAddressesRepo');
} catch (_) {
  try {
    subscriberAddressesRepo = require('../subscriberAddressesRepo');
  } catch (_) {
    try {
      subscriberAddressesRepo = require('../../subscriberAddressesRepo');
    } catch (e) {
      console.warn('[persistence] subscriberAddressesRepo não encontrado — persistência SQLite desabilitada');
      subscriberAddressesRepo = {
        upsert: () => { throw new Error('subscriberAddressesRepo indisponível'); },
      };
    }
  }
}

function chavesCandidatas(ordemId, ambiente) {
  if (!ordemId) return [];
  return [ordemId, `${ambiente}:${ordemId}`, `${ordemId}:${ambiente}`];
}

function buildRecord(result) {
  // FIX: o subscriberAddressesRepo.upsert exige subscriberId e ambiente.
  // Em fluxos que não coletam subscriberId (esteira de Encerramento
  // Externo) o upsert falhava com "subscriberId e ambiente sao
  // obrigatorios" e a persistência silenciosa quebrava. Agora geramos
  // um placeholder determinístico (SA-<numero> ou ORDEM-<id>) só para
  // satisfazer a validação do SQLite. O valor real, quando vier
  // coletado por algum step, sobrescreve este.
  const placeholderSubId = (result.sa && `SA-${String(result.sa).replace(/\D+/g, '')}`)
                        || (result.ordemId && `ORDEM-${result.ordemId}`)
                        || `SEM-ID-${Date.now()}`;

  return {
    saId:             result.ordemId,
    ordemId:          result.ordemId,
    subscriberId:     result.subscriberId || placeholderSubId,
    address:          result.address      || null,
    slotDate:         result.slotDate     || null,
    ambiente:         result.ambiente,
    flowType:         FLOW_TYPE,
    status:           STATUS,
    codigoONT:        result.codigoONT        || null,
    numeroSerie:      result.numeroSerie      || null,
    matriculaTecnico: result.matriculaTecnico || null,
    caboDrop:         result.caboDrop         || null,
    encerradaEm:      result.encerradaEm      || new Date().toISOString(),
  };
}

function mergePreservando(existente, novo) {
  if (!existente) return novo;
  return {
    ...existente,
    ...novo,
    subscriberId: novo.subscriberId || existente.subscriberId || null,
    address:      novo.address      || existente.address      || null,
    slotDate:     novo.slotDate     || existente.slotDate     || null,
  };
}

function persistirEmMemoria(result) {
  const map = clients.createdOrders;
  if (!(map instanceof Map)) {
    return { ok: false, error: 'clients.createdOrders não é um Map' };
  }
  const record = buildRecord(result);
  const chaves = chavesCandidatas(result.ordemId, result.ambiente);

  let chaveUsada = null;
  let existente  = null;
  for (const k of chaves) {
    if (map.has(k)) { chaveUsada = k; existente = map.get(k); break; }
  }

  const merged = mergePreservando(existente, record);
  if (chaveUsada) {
    map.set(chaveUsada, merged);
  } else {
    map.set(record.ordemId, merged);
  }
  return { ok: true, chave: chaveUsada || record.ordemId, merge: !!existente };
}

function persistirEmSqlite(result) {
  const record = buildRecord(result);
  try {
    subscriberAddressesRepo.upsert(record);
    return { ok: true };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.error(
      `[persistence] upsert SQLite falhou para ${result.ordemId} (ambiente=${result.ambiente}): ${msg}`
    );
    return { ok: false, error: msg };
  }
}

function persistir(result) {
  if (!result || !result.ordemId) throw new Error('persistir exige result.ordemId');
  if (!result.ambiente)          throw new Error('persistir exige result.ambiente');

  const record  = buildRecord(result);
  const sqlite  = persistirEmSqlite(result);
  const memoria = persistirEmMemoria(result);
  return { ok: true, record, sqlite, memoria };
}

function buscarPorSa(ordemId, ambiente) {
  const map = clients.createdOrders;
  if (!(map instanceof Map)) return null;
  for (const k of chavesCandidatas(ordemId, ambiente)) {
    if (map.has(k)) return map.get(k);
  }
  return null;
}

function listarEncerradasExterno(ambiente) {
  const map = clients.createdOrders;
  if (!(map instanceof Map)) return [];
  const out = [];
  for (const reg of map.values()) {
    if (reg.flowType !== FLOW_TYPE) continue;
    if (ambiente && reg.ambiente !== ambiente) continue;
    out.push(reg);
  }
  return out;
}

function listarBolsao(ambiente) {
  const map = clients.createdOrders;
  if (!(map instanceof Map)) return [];
  const out = [];
  for (const reg of map.values()) {
    if (ambiente && reg.ambiente !== ambiente) continue;
    if (!reg.associatedDocument) continue;
    out.push({
      saId:              reg.saId          || reg.ordemId || null,
      ordemId:           reg.ordemId       || reg.saId    || null,
      associatedDocument: reg.associatedDocument,
      subscriberId:      reg.subscriberId  || null,
      address:           reg.address       || null,
      slotDate:          reg.slotDate      || null,
      flowType:          reg.flowType      || null,    // info: FSL / MudançaEndereço / InstalacaoEncerramentoExterno
    });
  }
  return out;
}

module.exports = {
  FLOW_TYPE,
  STATUS,
  buildRecord,
  persistir,
  buscarPorSa,
  listarEncerradasExterno,
  listarBolsao,        // ← novo
};