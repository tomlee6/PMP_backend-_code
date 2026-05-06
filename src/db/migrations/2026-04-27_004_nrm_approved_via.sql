-- Track which client (mobile/web) actioned an NRM request — set by the API on
-- approve / reject / issue / cancel. Mirrors the column we added to hr_requests
-- so the shared web drawer can use a single field name for its view-only check.

ALTER TABLE nrm_requests
  ADD COLUMN approved_via VARCHAR(20) NULL AFTER issued_at;
