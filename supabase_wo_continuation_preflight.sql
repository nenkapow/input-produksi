-- READ ONLY: run in the Supabase SQL editor as the intended migration owner.
-- One result set: section + JSON details. No migration, grants, or data writes.
-- The catalog gates query_to_xml SELECTs so missing dependencies are reported
-- instead of causing parse-time errors. Existing WO functions must be STABLE.
WITH
required_columns(table_name, column_name) AS (VALUES
 ('logs','id'),('logs','wo_ref'),('logs','wo_qty'),('logs','wo_start_date'),('logs','wo_start_shift'),('logs','tanggal'),('logs','shift'),('logs','line'),('logs','kode'),('logs','nama'),('logs','okpcs'),
 ('production_wo_assignments','id'),('production_wo_assignments','wo_ref'),('production_wo_assignments','line_code'),('production_wo_assignments','product_code'),('production_wo_assignments','product_name'),('production_wo_assignments','effective_date'),('production_wo_assignments','effective_shift'),('production_wo_assignments','ended_date'),('production_wo_assignments','ended_shift'),
 ('production_wo_status','id'),('production_wo_status','wo_ref'),('production_wo_status','status'),('production_wo_status','closed_reason'),('production_wo_status','note'),('production_wo_status','updated_at'),('production_wo_status','closed_at'),('production_wo_status','remaining_at_close'),
 ('production_wo_actions','id'),('production_wo_actions','wo_ref'),('production_wo_actions','action'),('production_wo_actions','previous_status'),('production_wo_actions','new_status'),('production_wo_actions','assignment_id'),('production_wo_actions','note'),('production_wo_actions','created_at')
),
required_functions(signature) AS (VALUES
 ('public.wo_normalize(text)'),('public.wo_metadata(text)'),('public.wo_list_metadata()'),('public.wo_progress(text,text,jsonb,bigint)'),('public.wo_status_for_ref(text)'),('public.wo_attention_list()'),('public.create_wo_assignment(text,text,text,text,date,smallint,bigint)')
),
column_check AS (
 SELECT r.table_name,r.column_name, to_regclass('public.'||r.table_name) IS NOT NULL AS table_exists,
 EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass('public.'||r.table_name) AND a.attname=r.column_name AND a.attnum>0 AND NOT a.attisdropped) AS present
 FROM required_columns r
),
function_check AS (
 SELECT f.signature,to_regprocedure(f.signature) AS oid FROM required_functions f
),
optional_tables(table_name) AS (VALUES ('production_wo_targets'),('production_wo_continuations')),
optional_required(table_name,column_name) AS (VALUES
 ('production_wo_targets','wo_ref'),('production_wo_targets','target_qty'),('production_wo_targets','start_date'),('production_wo_targets','start_shift'),('production_wo_targets','source'),('production_wo_targets','locked_at'),('production_wo_targets','created_at'),
 ('production_wo_continuations','id'),('production_wo_continuations','parent_wo_ref'),('production_wo_continuations','child_wo_ref'),('production_wo_continuations','added_qty'),('production_wo_continuations','carryover_qty'),('production_wo_continuations','effective_date'),('production_wo_continuations','effective_shift'),('production_wo_continuations','parent_target'),('production_wo_continuations','parent_actual'),('production_wo_continuations','parent_excess'),('production_wo_continuations','note'),('production_wo_continuations','created_at')
),
optional_check AS (
 SELECT r.*, to_regclass('public.'||r.table_name) IS NOT NULL AS table_exists,
 EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass('public.'||r.table_name) AND a.attname=r.column_name AND a.attnum>0 AND NOT a.attisdropped) AS present FROM optional_required r
),
flags AS (
 SELECT NOT EXISTS (SELECT 1 FROM column_check WHERE NOT present) AND NOT EXISTS (SELECT 1 FROM function_check WHERE oid IS NULL) AS schema_ok,
 NOT EXISTS (SELECT 1 FROM optional_check WHERE table_exists AND NOT present) AS optional_schema_ok,
 to_regrole('anon') IS NOT NULL AND to_regrole('authenticated') IS NOT NULL AS roles_ok,
 NOT EXISTS (SELECT 1 FROM function_check f JOIN pg_proc p ON p.oid=f.oid WHERE f.signature IN ('public.wo_normalize(text)','public.wo_status_for_ref(text)','public.wo_progress(text,text,jsonb,bigint)') AND p.provolatile='v') AS existing_functions_stable,
 (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS is_super
),
required_tables AS (SELECT DISTINCT table_name FROM required_columns),
permission_check AS (
 SELECT 'schema CREATE public' AS check_name, has_schema_privilege(current_user,'public','CREATE') AS allowed
 UNION ALL SELECT 'roles anon/authenticated exist',roles_ok FROM flags
 UNION ALL SELECT 'normalized status unique index', EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.wo_status_normalized_ref_idx') AND i.indisunique AND i.indisvalid)
 UNION ALL SELECT 'gen_random_uuid available',to_regprocedure('pg_catalog.gen_random_uuid()') IS NOT NULL OR to_regprocedure('public.gen_random_uuid()') IS NOT NULL
 UNION ALL SELECT 'existing WO functions STABLE or IMMUTABLE',existing_functions_stable FROM flags
 UNION ALL SELECT 'SELECT '||t.table_name, CASE WHEN to_regclass('public.'||t.table_name) IS NULL THEN false ELSE has_table_privilege(current_user,to_regclass('public.'||t.table_name),'SELECT') END FROM required_tables t
 UNION ALL SELECT 'TRIGGER logs',CASE WHEN to_regclass('public.logs') IS NULL THEN false ELSE has_table_privilege(current_user,to_regclass('public.logs'),'TRIGGER') END
 UNION ALL SELECT 'TRIGGER production_wo_assignments',CASE WHEN to_regclass('public.production_wo_assignments') IS NULL THEN false ELSE has_table_privilege(current_user,to_regclass('public.production_wo_assignments'),'TRIGGER') END
 UNION ALL SELECT 'UPDATE logs (LOCK TABLE)',CASE WHEN to_regclass('public.logs') IS NULL THEN false ELSE has_table_privilege(current_user,to_regclass('public.logs'),'UPDATE') END
 UNION ALL SELECT 'UPDATE assignments (LOCK TABLE)',CASE WHEN to_regclass('public.production_wo_assignments') IS NULL THEN false ELSE has_table_privilege(current_user,to_regclass('public.production_wo_assignments'),'UPDATE') END
 UNION ALL SELECT 'INSERT '||t.table_name,CASE WHEN to_regclass('public.'||t.table_name) IS NULL THEN false ELSE has_table_privilege(current_user,to_regclass('public.'||t.table_name),'INSERT') END FROM required_tables t WHERE t.table_name IN ('production_wo_assignments','production_wo_status','production_wo_actions')
 UNION ALL SELECT 'UPDATE production_wo_status',CASE WHEN to_regclass('public.production_wo_status') IS NULL THEN false ELSE has_table_privilege(current_user,to_regclass('public.production_wo_status'),'UPDATE') END
 UNION ALL SELECT 'replace function '||f.signature,CASE WHEN f.oid IS NULL THEN false ELSE ((SELECT is_super FROM flags) OR pg_has_role(current_user,p.proowner,'USAGE')) END FROM function_check f LEFT JOIN pg_proc p ON p.oid=f.oid WHERE f.signature IN ('public.wo_metadata(text)','public.wo_list_metadata()','public.wo_progress(text,text,jsonb,bigint)','public.wo_attention_list()')
 UNION ALL SELECT 'EXECUTE '||f.signature,CASE WHEN f.oid IS NULL THEN false ELSE has_function_privilege(current_user,f.oid,'EXECUTE') END FROM function_check f
 UNION ALL SELECT 'replace existing migration function '||p.oid::regprocedure::text,((SELECT is_super FROM flags) OR pg_has_role(current_user,p.proowner,'USAGE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('wo_create_continuation','wo_targets_read','wo_continuation_read','wo_guard_log_continuation','wo_parent_snapshot_match','wo_freeze_parent_log','wo_freeze_parent_assignment','wo_register_target','wo_freeze_target')
 UNION ALL SELECT 'full visibility under RLS: '||c.relname, (NOT c.relrowsecurity OR (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) OR (NOT c.relforcerowsecurity AND pg_has_role(current_user,c.relowner,'USAGE'))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (SELECT table_name FROM required_tables UNION SELECT table_name FROM optional_tables) AND c.relkind IN ('r','p')
 UNION ALL SELECT 'SELECT existing optional table '||o.table_name,CASE WHEN to_regclass('public.'||o.table_name) IS NULL THEN true ELSE has_table_privilege(current_user,to_regclass('public.'||o.table_name),'SELECT') END FROM optional_tables o
 UNION ALL SELECT 'INSERT existing optional table '||o.table_name,CASE WHEN to_regclass('public.'||o.table_name) IS NULL THEN true ELSE has_table_privilege(current_user,to_regclass('public.'||o.table_name),'INSERT') END FROM optional_tables o
 UNION ALL SELECT 'owner of existing optional table '||o.table_name,CASE WHEN to_regclass('public.'||o.table_name) IS NULL THEN true ELSE ((SELECT is_super FROM flags) OR pg_has_role(current_user,c.relowner,'USAGE')) END FROM optional_tables o LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||o.table_name)
),
-- PostgreSQL grants can be altered by RLS and function-owner identity; these are
-- privilege checks, not a claim that an RPC is authorized for an Admin.
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
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (SELECT table_name FROM required_tables UNION SELECT table_name FROM optional_tables) AND c.relkind IN ('r','p')
),
security_functions AS (
 SELECT p.oid::regprocedure::text AS function_name,pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS security_definer,p.provolatile AS volatility,p.proconfig AS settings,
 CASE WHEN to_regrole('anon') IS NULL THEN NULL ELSE has_function_privilege('anon',p.oid,'EXECUTE') END AS anon_execute,
 CASE WHEN to_regrole('authenticated') IS NULL THEN NULL ELSE has_function_privilege('authenticated',p.oid,'EXECUTE') END AS authenticated_execute,
 CASE WHEN to_regclass('public.logs') IS NULL THEN NULL ELSE has_table_privilege(p.proowner,to_regclass('public.logs'),'SELECT') END AS owner_can_read_logs,
 CASE WHEN to_regclass('public.production_wo_assignments') IS NULL THEN NULL ELSE has_table_privilege(p.proowner,to_regclass('public.production_wo_assignments'),'UPDATE') END AS owner_can_update_assignments
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'wo\_%' ESCAPE '\' OR p.proname='create_wo_assignment')
),
preconditions AS (
 SELECT f.schema_ok AND f.optional_schema_ok AND f.existing_functions_stable AND NOT EXISTS (SELECT 1 FROM permission_check WHERE NOT allowed) AS can_inspect FROM flags f
),
-- JSON emitted by one read-only SELECT per section; this also avoids hard
-- references to optional relations in the outer query.
legacy_data AS (
 SELECT CASE WHEN (SELECT can_inspect FROM preconditions) THEN
  (xpath('string(/table/row/doc)',query_to_xml($q$
   WITH raw AS (
    SELECT public.wo_normalize(wo_ref) AS key,wo_ref,wo_qty,wo_start_date,wo_start_shift FROM public.logs WHERE public.wo_normalize(wo_ref)<>''
   ), grouped AS (
    SELECT key,min(wo_ref) AS wo_ref,count(*) AS log_count,count(DISTINCT wo_qty) FILTER (WHERE wo_qty>0) AS distinct_targets,
     array_agg(DISTINCT wo_qty ORDER BY wo_qty) FILTER (WHERE wo_qty>0) AS targets,
     array_agg(DISTINCT wo_start_date ORDER BY wo_start_date) FILTER (WHERE wo_start_date IS NOT NULL) AS dates,
     array_agg(DISTINCT wo_start_shift::text ORDER BY wo_start_shift::text) FILTER (WHERE wo_start_shift IS NOT NULL) AS shifts,
     count(*) FILTER (WHERE wo_start_date IS NULL) AS null_dates,
     count(*) FILTER (WHERE wo_start_shift IS NULL OR wo_start_shift::text NOT IN ('1','2','3')) AS invalid_shifts
    FROM raw GROUP BY key
   ), known AS (
    SELECT public.wo_normalize(wo_ref) AS key,min(wo_ref) AS ref,'assignment' AS source FROM public.production_wo_assignments WHERE public.wo_normalize(wo_ref)<>'' GROUP BY public.wo_normalize(wo_ref)
    UNION ALL SELECT public.wo_normalize(wo_ref),min(wo_ref),'status' FROM public.production_wo_status WHERE public.wo_normalize(wo_ref)<>'' GROUP BY public.wo_normalize(wo_ref)
   ), known_group AS (SELECT key,min(ref) AS ref,array_agg(source ORDER BY source) AS sources FROM known GROUP BY key),
   merged AS (SELECT coalesce(g.key,k.key) AS key,coalesce(g.wo_ref,k.ref) AS wo_ref,coalesce(k.sources,ARRAY['logs']) AS sources,coalesce(g.log_count,0) AS log_count,coalesce(g.distinct_targets,0) AS distinct_targets,g.targets,g.dates,g.shifts,coalesce(g.null_dates,0) AS null_dates,coalesce(g.invalid_shifts,0) AS invalid_shifts FROM grouped g FULL JOIN known_group k USING(key))
   SELECT jsonb_build_object(
    'target_conflicts',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY wo_ref) FROM merged m WHERE distinct_targets>1),'[]'::jsonb),
    'missing_targets',coalesce((SELECT jsonb_agg(to_jsonb(m) || jsonb_build_object('reason',CASE WHEN log_count=0 THEN 'Tidak ada log dengan referensi ini' ELSE 'Tidak ada wo_qty positif' END) ORDER BY wo_ref) FROM merged m WHERE sources && ARRAY['assignment','status'] AND distinct_targets=0),'[]'::jsonb),
    'boundary_conflicts',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY wo_ref) FROM merged m WHERE (distinct_targets>0 OR sources && ARRAY['assignment','status']) AND (coalesce(cardinality(dates),0)<>1 OR coalesce(cardinality(shifts),0)<>1 OR null_dates>0 OR invalid_shifts>0)),'[]'::jsonb)
   )::text AS doc
  $q$,true,false,'')))[1]::text::jsonb ELSE NULL END AS doc
),
optional_data AS (
 SELECT
 CASE WHEN (SELECT can_inspect FROM preconditions) AND to_regclass('public.production_wo_targets') IS NOT NULL THEN
  (xpath('string(/table/row/doc)',query_to_xml($q$
   SELECT jsonb_build_object('row_count',(SELECT count(*) FROM public.production_wo_targets),
    'target_conflicts',coalesce((SELECT jsonb_agg(jsonb_build_object('wo_ref',t.wo_ref,'stored',t.target_qty,'log_qty',l.wo_qty,'log_id',l.id)) FROM public.production_wo_targets t JOIN public.logs l ON public.wo_normalize(t.wo_ref)=public.wo_normalize(l.wo_ref) WHERE l.wo_qty>0 AND l.wo_qty<>t.target_qty),'[]'::jsonb),
    'duplicate_refs',coalesce((SELECT jsonb_agg(x) FROM (SELECT public.wo_normalize(wo_ref) AS wo_ref,count(*) AS count FROM public.production_wo_targets GROUP BY 1 HAVING count(*)>1) x),'[]'::jsonb),
    'invalid_boundary',coalesce((SELECT jsonb_agg(jsonb_build_object('wo_ref',t.wo_ref,'start_date',t.start_date,'start_shift',t.start_shift)) FROM public.production_wo_targets t WHERE t.start_date IS NULL OR t.start_shift IS NULL OR t.start_shift::text NOT IN ('1','2','3')),'[]'::jsonb))::text AS doc
  $q$,true,false,'')))[1]::text::jsonb ELSE NULL END AS targets,
 CASE WHEN (SELECT can_inspect FROM preconditions) AND to_regclass('public.production_wo_continuations') IS NOT NULL THEN
  (xpath('string(/table/row/doc)',query_to_xml($q$
   SELECT jsonb_build_object('row_count',(SELECT count(*) FROM public.production_wo_continuations),
    'duplicate_parent',coalesce((SELECT jsonb_agg(x) FROM (SELECT public.wo_normalize(parent_wo_ref) AS parent_ref,count(*) AS count FROM public.production_wo_continuations GROUP BY 1 HAVING count(*)>1) x),'[]'::jsonb),
    'duplicate_child',coalesce((SELECT jsonb_agg(x) FROM (SELECT public.wo_normalize(child_wo_ref) AS child_ref,count(*) AS count FROM public.production_wo_continuations GROUP BY 1 HAVING count(*)>1) x),'[]'::jsonb),
    'orphan_or_inconsistent',coalesce((SELECT jsonb_agg(jsonb_build_object('parent_ref',c.parent_wo_ref,'child_ref',c.child_wo_ref,'reason',CASE WHEN public.wo_normalize(c.parent_wo_ref)='' OR public.wo_normalize(c.child_wo_ref)='' THEN 'Referensi kosong' WHEN public.wo_normalize(c.parent_wo_ref)=public.wo_normalize(c.child_wo_ref) THEN 'Parent dan child sama' WHEN NOT EXISTS (SELECT 1 FROM public.logs l WHERE public.wo_normalize(l.wo_ref)=public.wo_normalize(c.parent_wo_ref)) AND NOT EXISTS (SELECT 1 FROM public.production_wo_continuations prior WHERE public.wo_normalize(prior.child_wo_ref)=public.wo_normalize(c.parent_wo_ref)) THEN 'Parent tidak ditemukan' WHEN NOT EXISTS (SELECT 1 FROM public.production_wo_status s WHERE public.wo_normalize(s.wo_ref)=public.wo_normalize(c.child_wo_ref)) THEN 'Status child tidak ditemukan' WHEN NOT EXISTS (SELECT 1 FROM public.production_wo_assignments a WHERE public.wo_normalize(a.wo_ref)=public.wo_normalize(c.child_wo_ref)) THEN 'Assignment child tidak ditemukan' ELSE 'Target atau carry-over tidak valid' END)) FROM public.production_wo_continuations c WHERE public.wo_normalize(c.parent_wo_ref)='' OR public.wo_normalize(c.child_wo_ref)='' OR public.wo_normalize(c.parent_wo_ref)=public.wo_normalize(c.child_wo_ref) OR c.added_qty<=0 OR c.carryover_qty<0 OR c.carryover_qty>c.added_qty OR NOT EXISTS (SELECT 1 FROM public.logs l WHERE public.wo_normalize(l.wo_ref)=public.wo_normalize(c.parent_wo_ref)) AND NOT EXISTS (SELECT 1 FROM public.production_wo_continuations prior WHERE public.wo_normalize(prior.child_wo_ref)=public.wo_normalize(c.parent_wo_ref)) OR NOT EXISTS (SELECT 1 FROM public.production_wo_status s WHERE public.wo_normalize(s.wo_ref)=public.wo_normalize(c.child_wo_ref)) OR NOT EXISTS (SELECT 1 FROM public.production_wo_assignments a WHERE public.wo_normalize(a.wo_ref)=public.wo_normalize(c.child_wo_ref))),'[]'::jsonb))::text AS doc
  $q$,true,false,'')))[1]::text::jsonb ELSE NULL END AS continuations
),
optional_cross AS (
 SELECT CASE WHEN (SELECT can_inspect FROM preconditions) AND to_regclass('public.production_wo_targets') IS NOT NULL AND to_regclass('public.production_wo_continuations') IS NOT NULL THEN
  (xpath('string(/table/row/doc)',query_to_xml($q$
   SELECT coalesce(jsonb_agg(jsonb_build_object('parent_ref',c.parent_wo_ref,'child_ref',c.child_wo_ref,'continuation_target',c.added_qty,'stored_target',t.target_qty,'reason',CASE WHEN t.wo_ref IS NULL THEN 'Target child tidak ditemukan' ELSE 'Target child berbeda dari continuation' END)), '[]'::jsonb)::text AS doc
   FROM public.production_wo_continuations c LEFT JOIN public.production_wo_targets t ON public.wo_normalize(t.wo_ref)=public.wo_normalize(c.child_wo_ref)
   WHERE t.wo_ref IS NULL OR t.target_qty<>c.added_qty
  $q$,true,false,'')))[1]::text::jsonb ELSE NULL END AS doc
),
baseline AS (
 SELECT CASE WHEN (SELECT can_inspect FROM preconditions) THEN
  (xpath('string(/table/row/doc)',query_to_xml($q$
   WITH refs AS (SELECT DISTINCT ON (public.wo_normalize(l.wo_ref)) l.wo_ref,l.wo_qty FROM public.logs l WHERE public.wo_normalize(l.wo_ref)<>'' AND l.wo_qty>0 AND l.wo_start_date IS NOT NULL ORDER BY public.wo_normalize(l.wo_ref),l.tanggal DESC,l.shift DESC,l.id DESC),
   agg AS (SELECT r.wo_ref,r.wo_qty::numeric AS target,public.wo_status_for_ref(r.wo_ref) AS status,(public.wo_progress(r.wo_ref)->>'historical_ok')::numeric AS progress,
     (SELECT count(*) FROM public.production_wo_assignments a WHERE public.wo_normalize(a.wo_ref)=public.wo_normalize(r.wo_ref)) AS assignment_count,
     (SELECT string_agg(DISTINCT a.product_code||' '||a.product_name, ' | ') FROM public.production_wo_assignments a WHERE public.wo_normalize(a.wo_ref)=public.wo_normalize(r.wo_ref)) AS products FROM refs r)
   SELECT jsonb_build_object('open_wo',coalesce((SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('highlight',CASE WHEN upper(coalesce(products,'')) LIKE '%BURGUNDY%' THEN 'BURGUNDY' WHEN upper(coalesce(products,'')) LIKE '%KELLY%' THEN 'KELLY' WHEN upper(coalesce(products,'')) LIKE '%PT206%' THEN 'PT206' ELSE NULL END) ORDER BY wo_ref) FROM agg a WHERE status='OPEN'),'[]'::jsonb),
    'target_114300',coalesce((SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('excess',greatest(progress-target,0),'simulated_carryover',least(greatest(progress-target,0),76000),'simulated_remaining',76000-least(greatest(progress-target,0),76000))) FROM agg a WHERE target=114300),'[]'::jsonb))::text AS doc
  $q$,true,false,'')))[1]::text::jsonb ELSE NULL END AS doc
),
blockers AS (
 SELECT 'Schema dependency missing: '||table_name||'.'||column_name AS reason FROM column_check WHERE NOT present
 UNION ALL SELECT 'Function missing: '||signature FROM function_check WHERE oid IS NULL
 UNION ALL SELECT 'Optional table incomplete: '||table_name||'.'||column_name FROM optional_check WHERE table_exists AND NOT present
 UNION ALL SELECT 'Permission or prerequisite: '||check_name FROM permission_check WHERE NOT allowed
 UNION ALL SELECT 'Conflicting WO targets' FROM legacy_data WHERE jsonb_array_length(doc->'target_conflicts')>0
 UNION ALL SELECT 'WO assignment/status without positive target' FROM legacy_data WHERE jsonb_array_length(doc->'missing_targets')>0
 UNION ALL SELECT 'Ambiguous WO start boundary' FROM legacy_data WHERE jsonb_array_length(doc->'boundary_conflicts')>0
 UNION ALL SELECT 'Existing target table conflicts with logs or duplicate references' FROM optional_data WHERE jsonb_array_length(targets->'target_conflicts')>0 OR jsonb_array_length(targets->'duplicate_refs')>0 OR jsonb_array_length(targets->'invalid_boundary')>0
 UNION ALL SELECT 'Existing child targets missing or inconsistent with continuations' FROM optional_cross WHERE jsonb_array_length(doc)>0
 UNION ALL SELECT 'Existing continuations contain duplicates, orphan or inconsistent references' FROM optional_data WHERE jsonb_array_length(continuations->'duplicate_parent')>0 OR jsonb_array_length(continuations->'duplicate_child')>0 OR jsonb_array_length(continuations->'orphan_or_inconsistent')>0
)
SELECT section, result FROM (
 SELECT 1 AS ord,'SCHEMA' AS section,jsonb_build_object('columns',(SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name,column_name) FROM column_check c),'functions',(SELECT jsonb_agg(jsonb_build_object('signature',signature,'status',CASE WHEN oid IS NULL THEN 'FAIL' ELSE 'PASS' END) ORDER BY signature) FROM function_check),'optional_columns',(SELECT jsonb_agg(to_jsonb(o) ORDER BY table_name,column_name) FROM optional_check o)) AS result
 UNION ALL SELECT 2,'TARGETS AND BOUNDARIES',coalesce((SELECT doc FROM legacy_data),jsonb_build_object('status','NOT CHECKED - resolve schema/permission blockers'))
 UNION ALL SELECT 3,'OPTIONAL TABLES',jsonb_build_object('production_wo_targets',coalesce((SELECT targets FROM optional_data),to_jsonb(CASE WHEN to_regclass('public.production_wo_targets') IS NULL THEN 'NOT PRESENT - EXPECTED' ELSE 'NOT CHECKED' END)),'production_wo_continuations',coalesce((SELECT continuations FROM optional_data),to_jsonb(CASE WHEN to_regclass('public.production_wo_continuations') IS NULL THEN 'NOT PRESENT - EXPECTED' ELSE 'NOT CHECKED' END)),'child_target_inconsistencies',coalesce((SELECT doc FROM optional_cross),'[]'::jsonb))
 UNION ALL SELECT 4,'PRIVILEGES AND RLS',jsonb_build_object('current_user',current_user,'required',(SELECT jsonb_agg(to_jsonb(p) ORDER BY check_name) FROM permission_check p),'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY table_name) FROM security_tables t),'functions',(SELECT jsonb_agg(to_jsonb(f) ORDER BY function_name) FROM security_functions f),'note','Theoretical grants only; RLS policies, SECURITY DEFINER ownership and lock/concurrent workload require separate review.')
 UNION ALL SELECT 5,'BASELINE',coalesce((SELECT doc FROM baseline),jsonb_build_object('status','NOT CHECKED - resolve schema/permission blockers'))
 UNION ALL SELECT 6,'SUMMARY',jsonb_build_object('status',CASE WHEN EXISTS (SELECT 1 FROM blockers) THEN 'BLOCKED' ELSE 'READY' END,'reasons',coalesce((SELECT jsonb_agg(reason ORDER BY reason) FROM blockers),'[]'::jsonb),'note','READY means the listed read-only checks found no blocker; it is not a migration execution or a production authorization.')
) sections ORDER BY ord;
