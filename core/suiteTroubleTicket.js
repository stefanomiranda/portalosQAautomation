// core/suiteTroubleTicket.js
//
// Suite 2 (Chamado Tecnico): busca slot, abre Trouble Ticket, faz patch V2,
// consulta notificacoes. Implementacao real (sem stubs).
//
// Contrato consumido pelo app.js (linhas 22-23):
//   buscarSlotEAgendar({ ambiente, addressId, subscriberId, productType,
//                        accessToken, cp_selection })
//     -> { slot, agendamentoResp }
//   abrirTroubleTicket({ ambiente, payload, accessToken })
//     -> { id (ou troubleTicket.id), protocol (ou troubleTicket.protocol), ... }
//   patchTroubleTicketV2({ ambiente, ttId, payload, accessToken })
//     -> objeto livre
//   consultarNotificacoesTT({ ambiente, ttId, accessToken })
//     -> objeto livre
//
// URLs consumidas (definidas em config.js):
//   APPOINTMENT_SLOTS_URL  - GET para listar slots disponiveis
//   APPOINTMENT_AGENDAR_URL - POST para confirmar slot
//   TT_OPEN_URL            - POST para abrir Trouble Ticket
//   TT_PATCH_V2_URL        - PATCH para atualizar TT
//   TT_NOTIF_URL           - GET para listar notificacoes

const {
  APPOINTMENT_SLOTS_URL,
  APPOINTMENT_AGENDAR_URL,
  TT_OPEN_URL,
  TT_PATCH_V2_URL,
  TT_NOTIF_URL
} = require('../config');

function buildUrl(base, params) {
  if (!base) return '';
  const sep = base.includes('?') ? '&' : '?';
  const query = Object.keys(params || {})
    .filter((k) => params[k] !== null && params[k] !== undefined && params[k] !== '')
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  return base + (query ? sep + query : '');
}

async function buscarSlotEAgendar(params) {
  // 1) Buscar slots disponiveis
  const slotsUrl = buildUrl(APPOINTMENT_SLOTS_URL, {
    ambiente: params.ambiente,
    addressId: params.addressId,
    subscriberId: params.subscriberId,
    productType: params.productType,
    orderType: 'Instalacao'
  });

  const slotsResp = await fetch(slotsUrl, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + (params.accessToken || ''),
      'Content-Type': 'application/json'
    }
  });
  const slotsData = await slotsResp.json().catch(() => ({}));

  // A API externa pode devolver o array em varios formatos
  const slots = slotsData.slots || slotsData.appointments || slotsData.data || (Array.isArray(slotsData) ? slotsData : []);
  const slot = slots[0] || null;

  if (!slot) {
    return {
      slot: null,
      agendamentoResp: null,
      erro: 'Nenhum slot disponivel para o endereco informado.'
    };
  }

  // 2) Confirmar agendamento do primeiro slot
  const agendarUrl = buildUrl(APPOINTMENT_AGENDAR_URL, {
    ambiente: params.ambiente,
    slotId: slot.slotId || slot.id
  });

  const agendarResp = await fetch(agendarUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + (params.accessToken || ''),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      slotId: slot.slotId || slot.id,
      addressId: params.addressId,
      inventoryId: slot.inventoryId,
      productType: params.productType,
      subscriberId: params.subscriberId,
      cp_selection: params.cp_selection
    })
  });
  const agendamentoData = await agendarResp.json().catch(() => ({}));

  return {
    slot: slot,
    agendamentoResp: agendamentoData,
    erro: agendarResp.ok ? null : ('Erro HTTP ' + agendarResp.status + ' ao agendar')
  };
}

async function abrirTroubleTicket(params) {
  const url = buildUrl(TT_OPEN_URL, { ambiente: params.ambiente });
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + (params.accessToken || ''),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params.payload || {})
  });
  const data = await resp.json().catch(() => ({}));

  // Normalizar campos - diferentes APIs usam nomes diferentes
  const tt = data.troubleTicket || data.order || data;
  return {
    httpStatus: resp.status,
    ok: resp.ok,
    id: tt.id || data.id || null,
    externalId: tt.externalId || data.externalId || null,
    protocol: tt.protocol || data.protocol || null,
    troubleTicketId: tt.id || data.id || null,
    troubleTicketProtocolo: tt.protocol || data.protocol || null,
    raw: data
  };
}

async function patchTroubleTicketV2(params) {
  const url = buildUrl(TT_PATCH_V2_URL, {
    ambiente: params.ambiente,
    ttId: params.ttId
  });
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + (params.accessToken || ''),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params.payload || {})
  });
  const data = await resp.json().catch(() => ({}));
  return {
    httpStatus: resp.status,
    ok: resp.ok,
    raw: data
  };
}

async function consultarNotificacoesTT(params) {
  const url = buildUrl(TT_NOTIF_URL, {
    ambiente: params.ambiente,
    ttId: params.ttId
  });
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + (params.accessToken || '')
    }
  });
  const data = await resp.json().catch(() => ({}));
  return {
    httpStatus: resp.status,
    ok: resp.ok,
    raw: data
  };
}

module.exports = {
  buscarSlotEAgendar,
  abrirTroubleTicket,
  patchTroubleTicketV2,
  consultarNotificacoesTT
};