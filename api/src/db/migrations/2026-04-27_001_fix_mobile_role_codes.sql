-- Earlier seed data inserted these mobile roles with role_codes that don't match
-- what the API expects (Api/src/routes/users.js MANAGEABLE_ROLE_CODES). The
-- 2026-04-25 migration's ON DUPLICATE KEY UPDATE only refreshed role_name, so
-- the wrong role_codes remained and Add User returned 500 for these roles.
-- This migration aligns role_code with the API's expected values, in place,
-- so existing user_roles mappings (FK on roles.id) are preserved.

UPDATE roles SET role_code = 'GENERAL_MANAGER'     WHERE role_name = 'General Manager'      AND role_code <> 'GENERAL_MANAGER';
UPDATE roles SET role_code = 'MNT_MANAGER'         WHERE role_name = 'Maintenance Manager'  AND role_code <> 'MNT_MANAGER';
UPDATE roles SET role_code = 'MNT_ENGINEER'        WHERE role_name = 'Maintenance Engineer' AND role_code <> 'MNT_ENGINEER';
UPDATE roles SET role_code = 'PRODUCTION_STAFF'    WHERE role_name = 'Production Staff'     AND role_code <> 'PRODUCTION_STAFF';
UPDATE roles SET role_code = 'DATA_ENTRY_OPERATOR' WHERE role_name = 'Data Entry Operator'  AND role_code <> 'DATA_ENTRY_OPERATOR';
