-- Travel modes/purposes were hardcoded in the mobile new-HR-request screen.
-- This migration moves them into the DB and links them to hr_requests via FK,
-- so the web admin's request drawer can render the travel choice cleanly and
-- new modes/purposes can be added without a mobile release.

CREATE TABLE IF NOT EXISTS master_travel_modes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mode_code VARCHAR(20) NOT NULL,
  mode_label VARCHAR(50) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_travel_mode_code (mode_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS master_travel_purposes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mode_id INT NOT NULL,
  label VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_travel_purpose_mode (mode_id),
  CONSTRAINT fk_travel_purpose_mode FOREIGN KEY (mode_id) REFERENCES master_travel_modes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO master_travel_modes (mode_code, mode_label, sort_order) VALUES
  ('CAB',    'Cab',    1),
  ('CAR',    'Car',    2),
  ('BUS',    'Bus',    3),
  ('FLIGHT', 'Flight', 4)
ON DUPLICATE KEY UPDATE mode_label = VALUES(mode_label), sort_order = VALUES(sort_order);

INSERT INTO master_travel_purposes (mode_id, label, sort_order)
SELECT id, 'Local Supplier Visit', 1 FROM master_travel_modes WHERE mode_code = 'CAB'
UNION ALL SELECT id, 'Local Customer Visit', 2 FROM master_travel_modes WHERE mode_code = 'CAB'
UNION ALL SELECT id, 'Outside Chennai',      1 FROM master_travel_modes WHERE mode_code = 'CAR'
UNION ALL SELECT id, 'Customer Pickup',      2 FROM master_travel_modes WHERE mode_code = 'CAR'
UNION ALL SELECT id, 'Outside Chennai',      1 FROM master_travel_modes WHERE mode_code = 'BUS'
UNION ALL SELECT id, 'Outside Chennai',      1 FROM master_travel_modes WHERE mode_code = 'FLIGHT';

ALTER TABLE hr_requests
  ADD COLUMN travel_mode_id    INT NULL AFTER items_text,
  ADD COLUMN travel_purpose_id INT NULL AFTER travel_mode_id,
  ADD CONSTRAINT fk_hr_travel_mode    FOREIGN KEY (travel_mode_id)    REFERENCES master_travel_modes(id),
  ADD CONSTRAINT fk_hr_travel_purpose FOREIGN KEY (travel_purpose_id) REFERENCES master_travel_purposes(id);
