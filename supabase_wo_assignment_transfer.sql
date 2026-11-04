-- Run after supabase_wo_assignments.sql. Uses the caller's existing table privileges and RLS.
CREATE OR REPLACE FUNCTION public.create_wo_assignment(
    p_wo_ref text, p_line_code text, p_product_code text, p_product_name text,
    p_effective_date date, p_effective_shift smallint, p_transfer_id bigint DEFAULT NULL
) RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
    source public.production_wo_assignments%ROWTYPE;
    previous_date date;
    previous_shift smallint;
    new_id bigint;
BEGIN
    IF nullif(btrim(p_wo_ref), '') IS NULL OR nullif(btrim(p_line_code), '') IS NULL
       OR nullif(btrim(p_product_code), '') IS NULL OR nullif(btrim(p_product_name), '') IS NULL
       OR p_effective_date IS NULL OR p_effective_shift IS NULL OR p_effective_shift NOT BETWEEN 1 AND 3 THEN
        RAISE EXCEPTION 'Assignment tidak lengkap';
    END IF;
    IF p_transfer_id IS NOT NULL THEN
        SELECT * INTO source FROM public.production_wo_assignments WHERE id = p_transfer_id FOR UPDATE;
        IF NOT FOUND OR upper(regexp_replace(btrim(source.wo_ref), '\s+', ' ', 'g')) <> upper(regexp_replace(btrim(p_wo_ref), '\s+', ' ', 'g')) OR source.ended_date IS NOT NULL THEN
            RAISE EXCEPTION 'Assignment asal tidak tersedia atau sudah ditutup';
        END IF;
        previous_date := CASE WHEN p_effective_shift = 1 THEN p_effective_date - 1 ELSE p_effective_date END;
        previous_shift := CASE WHEN p_effective_shift = 1 THEN 3 ELSE p_effective_shift - 1 END;
        IF (previous_date, previous_shift) < (source.effective_date, source.effective_shift) THEN
            RAISE EXCEPTION 'Perpindahan harus setelah awal assignment asal';
        END IF;
        UPDATE public.production_wo_assignments SET ended_date = previous_date, ended_shift = previous_shift WHERE id = p_transfer_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Assignment asal tidak dapat ditutup'; END IF;
    END IF;
    INSERT INTO public.production_wo_assignments (wo_ref, line_code, product_code, product_name, effective_date, effective_shift)
    VALUES (btrim(p_wo_ref), btrim(p_line_code), p_product_code, p_product_name, p_effective_date, p_effective_shift)
    RETURNING id INTO new_id;
    RETURN new_id;
END;
$$;
