-- READ ONLY. Run separately as the intended migration/function owner.
-- Results are section + JSON; the final row is READY/BLOCKED with counts.
-- Existing wo_attention_list() is invoked once for authoritative baseline.
-- query_to_xml executes only SELECT and is gated on schema/privileges so missing
-- relations are reported rather than referenced at parse time.
WITH
required_columns(table_name,column_name) AS (VALUES
 ('logs','id'),('logs','wo_ref'),('logs','wo_qty'),('logs','wo_start_date'),('logs','wo_start_shift'),('logs','line'),('logs','kode'),('logs','nama'),('logs','tanggal'),('logs','shift'),('logs','okpcs'),
 ('production_wo_assignments','id'),('production_wo_assignments','wo_ref'),('production_wo_assignments','line_code'),('production_wo_assignments','product_code'),('production_wo_assignments','product_name'),('production_wo_assignments','effective_date'),('production_wo_assignments','effective_shift'),('production_wo_assignments','ended_date'),('production_wo_assignments','ended_shift'),
 ('production_wo_status','wo_ref'),('production_wo_status','status'),('production_wo_status','updated_at'),('production_wo_status','closed_at'),('production_wo_status','closed_reason'),('production_wo_status','remaining_at_close'),
 ('production_wo_actions','wo_ref'),('production_wo_actions','action'),('production_wo_actions','previous_status'),('production_wo_actions','new_status'),('production_wo_actions','assignment_id'),('production_wo_actions','note'),
 ('production_wo_continuations','parent_wo_ref'),('production_wo_continuations','child_wo_ref'),('production_wo_continuations','effective_date'),('production_wo_continuations','effective_shift'),('production_wo_continuations','carryover_qty'),
 ('production_wo_targets','wo_ref'),('production_wo_targets','target_qty'),('master','kode'),('master','nama')
),
optional_history_columns(column_name) AS (VALUES ('id'),('wo_ref'),('assignment_id'),('line_code'),('product_code'),('product_name'),('effective_date'),('effective_shift'),('ended_date'),('ended_shift'),('source'),('created_at')),
optional_history_check AS (
 SELECT o.column_name,to_regclass('public.production_wo_history_links') IS NOT NULL AS table_exists,
 EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.production_wo_history_links') AND a.attname=o.column_name AND a.attnum>0 AND NOT a.attisdropped) AS present FROM optional_history_columns o
),
required_functions(signature) AS (VALUES
 ('public.wo_progress(text,text,jsonb,bigint)'),('public.wo_attention_list()'),('public.wo_normalize(text)'),('public.wo_status_for_ref(text)'),
 ('public.wo_metadata(text)'),('public.wo_list_metadata()'),('public.wo_continuation_read(text)'),('public.create_wo_assignment(text,text,text,text,date,smallint,bigint)')
),
columns_check AS (
 SELECT r.*,to_regclass('public.'||r.table_name) IS NOT NULL AS table_exists,
 EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||r.table_name) AND a.attname=r.column_name AND a.attnum>0 AND NOT a.attisdropped) AS present FROM required_columns r
),
functions_check AS (SELECT f.signature,to_regprocedure(f.signature) AS oid FROM required_functions f),
required_tables AS (SELECT DISTINCT table_name FROM required_columns),
role_flags AS (SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user),
permissions AS (
 SELECT 'CREATE public schema' AS check_name,has_schema_privilege(current_user,'public','CREATE') AS allowed
 UNION ALL SELECT 'roles anon and authenticated exist',to_regrole('anon') IS NOT NULL AND to_regrole('authenticated') IS NOT NULL
 UNION ALL SELECT 'normalized status unique index',EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.wo_status_normalized_ref_idx') AND i.indisunique AND i.indisvalid)
 UNION ALL SELECT 'SELECT '||t.table_name,CASE WHEN to_regclass('public.'||t.table_name) IS NULL THEN false ELSE has_table_privilege(current_user,to_regclass('public.'||t.table_name),'SELECT') END FROM required_tables t
 UNION ALL SELECT 'INSERT '||t.table_name,CASE WHEN to_regclass('public.'||t.table_name) IS NULL THEN false ELSE has_table_privilege(current_user,to_regclass('public.'||t.table_name),'INSERT') END FROM required_tables t WHERE t.table_name IN ('production_wo_assignments','production_wo_status','production_wo_actions')
 UNION ALL SELECT 'UPDATE '||t.table_name,CASE WHEN to_regclass('public.'||t.table_name) IS NULL THEN false ELSE has_table_privilege(current_user,to_regclass('public.'||t.table_name),'UPDATE') END FROM required_tables t WHERE t.table_name IN ('logs','production_wo_assignments','production_wo_status')
 UNION ALL SELECT 'TRIGGER production_wo_assignments',CASE WHEN to_regclass('public.production_wo_assignments') IS NULL THEN false ELSE has_table_privilege(current_user,to_regclass('public.production_wo_assignments'),'TRIGGER') END
 UNION ALL SELECT 'EXECUTE '||f.signature,CASE WHEN f.oid IS NULL THEN false ELSE has_function_privilege(current_user,f.oid,'EXECUTE') END FROM functions_check f
 UNION ALL SELECT 'replace existing function '||f.signature,CASE WHEN f.oid IS NULL THEN false ELSE ((SELECT rolsuper FROM role_flags) OR pg_has_role(current_user,p.proowner,'USAGE')) END FROM functions_check f LEFT JOIN pg_proc p ON p.oid=f.oid WHERE f.signature IN ('public.wo_progress(text,text,jsonb,bigint)','public.wo_attention_list()')
 UNION ALL SELECT 'replace existing repair function '||p.oid::regprocedure::text,((SELECT rolsuper FROM role_flags) OR pg_has_role(current_user,p.proowner,'USAGE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('wo_repair_preview','wo_repair_apply','wo_history_link_covers','wo_guard_history_link_assignment')
 UNION ALL SELECT 'full visibility under RLS: '||c.relname, (NOT c.relrowsecurity OR (SELECT rolsuper OR rolbypassrls FROM role_flags) OR (NOT c.relforcerowsecurity AND pg_has_role(current_user,c.relowner,'USAGE'))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (SELECT table_name FROM required_tables) AND c.relkind IN ('r','p')
 UNION ALL SELECT 'full visibility under RLS: production_wo_history_links',CASE WHEN to_regclass('public.production_wo_history_links') IS NULL THEN true ELSE (NOT c.relrowsecurity OR (SELECT rolsuper OR rolbypassrls FROM role_flags) OR (NOT c.relforcerowsecurity AND pg_has_role(current_user,c.relowner,'USAGE'))) END FROM (SELECT 1) x LEFT JOIN pg_class c ON c.oid=to_regclass('public.production_wo_history_links')
 UNION ALL SELECT 'SELECT existing history-link table',CASE WHEN to_regclass('public.production_wo_history_links') IS NULL THEN true ELSE has_table_privilege(current_user,to_regclass('public.production_wo_history_links'),'SELECT') END
 UNION ALL SELECT 'INSERT existing history-link table',CASE WHEN to_regclass('public.production_wo_history_links') IS NULL THEN true ELSE has_table_privilege(current_user,to_regclass('public.production_wo_history_links'),'INSERT') END
 UNION ALL SELECT 'UPDATE existing history-link table (LOCK TABLE)',CASE WHEN to_regclass('public.production_wo_history_links') IS NULL THEN true ELSE has_table_privilege(current_user,to_regclass('public.production_wo_history_links'),'UPDATE') END
 UNION ALL SELECT 'existing history-link table ownership',CASE WHEN to_regclass('public.production_wo_history_links') IS NULL THEN true ELSE ((SELECT rolsuper FROM role_flags) OR pg_has_role(current_user,c.relowner,'USAGE')) END FROM (SELECT 1) x LEFT JOIN pg_class c ON c.oid=to_regclass('public.production_wo_history_links')
 UNION ALL SELECT 'baseline functions are read-only (STABLE/IMMUTABLE)',NOT EXISTS (SELECT 1 FROM functions_check f JOIN pg_proc p ON p.oid=f.oid WHERE f.signature IN ('public.wo_progress(text,text,jsonb,bigint)','public.wo_attention_list()','public.wo_normalize(text)','public.wo_status_for_ref(text)','public.wo_metadata(text)','public.wo_list_metadata()','public.wo_continuation_read(text)') AND p.provolatile='v')
),
flags AS (
 SELECT NOT EXISTS (SELECT 1 FROM columns_check WHERE NOT present)
  AND NOT EXISTS (SELECT 1 FROM functions_check WHERE oid IS NULL)
  AND NOT EXISTS (SELECT 1 FROM optional_history_check WHERE table_exists AND NOT present)
  AND NOT EXISTS (SELECT 1 FROM permissions WHERE NOT allowed) AS can_inspect
),
security_tables AS (
 SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS rls_forced,
 CASE WHEN to_regrole('anon') IS NULL THEN NULL ELSE has_table_privilege('anon',c.oid,'SELECT') END AS anon_select,
 CASE WHEN to_regrole('anon') IS NULL THEN NULL ELSE has_table_privilege('anon',c.oid,'INSERT') END AS anon_insert,
 CASE WHEN to_regrole('anon') IS NULL THEN NULL ELSE has_table_privilege('anon',c.oid,'UPDATE') END AS anon_update,
 CASE WHEN to_regrole('anon') IS NULL THEN NULL ELSE has_table_privilege('anon',c.oid,'DELETE') END AS anon_delete,
 CASE WHEN to_regrole('authenticated') IS NULL THEN NULL ELSE has_table_privilege('authenticated',c.oid,'SELECT') END AS authenticated_select,
 CASE WHEN to_regrole('authenticated') IS NULL THEN NULL ELSE has_table_privilege('authenticated',c.oid,'INSERT') END AS authenticated_insert,
 CASE WHEN to_regrole('authenticated') IS NULL THEN NULL ELSE has_table_privilege('authenticated',c.oid,'UPDATE') END AS authenticated_update,
 CASE WHEN to_regrole('authenticated') IS NULL THEN NULL ELSE has_table_privilege('authenticated',c.oid,'DELETE') END AS authenticated_delete
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (SELECT table_name FROM required_tables UNION SELECT 'production_wo_history_links') AND c.relkind IN ('r','p')
),
security_functions AS (
 SELECT p.oid::regprocedure::text AS signature,pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS security_definer,p.provolatile AS volatility,p.proconfig AS settings,
 CASE WHEN to_regrole('anon') IS NULL THEN NULL ELSE has_function_privilege('anon',p.oid,'EXECUTE') END AS anon_execute,
 CASE WHEN to_regrole('authenticated') IS NULL THEN NULL ELSE has_function_privilege('authenticated',p.oid,'EXECUTE') END AS authenticated_execute,
 CASE WHEN to_regclass('public.logs') IS NULL THEN NULL ELSE has_table_privilege(p.proowner,to_regclass('public.logs'),'SELECT') END AS owner_select_logs,
 CASE WHEN to_regclass('public.production_wo_assignments') IS NULL THEN NULL ELSE has_table_privilege(p.proowner,to_regclass('public.production_wo_assignments'),'UPDATE') END AS owner_update_assignments
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'wo\_%' ESCAPE '\' OR p.proname='create_wo_assignment')
),
indexes AS (
 SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('logs','production_wo_assignments','production_wo_continuations','production_wo_targets','production_wo_history_links')
),
-- JSON result from a single SELECT. The materialized normalized logs/assignments
-- avoid one client request or full logs scan per assignment. This inspection
-- can still be expensive on a large database; schedule it appropriately.
inspection AS (
 SELECT CASE WHEN (SELECT can_inspect FROM flags) THEN
 (xpath('string(/table/row/doc)',query_to_xml($q$
 WITH
 attention AS MATERIALIZED (SELECT x.* FROM jsonb_to_recordset(public.wo_attention_list()) AS x(wo_ref text,qty numeric,ok numeric,remaining numeric,status text,assignments jsonb,carryover_qty numeric,parent_ref text)),
 metadata AS MATERIALIZED (SELECT m.* FROM public.wo_list_metadata() m),
 assignments AS MATERIALIZED (SELECT a.*,public.wo_normalize(a.wo_ref) AS rk,public.wo_normalize(a.line_code) AS lk,public.wo_normalize(a.product_code) AS ck,public.wo_normalize(a.product_name) AS nk FROM public.production_wo_assignments a),
 logs_n AS MATERIALIZED (SELECT l.id,l.wo_ref,l.line,l.kode,l.nama,l.tanggal::date AS tanggal,CASE WHEN l.shift::text IN ('1','2','3') THEN l.shift::integer ELSE NULL END AS shift,l.okpcs,public.wo_normalize(l.wo_ref) AS rk,public.wo_normalize(l.line) AS lk,public.wo_normalize(l.kode) AS ck,public.wo_normalize(l.nama) AS nk,(to_jsonb(l)->>'created_at') AS created_sort FROM public.logs l),
 assignment_overlaps AS MATERIALIZED (
  SELECT a.wo_ref AS wo_a,b.wo_ref AS wo_b,a.id AS assignment_a,b.id AS assignment_b,a.line_code,a.product_code,a.product_name,
   a.effective_date AS start_a,a.effective_shift AS shift_a,a.ended_date AS end_a,a.ended_shift AS end_shift_a,
   b.effective_date AS start_b,b.effective_shift AS shift_b,b.ended_date AS end_b,b.ended_shift AS end_shift_b
  FROM assignments a JOIN assignments b ON a.id<b.id AND a.rk<>b.rk AND a.lk=b.lk AND a.ck=b.ck AND a.nk=b.nk
   AND (a.effective_date,a.effective_shift)<=(coalesce(b.ended_date,'infinity'::date),coalesce(b.ended_shift,2147483647))
   AND (b.effective_date,b.effective_shift)<=(coalesce(a.ended_date,'infinity'::date),coalesce(a.ended_shift,2147483647))
 ),
 child_logs AS MATERIALIZED (
  SELECT c.child_wo_ref,c.parent_wo_ref,c.effective_date AS child_date,c.effective_shift AS child_shift,
   a.id AS assignment_id,a.line_code,a.product_code,a.product_name,a.effective_date AS assignment_date,a.effective_shift AS assignment_shift,
   a.ended_date,a.ended_shift,l.id AS log_id,l.tanggal,l.shift,l.okpcs,
   EXISTS (SELECT 1 FROM assignments other_a WHERE other_a.rk<>a.rk AND other_a.lk=l.lk AND other_a.ck=l.ck AND other_a.nk=l.nk
     AND (l.tanggal,l.shift)>=(other_a.effective_date,other_a.effective_shift)
     AND (other_a.ended_date IS NULL OR (l.tanggal,l.shift)<=(other_a.ended_date,other_a.ended_shift))) AS has_other_assignment
  FROM public.production_wo_continuations c JOIN assignments a ON a.rk=public.wo_normalize(c.child_wo_ref)
  LEFT JOIN logs_n l ON l.lk=a.lk AND l.ck=a.ck AND l.nk=a.nk AND l.rk=''
 ),
 child_boundary AS MATERIALIZED (
  SELECT child_wo_ref,parent_wo_ref,child_date,child_shift,assignment_id,line_code,product_code,product_name,assignment_date,assignment_shift,
   coalesce(sum(coalesce(okpcs,0)) FILTER (WHERE (tanggal,shift)<(child_date,child_shift)),0) AS before_child_boundary_ok,
   count(log_id) FILTER (WHERE (tanggal,shift)<(child_date,child_shift)) AS before_child_boundary_logs,
   coalesce(sum(coalesce(okpcs,0)) FILTER (WHERE (tanggal,shift)>=(child_date,child_shift) AND (ended_date IS NULL OR (tanggal,shift)<=(ended_date,ended_shift)) AND NOT has_other_assignment),0) AS eligible_after_child_boundary_ok,
   count(log_id) FILTER (WHERE (tanggal,shift)>=(child_date,child_shift) AND (ended_date IS NULL OR (tanggal,shift)<=(ended_date,ended_shift)) AND NOT has_other_assignment) AS eligible_after_child_boundary_logs
  FROM child_logs GROUP BY child_wo_ref,parent_wo_ref,child_date,child_shift,assignment_id,line_code,product_code,product_name,assignment_date,assignment_shift
 ),
 protected AS MATERIALIZED (
  SELECT DISTINCT l.id AS log_id,l.line,l.kode,l.nama,l.wo_ref AS log_wo_ref,a.wo_ref AS candidate_wo_ref,l.tanggal,l.shift,l.okpcs
  FROM assignments a JOIN logs_n l ON l.lk=a.lk AND l.ck=a.ck AND l.nk=a.nk
   AND l.rk<>'' AND l.rk<>a.rk AND (l.tanggal,l.shift)<(a.effective_date,a.effective_shift)
  JOIN attention w ON public.wo_normalize(w.wo_ref)=a.rk AND w.status IN ('OPEN','ON_HOLD')
  JOIN metadata m ON public.wo_normalize(m.wo_ref)=a.rk AND (l.tanggal,l.shift)>=(m.wo_start_date,m.wo_start_shift)
 ),
 -- Simulate a potential new machine for an exact product already assigned to a
 -- WO. It is a candidate only, not a suggestion to create an assignment.
 candidate_rows AS MATERIALIZED (
  SELECT DISTINCT w.wo_ref,w.qty,w.ok,w.remaining,w.carryover_qty,l.id,l.line,l.kode,l.nama,l.tanggal,l.shift,l.okpcs
  FROM attention w JOIN assignments known ON known.rk=public.wo_normalize(w.wo_ref)
  JOIN logs_n l ON l.ck=known.ck AND l.nk=known.nk AND l.rk=''
  JOIN metadata m ON public.wo_normalize(m.wo_ref)=public.wo_normalize(w.wo_ref) AND (l.tanggal,l.shift)>=(m.wo_start_date,m.wo_start_shift)
  WHERE w.status='OPEN' AND l.tanggal IS NOT NULL AND l.shift BETWEEN 1 AND 3
   AND NOT EXISTS (SELECT 1 FROM assignments own_a WHERE own_a.rk=public.wo_normalize(w.wo_ref) AND own_a.lk=l.lk AND own_a.ck=l.ck AND own_a.nk=l.nk AND (l.tanggal,l.shift)>=(own_a.effective_date,own_a.effective_shift) AND (own_a.ended_date IS NULL OR (l.tanggal,l.shift)<=(own_a.ended_date,own_a.ended_shift)))
   AND NOT EXISTS (SELECT 1 FROM assignments other_a WHERE other_a.rk<>public.wo_normalize(w.wo_ref) AND other_a.lk=l.lk AND other_a.ck=l.ck AND other_a.nk=l.nk AND (l.tanggal,l.shift)>=(other_a.effective_date,other_a.effective_shift) AND (other_a.ended_date IS NULL OR (l.tanggal,l.shift)<=(other_a.ended_date,other_a.ended_shift)))
 ), protected_blank AS MATERIALIZED (
  SELECT DISTINCT w.wo_ref AS candidate_wo_ref,l.id AS log_id,l.line,l.kode,l.nama,l.tanggal,l.shift,l.okpcs,other_a.wo_ref AS covered_by_wo
  FROM attention w JOIN assignments known ON known.rk=public.wo_normalize(w.wo_ref)
  JOIN logs_n l ON l.ck=known.ck AND l.nk=known.nk AND l.rk=''
  JOIN metadata m ON public.wo_normalize(m.wo_ref)=public.wo_normalize(w.wo_ref) AND (l.tanggal,l.shift)>=(m.wo_start_date,m.wo_start_shift)
  JOIN assignments other_a ON other_a.rk<>public.wo_normalize(w.wo_ref) AND other_a.lk=l.lk AND other_a.ck=l.ck AND other_a.nk=l.nk
   AND (l.tanggal,l.shift)>=(other_a.effective_date,other_a.effective_shift) AND (other_a.ended_date IS NULL OR (l.tanggal,l.shift)<=(other_a.ended_date,other_a.ended_shift))
  WHERE w.status='OPEN' AND l.tanggal IS NOT NULL AND l.shift BETWEEN 1 AND 3
   AND NOT EXISTS (SELECT 1 FROM assignments own_a WHERE own_a.rk=public.wo_normalize(w.wo_ref) AND own_a.lk=l.lk AND own_a.ck=l.ck AND own_a.nk=l.nk AND (l.tanggal,l.shift)>=(own_a.effective_date,own_a.effective_shift) AND (own_a.ended_date IS NULL OR (l.tanggal,l.shift)<=(own_a.ended_date,own_a.ended_shift)))
 ), candidate_groups AS (
  SELECT wo_ref,qty,ok,remaining,carryover_qty,line,kode,nama,sum(coalesce(okpcs,0)) AS candidate_ok,count(*) AS reports,
   min(tanggal::text||' S'||shift::text) AS first_boundary,max(tanggal::text||' S'||shift::text) AS last_boundary
  FROM candidate_rows GROUP BY wo_ref,qty,ok,remaining,carryover_qty,line,kode,nama
 ),
 example AS (
  SELECT a.wo_ref,a.id AS assignment_id,a.line_code,a.product_code,a.product_name,a.effective_date,a.effective_shift,
   w.ok AS current_progress,latest.kode AS latest_code,latest.nama AS latest_name,latest.tanggal AS latest_date,latest.shift AS latest_shift,
   (a.ck=latest.ck AND a.nk=latest.nk) AS matches_latest_exact,
   CASE WHEN a.product_name ~* '#2[[:space:]]*$' AND a.ck=latest.ck AND a.nk=latest.nk THEN 'NO CORRECTION NEEDED' ELSE 'REVIEW CURRENT ASSIGNMENT' END AS review,
   (SELECT count(*) FROM logs_n l WHERE l.lk=a.lk AND l.ck=a.ck AND l.nk=a.nk AND (l.tanggal,l.shift)>=(a.effective_date,a.effective_shift) AND (a.ended_date IS NULL OR (l.tanggal,l.shift)<=(a.ended_date,a.ended_shift)) AND (l.rk='' OR l.rk=a.rk)) AS matching_log_count,
   (SELECT coalesce(sum(coalesce(l.okpcs,0)),0) FROM logs_n l WHERE l.lk=a.lk AND l.ck=a.ck AND l.nk=a.nk AND (l.tanggal,l.shift)>=(a.effective_date,a.effective_shift) AND (a.ended_date IS NULL OR (l.tanggal,l.shift)<=(a.ended_date,a.ended_shift)) AND (l.rk='' OR l.rk=a.rk)) AS matching_ok
  FROM assignments a LEFT JOIN attention w ON public.wo_normalize(w.wo_ref)=a.rk
  LEFT JOIN LATERAL (SELECT l.* FROM logs_n l WHERE l.lk=a.lk ORDER BY l.tanggal DESC,l.shift DESC,l.created_sort DESC NULLS LAST,l.id DESC LIMIT 1) latest ON true
  WHERE a.rk=public.wo_normalize('WO-20261107-5907C8B1-2172-45BA-B047-7F0DD033B12F') AND a.lk=public.wo_normalize('32') AND a.ck=public.wo_normalize('PT207')
 ), boundary_issues AS (
  SELECT c.child_wo_ref,c.effective_date,c.effective_shift,a.id AS assignment_id,a.effective_date AS assignment_date,a.effective_shift AS assignment_shift
  FROM public.production_wo_continuations c LEFT JOIN assignments a ON a.rk=public.wo_normalize(c.child_wo_ref)
  WHERE c.effective_date IS NULL OR c.effective_shift IS NULL OR c.effective_shift NOT BETWEEN 1 AND 3 OR (a.id IS NOT NULL AND (a.effective_date IS NULL OR a.effective_shift IS NULL OR a.effective_shift NOT BETWEEN 1 AND 3 OR (a.effective_date,a.effective_shift)<(c.effective_date,c.effective_shift)))
 ), assignment_boundary_issues AS (
  SELECT a.id,a.wo_ref,a.line_code,a.product_code,a.product_name,a.effective_date,a.effective_shift,a.ended_date,a.ended_shift
  FROM assignments a WHERE a.effective_date IS NULL OR a.effective_shift IS NULL OR a.effective_shift NOT BETWEEN 1 AND 3
   OR (a.ended_date IS NULL)<>(a.ended_shift IS NULL) OR (a.ended_shift IS NOT NULL AND a.ended_shift NOT BETWEEN 1 AND 3)
   OR (a.ended_date IS NOT NULL AND (a.ended_date,a.ended_shift)<(a.effective_date,a.effective_shift))
 ), baseline_missing AS (
  SELECT a.wo_ref,coalesce(st.status,'OPEN') AS status FROM assignments a
  LEFT JOIN public.production_wo_status st ON public.wo_normalize(st.wo_ref)=a.rk
  WHERE coalesce(st.status,'OPEN') IN ('OPEN','ON_HOLD') AND NOT EXISTS (SELECT 1 FROM attention w WHERE public.wo_normalize(w.wo_ref)=a.rk)
  GROUP BY a.wo_ref,st.status
  UNION SELECT st.wo_ref,st.status FROM public.production_wo_status st WHERE st.status IN ('OPEN','ON_HOLD') AND NOT EXISTS (SELECT 1 FROM attention w WHERE public.wo_normalize(w.wo_ref)=public.wo_normalize(st.wo_ref))
 ), baseline AS (
  SELECT w.wo_ref,w.qty AS target,w.ok-coalesce(w.carryover_qty,0) AS production_ok,coalesce(w.carryover_qty,0) AS carryover_qty,w.ok AS total_progress,w.remaining,w.status,
   (SELECT count(*) FROM assignments a WHERE a.rk=public.wo_normalize(w.wo_ref)) AS assignment_count,
   EXISTS(SELECT 1 FROM public.production_wo_continuations c WHERE public.wo_normalize(c.child_wo_ref)=public.wo_normalize(w.wo_ref)) AS is_continuation,
   (SELECT string_agg(DISTINCT a.product_code||' '||a.product_name,' | ') FROM assignments a WHERE a.rk=public.wo_normalize(w.wo_ref)) AS products
  FROM attention w WHERE w.status IN ('OPEN','ON_HOLD')
 )
 SELECT jsonb_build_object(
  'baseline',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY wo_ref) FROM baseline b),'[]'::jsonb),
  'known_multi_machine',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY wo_ref) FROM baseline b WHERE upper(coalesce(products,'')) LIKE '%BURGUNDY%' OR upper(coalesce(products,'')) LIKE '%KELLY%' OR upper(coalesce(products,'')) LIKE '%PT206%' OR upper(coalesce(products,'')) LIKE '%PT207%'),'[]'::jsonb),
  'child_boundaries',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY child_wo_ref,assignment_id) FROM child_boundary b),'[]'::jsonb),
  'boundary_issues',coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM boundary_issues b),'[]'::jsonb),
  'assignment_boundary_issues',coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM assignment_boundary_issues b),'[]'::jsonb),
  'baseline_invalid',coalesce((SELECT jsonb_agg(to_jsonb(w)) FROM attention w WHERE w.status IN ('OPEN','ON_HOLD') AND (w.qty IS NULL OR w.ok IS NULL OR w.remaining IS NULL)),'[]'::jsonb),
  'protected_other_wo_logs',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY candidate_wo_ref,tanggal,shift) FROM protected p),'[]'::jsonb),
  'overlaps',coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY wo_a,wo_b) FROM assignment_overlaps o),'[]'::jsonb),
  'protected_blank_conflicts',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY candidate_wo_ref,tanggal,shift) FROM protected_blank b),'[]'::jsonb),
  'baseline_missing',coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM baseline_missing b),'[]'::jsonb),
  'invalid_log_shift_count',(SELECT count(*) FROM public.logs l WHERE l.shift IS NOT NULL AND l.shift::text NOT IN ('1','2','3')),
  'pt207_line32',coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM example e),'[]'::jsonb),
  'simulation',coalesce((SELECT to_jsonb(c) || jsonb_build_object('projected_progress',c.ok+c.candidate_ok,'projected_remaining',c.qty-c.ok-c.candidate_ok,'note','Simulation only; final eligibility and boundary must be confirmed in authoritative preview.') FROM candidate_groups c ORDER BY c.wo_ref,c.line,c.kode,c.nama LIMIT 1),jsonb_build_object('status','NO CURRENT CANDIDATE')),
  'active_wo_count',(SELECT count(*) FROM baseline),
  'continuation_child_count',(SELECT count(*) FROM public.production_wo_continuations),
  'overlap_count',(SELECT count(*) FROM assignment_overlaps),
  'protected_other_wo_log_count',(SELECT count(DISTINCT log_id) FROM protected)
 )::text AS doc
 $q$,true,false,'')))[1]::text::jsonb ELSE NULL END AS doc
),
-- An existing history-link table is inspected only when its columns and
-- permissions are known. No CREATE/ALTER or data mutation is performed.
history_inspection AS (
 SELECT CASE WHEN (SELECT can_inspect FROM flags) AND to_regclass('public.production_wo_history_links') IS NOT NULL THEN
 (xpath('string(/table/row/doc)',query_to_xml($q$
  WITH link_overlaps AS (
   SELECT x.id AS link_a,y.id AS link_b,x.wo_ref AS wo_a,y.wo_ref AS wo_b,x.line_code,x.product_code,x.product_name,x.effective_date AS start_a,x.effective_shift AS start_shift_a,x.ended_date AS end_a,x.ended_shift AS end_shift_a,y.effective_date AS start_b,y.effective_shift AS start_shift_b,y.ended_date AS end_b,y.ended_shift AS end_shift_b
   FROM public.production_wo_history_links x JOIN public.production_wo_history_links y ON x.id<y.id AND public.wo_normalize(x.wo_ref)<>public.wo_normalize(y.wo_ref)
    AND public.wo_normalize(x.line_code)=public.wo_normalize(y.line_code) AND public.wo_normalize(x.product_code)=public.wo_normalize(y.product_code) AND public.wo_normalize(x.product_name)=public.wo_normalize(y.product_name)
    AND (x.effective_date,x.effective_shift)<=(y.ended_date,y.ended_shift) AND (y.effective_date,y.effective_shift)<=(x.ended_date,x.ended_shift)
  ), assignment_overlaps AS (
   SELECT h.id AS link_id,h.wo_ref AS link_wo,a.id AS assignment_id,a.wo_ref AS assignment_wo,h.line_code,h.product_code,h.product_name,h.effective_date,h.effective_shift,h.ended_date,h.ended_shift
   FROM public.production_wo_history_links h JOIN public.production_wo_assignments a ON public.wo_normalize(h.wo_ref)<>public.wo_normalize(a.wo_ref)
    AND public.wo_normalize(h.line_code)=public.wo_normalize(a.line_code) AND public.wo_normalize(h.product_code)=public.wo_normalize(a.product_code) AND public.wo_normalize(h.product_name)=public.wo_normalize(a.product_name)
    AND (h.effective_date,h.effective_shift)<=(coalesce(a.ended_date,'infinity'::date),coalesce(a.ended_shift,2147483647)) AND (a.effective_date,a.effective_shift)<=(h.ended_date,h.ended_shift)
  ), invalid_links AS (
   SELECT h.id,h.wo_ref,h.assignment_id,h.line_code,h.product_code,h.product_name,h.effective_date,h.effective_shift,h.ended_date,h.ended_shift
   FROM public.production_wo_history_links h LEFT JOIN public.production_wo_assignments a ON a.id=h.assignment_id
   LEFT JOIN public.production_wo_continuations c ON public.wo_normalize(c.child_wo_ref)=public.wo_normalize(h.wo_ref)
   WHERE a.id IS NULL OR public.wo_normalize(a.wo_ref)<>public.wo_normalize(h.wo_ref)
    OR public.wo_normalize(a.line_code)<>public.wo_normalize(h.line_code) OR public.wo_normalize(a.product_code)<>public.wo_normalize(h.product_code) OR public.wo_normalize(a.product_name)<>public.wo_normalize(h.product_name)
    OR (c.child_wo_ref IS NOT NULL AND (h.effective_date,h.effective_shift)<(c.effective_date,c.effective_shift))
    OR (h.effective_date,h.effective_shift)<(a.effective_date,a.effective_shift)
    OR (a.ended_date IS NOT NULL AND (h.ended_date,h.ended_shift)>(a.ended_date,a.ended_shift))
  ) SELECT jsonb_build_object('link_overlaps',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM link_overlaps x),'[]'::jsonb),
    'assignment_overlaps',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM assignment_overlaps x),'[]'::jsonb),
    'invalid_links',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM invalid_links x),'[]'::jsonb))::text AS doc
 $q$,true,false,'')))[1]::text::jsonb ELSE NULL END AS doc
),
blockers AS (
 SELECT 'Missing dependency column '||table_name||'.'||column_name AS reason FROM columns_check WHERE NOT present
 UNION ALL SELECT 'Existing history-link table missing column '||column_name FROM optional_history_check WHERE table_exists AND NOT present
 UNION ALL SELECT 'Missing or incompatible function signature '||signature FROM functions_check WHERE oid IS NULL
 UNION ALL SELECT 'Privilege or prerequisite: '||check_name FROM permissions WHERE NOT allowed
 UNION ALL SELECT 'Assignment overlap between different WO references' FROM inspection WHERE coalesce((doc->>'overlap_count')::integer,0)>0
 UNION ALL SELECT 'Child boundary missing, invalid or assignment precedes child start' FROM inspection WHERE jsonb_array_length(doc->'boundary_issues')>0
 UNION ALL SELECT 'Assignment boundary missing, invalid or reversed' FROM inspection WHERE jsonb_array_length(doc->'assignment_boundary_issues')>0
 UNION ALL SELECT 'Log shift values outside 1/2/3 can invalidate repair casts' FROM inspection WHERE coalesce((doc->>'invalid_log_shift_count')::integer,0)>0
 UNION ALL SELECT 'WO baseline unavailable or missing active assignments' FROM inspection WHERE doc IS NULL OR jsonb_array_length(doc->'baseline_missing')>0 OR jsonb_array_length(doc->'baseline_invalid')>0
 UNION ALL SELECT 'Existing history-link overlaps another WO or has an invalid assignment/boundary' FROM history_inspection WHERE jsonb_array_length(doc->'link_overlaps')>0 OR jsonb_array_length(doc->'assignment_overlaps')>0 OR jsonb_array_length(doc->'invalid_links')>0
),
warnings AS (
 SELECT 'PIN UI bukan autentikasi database; fungsi SECURITY DEFINER yang dapat dipanggil anon memerlukan otorisasi Admin terpisah.' AS warning
 UNION ALL SELECT 'Baseline memanggil wo_attention_list sekali dan audit membaca data produksi; rencanakan waktu eksekusi dan pantau statement timeout.'
 UNION ALL SELECT 'Candidate blank WO tidak membuktikan kepemilikan: Admin harus memverifikasi; preview dan trigger repair tetap menjadi penentu.'
 UNION ALL SELECT 'Blank logs tercakup assignment WO lain; data tersebut dilaporkan sebagai protected dan harus dikecualikan oleh preview.' FROM inspection WHERE jsonb_array_length(doc->'protected_blank_conflicts')>0
 UNION ALL SELECT 'Skrip hanya melaporkan index yang ada; index aktual dan rencana query harus diperiksa dengan EXPLAIN tanpa ANALYZE.'
 UNION ALL SELECT 'Tabel production_wo_history_links belum ada; ini diharapkan sebelum migrasi.' WHERE to_regclass('public.production_wo_history_links') IS NULL
)
SELECT section,result FROM (
 SELECT 1 AS ord,'DEPENDENCIES' AS section,jsonb_build_object('columns',(SELECT jsonb_agg(to_jsonb(c) || jsonb_build_object('result',CASE WHEN present THEN 'PASS' ELSE 'FAIL' END) ORDER BY table_name,column_name) FROM columns_check c),'functions',(SELECT jsonb_agg(jsonb_build_object('signature',signature,'result',CASE WHEN oid IS NULL THEN 'FAIL' ELSE 'PASS' END) ORDER BY signature) FROM functions_check),'existing_history_link_columns',(SELECT jsonb_agg(to_jsonb(h) ORDER BY column_name) FROM optional_history_check h)) AS result
 UNION ALL SELECT 2,'BASELINE',coalesce((SELECT jsonb_build_object('all_active',doc->'baseline','known_multi_machine',doc->'known_multi_machine','missing',doc->'baseline_missing','invalid',doc->'baseline_invalid') FROM inspection),jsonb_build_object('status','NOT CHECKED'))
 UNION ALL SELECT 3,'CHILD BOUNDARY',coalesce((SELECT jsonb_build_object('assignments',doc->'child_boundaries','issues',doc->'boundary_issues','assignment_boundary_issues',doc->'assignment_boundary_issues','note','Before child boundary is forbidden. After-boundary blank logs are only candidates; approval and ownership checks are still required.') FROM inspection),jsonb_build_object('status','NOT CHECKED'))
 UNION ALL SELECT 4,'OTHER WO PROTECTED',coalesce((SELECT jsonb_build_object('referenced_other_wo',doc->'protected_other_wo_logs','blank_ownership_conflicts',doc->'protected_blank_conflicts') FROM inspection),jsonb_build_object('status','NOT CHECKED'))
 UNION ALL SELECT 5,'ASSIGNMENT OVERLAPS',coalesce((SELECT doc->'overlaps' FROM inspection),'[]'::jsonb)
 UNION ALL SELECT 6,'PT207 MACHINE 32',coalesce((SELECT CASE WHEN jsonb_array_length(doc->'pt207_line32')=0 THEN jsonb_build_object('status','NOT FOUND') ELSE doc->'pt207_line32' END FROM inspection),jsonb_build_object('status','NOT CHECKED'))
 UNION ALL SELECT 7,'LATE PARALLEL SIMULATION',coalesce((SELECT doc->'simulation' FROM inspection),jsonb_build_object('status','NOT CHECKED'))
 UNION ALL SELECT 8,'HISTORY LINK OWNERSHIP',coalesce((SELECT doc FROM history_inspection),jsonb_build_object('status',CASE WHEN to_regclass('public.production_wo_history_links') IS NULL THEN 'NOT PRESENT - EXPECTED' ELSE 'NOT CHECKED' END))
 UNION ALL SELECT 9,'PRIVILEGES / RLS / INDEXES',jsonb_build_object('current_user',current_user,'required',(SELECT jsonb_agg(to_jsonb(p) ORDER BY check_name) FROM permissions p),'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY relname) FROM security_tables t),'functions',(SELECT jsonb_agg(to_jsonb(f) ORDER BY signature) FROM security_functions f),'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY tablename,indexname) FROM indexes i),'planned_history_table',CASE WHEN to_regclass('public.production_wo_history_links') IS NULL THEN 'NOT PRESENT - EXPECTED' ELSE 'PRESENT: inspect privileges above' END)
 UNION ALL SELECT 10,'SUMMARY',jsonb_build_object('status',CASE WHEN EXISTS (SELECT 1 FROM blockers) THEN 'BLOCKED' ELSE 'READY' END,'blockers',coalesce((SELECT jsonb_agg(reason ORDER BY reason) FROM blockers),'[]'::jsonb),'warning',coalesce((SELECT jsonb_agg(warning ORDER BY warning) FROM warnings),'[]'::jsonb),'active_wo_count',(SELECT (doc->>'active_wo_count')::integer FROM inspection),'continuation_child_count',(SELECT (doc->>'continuation_child_count')::integer FROM inspection),'overlap_count',(SELECT (doc->>'overlap_count')::integer FROM inspection),'protected_other_wo_log_count',(SELECT (doc->>'protected_other_wo_log_count')::integer FROM inspection))
) results ORDER BY ord;
