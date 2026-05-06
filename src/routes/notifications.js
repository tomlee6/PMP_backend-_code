const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');

// GET /api/v1/notifications
// Used by: notifications.html (mobile), home.html (badge count)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const [rows] = await db.query(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [req.user.id, parseInt(limit), parseInt(offset)]
    );

    const [[{ unread_count }]] = await db.query(
      'SELECT COUNT(*) as unread_count FROM notifications WHERE user_id = ? AND is_read = FALSE',
      [req.user.id]
    );

    res.json({ success: true, data: rows, unread_count });
  } catch (err) { next(err); }
});

// PUT /api/v1/notifications/:id/read
// Used by: notifications.html (tap on notification)
router.put('/:id/read', authenticate, async (req, res, next) => {
  try {
    await db.query('UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true, message: 'Marked as read' });
  } catch (err) { next(err); }
});

// PUT /api/v1/notifications/read-all
// Used by: notifications.html (mark all read)
router.put('/read-all', authenticate, async (req, res, next) => {
  try {
    await db.query('UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE', [req.user.id]);
    res.json({ success: true, message: 'All marked as read' });
  } catch (err) { next(err); }
});

module.exports = router;
