-- 003: special projects gain the same disbursement tracking columns as the
--      welfare / funeral / wedding cases so one code path can disburse any of them.
ALTER TABLE special_projects ADD COLUMN IF NOT EXISTS disbursed_at TIMESTAMPTZ;
ALTER TABLE special_projects ADD COLUMN IF NOT EXISTS disbursement_reference VARCHAR(120);
