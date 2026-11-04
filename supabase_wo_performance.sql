-- Additive WO query helpers. Run after the existing WO migrations.
-- SECURITY INVOKER preserves the caller's existing table permissions and RLS.
CREATE INDEX IF NOT EXISTS logs_wo_normalized_ref_idx ON public.logs ((upper(regexp_replace(btrim(coalesce(wo_ref, '')), '\s+', ' ', 'g'))));
CREATE INDEX IF NOT EXISTS logs_wo_history_lookup_idx ON public.logs (
  (upper(regexp_replace(btrim(coalesce(line, '')), '\s+', ' ', 'g'))),
  (upper(regexp_replace(btrim(coalesce(kode, '')), '\s+', ' ', 'g'))),
  (upper(regexp_replace(btrim(coalesce(nama, '')), '\s+', ' ', 'g'))), tanggal, shift
);
CREATE INDEX IF NOT EXISTS wo_assignment_normalized_ref_idx ON public.production_wo_assignments ((upper(regexp_replace(btrim(wo_ref), '\s+', ' ', 'g'))));
CREATE INDEX IF NOT EXISTS wo_assignment_resolve_idx ON public.production_wo_assignments (
  (upper(regexp_replace(btrim(line_code), '\s+', ' ', 'g'))),
  (upper(regexp_replace(btrim(product_code), '\s+', ' ', 'g'))),
  (upper(regexp_replace(btrim(product_name), '\s+', ' ', 'g'))), effective_date, effective_shift
);

CREATE OR REPLACE FUNCTION public.wo_normalize(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT upper(regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.wo_resolve_assignments(p_line text, p_code text, p_name text)
RETURNS SETOF public.production_wo_assignments LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT a.* FROM public.production_wo_assignments a
 WHERE public.wo_normalize(a.line_code) = public.wo_normalize(p_line)
   AND public.wo_normalize(a.product_code) = public.wo_normalize(p_code)
   AND public.wo_normalize(a.product_name) = public.wo_normalize(p_name)
$$;

CREATE OR REPLACE FUNCTION public.wo_metadata(p_ref text)
RETURNS TABLE (wo_ref text, wo_qty numeric, wo_start_date date, wo_start_shift integer)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT l.wo_ref::text, l.wo_qty::numeric, l.wo_start_date::date, l.wo_start_shift::integer
 FROM public.logs l WHERE public.wo_normalize(l.wo_ref) = public.wo_normalize(p_ref)
   AND l.wo_qty > 0 AND l.wo_start_date IS NOT NULL
 ORDER BY l.tanggal DESC, l.shift DESC LIMIT 1
$$;

-- Used only when the user explicitly opens Lanjut WO.
CREATE OR REPLACE FUNCTION public.wo_list_metadata()
RETURNS TABLE (wo_ref text, wo_qty numeric, wo_start_date date, wo_start_shift integer)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT DISTINCT ON (public.wo_normalize(l.wo_ref)) l.wo_ref::text, l.wo_qty::numeric, l.wo_start_date::date, l.wo_start_shift::integer
 FROM public.logs l WHERE public.wo_normalize(l.wo_ref) <> '' AND l.wo_qty > 0 AND l.wo_start_date IS NOT NULL
 ORDER BY public.wo_normalize(l.wo_ref), l.tanggal DESC, l.shift DESC
$$;

CREATE OR REPLACE FUNCTION public.wo_progress(p_ref text, p_exclude_id text DEFAULT NULL, p_draft jsonb DEFAULT NULL, p_transfer_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$
 WITH assignment AS (
   SELECT a.line_code, a.product_code, a.product_name, a.effective_date, a.effective_shift,
     CASE WHEN a.id = p_transfer_id AND p_draft IS NOT NULL THEN
       CASE WHEN (p_draft->>'effective_shift')::integer = 1 THEN (p_draft->>'effective_date')::date - 1 ELSE (p_draft->>'effective_date')::date END
       ELSE a.ended_date END AS ended_date,
     CASE WHEN a.id = p_transfer_id AND p_draft IS NOT NULL THEN
       CASE WHEN (p_draft->>'effective_shift')::integer = 1 THEN 3 ELSE (p_draft->>'effective_shift')::integer - 1 END
       ELSE a.ended_shift END AS ended_shift
   FROM public.production_wo_assignments a WHERE public.wo_normalize(a.wo_ref) = public.wo_normalize(p_ref)
   UNION ALL
   SELECT p_draft->>'line_code', p_draft->>'product_code', p_draft->>'product_name',
     (p_draft->>'effective_date')::date, (p_draft->>'effective_shift')::integer, NULL::date, NULL::integer
   WHERE p_draft IS NOT NULL
 ), matched AS (
   SELECT l.line, l.kode, l.nama, l.okpcs, l.wo_ref
   FROM public.logs l
   WHERE (p_exclude_id IS NULL OR l.id::text <> p_exclude_id)
     AND (public.wo_normalize(l.wo_ref) = '' OR public.wo_normalize(l.wo_ref) = public.wo_normalize(p_ref))
     AND EXISTS (SELECT 1 FROM assignment a
       WHERE public.wo_normalize(l.line) = public.wo_normalize(a.line_code)
         AND public.wo_normalize(l.kode) = public.wo_normalize(a.product_code)
         AND public.wo_normalize(l.nama) = public.wo_normalize(a.product_name)
         AND (l.tanggal::date, l.shift::integer) >= (a.effective_date, a.effective_shift)
         AND (a.ended_date IS NULL OR (l.tanggal::date, l.shift::integer) <= (a.ended_date, a.ended_shift)))
 ), grouped AS (
   SELECT line, kode, nama, sum(coalesce(okpcs,0)) AS ok FROM matched GROUP BY line,kode,nama
 )
 SELECT jsonb_build_object('historical_ok', coalesce((SELECT sum(coalesce(okpcs,0)) FROM matched),0),
   'includes_unreferenced', coalesce((SELECT bool_or(public.wo_normalize(wo_ref) = '') FROM matched),false),
   'contributions', coalesce((SELECT jsonb_agg(jsonb_build_object('line',line,'kode',kode,'nama',nama,'ok',ok)) FROM grouped),'[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.wo_assignments_for_ref(p_ref text)
RETURNS SETOF public.production_wo_assignments LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT a.* FROM public.production_wo_assignments a WHERE public.wo_normalize(a.wo_ref) = public.wo_normalize(p_ref)
$$;
