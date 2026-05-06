const db = require('../db/connection');

async function generateTicketNumber(module) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE ticket_sequences SET last_number = last_number + 1 WHERE module = ?', [module]);
    const [rows] = await conn.query('SELECT prefix, last_number FROM ticket_sequences WHERE module = ?', [module]);
    await conn.commit();
    return `${rows[0].prefix}${String(rows[0].last_number).padStart(4, '0')}`;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { generateTicketNumber };
