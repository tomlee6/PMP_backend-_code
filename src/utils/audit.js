const db = require('../db/connection');

async function logAudit(userId, action, module, entityType, entityId, oldValues, newValues, ip) {
  await db.query(
    `INSERT INTO audit_log (user_id, action, module, entity_type, entity_id, old_values, new_values, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, action, module, entityType, entityId, JSON.stringify(oldValues), JSON.stringify(newValues), ip]
  );
}

module.exports = { logAudit };
