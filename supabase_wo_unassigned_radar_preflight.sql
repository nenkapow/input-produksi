-- READ ONLY. Execute separately as the intended migration owner.
-- One result set, with SUMMARY as the final row. No mutation or migration.
-- Data inspection is gated on schema, function signatures and permissions.
WITH
required_columns(table_name,column_name) AS (VALUES
 ('logs','id'),('logs','line'),('logs','kode'),('logs','nama'),('logs','tanggal'),('logs','shift'),('logs','okpcs'),('logs','wo_ref'),
 ('production_wo_assignments','id'),('production_wo_assignments','wo_ref'),('production_wo_assignments','line_code'),('production_wo_assignments','product_code'),('production_wo_assignments','product_name'),('production_wo_assignments','effective_date'),('production_wo_assignments','effective_shift'),('production_wo_assignments','ended_date'),('production_wo_assignments','ended_shift'),
 ('production_wo_status','wo_ref'),('production_wo_status','status'),
 ('production_wo_continuations','child_wo_ref'),('production_wo_continuations','effective_date'),('production_wo_continuations','effective_shift'),
 ('master','kode'),('master','nama')
),
optional_history_columns(column_name) AS (VALUES ('wo_ref'),('assignment_id'),('line_code'),('product_code'),('product_name'),('effective_date'),('effective_shift'),('ended_date'),('ended_shift')),
optional_history_check AS (
 SELECT h.column_name,to_regclass('public.production_wo_history_links') IS NOT NULL AS table_exists,
 EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.production_wo_history_links') AND a.attname=h.column_name AND a.attnum>0 AND NOT a.attisdropped) AS present FROM optional_history_columns h
),
required_functions(signature) AS (VALUES
 ('public.wo_normalize(text)'),('public.wo_status_for_ref(text)'),('public.wo_attention_list()'),('public.wo_metadata(text)'),
 ('public.wo_repair_preview(text,text,bigint,text,text,text,date,integer,boolean)'),
 ('public.wo_repair_apply(text,text,bigint,text,text,text,date,integer,boolean,jsonb,text)'),
 ('public.wo_blank_owned_by_other(text,text,text,text,date,integer)')
),
columns_check AS (
 SELECT r.*,to_regclass('public.'||r.table_name) IS NOT NULL AS table_exists,
 EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||r.table_name) AND a.attname=r.column_name AND a.attnum>0 AND NOT a.attisdropped) AS present FROM required_columns r
),
functions_check AS (SELECT f.signature,to_regprocedure(f.signature) AS oid FROM required_functions f),
required_tables AS (SELECT DISTINCT table_name FROM required_columns),
roles AS (SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user),
permissions AS (
 SELECT 'CREATE public schema' AS check_name,has_schema_privilege(current_user,'public','CREATE') AS allowed
 UNION ALL SELECT 'roles anon and authenticated exist',to_regrole('anon') IS NOT NULL AND to_regrole('authenticated') IS NOT NULL
 UNION ALL SELECT 'SELECT '||t.table_name,CASE WHEN to_regclass('public.'||t.table_name) IS NULL THEN false ELSE has_table_privilege(current_user,to_regclass('public.'||t.table_name),'SELECT') END FROM required_tables t
 UNION ALL SELECT 'CREATE INDEX on logs (table owner)',CASE WHEN to_regclass('public.logs') IS NULL THEN false ELSE ((SELECT rolsuper FROM roles) OR pg_has_role(current_user,c.relowner,'USAGE')) END FROM (SELECT 1) x LEFT JOIN pg_class c ON c.oid=to_regclass('public.logs')
 UNION ALL SELECT 'replace existing radar function',CASE WHEN to_regprocedure('public.wo_unassigned_machines()') IS NULL THEN true ELSE ((SELECT rolsuper FROM roles) OR pg_has_role(current_user,p.proowner,'USAGE')) END FROM (SELECT 1) x LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.wo_unassigned_machines()')
 UNION ALL SELECT 'EXECUTE '||f.signature,CASE WHEN f.oid IS NULL THEN false ELSE has_function_privilege(current_user,f.oid,'EXECUTE') END FROM functions_check f
 UNION ALL SELECT 'anon SELECT radar table '||t.table_name,CASE WHEN to_regrole('anon') IS NULL OR to_regclass('public.'||t.table_name) IS NULL THEN false ELSE has_table_privilege('anon',to_regclass('public.'||t.table_name),'SELECT') END FROM required_tables t WHERE t.table_name IN ('logs','production_wo_assignments','production_wo_status')
 UNION ALL SELECT 'anon EXECUTE wo_normalize',CASE WHEN to_regrole('anon') IS NULL OR to_regprocedure('public.wo_normalize(text)') IS NULL THEN false ELSE has_function_privilege('anon',to_regprocedure('public.wo_normalize(text)'),'EXECUTE') END
 UNION ALL SELECT 'full preflight visibility under RLS: '||c.relname,(NOT c.relrowsecurity OR (SELECT rolsuper OR rolbypassrls FROM roles) OR (NOT c.relforcerowsecurity AND pg_has_role(current_user,c.relowner,'USAGE'))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (SELECT table_name FROM required_tables) AND c.relkind IN ('r','p')
 UNION ALL SELECT 'read functions STABLE or IMMUTABLE',NOT EXISTS (SELECT 1 FROM functions_check f JOIN pg_proc p ON p.oid=f.oid WHERE f.signature <> 'public.wo_repair_apply(text,text,bigint,text,text,text,date,integer,boolean,jsonb,text)' AND p.provolatile='v')
 UNION ALL SELECT 'history-link table required by ownership helper',CASE WHEN to_regclass('public.production_wo_history_links') IS NOT NULL THEN true WHEN to_regprocedure('public.wo_blank_owned_by_other(text,text,text,text,date,integer)') IS NULL THEN false ELSE position('production_wo_history_links' in pg_get_functiondef(to_regprocedure('public.wo_blank_owned_by_other(text,text,text,text,date,integer)'))) = 0 END
 UNION ALL SELECT 'ownership helper owner can read assignments',CASE WHEN to_regprocedure('public.wo_blank_owned_by_other(text,text,text,text,date,integer)') IS NULL OR to_regclass('public.production_wo_assignments') IS NULL THEN false ELSE has_table_privilege(p.proowner,to_regclass('public.production_wo_assignments'),'SELECT') END FROM (SELECT 1) x LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.wo_blank_owned_by_other(text,text,text,text,date,integer)')
 UNION ALL SELECT 'ownership helper owner can read history links',CASE WHEN to_regclass('public.production_wo_history_links') IS NULL OR to_regprocedure('public.wo_blank_owned_by_other(text,text,text,text,date,integer)') IS NULL THEN true ELSE has_table_privilege(p.proowner,to_regclass('public.production_wo_history_links'),'SELECT') END FROM (SELECT 1) x LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.wo_blank_owned_by_other(text,text,text,text,date,integer)')
 UNION ALL SELECT 'ownership helper references assignment, history link and boundaries',CASE WHEN to_regprocedure('public.wo_blank_owned_by_other(text,text,text,text,date,integer)') IS NULL THEN false ELSE position('production_wo_assignments' in pg_get_functiondef(to_regprocedure('public.wo_blank_owned_by_other(text,text,text,text,date,integer)'))) > 0 AND position('production_wo_history_links' in pg_get_functiondef(to_regprocedure('public.wo_blank_owned_by_other(text,text,text,text,date,integer)'))) > 0 AND position('effective_date' in pg_get_functiondef(to_regprocedure('public.wo_blank_owned_by_other(text,text,text,text,date,integer)'))) > 0 AND position('ended_date' in pg_get_functiondef(to_regprocedure('public.wo_blank_owned_by_other(text,text,text,text,date,integer)'))) > 0 END
 UNION ALL SELECT 'repair preview checks ownership helper',CASE WHEN to_regprocedure('public.wo_repair_preview(text,text,bigint,text,text,text,date,integer,boolean)') IS NULL THEN false ELSE position('wo_blank_owned_by_other' in pg_get_functiondef(to_regprocedure('public.wo_repair_preview(text,text,bigint,text,text,text,date,integer,boolean)'))) > 0 END
 UNION ALL SELECT 'repair apply rechecks preview and protected ownership',CASE WHEN to_regprocedure('public.wo_repair_apply(text,text,bigint,text,text,text,date,integer,boolean,jsonb,text)') IS NULL THEN false ELSE position('wo_repair_preview' in pg_get_functiondef(to_regprocedure('public.wo_repair_apply(text,text,bigint,text,text,text,date,integer,boolean,jsonb,text)'))) > 0 AND position('blocking_protected_count' in pg_get_functiondef(to_regprocedure('public.wo_repair_apply(text,text,bigint,text,text,text,date,integer,boolean,jsonb,text)'))) > 0 AND position('blocking_ownership_conflicts' in pg_get_functiondef(to_regprocedure('public.wo_repair_apply(text,text,bigint,text,text,text,date,integer,boolean,jsonb,text)'))) > 0 AND position('p_expected' in pg_get_functiondef(to_regprocedure('public.wo_repair_apply(text,text,bigint,text,text,text,date,integer,boolean,jsonb,text)'))) > 0 END
),
flags AS (SELECT NOT EXISTS(SELECT 1 FROM columns_check WHERE NOT present) AND NOT EXISTS(SELECT 1 FROM functions_check WHERE oid IS NULL) AND NOT EXISTS(SELECT 1 FROM optional_history_check WHERE table_exists AND NOT present) AND NOT EXISTS(SELECT 1 FROM permissions WHERE NOT allowed) AS can_inspect),
security_tables AS (
 SELECT c.relname AS table_name,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS rls_forced,
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
 CASE WHEN to_regrole('authenticated') IS NULL THEN NULL ELSE has_function_privilege('authenticated',p.oid,'EXECUTE') END AS authenticated_execute
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('wo_normalize','wo_status_for_ref','wo_attention_list','wo_repair_preview','wo_repair_apply','wo_blank_owned_by_other','wo_unassigned_machines')
),
indexes AS (SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('logs','production_wo_assignments','production_wo_status','production_wo_history_links')),
inspection AS (
 SELECT CASE WHEN (SELECT can_inspect FROM flags) THEN
 (xpath('string(/table/row/doc)',query_to_xml($q$
 WITH recent_shifts AS MATERIALIZED (
  SELECT DISTINCT l.tanggal,l.shift FROM public.logs l WHERE l.tanggal IS NOT NULL AND l.shift::text IN ('1','2','3') ORDER BY l.tanggal DESC,l.shift DESC LIMIT 3
 ), recent_logs AS MATERIALIZED (
  SELECT l.id,l.line,l.kode,l.nama,l.tanggal,l.shift,l.okpcs,l.wo_ref,
   public.wo_normalize(l.line) AS lk,public.wo_normalize(l.kode) AS ck,public.wo_normalize(l.nama) AS nk,(to_jsonb(l)->>'created_at') AS created_sort
  FROM public.logs l JOIN recent_shifts rs ON l.tanggal=rs.tanggal AND l.shift=rs.shift
  WHERE l.shift::text IN ('1','2','3') AND public.wo_normalize(l.line)<>''
 ), ranked AS (
  SELECT l.*,count(*) OVER (PARTITION BY lk) AS recent_log_count,row_number() OVER (PARTITION BY lk ORDER BY tanggal DESC,shift::integer DESC,created_sort DESC NULLS LAST,id DESC) AS rn FROM recent_logs l
 ), latest AS MATERIALIZED (SELECT * FROM ranked WHERE rn=1),
 attention AS MATERIALIZED (SELECT x.* FROM jsonb_to_recordset(public.wo_attention_list()) AS x(wo_ref text,qty numeric,ok numeric,remaining numeric,status text,assignments jsonb,parent_ref text)),
 attention_assignments AS MATERIALIZED (
  SELECT w.wo_ref,w.qty,w.ok,w.remaining,w.status,w.parent_ref,w.assignments,a.value AS assignment
  FROM attention w CROSS JOIN LATERAL jsonb_array_elements(coalesce(w.assignments,'[]'::jsonb)) a(value)
 ),
 changeovers AS MATERIALIZED (
  SELECT DISTINCT l.lk,l.line,l.kode,l.nama,w.wo_ref,'CHANGEOVER_EXCLUDED'::text AS reason
  FROM latest l JOIN attention_assignments w ON public.wo_normalize(w.assignment->>'line_code')=l.lk
  WHERE w.status='OPEN' AND w.remaining>0 AND coalesce((w.assignment->>'changed')::boolean,false)
 ),
 assignment_rows AS MATERIALIZED (
  SELECT a.*,public.wo_normalize(a.wo_ref) AS rk,public.wo_normalize(a.line_code) AS lk,public.wo_normalize(a.product_code) AS ck,public.wo_normalize(a.product_name) AS nk,coalesce(st.status,'OPEN') AS wo_status
  FROM public.production_wo_assignments a LEFT JOIN public.production_wo_status st ON public.wo_normalize(st.wo_ref)=public.wo_normalize(a.wo_ref)
  WHERE public.wo_normalize(a.wo_ref)<>''
 ), machine_matches AS MATERIALIZED (
  SELECT l.lk,count(DISTINCT a.rk) FILTER(WHERE a.wo_status='OPEN') AS open_match,
   count(DISTINCT a.rk) FILTER(WHERE a.wo_status='ON_HOLD') AS on_hold_match,
   count(DISTINCT a.rk) FILTER(WHERE a.wo_status='CLOSED') AS closed_match
  FROM latest l LEFT JOIN assignment_rows a ON a.lk=l.lk AND a.ck=l.ck AND a.nk=l.nk
   AND (l.tanggal::date,l.shift::integer)>=(a.effective_date,a.effective_shift)
   AND (a.ended_date IS NULL OR (l.tanggal::date,l.shift::integer)<=(a.ended_date,a.ended_shift)) GROUP BY l.lk
 ), product_matches AS MATERIALIZED (
  SELECT a.ck,a.nk,count(DISTINCT a.rk) FILTER(WHERE a.wo_status='OPEN' AND a.ended_date IS NULL) AS matching_open_wo_count,
   count(DISTINCT a.rk) FILTER(WHERE a.wo_status='ON_HOLD' AND a.ended_date IS NULL) AS matching_on_hold_wo_count
  FROM assignment_rows a GROUP BY a.ck,a.nk
 ), classified AS MATERIALIZED (
  SELECT l.*,m.open_match,m.on_hold_match,m.closed_match,coalesce(p.matching_open_wo_count,0) AS matching_open_wo_count,
   coalesce(p.matching_on_hold_wo_count,0) AS matching_on_hold_wo_count,
   EXISTS(SELECT 1 FROM changeovers c WHERE c.lk=l.lk) AS is_changeover
  FROM latest l JOIN machine_matches m USING(lk) LEFT JOIN product_matches p ON p.ck=l.ck AND p.nk=l.nk
 ), unassigned AS MATERIALIZED (SELECT * FROM classified WHERE open_match=0 AND on_hold_match=0 AND NOT is_changeover),
 held AS MATERIALIZED (SELECT * FROM classified WHERE open_match=0 AND on_hold_match>0 AND NOT is_changeover),
 options AS MATERIALIZED (
  SELECT DISTINCT u.lk,u.line,u.kode,u.nama,w.wo_ref,w.qty AS target,w.ok AS progress,w.remaining,w.parent_ref,
   (SELECT jsonb_agg(DISTINCT z.value->>'line_code') FROM jsonb_array_elements(coalesce(w.assignments,'[]'::jsonb)) z(value)) AS current_machines,
   EXISTS(SELECT 1 FROM public.master m WHERE public.wo_normalize(m.kode)=u.ck AND public.wo_normalize(m.nama)=u.nk) AS exact_master_product_available
  FROM unassigned u JOIN attention_assignments w ON w.status='OPEN' AND public.wo_normalize(w.assignment->>'product_code')=u.ck AND public.wo_normalize(w.assignment->>'product_name')=u.nk
 ),
 -- These are read-only candidates only; the actual repair preview applies
 -- overlap and stale-data checks again before any eventual transaction.
 option_logs AS MATERIALIZED (
  SELECT o.wo_ref,o.line,o.kode,o.nama,o.target,o.progress,o.remaining,l.id,l.wo_ref AS log_wo_ref,l.tanggal::date AS tanggal,l.shift::integer AS shift,l.okpcs,
   CASE WHEN public.wo_normalize(l.wo_ref)<>'' AND public.wo_normalize(l.wo_ref)<>public.wo_normalize(o.wo_ref) THEN true
        WHEN public.wo_normalize(l.wo_ref)='' THEN public.wo_blank_owned_by_other(o.wo_ref,l.line,l.kode,l.nama,l.tanggal::date,l.shift::integer)
        ELSE false END AS protected
  FROM options o JOIN latest u ON u.lk=o.lk AND o.exact_master_product_available
  JOIN LATERAL public.wo_metadata(o.wo_ref) m ON true
  JOIN public.logs l ON public.wo_normalize(l.line)=o.lk AND public.wo_normalize(l.kode)=u.ck AND public.wo_normalize(l.nama)=u.nk
   AND l.shift::text IN ('1','2','3') AND (l.tanggal::date,l.shift::integer)>=(m.wo_start_date,m.wo_start_shift) AND (l.tanggal::date,l.shift::integer)<(u.tanggal::date,u.shift::integer)
 ),
 simulation_rows AS MATERIALIZED (
  SELECT ol.* FROM option_logs ol WHERE NOT ol.protected AND (public.wo_normalize(ol.log_wo_ref)='' OR public.wo_normalize(ol.log_wo_ref)=public.wo_normalize(ol.wo_ref))
   AND NOT EXISTS (SELECT 1 FROM assignment_rows own_a WHERE own_a.rk=public.wo_normalize(ol.wo_ref) AND own_a.lk=public.wo_normalize(ol.line) AND own_a.ck=public.wo_normalize(ol.kode) AND own_a.nk=public.wo_normalize(ol.nama)
    AND (ol.tanggal,ol.shift)>=(own_a.effective_date,own_a.effective_shift) AND (own_a.ended_date IS NULL OR (ol.tanggal,ol.shift)<=(own_a.ended_date,own_a.ended_shift)))
 ), simulation_groups AS (
  SELECT wo_ref,line,kode,nama,target,progress,remaining,count(*) AS report_count,sum(coalesce(okpcs,0)) AS historical_candidate_ok,
   min(tanggal::text||' S'||shift::text) AS first_boundary,max(tanggal::text||' S'||shift::text) AS last_boundary
  FROM simulation_rows GROUP BY wo_ref,line,kode,nama,target,progress,remaining
 ),
 protected_rows AS MATERIALIZED (SELECT DISTINCT id,wo_ref,line,kode,nama,log_wo_ref,tanggal,shift,okpcs FROM option_logs WHERE protected),
 duplicate_radar AS (SELECT lk,count(*) AS count FROM unassigned GROUP BY lk HAVING count(*)>1),
 violations AS (
  SELECT 'CHANGEOVER_IN_RADAR' AS reason FROM unassigned WHERE is_changeover
  UNION ALL SELECT 'ON_HOLD_IN_RADAR' FROM unassigned WHERE on_hold_match>0
  UNION ALL SELECT 'PROTECTED_LOG_IN_CANDIDATES' FROM simulation_rows WHERE protected OR (public.wo_normalize(log_wo_ref)<>'' AND public.wo_normalize(log_wo_ref)<>public.wo_normalize(wo_ref))
 )
 SELECT jsonb_build_object(
  'recent_shifts',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY tanggal DESC,shift DESC) FROM recent_shifts r),'[]'::jsonb),
  'latest_machine_logs',coalesce((SELECT jsonb_agg(to_jsonb(l)-'lk'-'ck'-'nk'-'created_sort'-'rn' ORDER BY line) FROM latest l),'[]'::jsonb),
  'assignment_matches',coalesce((SELECT jsonb_agg(jsonb_build_object('line',line,'product_code',kode,'product_name',nama,'open_match',open_match,'on_hold_match',on_hold_match,'closed_match',closed_match,'no_matching_assignment',(open_match=0 AND on_hold_match=0 AND closed_match=0)) ORDER BY line) FROM classified),'[]'::jsonb),
  'changeover_excluded',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY line,wo_ref) FROM changeovers c),'[]'::jsonb),
  'unassigned',coalesce((SELECT jsonb_agg(jsonb_build_object('line',line,'product_code',kode,'product_name',nama,'latest_date',tanggal,'latest_shift',shift,'latest_ok',okpcs,'recent_log_count',recent_log_count,'matching_open_wo_count',matching_open_wo_count,'matching_on_hold_wo_count',matching_on_hold_wo_count) ORDER BY line) FROM unassigned),'[]'::jsonb),
  'on_hold_match',coalesce((SELECT jsonb_agg(jsonb_build_object('line',line,'product_code',kode,'product_name',nama,'latest_date',tanggal,'latest_shift',shift,'on_hold_count',on_hold_match,'status','ON_HOLD_MATCH') ORDER BY line) FROM held),'[]'::jsonb),
  'open_wo_options',coalesce((SELECT jsonb_agg(to_jsonb(o)-'lk' ORDER BY line,wo_ref) FROM options o),'[]'::jsonb),
  'simulation',coalesce((SELECT to_jsonb(g)||jsonb_build_object('projected_progress',g.progress+g.historical_candidate_ok,'projected_remaining',g.target-g.progress-g.historical_candidate_ok,'protected_other_wo_ok',(SELECT coalesce(sum(coalesce(p.okpcs,0)),0) FROM protected_rows p WHERE p.wo_ref=g.wo_ref AND public.wo_normalize(p.line)=public.wo_normalize(g.line) AND public.wo_normalize(p.kode)=public.wo_normalize(g.kode) AND public.wo_normalize(p.nama)=public.wo_normalize(g.nama)),'note','Simulation only; repair preview remains authoritative and can reject overlapping boundaries.') FROM simulation_groups g ORDER BY wo_ref,line,kode,nama LIMIT 1),jsonb_build_object('status','NO CURRENT CANDIDATE')),
  'protected_logs',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY wo_ref,line,tanggal,shift) FROM protected_rows p),'[]'::jsonb),
  'duplicate_machines',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM duplicate_radar d),'[]'::jsonb),
  'violations',coalesce((SELECT jsonb_agg(reason) FROM violations),'[]'::jsonb),
  'recent_machine_count',(SELECT count(*) FROM latest),'unassigned_count',(SELECT count(*) FROM unassigned),
  'changeover_excluded_count',(SELECT count(DISTINCT lk) FROM changeovers),'on_hold_match_count',(SELECT count(*) FROM held),
  'protected_log_count',(SELECT count(DISTINCT id) FROM protected_rows),
  'option_count',(SELECT count(*) FROM options)
 )::text AS doc
 $q$,true,false,'')))[1]::text::jsonb ELSE NULL END AS doc
),
blockers AS (
 SELECT 'Missing dependency column '||table_name||'.'||column_name AS reason FROM columns_check WHERE NOT present
 UNION ALL SELECT 'Existing history-link table missing column '||column_name FROM optional_history_check WHERE table_exists AND NOT present
 UNION ALL SELECT 'Missing or incompatible function signature '||signature FROM functions_check WHERE oid IS NULL
 UNION ALL SELECT 'Privilege or prerequisite: '||check_name FROM permissions WHERE NOT allowed
 UNION ALL SELECT 'Radar inspection unavailable' FROM inspection WHERE doc IS NULL
 UNION ALL SELECT 'Duplicate radar machine' FROM inspection WHERE jsonb_array_length(doc->'duplicate_machines')>0
 UNION ALL SELECT 'Radar ownership, changeover or ON_HOLD violation' FROM inspection WHERE jsonb_array_length(doc->'violations')>0
),
warnings AS (
 SELECT 'PIN is a browser UI control, not database Admin authentication; review SECURITY DEFINER/RLS separately.' AS warning
 UNION ALL SELECT 'RLS privileges shown are theoretical; anon policies can still filter rows even when SELECT is granted.'
 UNION ALL SELECT 'Ownership safety checks inspect function source and sample data; they do not prove all possible cases.'
 UNION ALL SELECT 'Inspection and wo_attention_list() read production data; schedule carefully and review the separate EXPLAIN plan.'
 UNION ALL SELECT 'No unassigned candidate in current three-shift window.' FROM inspection WHERE (doc->>'unassigned_count')::integer=0
 UNION ALL SELECT 'No matching OPEN WO options for current unassigned candidates.' FROM inspection WHERE (doc->>'unassigned_count')::integer>0 AND (doc->>'option_count')::integer=0
 UNION ALL SELECT 'production_wo_history_links is not present; the already-installed ownership helper must still be valid.' WHERE to_regclass('public.production_wo_history_links') IS NULL
 UNION ALL SELECT 'Planned date/shift index is absent; review EXPLAIN and index creation impact before production.' WHERE to_regclass('public.logs_wo_radar_recent_shift_idx') IS NULL
)
SELECT section,result FROM (
 SELECT 1 AS ord,'DEPENDENCIES' AS section,jsonb_build_object('columns',(SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('result',CASE WHEN present THEN 'PASS' ELSE 'FAIL' END) ORDER BY table_name,column_name) FROM columns_check c),'functions',(SELECT jsonb_agg(jsonb_build_object('signature',signature,'result',CASE WHEN oid IS NULL THEN 'FAIL' ELSE 'PASS' END) ORDER BY signature) FROM functions_check),'history_link_columns',(SELECT jsonb_agg(to_jsonb(h) ORDER BY column_name) FROM optional_history_check h)) AS result
 UNION ALL SELECT 2,'RECENT SHIFTS AND LATEST LOGS',coalesce((SELECT jsonb_build_object('recent_shifts',doc->'recent_shifts','latest_machine_logs',doc->'latest_machine_logs') FROM inspection),jsonb_build_object('status','NOT CHECKED'))
 UNION ALL SELECT 3,'ASSIGNMENT MATCHES',coalesce((SELECT doc->'assignment_matches' FROM inspection),jsonb_build_object('status','NOT CHECKED'))
 UNION ALL SELECT 4,'CHANGEOVER EXCLUDED',coalesce((SELECT doc->'changeover_excluded' FROM inspection),jsonb_build_object('status','NOT CHECKED'))
 UNION ALL SELECT 5,'UNASSIGNED AND ON HOLD',coalesce((SELECT jsonb_build_object('unassigned',doc->'unassigned','on_hold_match',doc->'on_hold_match') FROM inspection),jsonb_build_object('status','NOT CHECKED'))
 UNION ALL SELECT 6,'OPEN WO OPTIONS',coalesce((SELECT doc->'open_wo_options' FROM inspection),jsonb_build_object('status','NOT CHECKED'))
 UNION ALL SELECT 7,'HISTORY SIMULATION AND PROTECTED LOGS',coalesce((SELECT jsonb_build_object('simulation',doc->'simulation','protected_logs',doc->'protected_logs') FROM inspection),jsonb_build_object('status','NOT CHECKED'))
 UNION ALL SELECT 8,'DUPLICATES AND SAFETY',coalesce((SELECT jsonb_build_object('duplicates',doc->'duplicate_machines','violations',doc->'violations') FROM inspection),jsonb_build_object('status','NOT CHECKED'))
 UNION ALL SELECT 9,'PERMISSIONS RLS AND INDEXES',jsonb_build_object('current_user',current_user,'required',(SELECT jsonb_agg(to_jsonb(p) ORDER BY check_name) FROM permissions p),'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY table_name) FROM security_tables t),'functions',(SELECT jsonb_agg(to_jsonb(f) ORDER BY signature) FROM security_functions f),'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY tablename,indexname) FROM indexes i),'history_links',CASE WHEN to_regclass('public.production_wo_history_links') IS NULL THEN 'NOT PRESENT' ELSE 'PRESENT' END)
 UNION ALL SELECT 10,'SUMMARY',jsonb_build_object('status',CASE WHEN EXISTS(SELECT 1 FROM blockers) THEN 'BLOCKED' ELSE 'READY' END,'blockers',coalesce((SELECT jsonb_agg(reason ORDER BY reason) FROM blockers),'[]'::jsonb),'warnings',coalesce((SELECT jsonb_agg(warning ORDER BY warning) FROM warnings),'[]'::jsonb),'recent_machine_count',(SELECT (doc->>'recent_machine_count')::integer FROM inspection),'unassigned_count',(SELECT (doc->>'unassigned_count')::integer FROM inspection),'changeover_excluded_count',(SELECT (doc->>'changeover_excluded_count')::integer FROM inspection),'on_hold_match_count',(SELECT (doc->>'on_hold_match_count')::integer FROM inspection),'protected_log_count',(SELECT (doc->>'protected_log_count')::integer FROM inspection))
) results ORDER BY ord;

-- Optional, separate READ-ONLY plan for the recent-shift portion (no ANALYZE):
-- EXPLAIN (ANALYZE FALSE, BUFFERS FALSE)
-- SELECT DISTINCT tanggal, shift FROM public.logs
-- WHERE tanggal IS NOT NULL AND shift::text IN ('1','2','3')
-- ORDER BY tanggal DESC, shift DESC LIMIT 3;
-- Review whether existing indexes satisfy this ordering; the radar migration
-- proposes logs_wo_radar_recent_shift_idx if no equivalent index exists.
