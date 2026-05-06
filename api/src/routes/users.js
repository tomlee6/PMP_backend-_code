const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// All role codes the SYS_ADMIN can create / list / manage.
// Excludes SYS_ADMIN itself — that's the admin doing the managing.
const MANAGEABLE_ROLE_CODES = [
  'HR_ADMIN', 'NRM_ADMIN',
  'GENERAL_MANAGER', 'HR_STAFF', 'DEPT_HEAD',
  'MNT_MANAGER', 'MNT_ENGINEER', 'PRODUCTION_STAFF', 'DATA_ENTRY_OPERATOR',
];

// Map the user_type sent from the form to the underlying role_code.
// 'HR' / 'NRM' kept for backwards compatibility with the existing form.
const TYPE_TO_ROLE = {
  HR: 'HR_ADMIN',
  NRM: 'NRM_ADMIN',
  HR_ADMIN: 'HR_ADMIN',
  NRM_ADMIN: 'NRM_ADMIN',
  GENERAL_MANAGER: 'GENERAL_MANAGER',
  HR_STAFF: 'HR_STAFF',
  DEPT_HEAD: 'DEPT_HEAD',
  MNT_MANAGER: 'MNT_MANAGER',
  MNT_ENGINEER: 'MNT_ENGINEER',
  PRODUCTION_STAFF: 'PRODUCTION_STAFF',
  DATA_ENTRY_OPERATOR: 'DATA_ENTRY_OPERATOR',
};

// SYS_ADMIN gate — only the single admin may manage users
function requireSysAdmin(req, res, next) {
  const isSysAdmin = (req.user.roles || []).some(r => r.role_code === 'SYS_ADMIN');
  if (!isSysAdmin) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
}

// GET /api/v1/users — list all manageable users (any role except SYS_ADMIN)
router.get('/', authenticate, requireSysAdmin, async (req, res, next) => {
  try {
    const placeholders = MANAGEABLE_ROLE_CODES.map(() => '?').join(',');
    const [rows] = await db.query(
      `SELECT u.id, u.email, u.full_name, u.is_active, u.last_login_at, u.created_at,
              r.role_code, r.role_name
         FROM users u
         INNER JOIN user_roles ur ON ur.user_id = u.id
         INNER JOIN roles r ON r.id = ur.role_id
        WHERE r.role_code IN (${placeholders})
        ORDER BY u.created_at DESC`,
      MANAGEABLE_ROLE_CODES
    );
    const data = rows.map(u => ({
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      is_active: !!u.is_active,
      last_login_at: u.last_login_at,
      created_at: u.created_at,
      role_code: u.role_code,
      role_name: u.role_name,
      user_type: u.role_code === 'HR_ADMIN' ? 'HR' : u.role_code === 'NRM_ADMIN' ? 'NRM' : u.role_code,
    }));
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/v1/users — create a user with any manageable role
router.post('/', authenticate, requireSysAdmin, async (req, res, next) => {
  const { email, password, full_name, user_type } = req.body || {};

  const emailNorm = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const nameNorm = typeof full_name === 'string' ? full_name.trim() : '';

  if (!EMAIL_RE.test(emailNorm)) {
    return res.status(400).json({ success: false, message: 'Valid email is required' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
  }
  if (!nameNorm) {
    return res.status(400).json({ success: false, message: 'Full name is required' });
  }
  const roleCode = TYPE_TO_ROLE[user_type];
  if (!roleCode) {
    return res.status(400).json({ success: false, message: 'Invalid user type' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [emailNorm]);
    if (existing.length > 0) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'This email is already registered' });
    }

    const [roleRows] = await conn.query('SELECT id FROM roles WHERE role_code = ?', [roleCode]);
    if (roleRows.length === 0) {
      await conn.rollback();
      return res.status(500).json({ success: false, message: `Role ${roleCode} not found in roles table` });
    }
    const roleId = roleRows[0].id;

    const hash = await bcrypt.hash(password, 10);
    const [insertResult] = await conn.query(
      `INSERT INTO users (email, password_hash, full_name, is_first_login, is_active)
       VALUES (?, ?, ?, TRUE, TRUE)`,
      [emailNorm, hash, nameNorm]
    );
    const newUserId = insertResult.insertId;

    await conn.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)`,
      [newUserId, roleId, req.user.id]
    );

    await conn.commit();

    await logAudit(
      req.user.id, 'create_user', 'admin', 'users', newUserId,
      null, { email: emailNorm, full_name: nameNorm, role_code: roleCode }, req.ip
    );

    res.status(201).json({
      success: true,
      data: {
        id: newUserId,
        email: emailNorm,
        full_name: nameNorm,
        role_code: roleCode,
        user_type: roleCode === 'HR_ADMIN' ? 'HR' : roleCode === 'NRM_ADMIN' ? 'NRM' : roleCode,
      },
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* connection may already be released */ }
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
