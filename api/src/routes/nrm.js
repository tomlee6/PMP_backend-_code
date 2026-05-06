const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { generateTicketNumber } = require('../utils/ticketNumber');
const { logAudit } = require('../utils/audit');
const { notifyByPermission, createNotification } = require('../utils/notify');

// ============================================================================
// MOBILE APP APIs
// ============================================================================

// GET /api/v1/nrm/items
// Used by: nrm-create-request.html (item dropdown), nrm-catalog.html (item list)
router.get('/items', authenticate, async (req, res, next) => {
  try {
    const { category_id } = req.query;
    let where = 'i.is_active = TRUE';
    const params = [];
    if (category_id) { where += ' AND i.category_id = ?'; params.push(category_id); }

    const [rows] = await db.query(
      `SELECT i.*, c.category_name FROM nrm_items i
       LEFT JOIN nrm_categories c ON c.id = i.category_id
       WHERE ${where} ORDER BY i.item_name`, params
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/v1/nrm/requests
// Used by: nrm-catalog.html (request list with status filters)
router.get('/requests', authenticate, async (req, res, next) => {
  try {
    const { status, month, year, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = '1=1';
    const params = [];

    if (status) { where += ' AND n.status = ?'; params.push(status); }
    if (month && year) {
      where += ' AND MONTH(n.created_at) = ? AND YEAR(n.created_at) = ?';
      params.push(month, year);
    }

    const [rows] = await db.query(
      `SELECT n.*, u.full_name AS requester_name, d.department_name
       FROM nrm_requests n
       INNER JOIN users u ON u.id = n.requester_id
       LEFT JOIN departments d ON d.id = n.department_id
       WHERE ${where}
       ORDER BY n.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    // Attach items for each request
    for (const req_row of rows) {
      const [items] = await db.query(
        `SELECT ri.*, i.item_name, i.sku_code FROM nrm_request_items ri
         INNER JOIN nrm_items i ON i.id = ri.item_id WHERE ri.request_id = ?`, [req_row.id]
      );
      req_row.items = items;
    }

    const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM nrm_requests n WHERE ${where}`, params);
    res.json({ success: true, data: rows, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (err) { next(err); }
});

// GET /api/v1/nrm/requests/:id
// Used by: nrm-approve.html, nrm-issuance.html
router.get('/requests/:id', authenticate, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT n.*, u.full_name AS requester_name, d.department_name
       FROM nrm_requests n
       INNER JOIN users u ON u.id = n.requester_id
       LEFT JOIN departments d ON d.id = n.department_id
       WHERE n.id = ?`, [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Request not found' });

    const [items] = await db.query(
      `SELECT ri.*, i.item_name, i.sku_code, i.current_stock FROM nrm_request_items ri
       INNER JOIN nrm_items i ON i.id = ri.item_id WHERE ri.request_id = ?`, [req.params.id]
    );
    rows[0].items = items;

    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/v1/nrm/requests
// Used by: nrm-create-request.html
// Access: nrm_request permission (Production Staff, Dept Head, Plant Manager)
router.post('/requests', authenticate, requirePermission('nrm_request'), async (req, res, next) => {
  try {
    const { department_id, purpose, items } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item is required' });
    }

    const ticketNumber = await generateTicketNumber('nrm');

    const [result] = await db.query(
      `INSERT INTO nrm_requests (ticket_number, requester_id, department_id, purpose)
       VALUES (?, ?, ?, ?)`,
      [ticketNumber, req.user.id, department_id, purpose]
    );

    // Insert line items
    for (const item of items) {
      await db.query(
        'INSERT INTO nrm_request_items (request_id, item_id, requested_qty) VALUES (?, ?, ?)',
        [result.insertId, item.item_id, item.quantity]
      );
    }

    await logAudit(req.user.id, 'create', 'nrm', 'nrm_requests', result.insertId, null, { ticketNumber }, req.ip);
    await notifyByPermission('nrm_approve', 'New NRM Request', `${ticketNumber}: ${items.length} items`, 'nrm', 'nrm_request', result.insertId);

    res.status(201).json({ success: true, data: { id: result.insertId, ticket_number: ticketNumber } });
  } catch (err) { next(err); }
});

// PUT /api/v1/nrm/requests/:id/approve
// Used by: nrm-approve.html (Approve button)
// Access: nrm_approve permission (Dept Head L1, Plant Manager L2)
router.put('/requests/:id/approve', authenticate, requirePermission('nrm_approve'), async (req, res, next) => {
  try {
    const { comments, client_source } = req.body;
    const source = client_source === 'mobile' || client_source === 'web' ? client_source : null;
    const [request] = await db.query('SELECT * FROM nrm_requests WHERE id = ?', [req.params.id]);
    if (request.length === 0) return res.status(404).json({ success: false, message: 'Request not found' });

    const r = request[0];

    if (r.status === 'pending') {
      // L1 approval
      await db.query(
        `UPDATE nrm_requests SET l1_approved_by = ?, l1_approved_at = NOW(), l1_comments = ?, approved_via = ?,
         status = CASE WHEN requires_l2 = TRUE THEN 'pending' ELSE 'issuance' END
         WHERE id = ?`,
        [req.user.id, comments, source, req.params.id]
      );
      if (!r.requires_l2) {
        await notifyByPermission('nrm_execute', 'NRM Request Approved', `${r.ticket_number} ready for issuance`, 'nrm', 'nrm_request', req.params.id);
      }
    } else if (r.l1_approved_by && !r.l2_approved_by && r.requires_l2) {
      // L2 approval
      await db.query(
        `UPDATE nrm_requests SET l2_approved_by = ?, l2_approved_at = NOW(), l2_comments = ?, approved_via = ?, status = 'issuance' WHERE id = ?`,
        [req.user.id, comments, source, req.params.id]
      );
      await notifyByPermission('nrm_execute', 'NRM Request Fully Approved', `${r.ticket_number} ready for issuance`, 'nrm', 'nrm_request', req.params.id);
    }

    await createNotification(r.requester_id, 'Request Approved', `Your NRM request ${r.ticket_number} has been approved.`, 'nrm', 'nrm_request', req.params.id);
    await logAudit(req.user.id, 'approve', 'nrm', 'nrm_requests', req.params.id, null, { comments }, req.ip);
    res.json({ success: true, message: 'Request approved' });
  } catch (err) { next(err); }
});

// PUT /api/v1/nrm/requests/:id/reject
// Used by: nrm-approve.html (Reject button)
router.put('/requests/:id/reject', authenticate, requirePermission('nrm_approve'), async (req, res, next) => {
  try {
    const { comments, client_source } = req.body;
    const source = client_source === 'mobile' || client_source === 'web' ? client_source : null;
    await db.query(`UPDATE nrm_requests SET status = 'rejected', l1_comments = ?, approved_via = ? WHERE id = ?`, [comments, source, req.params.id]);
    const [request] = await db.query('SELECT ticket_number, requester_id FROM nrm_requests WHERE id = ?', [req.params.id]);
    await logAudit(req.user.id, 'reject', 'nrm', 'nrm_requests', req.params.id, null, { status: 'rejected' }, req.ip);
    
    if (request.length > 0) {
      await createNotification(request[0].requester_id, 'Request Rejected', `Your NRM request ${request[0].ticket_number} was rejected.`, 'nrm', 'nrm_request', req.params.id);
    }
    
    res.json({ success: true, message: 'Request rejected' });
  } catch (err) { next(err); }
});

// PUT /api/v1/nrm/requests/:id/issue
// Used by: nrm-issuance.html (Issued button)
// Access: nrm_execute permission (NRM Store Admin)
router.put('/requests/:id/issue', authenticate, requirePermission('nrm_execute'), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { comments, client_source } = req.body;
    const source = client_source === 'mobile' || client_source === 'web' ? client_source : null;

    // Get request items
    const [items] = await conn.query(
      'SELECT ri.*, i.current_stock FROM nrm_request_items ri INNER JOIN nrm_items i ON i.id = ri.item_id WHERE ri.request_id = ?',
      [req.params.id]
    );

    // Deduct stock for each item
    for (const item of items) {
      const issueQty = item.requested_qty;
      await conn.query('UPDATE nrm_items SET current_stock = current_stock - ? WHERE id = ?', [issueQty, item.item_id]);
      await conn.query('UPDATE nrm_request_items SET issued_qty = ? WHERE id = ?', [issueQty, item.id]);

      // Stock log
      await conn.query(
        `INSERT INTO nrm_stock_log (item_id, change_qty, reason, reference_type, reference_id, performed_by)
         VALUES (?, ?, 'issuance', 'nrm_request', ?, ?)`,
        [item.item_id, -issueQty, req.params.id, req.user.id]
      );

      // Check reorder alert
      const [[updated]] = await conn.query('SELECT current_stock, reorder_level FROM nrm_items WHERE id = ?', [item.item_id]);
      if (updated.current_stock <= updated.reorder_level) {
        // TODO: trigger low stock alert notification
      }
    }

    await conn.query(
      `UPDATE nrm_requests SET status = 'issued', issued_by = ?, issued_at = NOW(), issuance_comments = ?, approved_via = ? WHERE id = ?`,
      [req.user.id, comments, source, req.params.id]
    );

    await conn.commit();
    await logAudit(req.user.id, 'issue', 'nrm', 'nrm_requests', req.params.id, null, { status: 'issued' }, req.ip);
    
    const [request] = await db.query('SELECT ticket_number, requester_id FROM nrm_requests WHERE id = ?', [req.params.id]);
    if (request.length > 0) {
      await createNotification(request[0].requester_id, 'Materials Issued', `Materials for your NRM request ${request[0].ticket_number} have been issued.`, 'nrm', 'nrm_request', req.params.id);
    }
    
    res.json({ success: true, message: 'Materials issued' });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// PUT /api/v1/nrm/requests/:id/cancel
// Used by: nrm-issuance.html (Cancelled button)
router.put('/requests/:id/cancel', authenticate, requirePermission('nrm_execute'), async (req, res, next) => {
  try {
    const { comments, client_source } = req.body;
    const source = client_source === 'mobile' || client_source === 'web' ? client_source : null;
    await db.query(`UPDATE nrm_requests SET status = 'cancelled', issuance_comments = ?, approved_via = ? WHERE id = ?`, [comments, source, req.params.id]);
    const [request] = await db.query('SELECT ticket_number, requester_id FROM nrm_requests WHERE id = ?', [req.params.id]);
    await logAudit(req.user.id, 'cancel', 'nrm', 'nrm_requests', req.params.id, null, { status: 'cancelled' }, req.ip);
    
    if (request.length > 0) {
      await createNotification(request[0].requester_id, 'Request Cancelled', `Your NRM request ${request[0].ticket_number} was cancelled.`, 'nrm', 'nrm_request', req.params.id);
    }
    
    res.json({ success: true, message: 'Request cancelled' });
  } catch (err) { next(err); }
});

// ============================================================================
// WEB ADMIN APIs
// ============================================================================

// GET /api/v1/nrm/dashboard/stats
// Used by: admin-nrm.html (stat cards)
router.get('/dashboard/stats', authenticate, requirePermission('can_view_nrm_dashboard'), async (req, res, next) => {
  try {
    const [[stats]] = await db.query(`
      SELECT COUNT(*) as total,
        SUM(status IN ('issued','closed')) as issued,
        SUM(status = 'pending') as pending,
        SUM(status = 'cancelled') as cancelled
      FROM nrm_requests
      WHERE MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())
    `);
    res.json({ success: true, data: stats });
  } catch (err) { next(err); }
});

// GET /api/v1/nrm/dashboard/monthly-trend
// Used by: admin-nrm.html (trend charts)
router.get('/dashboard/monthly-trend', authenticate, requirePermission('can_view_nrm_dashboard'), async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') as month,
        COUNT(*) as request_count,
        SUM(status IN ('issued','closed')) as issued_count
      FROM nrm_requests
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m') ORDER BY month
    `);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/v1/nrm/dashboard/by-category
// Used by: admin-nrm.html (pie chart by category)
router.get('/dashboard/by-category', authenticate, requirePermission('can_view_nrm_dashboard'), async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT c.category_name, COUNT(DISTINCT ri.request_id) as request_count
      FROM nrm_request_items ri
      INNER JOIN nrm_items i ON i.id = ri.item_id
      INNER JOIN nrm_categories c ON c.id = i.category_id
      INNER JOIN nrm_requests n ON n.id = ri.request_id
      WHERE MONTH(n.created_at) = MONTH(NOW()) AND YEAR(n.created_at) = YEAR(NOW())
      GROUP BY c.id ORDER BY request_count DESC
    `);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/v1/nrm/dashboard/by-department
// Used by: admin-nrm.html (pie chart by department)
router.get('/dashboard/by-department', authenticate, requirePermission('can_view_nrm_dashboard'), async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT d.department_name, COUNT(*) as request_count
      FROM nrm_requests n
      INNER JOIN departments d ON d.id = n.department_id
      WHERE MONTH(n.created_at) = MONTH(NOW()) AND YEAR(n.created_at) = YEAR(NOW())
      GROUP BY d.id ORDER BY request_count DESC
    `);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/v1/nrm/dashboard/monthly-requests
// Used by: admin-nrm.html (monthly table with selector + PDF download)
router.get('/dashboard/monthly-requests', authenticate, requirePermission('can_view_nrm_dashboard'), async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const m = month || new Date().getMonth() + 1;
    const y = year || new Date().getFullYear();

    const [rows] = await db.query(
      `SELECT n.*, u.full_name AS requester_name, d.department_name,
              (SELECT GROUP_CONCAT(DISTINCT c.category_name ORDER BY c.category_name SEPARATOR ', ')
                 FROM nrm_request_items ri
                 INNER JOIN nrm_items i ON i.id = ri.item_id
                 INNER JOIN nrm_categories c ON c.id = i.category_id
                WHERE ri.request_id = n.id) AS category_name
       FROM nrm_requests n
       INNER JOIN users u ON u.id = n.requester_id
       LEFT JOIN departments d ON d.id = n.department_id
       WHERE MONTH(n.created_at) = ? AND YEAR(n.created_at) = ?
       ORDER BY n.created_at DESC`, [m, y]
    );

    for (const row of rows) {
      const [items] = await db.query(
        `SELECT i.item_name, ri.requested_qty, ri.issued_qty FROM nrm_request_items ri
         INNER JOIN nrm_items i ON i.id = ri.item_id WHERE ri.request_id = ?`, [row.id]
      );
      row.items = items;
    }
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

module.exports = router;
