-- Track which client approved/rejected an HR request (e.g. 'mobile', 'web').
-- The web drawer uses this to label rows actioned from the mobile app and to
-- enforce a view-only state (no further actions) once the mobile dev's approval
-- flow has completed it.

ALTER TABLE hr_requests
  ADD COLUMN approved_via VARCHAR(20) NULL AFTER approved_at;
