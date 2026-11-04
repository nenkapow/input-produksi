-- Add WO snapshots without changing existing production logs.
ALTER TABLE public.logs
    ADD COLUMN IF NOT EXISTS wo_ref text,
    ADD COLUMN IF NOT EXISTS wo_qty numeric,
    ADD COLUMN IF NOT EXISTS wo_start_date date,
    ADD COLUMN IF NOT EXISTS wo_start_shift integer;
