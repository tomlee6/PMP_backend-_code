const jwt = require('jsonwebtoken');
const db = require('../db/connection');

// Verify JWT token and attach user + roles to request
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const [users] = await db.query(
      `SELECT u.id, u.email, u.full_name, u.department, u.is_active
       FROM users u WHERE u.id = ? AND u.is_active = TRUE`, [decoded.userId]
    );

    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    // Get all roles for user
    const [roles] = await db.query(
      `SELECT r.* FROM roles r
       INNER JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = ? AND r.is_active = TRUE`, [decoded.userId]
    );

    req.user = users[0];
    req.user.roles = roles;

    // Merge permissions (OR across all roles)
    req.user.permissions = {};
    const permFields = [
      'mobile_access', 'web_admin_access', 'web_settings_access',
      'hr_request', 'hr_approve', 'hr_execute',
      'nrm_request', 'nrm_approve', 'nrm_execute',
      'mnt_request', 'mnt_approve', 'mnt_execute',
      'can_view_hr_dashboard', 'can_view_nrm_dashboard', 'can_view_mnt_dashboard',
      'settings_view', 'settings_upload'
    ];
    for (const field of permFields) {
      req.user.permissions[field] = roles.some(r => r[field] === 1);
    }

    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

// Check specific permission
const requirePermission = (...perms) => {
  return (req, res, next) => {
    const hasAccess = perms.some(p => req.user.permissions[p]);
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    next();
  };
};

module.exports = { authenticate, requirePermission };
