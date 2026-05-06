const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');

// GET /api/v1/admin/overview
// Used by: admin.html (overview dashboard stat cards)
router.get('/overview', authenticate, requirePermission('can_view_hr_dashboard', 'can_view_nrm_dashboard', 'can_view_mnt_dashboard'), async (req, res, next) => {
  try {
    const [[hr]] = await db.query(`SELECT COUNT(*) as total FROM hr_requests WHERE MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())`);
    const [[nrm]] = await db.query(`SELECT COUNT(*) as total FROM nrm_requests WHERE MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())`);
    const [[mnt]] = await db.query(`SELECT COUNT(*) as total FROM mnt_breakdowns WHERE MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())`);
    const [[pending]] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM hr_requests WHERE status = 'pending') +
        (SELECT COUNT(*) FROM nrm_requests WHERE status = 'pending') as total
    `);

    res.json({
      success: true,
      data: {
        hr_requests: hr.total,
        nrm_requests: nrm.total,
        breakdowns: mnt.total,
        pending_approvals: pending.total
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
