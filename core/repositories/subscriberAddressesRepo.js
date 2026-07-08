// core/repositories/subscriberAddressesRepo.js
const { getDb } = require('../../database');
const TABLE = 'subscriber_addresses';

function upsert(record) {
    if (!record || !record.subscriberId || !record.ambiente) {
        throw new Error('subscriberId e ambiente são obrigatórios');
    }
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO ${TABLE} (
            subscriber_id, ambiente, cp, order_id, correlation_order, associated_document,
            address_id, inventory_id, complement_type, complement_value, product_catalog_id,
            flow_type, created_at, updated_at
        ) VALUES (
            @subscriber_id, @ambiente, @cp, @order_id, @correlation_order, @associated_document,
            @address_id, @inventory_id, @complement_type, @complement_value, @product_catalog_id,
            @flow_type, @created_at, @updated_at
        )
        ON CONFLICT(subscriber_id, ambiente) DO UPDATE SET
            cp = excluded.cp,
            order_id = excluded.order_id,
            correlation_order = excluded.correlation_order,
            associated_document = excluded.associated_document,
            address_id = excluded.address_id,
            inventory_id = excluded.inventory_id,
            complement_type = excluded.complement_type,
            complement_value = excluded.complement_value,
            product_catalog_id = excluded.product_catalog_id,
            flow_type = excluded.flow_type,
            updated_at = excluded.updated_at
    `).run({
        subscriber_id: String(record.subscriberId),
        ambiente: String(record.ambiente),
        cp: record.cp || null,
        order_id: record.orderId || null,
        correlation_order: record.correlationOrder || null,
        associated_document: record.associatedDocument || null,
        address_id: record.addressId != null ? Number(record.addressId) : null,
        inventory_id: record.inventoryId != null ? Number(record.inventoryId) : null,
        complement_type: record.complementType || null,
        complement_value: record.complementValue || null,
        product_catalog_id: record.productCatalogId || null,
        flow_type: record.flowType || null,
        created_at: now,
        updated_at: now
    });
    return findBySubscriberId(record.subscriberId, record.ambiente);
}

function findBySubscriberId(subscriberId, ambiente) {
    if (!subscriberId || !ambiente) return null;
    const db = getDb();
    return db.prepare(
        `SELECT * FROM ${TABLE} WHERE subscriber_id = ? AND ambiente = ?`
    ).get(String(subscriberId), String(ambiente)) || null;
}

function listAll() {
    return getDb().prepare(`SELECT * FROM ${TABLE} ORDER BY created_at DESC`).all();
}

module.exports = { upsert, findBySubscriberId, listAll };