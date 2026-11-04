-- Run after supabase_wo_performance.sql. Functions use the caller's permissions and RLS.
CREATE OR REPLACE FUNCTION public.wo_historical_candidates(p_ref text, p_start_date date, p_start_shift integer)
RETURNS TABLE(line_code text, product_code text, product_name text, total_ok numeric, first_assignment date, first_assignment_shift integer)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 WITH grouped AS (
  SELECT l.line::text AS line_code, l.kode::text AS product_code, l.nama::text AS product_name, sum(coalesce(l.okpcs,0))::numeric AS total_ok
  FROM public.logs l
  WHERE (l.tanggal::date, l.shift::integer) >= (p_start_date, p_start_shift)
    AND (public.wo_normalize(l.wo_ref) = '' OR public.wo_normalize(l.wo_ref) = public.wo_normalize(p_ref))
    AND public.wo_normalize(l.line) <> '' AND public.wo_normalize(l.kode) <> '' AND public.wo_normalize(l.nama) <> ''
  GROUP BY l.line, l.kode, l.nama
 )
 SELECT g.line_code, g.product_code, g.product_name, g.total_ok, a.effective_date, a.effective_shift::integer
 FROM grouped g
 LEFT JOIN LATERAL (
  SELECT x.effective_date, x.effective_shift FROM public.production_wo_assignments x
  WHERE public.wo_normalize(x.wo_ref) = public.wo_normalize(p_ref)
   AND public.wo_normalize(x.line_code) = public.wo_normalize(g.line_code)
   AND public.wo_normalize(x.product_code) = public.wo_normalize(g.product_code)
   AND public.wo_normalize(x.product_name) = public.wo_normalize(g.product_name)
  ORDER BY x.effective_date, x.effective_shift LIMIT 1
 ) a ON true
 WHERE a.effective_date IS NULL OR (a.effective_date, a.effective_shift) > (p_start_date, p_start_shift)
 ORDER BY g.line_code, g.product_code, g.product_name
$$;

-- Each selection fills only the interval before an existing later assignment.
-- It never reopens an assignment that ended because of a transfer.
CREATE OR REPLACE FUNCTION public.wo_add_historical_parallel(p_ref text, p_start_date date, p_start_shift integer, p_candidates jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE item jsonb; first_row public.production_wo_assignments%ROWTYPE; end_date date; end_shift integer; added integer := 0;
BEGIN
 IF public.wo_normalize(p_ref) = '' OR p_start_date IS NULL OR p_start_shift NOT BETWEEN 1 AND 3 OR p_start_shift IS NULL OR jsonb_typeof(p_candidates) <> 'array' THEN
  RAISE EXCEPTION 'Data assignment historis tidak lengkap';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(public.wo_normalize(p_ref), 0));
 FOR item IN SELECT * FROM jsonb_array_elements(p_candidates) LOOP
  IF public.wo_normalize(item->>'line_code') = '' OR public.wo_normalize(item->>'product_code') = '' OR public.wo_normalize(item->>'product_name') = '' THEN RAISE EXCEPTION 'Mesin dan produk wajib diisi'; END IF;
  SELECT * INTO first_row FROM public.production_wo_assignments a
   WHERE public.wo_normalize(a.wo_ref) = public.wo_normalize(p_ref)
   AND public.wo_normalize(a.line_code) = public.wo_normalize(item->>'line_code')
   AND public.wo_normalize(a.product_code) = public.wo_normalize(item->>'product_code')
   AND public.wo_normalize(a.product_name) = public.wo_normalize(item->>'product_name')
   ORDER BY a.effective_date, a.effective_shift LIMIT 1 FOR UPDATE;
  IF FOUND THEN
   IF (first_row.effective_date, first_row.effective_shift) <= (p_start_date, p_start_shift) THEN CONTINUE; END IF;
   end_date := CASE WHEN first_row.effective_shift = 1 THEN first_row.effective_date - 1 ELSE first_row.effective_date END;
   end_shift := CASE WHEN first_row.effective_shift = 1 THEN 3 ELSE first_row.effective_shift - 1 END;
  ELSE end_date := NULL; end_shift := NULL; END IF;
  INSERT INTO public.production_wo_assignments (wo_ref, line_code, product_code, product_name, effective_date, effective_shift, ended_date, ended_shift)
  VALUES (btrim(p_ref), item->>'line_code', item->>'product_code', item->>'product_name', p_start_date, p_start_shift, end_date, end_shift);
  added := added + 1;
 END LOOP;
 RETURN added;
END;
$$;
