-- Core Application Tables

CREATE TABLE IF NOT EXISTS master_purpose_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  purpose_name VARCHAR(100) NOT NULL,
  is_active TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS master_travel_modes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mode_code VARCHAR(50) NOT NULL,
  mode_label VARCHAR(100) NOT NULL,
  sort_order INT DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS master_travel_purposes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mode_id INT NOT NULL,
  label VARCHAR(100) NOT NULL,
  sort_order INT DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  FOREIGN KEY (mode_id) REFERENCES master_travel_modes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hr_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_number VARCHAR(50) UNIQUE NOT NULL,
  requester_id INT NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  visit_date DATE NOT NULL,
  purpose_id INT,
  purpose_text TEXT,
  remarks TEXT,
  items_text TEXT,
  travel_mode_id INT,
  travel_purpose_id INT,
  status ENUM('pending', 'approved', 'rejected', 'closed') DEFAULT 'pending',
  actual_amount DECIMAL(10, 2),
  bill_attachment_path VARCHAR(255),
  approved_by INT,
  approved_at DATETIME,
  approved_via VARCHAR(50),
  approval_comments TEXT,
  closed_by INT,
  closed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (requester_id) REFERENCES users(id),
  FOREIGN KEY (purpose_id) REFERENCES master_purpose_types(id),
  FOREIGN KEY (travel_mode_id) REFERENCES master_travel_modes(id),
  FOREIGN KEY (travel_purpose_id) REFERENCES master_travel_purposes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  department_name VARCHAR(100) NOT NULL,
  is_active TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS nrm_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_name VARCHAR(100) NOT NULL,
  is_active TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS nrm_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_name VARCHAR(255) NOT NULL,
  sku_code VARCHAR(100),
  current_stock INT DEFAULT 0,
  category_id INT,
  is_active TINYINT(1) DEFAULT 1,
  FOREIGN KEY (category_id) REFERENCES nrm_categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS nrm_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_number VARCHAR(50) UNIQUE NOT NULL,
  requester_id INT NOT NULL,
  department_id INT,
  status ENUM('pending', 'approved', 'rejected', 'closed') DEFAULT 'pending',
  approved_by INT,
  approved_at DATETIME,
  approved_via VARCHAR(50),
  approval_comments TEXT,
  closed_by INT,
  closed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (requester_id) REFERENCES users(id),
  FOREIGN KEY (department_id) REFERENCES departments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS nrm_request_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  item_id INT NOT NULL,
  quantity INT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES nrm_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES nrm_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mnt_production_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  line_name VARCHAR(100) NOT NULL,
  is_active TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mnt_machines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  machine_name VARCHAR(100) NOT NULL,
  production_line_id INT,
  is_active TINYINT(1) DEFAULT 1,
  FOREIGN KEY (production_line_id) REFERENCES mnt_production_lines(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mnt_problem_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  problem_name VARCHAR(100) NOT NULL,
  is_active TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mnt_shifts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shift_name VARCHAR(100) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mnt_breakdowns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_number VARCHAR(50) UNIQUE NOT NULL,
  reported_by INT NOT NULL,
  machine_id INT,
  problem_type_id INT,
  problem_description TEXT,
  breakdown_start_time DATETIME,
  status ENUM('pending', 'in_progress', 'completed') DEFAULT 'pending',
  assigned_to INT,
  assigned_at DATETIME,
  completed_by INT,
  completed_at DATETIME,
  downtime_minutes INT,
  action_taken TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reported_by) REFERENCES users(id),
  FOREIGN KEY (machine_id) REFERENCES mnt_machines(id),
  FOREIGN KEY (problem_type_id) REFERENCES mnt_problem_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mnt_spare_parts_used (
  id INT AUTO_INCREMENT PRIMARY KEY,
  breakdown_id INT NOT NULL,
  item_name VARCHAR(255),
  sku_code VARCHAR(100),
  quantity INT,
  FOREIGN KEY (breakdown_id) REFERENCES mnt_breakdowns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  module VARCHAR(50),
  entity_type VARCHAR(50),
  entity_id INT,
  is_read TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
