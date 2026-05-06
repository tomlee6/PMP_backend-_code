-- Food items catalog for HR module
-- Powers the mobile HR request form (dropdowns for Main Dish / Side Dish / Juice / Snacks)
-- and the web admin food-items settings section.

CREATE TABLE IF NOT EXISTS master_food_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category ENUM('main_dish','side_dish','juice','snacks') NOT NULL,
  item_name VARCHAR(100) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_food_category_active (category, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed with the items currently hardcoded in mobile so existing flows keep working.
INSERT INTO master_food_items (category, item_name) VALUES
  ('main_dish', 'Chapthi'),
  ('main_dish', 'Nan'),
  ('main_dish', 'Chicken Biriyani'),
  ('main_dish', 'Fride rice'),
  ('main_dish', 'Sambar rice'),
  ('main_dish', 'Mini meals'),
  ('main_dish', 'Others'),
  ('side_dish', 'Gravy'),
  ('side_dish', 'Chicken fry'),
  ('side_dish', 'Fish fry'),
  ('side_dish', 'Others'),
  ('juice', 'Fresh juice'),
  ('juice', 'Bottle juice'),
  ('juice', 'Others'),
  ('snacks', 'Nuts'),
  ('snacks', 'Chocolate'),
  ('snacks', 'Biscuts'),
  ('snacks', 'Others');
