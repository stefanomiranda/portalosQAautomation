-- setup-db-003-subscriber-addresses-flow-type-unique.sql
-- Objetivo: permitir histórico completo (Instalacao + InstalacaoCancelada + Retirada)
--           por (subscriber_id, ambiente), trocando o UNIQUE para incluir flow_type.
-- Idempotente: pode rodar várias vezes sem quebrar.

-- 1) Descobre os nomes reais dos índices UNIQUE antigos sobre (subscriber_id, ambiente).
--    (SQLite não tem IF EXISTS para UNIQUE constraint na criação da tabela;
--     precisamos derrubar tanto o índice auto quanto qualquer índice manual.)

DROP INDEX IF EXISTS idx_subscriber_addresses_subscriber_ambiente;
DROP INDEX IF EXISTS uq_subscriber_addresses_subscriber_ambiente;
DROP INDEX IF EXISTS sqlite_autoindex_subscriber_addresses_1;

-- 2) Cria o novo UNIQUE que aceita até 3 linhas por (subscriber_id, ambiente):
--    uma Instalacao + uma InstalacaoCancelada + uma Retirada.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriber_addresses_subscriber_ambiente_flow
  ON subscriber_addresses (subscriber_id, ambiente, flow_type);

-- 3) Diagnóstico: se a tabela já tiver dados duplicados (improvável em dev),
--    esta query mostra quais (subscriber_id, ambiente, flow_type) estão em conflito.
--    Rode manualmente se o CREATE UNIQUE INDEX falhar:
--      SELECT subscriber_id, ambiente, flow_type, COUNT(*) AS total
--        FROM subscriber_addresses
--       GROUP BY subscriber_id, ambiente, flow_type
--      HAVING COUNT(*) > 1;
