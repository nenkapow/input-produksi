-- WO Attention performance hotfix. Requires the previous WO performance and
-- continuation migrations. It does not rewrite logs or change WO status.
-- Run after reviewing the plan and benchmarking against the current RPC.
-- The existing logs_wo_history_lookup_idx covers normalized line/code/name;
-- this separate index supports latest-log-by-line ordering without product.
CREATE INDEX IF NOT EXISTS logs_wo_line_latest_v2_idx
 ON public.logs (public.wo_normalize(line), tanggal DESC, shift DESC, id DESC);

CREATE OR REPLACE FUNCTION public.wo_attention_list()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$
WITH
refs AS MATERIALIZED (
 SELECT m.wo_ref,m.wo_qty AS qty,m.wo_start_date AS start_date,
        public.wo_normalize(m.wo_ref) AS ref_key
 FROM public.wo_list_metadata() m
),
-- The SECURITY DEFINER reader already mediates continuation access; invoke it
-- once per reference, retaining the existing INVOKER/RLS contract for logs.
continuation AS MATERIALIZED (
 SELECT r.ref_key,
        max(c.parent_wo_ref) FILTER (WHERE public.wo_normalize(c.child_wo_ref)=r.ref_key) AS parent_ref,
        max(c.child_wo_ref) FILTER (WHERE public.wo_normalize(c.parent_wo_ref)=r.ref_key) AS child_ref,
        coalesce(max(c.carryover_qty) FILTER (WHERE public.wo_normalize(c.child_wo_ref)=r.ref_key),0) AS carryover_qty,
        bool_or(public.wo_normalize(c.child_wo_ref)=r.ref_key) AS is_continuation
 FROM refs r LEFT JOIN LATERAL public.wo_continuation_read(r.wo_ref) c ON true
 GROUP BY r.ref_key
),
all_assignments AS MATERIALIZED (
 SELECT r.ref_key, a.id, a.line_code, a.product_code, a.product_name,
        a.effective_date,a.effective_shift,a.ended_date,a.ended_shift,
        public.wo_normalize(a.line_code) AS line_key,
        public.wo_normalize(a.product_code) AS code_key,
        public.wo_normalize(a.product_name) AS name_key
 FROM refs r JOIN public.production_wo_assignments a
   ON public.wo_normalize(a.wo_ref)=r.ref_key
),
active_assignments AS MATERIALIZED (
 SELECT * FROM all_assignments WHERE ended_date IS NULL
),
relevant_lines AS MATERIALIZED (
 SELECT DISTINCT line_key FROM all_assignments
),
-- Read matching lines once; no full logs are transferred to the browser.
line_logs AS MATERIALIZED (
 SELECT l.id,l.tanggal,l.shift,l.line,l.kode,l.nama,l.okpcs,l.wo_ref,
        public.wo_normalize(l.line) AS line_key,
        public.wo_normalize(l.kode) AS code_key,
        public.wo_normalize(l.nama) AS name_key,
        public.wo_normalize(l.wo_ref) AS ref_key,
        (to_jsonb(l)->>'created_at') AS created_sort
 FROM public.logs l JOIN relevant_lines r
   ON public.wo_normalize(l.line)=r.line_key
),
-- EXISTS in wo_progress counts a log once even if assignments overlap.
progress_matches AS MATERIALIZED (
 SELECT DISTINCT a.ref_key,l.id,l.okpcs
 FROM all_assignments a
 JOIN line_logs l ON l.line_key=a.line_key AND l.code_key=a.code_key AND l.name_key=a.name_key
 JOIN continuation c ON c.ref_key=a.ref_key
 WHERE (l.ref_key=a.ref_key OR (l.ref_key='' AND NOT coalesce(c.is_continuation,false)))
   AND (l.tanggal::date,l.shift::integer)>=(a.effective_date,a.effective_shift)
   AND (a.ended_date IS NULL OR (l.tanggal::date,l.shift::integer)<=(a.ended_date,a.ended_shift))
),
progress AS MATERIALIZED (
 SELECT ref_key,coalesce(sum(coalesce(okpcs,0)),0) AS production_ok
 FROM progress_matches GROUP BY ref_key
),
-- Resolve each assignment against its applicable line logs in one set.  The
-- boundary remains in the join so NULL date/shift ordering matches the old RPC.
latest_assignment AS MATERIALIZED (
 SELECT DISTINCT ON (a.id) a.id AS assignment_id,l.tanggal,l.shift,l.kode,l.nama
 FROM active_assignments a JOIN line_logs l ON l.line_key=a.line_key
 WHERE (l.tanggal::date,l.shift::integer)>=(a.effective_date,a.effective_shift)
 ORDER BY a.id,l.tanggal DESC,l.shift::integer DESC,l.created_sort DESC NULLS LAST,l.id DESC
),
-- One set-based join and DISTINCT ON replaces a lateral query per assignment.
previous_product AS MATERIALIZED (
 SELECT DISTINCT ON (a.id) a.id AS assignment_id,l.tanggal,l.shift
 FROM active_assignments a JOIN line_logs l
   ON l.line_key=a.line_key AND l.code_key=a.code_key AND l.name_key=a.name_key
 WHERE (l.ref_key='' OR l.ref_key=a.ref_key)
   AND (l.tanggal::date,l.shift::integer)>=(a.effective_date,a.effective_shift)
 ORDER BY a.id,l.tanggal DESC,l.shift::integer DESC,l.created_sort DESC NULLS LAST,l.id DESC
),
overview AS MATERIALIZED (
 SELECT r.wo_ref,r.qty,r.start_date,coalesce(s.status,'OPEN') AS status,
        s.closed_at,s.closed_reason,s.note,
        coalesce(p.production_ok,0)+c.carryover_qty AS ok,
        r.ref_key,c.parent_ref,c.child_ref,c.carryover_qty
 FROM refs r
 LEFT JOIN public.production_wo_status s ON public.wo_normalize(s.wo_ref)=r.ref_key
 JOIN continuation c ON c.ref_key=r.ref_key
 LEFT JOIN progress p ON p.ref_key=r.ref_key
),
assignment AS (
 SELECT o.wo_ref,o.qty,o.start_date,o.status,o.closed_at,o.closed_reason,o.note,o.ok,
        a.id AS assignment_id,a.line_code,a.product_code,a.product_name,a.effective_date,a.effective_shift,
        latest.tanggal AS latest_date,latest.shift AS latest_shift,latest.kode AS latest_code,latest.nama AS latest_name,
        prior.tanggal AS previous_date,prior.shift AS previous_shift,
        (latest.tanggal IS NOT NULL AND (public.wo_normalize(latest.kode)<>public.wo_normalize(a.product_code)
          OR public.wo_normalize(latest.nama)<>public.wo_normalize(a.product_name))) AS changed,
        o.ref_key
 FROM overview o JOIN active_assignments a ON a.ref_key=o.ref_key
 LEFT JOIN latest_assignment latest ON latest.assignment_id=a.id
 LEFT JOIN previous_product prior ON prior.assignment_id=a.id
),
assignment_json AS (
 SELECT ref_key,jsonb_agg(to_jsonb(a) - 'qty' - 'ok' - 'status' - 'wo_ref' - 'closed_at' - 'closed_reason' - 'note' - 'ref_key') AS assignments
 FROM assignment a GROUP BY ref_key
),
items AS (
 SELECT jsonb_build_object('wo_ref',o.wo_ref,'qty',o.qty,'ok',o.ok,'remaining',o.qty-o.ok,'status',o.status,
   'closed_at',o.closed_at,'reason',o.closed_reason,'note',o.note,'parent_ref',o.parent_ref,'child_ref',o.child_ref,
   'carryover_qty',o.carryover_qty,'assignments',coalesce(a.assignments,'[]'::jsonb)) AS item
 FROM overview o LEFT JOIN assignment_json a ON a.ref_key=o.ref_key
)
SELECT coalesce(jsonb_agg(item),'[]'::jsonb) FROM items
$$;

-- CREATE OR REPLACE preserves existing ACLs; repeat the existing browser grant.
GRANT EXECUTE ON FUNCTION public.wo_attention_list() TO anon, authenticated;
