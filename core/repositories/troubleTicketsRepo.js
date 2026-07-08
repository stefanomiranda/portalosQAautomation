// core/repositories/troubleTicketsRepo.js
//
// Repositorio de Trouble Tickets. Persiste tudo que a Suite 2 gera.
//
// Requer tabela (criada por 001_portalnode_diagnostico_tt.sql):
//   CREATE TABLE trouble_tickets (
//     id                   INT AUTO_INCREMENT PRIMARY KEY,
//     ambiente             VARCHAR(8)    NOT NULL,
//     diagnostico_id       INT           NULL,
//     created_order_id     INT           NULL,
//     tt_id_externo        VARCHAR(128)  NULL,
//     tt_protocolo         VARCHAR(64)   NULL,
//     status               VARCHAR(32)   NOT NULL DEFAULT 'ABERTO',
//     t088_status          VARCHAR(32)   NOT NULL DEFAULT 'PENDENTE_HUMANO',
//     slot_id              VARCHAR(128)  NULL,
//     agendamento_id       VARCHAR(128)  NULL,
//     request_open         JSON          NULL,
//     response_open        JSON          NULL,
//     request_patch        JSON          NULL,
//     response_patch       JSON          NULL,
//     notificacoes_payload JSON          NULL,
//     erro_msg             TEXT          NULL,
//     created_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
//     updated_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
//   );

const db = require('../../database');

async function createTroubleTicket(data) {
  const sql = `
    INSERT INTO trouble_tickets
      (ambiente, diagnostico_id, created_order_id, tt_id_externo, tt_protocolo, status, t088_status, slot_id, agendamento_id, request_open, response_open, erro_msg)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const result = await db.execute(sql, [
    data.ambiente,
    data.diagnosticoId || null,
    data.createdOrderId || null,
    data.ttIdExterno || null,
    data.ttProtocolo || null,
    data.status || 'ABERTO',
    data.t088Status || 'PENDENTE_HUMANO',
    data.slotId || null,
    data.agendamentoId || null,
    data.requestOpen ? JSON.stringify(data.requestOpen) : null,
    data.responseOpen ? JSON.stringify(data.responseOpen) : null,
    data.erroMsg || null
  ]);
  return result.insertId;
}

async function patchTroubleTicket(id, data) {
  const sql = `
    UPDATE trouble_tickets
       SET status = ?,
           request_patch = ?,
           response_patch = ?,
           erro_msg = ?,
           updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
  `;
  await db.execute(sql, [
    data.status,
    data.requestPatch ? JSON.stringify(data.requestPatch) : null,
    data.responsePatch ? JSON.stringify(data.responsePatch) : null,
    data.erroMsg || null,
    id
  ]);
}

async function saveNotificacoes(id, notificacoesPayload) {
  await db.execute(
    `UPDATE trouble_tickets
        SET notificacoes_payload = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [JSON.stringify(notificacoesPayload || {}), id]
  );
}

module.exports = { createTroubleTicket, patchTroubleTicket, saveNotificacoes };