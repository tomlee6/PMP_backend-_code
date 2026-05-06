-- Add 7 mobile-only user roles so SYS_ADMIN can create users for the mobile app.
-- Existing roles (SYS_ADMIN, HR_ADMIN, NRM_ADMIN) are NOT modified.

INSERT INTO roles (
  role_code, role_name,
  mobile_access, web_admin_access, web_settings_access,
  hr_request, hr_approve, hr_execute,
  nrm_request, nrm_approve, nrm_execute,
  mnt_request, mnt_approve, mnt_execute,
  can_view_hr_dashboard, can_view_nrm_dashboard, can_view_mnt_dashboard,
  settings_view, settings_upload,
  is_active
) VALUES
  ('GENERAL_MANAGER',    'General Manager',       1, 0, 0,  0, 1, 0,  0, 0, 0,  0, 0, 0,  0, 0, 0,  0, 0, 1),
  ('HR_STAFF',           'HR Staff',              1, 0, 0,  0, 0, 1,  0, 0, 0,  0, 0, 0,  0, 0, 0,  0, 0, 1),
  ('DEPT_HEAD',          'Department Head',       1, 0, 0,  1, 0, 0,  1, 0, 0,  0, 0, 0,  0, 0, 0,  0, 0, 1),
  ('MNT_MANAGER',        'Maintenance Manager',   1, 0, 0,  0, 0, 0,  0, 0, 0,  0, 1, 0,  0, 0, 0,  0, 0, 1),
  ('MNT_ENGINEER',       'Maintenance Engineer',  1, 0, 0,  0, 0, 0,  0, 0, 0,  0, 0, 1,  0, 0, 0,  0, 0, 1),
  ('PRODUCTION_STAFF',   'Production Staff',      1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,  0, 0, 0,  0, 0, 1),
  ('DATA_ENTRY_OPERATOR','Data Entry Operator',   1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,  0, 0, 0,  0, 0, 1)
ON DUPLICATE KEY UPDATE role_name = VALUES(role_name);
