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

// GET /api/v1/maintenance/breakdowns
// Used by: mnt-breakdowns.html, home.html (recent activity)
router.get('/breakdowns', authenticate, async (req, res, next) => {
  try {
    const { status, month, year, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = '1=1';
    const params = [];

    if (status) { where += ' AND b.status = ?'; params.push(status); }
    if (month && year) {
      where += ' AND MONTH(b.created_at) = ? AND YEAR(b.created_at) = ?';
      params.push(month, year);
    }

    const [rows] = await db.query(
      `SELECT b.*, u.full_name AS reported_by_name, pl.line_name, m.machine_name,
              pt.problem_name, s.shift_name, eng.full_name AS engineer_name
       FROM mnt_breakdowns b
       INNER JOIN users u ON u.id = b.reported_by
       INNER JOIN mnt_production_lines pl ON pl.id = b.production_line_id
       INNER JOIN mnt_machines m ON m.id = b.machine_id
       LEFT JOIN mnt_problem_types pt ON pt.id = b.problem_type_id
       LEFT JOIN mnt_shifts s ON s.id = b.shift_id
       LEFT JOIN users eng ON eng.id = b.assigned_to
       WHERE ${where}
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM mnt_breakdowns b WHERE ${where}`, params);
    res.json({ success: true, data: rows, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (err) { next(err); }
});

// GET /api/v1/maintenance/breakdowns/:id
// Used by: mnt-resolve.html
router.get('/breakdowns/:id', authenticate, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, u.full_name AS reported_by_name, pl.line_name, m.machine_name,
              pt.problem_name, s.shift_name, eng.full_name AS engineer_name
       FROM mnt_breakdowns b
       INNER JOIN users u ON u.id = b.reported_by
       INNER JOIN mnt_production_lines pl ON pl.id = b.production_line_id
       INNER JOIN mnt_machines m ON m.id = b.machine_id
       LEFT JOIN mnt_problem_types pt ON pt.id = b.problem_type_id
       LEFT JOIN mnt_shifts s ON s.id = b.shift_id
       LEFT JOIN users eng ON eng.id = b.assigned_to
       WHERE b.id = ?`, [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Breakdown not found' });

    // Get spare parts used
    const [parts] = await db.query(
      `SELECT sp.*, i.item_name, i.sku_code FROM mnt_spare_parts_used sp
       INNER JOIN nrm_items i ON i.id = sp.nrm_item_id WHERE sp.breakdown_id = ?`, [req.params.id]
    );
    rows[0].spare_parts = parts;

    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// GET /api/v1/maintenance/dropdowns
// Used by: mnt-report.html (production lines, machines, problem types dropdowns)
router.get('/dropdowns', authenticate, async (req, res, next) => {
  try {
    const [lines] = await db.query('SELECT id, line_name FROM mnt_production_lines WHERE is_active = TRUE ORDER BY line_name');
    const [machines] = await db.query('SELECT id, machine_name, production_line_id FROM mnt_machines WHERE is_active = TRUE ORDER BY machine_name');
    const [problems] = await db.query('SELECT id, problem_name FROM mnt_problem_types WHERE is_active = TRUE ORDER BY problem_name');
    const [shifts] = await db.query('SELECT id, shift_name, start_time, end_time FROM mnt_shifts WHERE is_active = TRUE');

    res.json({ success: true, data: { lines, machines, problems, shifts } });
  } catch (err) { next(err); }
});

// POST /api/v1/maintenance/breakdowns
// Used by: mnt-report.html (Report Breakdown button)
// Access: mnt_request permission (Production Staff)
router.post('/breakdowns', authenticate, requirePermission('mnt_request'), async (req, res, next) => {
  try {
    const { production_line_id, machine_id, problem_type_id, shift_id, breakdown_start_time, description } = req.body;
    if (!production_line_id || !machine_id || !breakdown_start_time) {
      return res.status(400).json({ success: false, message: 'Production line, machine, and start time are required' });
    }

    const ticketNumber = await generateTicketNumber('mnt');
    const [result] = await db.query(
      `INSERT INTO mnt_breakdowns (ticket_number, reported_by, production_line_id, machine_id, problem_type_id, shift_id, breakdown_start_time, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ticketNumber, req.user.id, production_line_id, machine_id, problem_type_id, shift_id, breakdown_start_time, description]
    );

    await logAudit(req.user.id, 'create', 'maintenance', 'mnt_breakdowns', result.insertId, null, { ticketNumber }, req.ip);
    await notifyByPermission('mnt_approve', 'New Breakdown Reported', `${ticketNumber}: Line ${production_line_id}`, 'maintenance', 'mnt_breakdown', result.insertId);
    await notifyByPermission('mnt_execute', 'New Breakdown Reported', `${ticketNumber}: Line ${production_line_id}`, 'maintenance', 'mnt_breakdown', result.insertId);

    res.status(201).json({ success: true, data: { id: result.insertId, ticket_number: ticketNumber } });
  } catch (err) { next(err); }
});

// PUT /api/v1/maintenance/breakdowns/:id/assign
// Used by: Maintenance Manager assigns engineer
// Access: mnt_approve permission
router.put('/breakdowns/:id/assign', authenticate, requirePermission('mnt_approve'), async (req, res, next) => {
  try {
    const { engineer_id } = req.body;
    await db.query(
      `UPDATE mnt_breakdowns SET assigned_to = ?, status = 'in_progress', acknowledged_at = NOW() WHERE id = ?`,
      [engineer_id, req.params.id]
    );
    const [request] = await db.query('SELECT ticket_number, reported_by FROM mnt_breakdowns WHERE id = ?', [req.params.id]);
    await logAudit(req.user.id, 'assign', 'maintenance', 'mnt_breakdowns', req.params.id, null, { assigned_to: engineer_id }, req.ip);
    
    if (request.length > 0) {
      await createNotification(request[0].reported_by, 'Engineer Assigned', `Engineer assigned to your breakdown report ${request[0].ticket_number}.`, 'maintenance', 'mnt_breakdown', req.params.id);
    }
    
    res.json({ success: true, message: 'Engineer assigned' });
  } catch (err) { next(err); }
});

// PUT /api/v1/maintenance/breakdowns/:id/resolve
// Used by: mnt-resolve.html (Close Ticket button)
// Access: mnt_execute permission (Maintenance Engineer)
router.put('/breakdowns/:id/resolve', authenticate, requirePermission('mnt_execute'), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { action_taken, root_cause, spare_parts } = req.body;

    // Calculate resolution time
    const [[breakdown]] = await conn.query('SELECT breakdown_start_time FROM mnt_breakdowns WHERE id = ?', [req.params.id]);
    const resolutionMinutes = Math.round((Date.now() - new Date(breakdown.breakdown_start_time).getTime()) / 60000);

    await conn.query(
      `UPDATE mnt_breakdowns SET action_taken = ?, root_cause = ?, resolved_at = NOW(),
       resolution_time_minutes = ?, status = 'closed', closed_by = ?, closed_at = NOW()
       WHERE id = ?`,
      [action_taken, root_cause, resolutionMinutes, req.user.id, req.params.id]
    );

    // Record spare parts and deduct NRM stock
    if (spare_parts && spare_parts.length > 0) {
      for (const part of spare_parts) {
        await conn.query(
          'INSERT INTO mnt_spare_parts_used (breakdown_id, nrm_item_id, quantity_used) VALUES (?, ?, ?)',
          [req.params.id, part.nrm_item_id, part.quantity]
        );

        // Deduct from NRM stock
        await conn.query('UPDATE nrm_items SET current_stock = current_stock - ? WHERE id = ?', [part.quantity, part.nrm_item_id]);

        // Stock log
        await conn.query(
          `INSERT INTO nrm_stock_log (item_id, change_qty, reason, reference_type, reference_id, performed_by)
           VALUES (?, ?, 'maintenance_usage', 'mnt_breakdown', ?, ?)`,
          [part.nrm_item_id, -part.quantity, req.params.id, req.user.id]
        );
      }
    }

    await conn.commit();
    await logAudit(req.user.id, 'resolve', 'maintenance', 'mnt_breakdowns', req.params.id, null, { action_taken, root_cause, resolution_time_minutes: resolutionMinutes }, req.ip);
    
    const [request] = await db.query('SELECT ticket_number, reported_by FROM mnt_breakdowns WHERE id = ?', [req.params.id]);
    if (request.length > 0) {
      await createNotification(request[0].reported_by, 'Breakdown Resolved', `Your breakdown report ${request[0].ticket_number} has been resolved and closed.`, 'maintenance', 'mnt_breakdown', req.params.id);
    }
    
    res.json({ success: true, message: 'Breakdown resolved', data: { resolution_time_minutes: resolutionMinutes } });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ============================================================================
// WEB ADMIN APIs
// ============================================================================

// GET /api/v1/maintenance/dashboard/stats
// Used by: admin-mnt.html (stat cards)
router.get('/dashboard/stats', authenticate, requirePermission('can_view_mnt_dashboard'), async (req, res, next) => {
  try {
    const [[stats]] = await db.query(`
      SELECT COUNT(*) as total,
        SUM(status = 'closed') as resolved,
        SUM(status IN ('open','in_progress')) as active,
        COALESCE(AVG(CASE WHEN status = 'closed' THEN resolution_time_minutes END), 0) as avg_resolution_time
      FROM mnt_breakdowns
      WHERE MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())
    `);

    // Spare parts cost this month
    const [[cost]] = await db.query(`
      SELECT COALESCE(SUM(sp.quantity_used * 500), 0) as spare_parts_cost
      FROM mnt_spare_parts_used sp
      INNER JOIN mnt_breakdowns b ON b.id = sp.breakdown_id
      WHERE MONTH(b.created_at) = MONTH(NOW()) AND YEAR(b.created_at) = YEAR(NOW())
    `);

    res.json({ success: true, data: { ...stats, spare_parts_cost: cost.spare_parts_cost } });
  } catch (err) { next(err); }
});

// GET /api/v1/maintenance/dashboard/monthly-trend
// Used by: admin-mnt.html (trend charts)
router.get('/dashboard/monthly-trend', authenticate, requirePermission('can_view_mnt_dashboard'), async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') as month,
        COUNT(*) as breakdown_count,
        COALESCE(AVG(CASE WHEN status = 'closed' THEN resolution_time_minutes END), 0) as avg_resolution_time
      FROM mnt_breakdowns
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m') ORDER BY month
    `);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/v1/maintenance/dashboard/by-line
// Used by: admin-mnt.html (pie chart by production line)
router.get('/dashboard/by-line', authenticate, requirePermission('can_view_mnt_dashboard'), async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT pl.line_name, COUNT(*) as breakdown_count
      FROM mnt_breakdowns b
      INNER JOIN mnt_production_lines pl ON pl.id = b.production_line_id
      WHERE MONTH(b.created_at) = MONTH(NOW()) AND YEAR(b.created_at) = YEAR(NOW())
      GROUP BY pl.id ORDER BY breakdown_count DESC
    `);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/v1/maintenance/dashboard/by-problem
// Used by: admin-mnt.html (pie chart by problem type)
router.get('/dashboard/by-problem', authenticate, requirePermission('can_view_mnt_dashboard'), async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT pt.problem_name, COUNT(*) as breakdown_count
      FROM mnt_breakdowns b
      INNER JOIN mnt_problem_types pt ON pt.id = b.problem_type_id
      WHERE MONTH(b.created_at) = MONTH(NOW()) AND YEAR(b.created_at) = YEAR(NOW())
      GROUP BY pt.id ORDER BY breakdown_count DESC
    `);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/v1/maintenance/dashboard/monthly-breakdowns
// Used by: admin-mnt.html (monthly table with selector + PDF)
router.get('/dashboard/monthly-breakdowns', authenticate, requirePermission('can_view_mnt_dashboard'), async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const m = month || new Date().getMonth() + 1;
    const y = year || new Date().getFullYear();

    const [rows] = await db.query(
      `SELECT b.*, pl.line_name, m.machine_name, pt.problem_name, eng.full_name AS engineer_name
       FROM mnt_breakdowns b
       INNER JOIN mnt_production_lines pl ON pl.id = b.production_line_id
       INNER JOIN mnt_machines m ON m.id = b.machine_id
       LEFT JOIN mnt_problem_types pt ON pt.id = b.problem_type_id
       LEFT JOIN users eng ON eng.id = b.assigned_to
       WHERE MONTH(b.created_at) = ? AND YEAR(b.created_at) = ?
       ORDER BY b.created_at DESC`, [m, y]
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

module.exports = router;
