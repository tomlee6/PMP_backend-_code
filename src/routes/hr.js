const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { generateTicketNumber } = require('../utils/ticketNumber');
const { logAudit } = require('../utils/audit');
const { notifyByPermission, createNotification } = require('../utils/notify');

// ============================================================================
// MOBILE APP APIs
// ============================================================================

// GET /api/v1/hr/travel-options
// Used by: mobile new-hr-request screen (Travel Mode + Travel Purpose dropdowns).
// Returns active modes with their active purposes nested, in sort order.
router.get('/travel-options', authenticate, async (req, res, next) => {
  try {
    const [modes] = await db.query(
      `SELECT id, mode_code, mode_label
         FROM master_travel_modes
        WHERE is_active = 1
        ORDER BY sort_order, mode_label`
    );

    let purposes = [];
    if (modes.length > 0) {
      const ids = modes.map(m => m.id);
      const placeholders = ids.map(() => '?').join(',');
      const [rows] = await db.query(
        `SELECT id, mode_id, label
           FROM master_travel_purposes
          WHERE is_active = 1 AND mode_id IN (${placeholders})
          ORDER BY mode_id, sort_order, label`,
        ids
      );
      purposes = rows;
    }

    const data = modes.map(m => ({
      id: m.id,
      mode_code: m.mode_code,
      mode_label: m.mode_label,
      purposes: purposes
        .filter(p => p.mode_id === m.id)
        .map(p => ({ id: p.id, label: p.label })),
    }));

    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v1/hr/food-items
// Used by: mobile new-hr-request screen (populates Main Dish / Side Dish / Juice / Snacks dropdowns)
// Optional filter: ?category=main_dish|side_dish|juice|snacks
router.get('/food-items', authenticate, async (req, res, next) => {
  try {
    const { category } = req.query;
    const where = category ? 'is_active = 1 AND category = ?' : 'is_active = 1';
    const params = category ? [category] : [];
    const [rows] = await db.query(
      `SELECT id, category, item_name FROM master_food_items WHERE ${where} ORDER BY category, item_name`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/v1/hr/requests
// Used by: hr-requests.html, home.html (recent activity)
// Access: Anyone with hr_request, hr_approve, or hr_execute permission
router.get('/requests', authenticate, async (req, res, next) => {
  try {
    const { status, month, year, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = '1=1';
    const params = [];

    if (status) { where += ' AND h.status = ?'; params.push(status); }
    if (month && year) {
      where += ' AND MONTH(h.created_at) = ? AND YEAR(h.created_at) = ?';
      params.push(month, year);
    }

    const [rows] = await db.query(
      `SELECT h.*, u.full_name AS requester_name
       FROM hr_requests h
       INNER JOIN users u ON u.id = h.requester_id
       WHERE ${where}
       ORDER BY h.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM hr_requests h WHERE ${where}`, params);

    res.json({ success: true, data: rows, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (err) { next(err); }
});

// GET /api/v1/hr/requests/:id
// Used by: hr-approve.html, hr-close-ticket.html
router.get('/requests/:id', authenticate, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT h.*, u.full_name AS requester_name, u.department AS department_name,
              p.purpose_name,
              a.full_name AS approver_name, c.full_name AS closed_by_name,
              tm.mode_code  AS travel_mode_code,
              tm.mode_label AS travel_mode_label,
              tp.label      AS travel_purpose_label
       FROM hr_requests h
       INNER JOIN users u ON u.id = h.requester_id
       LEFT JOIN master_purpose_types p ON p.id = h.purpose_id
       LEFT JOIN users a ON a.id = h.approved_by
       LEFT JOIN users c ON c.id = h.closed_by
       LEFT JOIN master_travel_modes    tm ON tm.id = h.travel_mode_id
       LEFT JOIN master_travel_purposes tp ON tp.id = h.travel_purpose_id
       WHERE h.id = ?`, [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Request not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/v1/hr/requests
// Used by: hr-create-request.html
// Access: hr_request permission (Production Staff, Dept Head, Plant Manager)
router.post('/requests', authenticate, requirePermission('hr_request'), async (req, res, next) => {
  try {
    const { customer_name, visit_date, purpose_id, purpose_text, remarks, items_text, travel_mode_id, travel_purpose_id } = req.body;
    if (!customer_name || !visit_date || !items_text) {
      return res.status(400).json({ success: false, message: 'Customer name, visit date, and items are required' });
    }

    const ticketNumber = await generateTicketNumber('hr');
    const [result] = await db.query(
      `INSERT INTO hr_requests (ticket_number, requester_id, customer_name, visit_date, purpose_id, purpose_text, remarks, items_text, travel_mode_id, travel_purpose_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ticketNumber, req.user.id, customer_name, visit_date, purpose_id, purpose_text, remarks, items_text, travel_mode_id || null, travel_purpose_id || null]
    );

    await logAudit(req.user.id, 'create', 'hr', 'hr_requests', result.insertId, null, { ticketNumber }, req.ip);
    await notifyByPermission('hr_approve', 'New HR Request', `${ticketNumber}: ${customer_name}`, 'hr', 'hr_request', result.insertId);

    res.status(201).json({ success: true, data: { id: result.insertId, ticket_number: ticketNumber } });
  } catch (err) { next(err); }
});

// PUT /api/v1/hr/requests/:id/approve
// Used by: hr-approve.html (Approve button)
// Access: hr_approve permission (Plant Manager, General Manager)
router.put('/requests/:id/approve', authenticate, requirePermission('hr_approve'), async (req, res, next) => {
  try {
    const { comments, client_source } = req.body;
    const source = client_source === 'mobile' || client_source === 'web' ? client_source : null;
    const [request] = await db.query('SELECT * FROM hr_requests WHERE id = ? AND status = "pending"', [req.params.id]);
    if (request.length === 0) return res.status(404).json({ success: false, message: 'Request not found or not pending' });

    await db.query(
      `UPDATE hr_requests SET status = "approved", approved_by = ?, approved_at = NOW(), approved_via = ?, approval_comments = ? WHERE id = ?`,
      [req.user.id, source, comments, req.params.id]
    );

    await logAudit(req.user.id, 'approve', 'hr', 'hr_requests', req.params.id, { status: 'pending' }, { status: 'approved' }, req.ip);
    await notifyByPermission('hr_execute', 'HR Request Approved', `${request[0].ticket_number} approved`, 'hr', 'hr_request', req.params.id);
    await createNotification(request[0].requester_id, 'Request Approved', `Your HR request ${request[0].ticket_number} has been approved.`, 'hr', 'hr_request', req.params.id);

    res.json({ success: true, message: 'Request approved' });
  } catch (err) { next(err); }
});

// PUT /api/v1/hr/requests/:id/reject
// Used by: hr-approve.html (Reject button)
// Access: hr_approve permission
router.put('/requests/:id/reject', authenticate, requirePermission('hr_approve'), async (req, res, next) => {
  try {
    const { comments, client_source } = req.body;
    const source = client_source === 'mobile' || client_source === 'web' ? client_source : null;
    await db.query(
      `UPDATE hr_requests SET status = "rejected", approved_by = ?, approved_at = NOW(), approved_via = ?, approval_comments = ? WHERE id = ?`,
      [req.user.id, source, comments, req.params.id]
    );
    const [request] = await db.query('SELECT ticket_number, requester_id FROM hr_requests WHERE id = ?', [req.params.id]);
    await logAudit(req.user.id, 'reject', 'hr', 'hr_requests', req.params.id, { status: 'pending' }, { status: 'rejected' }, req.ip);
    
    if (request.length > 0) {
      await createNotification(request[0].requester_id, 'Request Rejected', `Your HR request ${request[0].ticket_number} was rejected.`, 'hr', 'hr_request', req.params.id);
    }
    
    res.json({ success: true, message: 'Request rejected' });
  } catch (err) { next(err); }
});

// PUT /api/v1/hr/requests/:id/close
// Used by: hr-close-ticket.html (Close Ticket button)
// Access: hr_execute permission (HR Staff)
router.put('/requests/:id/close', authenticate, requirePermission('hr_execute'), upload.single('bill'), async (req, res, next) => {
  try {
    const { actual_amount } = req.body;
    const billPath = req.file ? req.file.path : null;

    await db.query(
      `UPDATE hr_requests SET status = "closed", actual_amount = ?, bill_attachment_path = ?, closed_by = ?, closed_at = NOW() WHERE id = ? AND status = "approved"`,
      [actual_amount, billPath, req.user.id, req.params.id]
    );

    const [request] = await db.query('SELECT ticket_number, requester_id FROM hr_requests WHERE id = ?', [req.params.id]);
    await logAudit(req.user.id, 'close', 'hr', 'hr_requests', req.params.id, { status: 'approved' }, { status: 'closed', actual_amount }, req.ip);
    
    if (request.length > 0) {
      await createNotification(request[0].requester_id, 'Request Closed', `Your HR request ${request[0].ticket_number} has been closed.`, 'hr', 'hr_request', req.params.id);
    }
    
    res.json({ success: true, message: 'Ticket closed' });
  } catch (err) { next(err); }
});

// ============================================================================
// WEB ADMIN APIs
// ============================================================================

// GET /api/v1/hr/dashboard/stats
// Used by: admin-hr.html (stat cards)
// Access: can_view_hr_dashboard
router.get('/dashboard/stats', authenticate, requirePermission('can_view_hr_dashboard'), async (req, res, next) => {
  try {
    const [[stats]] = await db.query(`
      SELECT
        COUNT(*) as total,
        SUM(status = 'closed') as closed,
        SUM(status = 'pending') as pending,
        SUM(status = 'approved') as approved,
        COALESCE(SUM(CASE WHEN status = 'closed' THEN actual_amount ELSE 0 END), 0) as total_spending
      FROM hr_requests
      WHERE MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())
    `);
    res.json({ success: true, data: stats });
  } catch (err) { next(err); }
});

// GET /api/v1/hr/dashboard/monthly-trend
// Used by: admin-hr.html (spending trend + request count charts)
router.get('/dashboard/monthly-trend', authenticate, requirePermission('can_view_hr_dashboard'), async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT
        DATE_FORMAT(created_at, '%Y-%m') as month,
        COUNT(*) as request_count,
        COALESCE(SUM(CASE WHEN status = 'closed' THEN actual_amount ELSE 0 END), 0) as total_spending
      FROM hr_requests
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      ORDER BY month
    `);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/v1/hr/dashboard/monthly-requests
// Used by: admin-hr.html (monthly requests table with month selector + PDF download)
router.get('/dashboard/monthly-requests', authenticate, requirePermission('can_view_hr_dashboard'), async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const m = month || new Date().getMonth() + 1;
    const y = year || new Date().getFullYear();

    const [rows] = await db.query(
      `SELECT h.*, u.full_name AS requester_name, u.department AS department_name,
              tm.mode_code  AS travel_mode_code,
              tm.mode_label AS travel_mode_label,
              tp.label      AS travel_purpose_label
       FROM hr_requests h
       INNER JOIN users u ON u.id = h.requester_id
       LEFT JOIN master_travel_modes    tm ON tm.id = h.travel_mode_id
       LEFT JOIN master_travel_purposes tp ON tp.id = h.travel_purpose_id
       WHERE MONTH(h.created_at) = ? AND YEAR(h.created_at) = ?
       ORDER BY h.created_at DESC`,
      [m, y]
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

module.exports = router;
