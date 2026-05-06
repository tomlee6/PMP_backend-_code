const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { initSocket } = require('../utils/socket');

// TEMP: Setup endpoint to create initial users safely
router.get('/setup-admin', async (req, res, next) => {
  try {
    // 1. Create Roles if they don't exist
    await db.query(`
      INSERT IGNORE INTO roles (role_code, role_name, web_admin_access, web_settings_access, mobile_access, is_active)
      VALUES 
        ('SYS_ADMIN', 'System Administrator', 1, 1, 1, 1),
        ('PRODUCTION_STAFF', 'Production Staff', 0, 0, 1, 1)
    `);

    // 2. Create Admin User
    const adminHash = await bcrypt.hash('password123', 10);
    const [adminResult] = await db.query(
      'INSERT IGNORE INTO users (email, password_hash, full_name, department, is_first_login) VALUES (?, ?, ?, ?, ?)',
      ['admin@example.com', adminHash, 'System Admin', 'IT', 0]
    );

    // 3. Create Staff User
    const staffHash = await bcrypt.hash('staff123', 10);
    const [staffResult] = await db.query(
      'INSERT IGNORE INTO users (email, password_hash, full_name, department, is_first_login) VALUES (?, ?, ?, ?, ?)',
      ['staff@example.com', staffHash, 'Production Staff', 'Production', 0]
    );

    // 4. Link Roles
    await db.query(`
      INSERT IGNORE INTO user_roles (user_id, role_id)
      SELECT u.id, r.id FROM users u, roles r 
      WHERE u.email = 'admin@example.com' AND r.role_code = 'SYS_ADMIN'
    `);
    await db.query(`
      INSERT IGNORE INTO user_roles (user_id, role_id)
      SELECT u.id, r.id FROM users u, roles r 
      WHERE u.email = 'staff@example.com' AND r.role_code = 'PRODUCTION_STAFF'
    `);

    res.json({ success: true, message: 'Admin and Staff users created successfully. You can now login with password123 and staff123.' });
  } catch (err) { next(err); }
});

// POST /api/v1/auth/login
// Used by: Mobile App (index.html) + Web Admin + Web Settings
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const [users] = await db.query('SELECT * FROM users WHERE email = ? AND is_active = TRUE', [email]);
    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Get roles and permissions
    const [roles] = await db.query(
      `SELECT r.* FROM roles r INNER JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?`, [user.id]
    );

    const permFields = [
      'mobile_access', 'web_admin_access', 'web_settings_access',
      'hr_request', 'hr_approve', 'hr_execute',
      'nrm_request', 'nrm_approve', 'nrm_execute',
      'mnt_request', 'mnt_approve', 'mnt_execute',
      'can_view_hr_dashboard', 'can_view_nrm_dashboard', 'can_view_mnt_dashboard',
      'settings_view', 'settings_upload'
    ];
    const permissions = {};
    for (const field of permFields) {
      permissions[field] = roles.some(r => r[field] === 1);
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' });

    // Update last login
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    await logAudit(user.id, 'login', 'auth', 'users', user.id, null, null, req.ip);

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          department: user.department,
          is_first_login: user.is_first_login
        },
        roles: roles.map(r => ({ id: r.id, role_name: r.role_name, role_code: r.role_code })),
        permissions
      }
    });
  } catch (err) { next(err); }
});

// PUT /api/v1/auth/change-password
// Used by: profile.html - Change Password
router.put('/change-password', authenticate, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, message: 'Current and new password required' });
    }

    const [users] = await db.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    const valid = await bcrypt.compare(current_password, users[0].password_hash);
    if (!valid) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password_hash = ?, is_first_login = FALSE WHERE id = ?', [hash, req.user.id]);
    await logAudit(req.user.id, 'change_password', 'auth', 'users', req.user.id, null, null, req.ip);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) { next(err); }
});

// GET /api/v1/auth/profile
// Used by: profile.html
router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const [roles] = await db.query(
      `SELECT r.role_name, r.role_code FROM roles r
       INNER JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?`, [req.user.id]
    );
    res.json({
      success: true,
      data: { ...req.user, roles, permissions: req.user.permissions }
    });
  } catch (err) { next(err); }
});

// PUT /api/v1/auth/fcm-token
// Used by: Mobile app to register push notification token
router.put('/fcm-token', authenticate, async (req, res, next) => {
  try {
    const { fcm_token } = req.body;
    await db.query('UPDATE users SET fcm_token = ? WHERE id = ?', [fcm_token, req.user.id]);
    res.json({ success: true, message: 'FCM token updated' });
  } catch (err) { next(err); }
});

module.exports = router;
