-- 002_subscriber_addresses_products_json.sql
-- Adiciona a coluna products_json (TEXT) à tabela subscriber_addresses.
-- Idempotente: pode rodar mais de uma vez sem erro.
--
-- Como rodar (uma vez):
--   sqlite3 portalnode.db < 002_subscriber_addresses_products_json.sql
-- Ou via Node:
--   node -e "require('./database').getDb().exec(require('fs').readFileSync('002_subscriber_addresses_products_json.sql','utf8'))"
--
-- O repo subscriberAddressesRepo.js já faz o ALTER TABLE em runtime (idempotente),
-- então esta migration é opcional — use-a se quiser materializar a coluna antes
-- do primeiro upsert.

ALTER TABLE subscriber_addresses ADD COLUMN products_json TEXT;
