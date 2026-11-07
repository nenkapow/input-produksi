-- Apply only after supabase_wo_continuation.sql. Replaces the RPC; no data migration.
CREATE OR REPLACE FUNCTION public.wo_create_continuation(p_parent text,p_added_qty numeric,p_date date,p_shift integer,p_use_excess boolean,p_assignment_ids bigint[],p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE meta record; assignment_rec record; parent_actual numeric; excess numeric; carry numeric; child text; prev_date date; prev_shift integer; selected_count integer; info text;
BEGIN
 IF public.wo_normalize(p_parent)='' OR p_added_qty IS NULL OR p_added_qty<=0 OR p_date IS NULL OR p_shift IS NULL OR p_shift NOT BETWEEN 1 AND 3 OR coalesce(cardinality(p_assignment_ids),0)=0 THEN RAISE EXCEPTION 'Data WO lanjutan tidak lengkap'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(public.wo_normalize(p_parent),0));
 -- Prevent a report or assignment from changing between the snapshot and boundary transfer.
 LOCK TABLE public.logs IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.production_wo_assignments IN SHARE ROW EXCLUSIVE MODE;
 IF public.wo_status_for_ref(p_parent)<>'OPEN' THEN RAISE EXCEPTION 'Parent harus OPEN'; END IF;
 IF EXISTS (SELECT 1 FROM public.production_wo_continuations WHERE public.wo_normalize(parent_wo_ref)=public.wo_normalize(p_parent)) THEN RAISE EXCEPTION 'Parent sudah memiliki WO lanjutan'; END IF;
 SELECT * INTO meta FROM public.wo_metadata(p_parent); IF NOT FOUND OR meta.wo_start_date IS NULL OR meta.wo_start_shift IS NULL THEN RAISE EXCEPTION 'WO parent atau boundary tidak ditemukan'; END IF;
 INSERT INTO public.production_wo_targets (wo_ref,target_qty,start_date,start_shift,source) VALUES(meta.wo_ref,meta.wo_qty,meta.wo_start_date,meta.wo_start_shift,'legacy_fallback') ON CONFLICT ((public.wo_normalize(wo_ref))) DO NOTHING;
 SELECT t.target_qty INTO meta.wo_qty FROM public.production_wo_targets t WHERE public.wo_normalize(t.wo_ref)=public.wo_normalize(p_parent);
 prev_date := CASE WHEN p_shift=1 THEN p_date-1 ELSE p_date END; prev_shift := CASE WHEN p_shift=1 THEN 3 ELSE p_shift-1 END;
 IF (p_date,p_shift)<=(meta.wo_start_date,meta.wo_start_shift) THEN RAISE EXCEPTION 'Boundary child harus setelah awal parent'; END IF;
 SELECT count(*) INTO selected_count FROM public.production_wo_assignments WHERE id=ANY(p_assignment_ids) AND public.wo_normalize(wo_ref)=public.wo_normalize(p_parent) AND ended_date IS NULL;
 IF selected_count <> cardinality(p_assignment_ids) THEN RAISE EXCEPTION 'Assignment tidak valid atau sudah berakhir'; END IF;
 IF EXISTS (SELECT 1 FROM public.production_wo_assignments WHERE public.wo_normalize(wo_ref)=public.wo_normalize(p_parent) AND ((ended_date IS NULL AND (effective_date,effective_shift)>(prev_date,prev_shift)) OR (ended_date IS NOT NULL AND (ended_date,ended_shift)>=(p_date,p_shift)))) THEN RAISE EXCEPTION 'Boundary bertabrakan dengan assignment parent'; END IF;
 IF EXISTS (SELECT 1 FROM public.logs l WHERE (l.tanggal::date,l.shift::integer)>=(p_date,p_shift)
  AND (public.wo_normalize(l.wo_ref)=public.wo_normalize(p_parent) OR (public.wo_normalize(l.wo_ref)='' AND EXISTS (
   SELECT 1 FROM public.production_wo_assignments pa WHERE public.wo_normalize(pa.wo_ref)=public.wo_normalize(p_parent)
    AND public.wo_normalize(l.line)=public.wo_normalize(pa.line_code) AND public.wo_normalize(l.kode)=public.wo_normalize(pa.product_code) AND public.wo_normalize(l.nama)=public.wo_normalize(pa.product_name)
    AND (l.tanggal::date,l.shift::integer)>=(pa.effective_date,pa.effective_shift)
    AND (pa.ended_date IS NULL OR (l.tanggal::date,l.shift::integer)<=(pa.ended_date,pa.ended_shift))
  )))) THEN RAISE EXCEPTION 'Sudah ada laporan parent pada atau setelah boundary; pilih boundary setelah laporan tersebut'; END IF;
 parent_actual := (public.wo_progress(p_parent)->>'total_progress')::numeric; excess := greatest(parent_actual-meta.wo_qty,0); carry := CASE WHEN p_use_excess THEN least(excess,p_added_qty) ELSE 0 END;
 child := 'WO-'||to_char(p_date,'YYYYMMDD')||'-'||upper(replace(gen_random_uuid()::text,'-',''));
 IF EXISTS (SELECT 1 FROM public.wo_metadata(child)) OR EXISTS (SELECT 1 FROM public.production_wo_status WHERE public.wo_normalize(wo_ref)=public.wo_normalize(child)) THEN RAISE EXCEPTION 'Referensi child sudah dipakai'; END IF;
 FOR assignment_rec IN SELECT * FROM public.production_wo_assignments WHERE public.wo_normalize(wo_ref)=public.wo_normalize(p_parent) AND ended_date IS NULL FOR UPDATE LOOP
  IF assignment_rec.id=ANY(p_assignment_ids) THEN
   UPDATE public.production_wo_assignments SET ended_date=prev_date,ended_shift=prev_shift WHERE id=assignment_rec.id;
   PERFORM public.create_wo_assignment(child,assignment_rec.line_code,assignment_rec.product_code,assignment_rec.product_name,p_date,p_shift::smallint,NULL);
  ELSE UPDATE public.production_wo_assignments SET ended_date=prev_date,ended_shift=prev_shift WHERE id=assignment_rec.id; END IF;
 END LOOP;
 INSERT INTO public.production_wo_continuations(parent_wo_ref,child_wo_ref,added_qty,carryover_qty,effective_date,effective_shift,note,parent_target,parent_actual,parent_excess)
 VALUES(meta.wo_ref,child,p_added_qty,carry,p_date,p_shift,p_note,meta.wo_qty,parent_actual,excess);
 INSERT INTO public.production_wo_targets (wo_ref,target_qty,start_date,start_shift,source) VALUES(child,p_added_qty,p_date,p_shift,'continuation');
 INSERT INTO public.production_wo_status(wo_ref,status,closed_reason,note,closed_at,updated_at,remaining_at_close)
 VALUES(meta.wo_ref,'CLOSED','PPIC_ADDITIONAL_WO',p_note,now(),now(),meta.wo_qty-parent_actual)
 ON CONFLICT ((public.wo_normalize(wo_ref))) DO UPDATE SET status='CLOSED',closed_reason='PPIC_ADDITIONAL_WO',note=p_note,closed_at=now(),updated_at=now(),remaining_at_close=meta.wo_qty-parent_actual;
 INSERT INTO public.production_wo_status(wo_ref,status) VALUES(child,'OPEN');
 info := jsonb_build_object('parent_wo_ref',meta.wo_ref,'child_wo_ref',child,'added_qty',p_added_qty,'carryover_qty',carry,'effective_date',p_date,'effective_shift',p_shift,'note',p_note)::text;
 INSERT INTO public.production_wo_actions(wo_ref,action,previous_status,new_status,note) VALUES(meta.wo_ref,'CREATE_CONTINUATION','OPEN','CLOSED',info),(child,'CREATED_FROM_PARENT',NULL,'OPEN',info);
 RETURN jsonb_build_object('parent_wo_ref',meta.wo_ref,'child_wo_ref',child,'added_qty',p_added_qty,'carryover_qty',carry,'parent_actual',parent_actual,'remaining',p_added_qty-carry);
END $$;

GRANT EXECUTE ON FUNCTION public.wo_create_continuation(text,numeric,date,integer,boolean,bigint[],text) TO anon, authenticated;
