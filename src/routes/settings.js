const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const { logAudit } = require('../utils/audit');

// ============================================================================
// GENERIC CRUD HELPER for master data tables
// Used by: admin-settings-hr.html, admin-settings-nrm.html, admin-settings-mnt.html
// Access: settings_view (GET), settings_upload (POST/PUT/DELETE)
// ============================================================================

function masterDataCRUD(tableName, nameColumn, moduleName, extraColumns = []) {
  const sub = express.Router();

  // GET all items
  sub.get('/', authenticate, async (req, res, next) => {
    try {
      const [rows] = await db.query(`SELECT * FROM ${tableName} ORDER BY id`);
      res.json({ success: true, data: rows });
    } catch (err) { next(err); }
  });

  // POST single item
  sub.post('/', authenticate, requirePermission('settings_upload'), async (req, res, next) => {
    try {
      const columns = [nameColumn, ...extraColumns];
      const values = columns.map(c => req.body[c]);
      const placeholders = columns.map(() => '?').join(',');

      const [result] = await db.query(
        `INSERT INTO ${tableName} (${columns.join(',')}) VALUES (${placeholders})`, values
      );
      await logAudit(req.user.id, 'create', moduleName, tableName, result.insertId, null, req.body, req.ip);
      res.status(201).json({ success: true, data: { id: result.insertId } });
    } catch (err) { next(err); }
  });

  // PUT update item
  sub.put('/:id', authenticate, requirePermission('settings_upload'), async (req, res, next) => {
    try {
      const columns = [nameColumn, ...extraColumns];
      const setClause = columns.map(c => `${c} = ?`).join(', ');
      const values = columns.map(c => req.body[c]);

      // Allow optional is_active toggle (active/inactive) via edit
      if (Object.prototype.hasOwnProperty.call(req.body, 'is_active')) {
        const raw = req.body.is_active;
        const active = raw === true || raw === 1 || raw === '1' || raw === 'true';
        await db.query(
          `UPDATE ${tableName} SET ${setClause}, is_active = ? WHERE id = ?`,
          [...values, active, req.params.id]
        );
      } else {
        await db.query(`UPDATE ${tableName} SET ${setClause} WHERE id = ?`, [...values, req.params.id]);
      }
      await logAudit(req.user.id, 'update', moduleName, tableName, req.params.id, null, req.body, req.ip);
      res.json({ success: true, message: 'Updated' });
    } catch (err) { next(err); }
  });

  // DELETE item (soft delete)
  sub.delete('/:id', authenticate, requirePermission('settings_upload'), async (req, res, next) => {
    try {
      await db.query(`UPDATE ${tableName} SET is_active = FALSE WHERE id = ?`, [req.params.id]);
      await logAudit(req.user.id, 'delete', moduleName, tableName, req.params.id, null, null, req.ip);
      res.json({ success: true, message: 'Deleted' });
    } catch (err) { next(err); }
  });

  // POST bulk upload CSV
  sub.post('/bulk-upload', authenticate, requirePermission('settings_upload'), upload.single('csv'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'CSV file required' });

      const fileContent = fs.readFileSync(req.file.path, 'utf-8');
      const records = parse(fileContent, { columns: true, skip_empty_lines: true, trim: true });

      let inserted = 0;
      for (const record of records) {
        const columns = [nameColumn, ...extraColumns];
        const values = columns.map(c => {
          // Map CSV header to column (case-insensitive, space to underscore)
          const csvKey = Object.keys(record).find(k =>
            k.toLowerCase().replace(/\s+/g, '_') === c.toLowerCase() ||
            k.toLowerCase().replace(/\s+/g, '') === c.toLowerCase().replace(/_/g, '')
          );
          return csvKey ? record[csvKey] : null;
        });

        if (values[0]) {
          await db.query(
            `INSERT INTO ${tableName} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
            values
          );
          inserted++;
        }
      }

      await logAudit(req.user.id, 'bulk_upload', moduleName, tableName, null, null, { count: inserted }, req.ip);
      res.json({ success: true, message: `${inserted} records uploaded`, data: { inserted } });
    } catch (err) { next(err); }
  });

  return sub;
}

// ============================================================================
// HR Settings - admin-settings-hr.html
// ============================================================================

router.use('/purpose-types', masterDataCRUD('master_purpose_types', 'purpose_name', 'hr'));
router.use('/food-items', masterDataCRUD('master_food_items', 'item_name', 'hr', ['category']));

// ============================================================================
// NRM Settings - admin-settings-nrm.html
// ============================================================================

router.use('/nrm-categories', masterDataCRUD('nrm_categories', 'category_name', 'nrm'));
router.use('/departments', masterDataCRUD('departments', 'department_name', 'nrm'));

// NRM Items (has extra columns: sku_code, category_id)
router.use('/nrm-items', masterDataCRUD('nrm_items', 'item_name', 'nrm', ['sku_code', 'category_id']));

// ============================================================================
// Maintenance Settings - admin-settings-mnt.html
// ============================================================================

router.use('/production-lines', masterDataCRUD('mnt_production_lines', 'line_name', 'maintenance'));
router.use('/problem-types', masterDataCRUD('mnt_problem_types', 'problem_name', 'maintenance'));

// Machines (has extra column: production_line_id)
router.use('/machines', masterDataCRUD('mnt_machines', 'machine_name', 'maintenance', ['production_line_id']));

// Shifts
router.use('/shifts', masterDataCRUD('mnt_shifts', 'shift_name', 'maintenance', ['start_time', 'end_time']));

module.exports = router;
