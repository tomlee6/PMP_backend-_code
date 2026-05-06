-- Base Schema for Amphenol Platform
-- Creates the core identity tables needed for auth and roles

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_code VARCHAR(50) UNIQUE NOT NULL,
  role_name VARCHAR(100) NOT NULL,
  mobile_access TINYINT(1) DEFAULT 0,
  web_admin_access TINYINT(1) DEFAULT 0,
  web_settings_access TINYINT(1) DEFAULT 0,
  hr_request TINYINT(1) DEFAULT 0,
  hr_approve TINYINT(1) DEFAULT 0,
  hr_execute TINYINT(1) DEFAULT 0,
  nrm_request TINYINT(1) DEFAULT 0,
  nrm_approve TINYINT(1) DEFAULT 0,
  nrm_execute TINYINT(1) DEFAULT 0,
  mnt_request TINYINT(1) DEFAULT 0,
  mnt_approve TINYINT(1) DEFAULT 0,
  mnt_execute TINYINT(1) DEFAULT 0,
  can_view_hr_dashboard TINYINT(1) DEFAULT 0,
  can_view_nrm_dashboard TINYINT(1) DEFAULT 0,
  can_view_mnt_dashboard TINYINT(1) DEFAULT 0,
  settings_view TINYINT(1) DEFAULT 0,
  settings_upload TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  department VARCHAR(100),
  is_first_login TINYINT(1) DEFAULT 1,
  is_active TINYINT(1) DEFAULT 1,
  fcm_token TEXT,
  last_login_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT,
  role_id INT,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed initial SYS_ADMIN role if it doesn't exist
INSERT IGNORE INTO roles (role_code, role_name, web_admin_access, web_settings_access, is_active)
VALUES ('SYS_ADMIN', 'System Administrator', 1, 1, 1);
