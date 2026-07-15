// subscriberAddressesRepo.js
// Repositorio para a tabela subscriber_addresses.
// Mantem upsert, findBySubscriberId, listAll, listByFlowType (zero regressão).
// Adiciona 4 helpers novos para o fluxo de Retirada (Instalacao + InstalacaoCancelada + Retirada coexistem).

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '../../portalnode.db');
const TABLE = 'subscriber_addresses';

let _db = null;
function getDb() {
    if (!_db) {
        _db = new Database(DB_PATH);
        _db.pragma('journal_mode = WAL');
    }
    return _db;
}

// ─────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────

function readProducts(row) {
    if (!row) return [];
    if (row.products_json) {
        try {
            const arr = JSON.parse(row.products_json);
            return Array.isArray(arr) ? arr : [];
        } catch (_) {
            return [];
        }
    }
    if (row.product_catalog_id) return [row.product_catalog_id];
    return [];
}

function serializeProducts(produtos) {
    if (!produtos) return null;
    const arr = Array.isArray(produtos) ? produtos : [produtos];
    return JSON.stringify(arr.map(p => (typeof p === 'string' ? p : p.catalogId || p)));
}

// ─────────────────────────────────────────────
// API existente — NAO TOCAR (zero regressão)
// ─────────────────────────────────────────────

function upsert(record) {
    if (!record || !record.subscriberId || !record.ambiente) {
        throw new Error('subscriberId e ambiente sao obrigatorios em upsert');
    }
    const db = getDb();
    const now = new Date().toISOString();

    const existing = db.prepare(
        `SELECT * FROM ${TABLE} WHERE subscriber_id = ? AND ambiente = ?`
    ).get(String(record.subscriberId), String(record.ambiente));

    const productsJson = serializeProducts(record.produtos);

    if (existing) {
        db.prepare(`
            UPDATE ${TABLE} SET
                cp                  = @cp,
                order_id            = @order_id,
                correlation_order   = @correlation_order,
                associated_document = @associated_document,
                address_id          = @address_id,
                inventory_id        = @inventory_id,
                complement_type     = @complement_type,
                complement_value    = @complement_value,
                product_catalog_id  = @product_catalog_id,
                flow_type           = @flow_type,
                products_json       = @products_json,
                updated_at          = @updated_at
            WHERE subscriber_id = @subscriber_id AND ambiente = @ambiente
        `).run({
            cp:                  record.cp || existing.cp,
            order_id:            record.orderId || existing.order_id,
            correlation_order:   record.correlationOrder || existing.correlation_order,
            associated_document: record.associatedDocument || existing.associated_document,
            address_id:          record.addressId || existing.address_id,
            inventory_id:        record.inventoryId || existing.inventory_id,
            complement_type:     record.complementType || existing.complement_type,
            complement_value:    record.complementValue || existing.complement_value,
            product_catalog_id:  record.productCatalogId || existing.product_catalog_id,
            flow_type:           record.flowType || existing.flow_type,
            products_json:       productsJson || existing.products_json,
            updated_at:          now,
            subscriber_id:       String(record.subscriberId),
            ambiente:            String(record.ambiente)
        });
    } else {
        db.prepare(`
            INSERT INTO ${TABLE} (
                subscriber_id, ambiente, cp, order_id, correlation_order, associated_document,
                address_id, inventory_id, complement_type, complement_value, product_catalog_id,
                flow_type, products_json, created_at, updated_at
            ) VALUES (
                @subscriber_id, @ambiente, @cp, @order_id, @correlation_order, @associated_document,
                @address_id, @inventory_id, @complement_type, @complement_value, @product_catalog_id,
                @flow_type, @products_json, @created_at, @updated_at
            )
        `).run({
            subscriber_id:       String(record.subscriberId),
            ambiente:            String(record.ambiente),
            cp:                  record.cp || null,
            order_id:            record.orderId || null,
            correlation_order:   record.correlationOrder || null,
            associated_document: record.associatedDocument || null,
            address_id:          record.addressId || null,
            inventory_id:        record.inventoryId || null,
            complement_type:     record.complementType || null,
            complement_value:    record.complementValue || null,
            product_catalog_id:  record.productCatalogId || null,
            flow_type:           record.flowType || 'Instalacao',
            products_json:       productsJson,
            created_at:          now,
            updated_at:          now
        });
    }

    return findBySubscriberId(record.subscriberId, record.ambiente);
}

function findBySubscriberId(subscriberId, ambiente) {
    if (!subscriberId || !ambiente) return null;
    const db = getDb();
    const row = db.prepare(
        `SELECT * FROM ${TABLE} WHERE subscriber_id = ? AND ambiente = ?`
    ).get(String(subscriberId), String(ambiente));
    if (!row) return null;
    return { ...row, produtos: readProducts(row) };
}

