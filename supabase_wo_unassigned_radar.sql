-- Read-only radar, installed after the existing WO/attention migrations.
-- The index accelerates discovery of the latest three production shifts;
-- the WO performance indexes remain responsible for normalized lookups.
CREATE INDEX IF NOT EXISTS logs_wo_radar_recent_shift_idx
 ON public.logs (tanggal DESC, shift DESC);

CREATE OR REPLACE FUNCTION public.wo_unassigned_machines()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$
 WITH recent_shifts AS MATERIALIZED (
  SELECT DISTINCT l.tanggal,l.shift
  FROM public.logs l
  WHERE l.tanggal IS NOT NULL AND l.shift::text IN ('1','2','3')
  ORDER BY l.tanggal DESC,l.shift DESC LIMIT 3
 ), recent_logs AS MATERIALIZED (
  SELECT l.id,l.line,l.kode,l.nama,l.tanggal,l.shift,l.okpcs,
   public.wo_normalize(l.line) AS line_key,
   public.wo_normalize(l.kode) AS code_key,public.wo_normalize(l.nama) AS name_key,
   (to_jsonb(l)->>'created_at') AS created_sort
  FROM public.logs l JOIN recent_shifts rs ON l.tanggal=rs.tanggal AND l.shift=rs.shift
  WHERE l.shift::text IN ('1','2','3') AND public.wo_normalize(l.line)<>''
 ), ranked AS (
  SELECT l.*,count(*) OVER (PARTITION BY l.line_key) AS recent_log_count,
   row_number() OVER (PARTITION BY l.line_key ORDER BY l.tanggal DESC,l.shift::integer DESC,l.created_sort DESC NULLS LAST,l.id DESC) AS row_num
  FROM recent_logs l
 ), latest AS MATERIALIZED (SELECT * FROM ranked WHERE row_num=1),
 relevant_products AS MATERIALIZED (SELECT DISTINCT code_key,name_key FROM latest),
 relevant_assignments AS MATERIALIZED (
  SELECT a.wo_ref,a.line_code,a.product_code,a.product_name,a.effective_date,a.effective_shift,a.ended_date,a.ended_shift,
   public.wo_normalize(a.line_code) AS line_key,public.wo_normalize(a.product_code) AS code_key,
   public.wo_normalize(a.product_name) AS name_key,coalesce(st.status,'OPEN') AS status
  FROM public.production_wo_assignments a
  JOIN relevant_products p ON p.code_key=public.wo_normalize(a.product_code) AND p.name_key=public.wo_normalize(a.product_name)
  LEFT JOIN public.production_wo_status st ON public.wo_normalize(st.wo_ref)=public.wo_normalize(a.wo_ref)
  WHERE public.wo_normalize(a.wo_ref)<>'' AND coalesce(st.status,'OPEN') IN ('OPEN','ON_HOLD')
 ), machine_matches AS (
  SELECT l.line_key,
   count(DISTINCT public.wo_normalize(a.wo_ref)) FILTER (WHERE a.status='OPEN') AS line_open_wo_count,
   count(DISTINCT public.wo_normalize(a.wo_ref)) FILTER (WHERE a.status='ON_HOLD') AS line_on_hold_wo_count
  FROM latest l LEFT JOIN relevant_assignments a ON a.line_key=l.line_key AND a.code_key=l.code_key AND a.name_key=l.name_key
   -- An open-ended assignment is current even when its first report is pending.
   AND (a.ended_date IS NULL OR
    ((l.tanggal::date,l.shift::integer)>=(a.effective_date,a.effective_shift)
     AND (l.tanggal::date,l.shift::integer)<=(a.ended_date,a.ended_shift)))
  GROUP BY l.line_key
 ), product_matches AS (
  SELECT a.code_key,a.name_key,
   count(DISTINCT public.wo_normalize(a.wo_ref)) FILTER (WHERE a.status='OPEN' AND a.ended_date IS NULL) AS matching_open_wo_count,
   count(DISTINCT public.wo_normalize(a.wo_ref)) FILTER (WHERE a.status='ON_HOLD' AND a.ended_date IS NULL) AS matching_on_hold_wo_count
  FROM relevant_assignments a GROUP BY a.code_key,a.name_key
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'line_code',l.line,'product_code',l.kode,'product_name',l.nama,'latest_date',l.tanggal,
  'latest_shift',l.shift,'latest_ok',l.okpcs,'recent_log_count',l.recent_log_count,
  'matching_open_wo_count',coalesce(p.matching_open_wo_count,0),
  'matching_on_hold_wo_count',coalesce(p.matching_on_hold_wo_count,0),
  'line_on_hold_wo_count',m.line_on_hold_wo_count
 ) ORDER BY l.line_key),'[]'::jsonb)
 FROM latest l JOIN machine_matches m ON m.line_key=l.line_key
 LEFT JOIN product_matches p ON p.code_key=l.code_key AND p.name_key=l.name_key
 WHERE m.line_open_wo_count=0
$$;
REVOKE ALL ON FUNCTION public.wo_unassigned_machines() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wo_unassigned_machines() TO anon, authenticated;