function listAll() {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM ${TABLE} ORDER BY created_at DESC`).all();
    return rows.map(r => ({ ...r, produtos: readProducts(r) }));
}

function listByFlowType(flowType, ambiente) {
    const db = getDb();
    const rows = db.prepare(
        `SELECT * FROM ${TABLE} WHERE flow_type = ? AND ambiente = ? ORDER BY created_at DESC`
    ).all(String(flowType), String(ambiente));
    return rows.map(r => ({ ...r, produtos: readProducts(r) }));
}

// ─────────────────────────────────────────────
// Helpers novos para o fluxo de Retirada (Instalacao + InstalacaoCancelada + Retirada coexistem)
// ─────────────────────────────────────────────

/**
 * Insere um novo registro para um flow_type específico.
 * Como o UNIQUE agora é (subscriber_id, ambiente, flow_type), este INSERT
 * convive com Instalacao e InstalacaoCancelada existentes.
 * Se já existir (subscriber_id, ambiente, flow_type), atualiza (idempotente).
 */
function insertByFlowType(record) {
    if (!record || !record.subscriberId || !record.ambiente || !record.flowType) {
        throw new Error('subscriberId, ambiente e flowType sao obrigatorios em insertByFlowType');
    }
    return upsert(record);
}

/**
 * Marca uma Instalacao como InstalacaoCancelada localmente.
 * Cria (ou atualiza) a linha (subscriber_id, ambiente, 'InstalacaoCancelada') copiando
 * os dados principais da Instalacao original, com updated_at novo.
 * Retorna true se houve mudanca (linha nova), false se ja estava cancelada.
 */
function markInstalacaoAsCancelled(subscriberId, ambiente) {
    if (!subscriberId || !ambiente) {
        throw new Error('subscriberId e ambiente sao obrigatorios');
    }
    const db = getDb();

    const original = findBySubscriberId(subscriberId, ambiente);
    if (!original) {
        throw new Error(`Instalacao original nao encontrada para subscriberId=${subscriberId}, ambiente=${ambiente}`);
    }

    const jaCancelada = db.prepare(
        `SELECT 1 FROM ${TABLE} WHERE subscriber_id = ? AND ambiente = ? AND flow_type = 'InstalacaoCancelada'`
    ).get(String(subscriberId), String(ambiente));

    const now = new Date().toISOString();

    if (jaCancelada) {
        db.prepare(
            `UPDATE ${TABLE} SET updated_at = ? WHERE subscriber_id = ? AND ambiente = ? AND flow_type = 'InstalacaoCancelada'`
        ).run(now, String(subscriberId), String(ambiente));
        return false;
    }

    db.prepare(`
        INSERT INTO ${TABLE} (
            subscriber_id, ambiente, cp, order_id, correlation_order, associated_document,
            address_id, inventory_id, complement_type, complement_value, product_catalog_id,
            flow_type, products_json, created_at, updated_at
        ) VALUES (
            @subscriber_id, @ambiente, @cp, @order_id, @correlation_order, @associated_document,
            @address_id, @inventory_id, @complement_type, @complement_value, @product_catalog_id,
            'InstalacaoCancelada', @products_json, @created_at, @updated_at
        )
    `).run({
        subscriber_id:       String(original.subscriber_id),
        ambiente:            String(original.ambiente),
        cp:                  original.cp,
        order_id:            original.order_id,
        correlation_order:   original.correlation_order,
        associated_document: original.associated_document,
        address_id:          original.address_id,
        inventory_id:        original.inventory_id,
        complement_type:     original.complement_type,
        complement_value:    original.complement_value,
        product_catalog_id:  original.product_catalog_id,
        products_json:       original.products_json,
        created_at:          now,
        updated_at:          now
    });
    return true;
}

/**
 * Reativa uma Instalacao: remove a linha InstalacaoCancelada (rollback).
 * Use quando a chamada à V.tal falhar depois de termos marcado como cancelada.
 * Retorna true se removeu, false se não havia o que reverter.
 */
function reactivateInstalacao(subscriberId, ambiente) {
    if (!subscriberId || !ambiente) {
        throw new Error('subscriberId e ambiente sao obrigatorios');
    }
    const db = getDb();
    const result = db.prepare(
        `DELETE FROM ${TABLE} WHERE subscriber_id = ? AND ambiente = ? AND flow_type = 'InstalacaoCancelada'`
    ).run(String(subscriberId), String(ambiente));
    return result.changes > 0;
}

/**
 * Lista Instalacoes ativas (flow_type = 'Instalacao') que ainda nao foram canceladas.
 * É o que alimenta o dropdown da tela de Retirada.
 */
function listActiveInstalacoes(ambiente) {
    const db = getDb();
    const rows = db.prepare(
        `SELECT i.* FROM ${TABLE} i
          WHERE i.flow_type = 'Instalacao'
            AND i.ambiente = ?
            AND NOT EXISTS (
                SELECT 1 FROM ${TABLE} c
                 WHERE c.subscriber_id = i.subscriber_id
                   AND c.ambiente      = i.ambiente
                   AND c.flow_type     = 'InstalacaoCancelada'
            )
          ORDER BY i.created_at DESC`
    ).all(String(ambiente));
    return rows.map(r => ({ ...r, produtos: readProducts(r) }));
}


module.exports = {
    upsert, findBySubscriberId, listAll, listByFlowType, readProducts,
    // Novos helpers (Retirada):
    insertByFlowType, markInstalacaoAsCancelled, reactivateInstalacao, listActiveInstalacoes
};
