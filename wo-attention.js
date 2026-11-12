// Admin WO review. Database access follows the configured Supabase permissions.
let woAttentionRows = [], woRadarRows = null, woRadarError = '', woAttentionReady = false, woAttentionRequest = 0;
const attentionText = value => value == null || value === '' ? '-' : String(value);
function attentionNode(tag, text, cls) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; }
function attentionButton(label, callback, cls = 'btn sm') { const button = attentionNode('button', label, cls); button.type = 'button'; button.addEventListener('click', callback); return button; }
function attentionPriority(row) {
    if (row.status === 'OPEN' && +row.remaining > 0 && row.assignments.some(a => a.changed)) return 0;
    const last = row.assignments.map(a => a.previous_date).filter(Boolean).sort().pop();
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 3);
    if (row.status === 'OPEN' && (!last || last < cutoff.toISOString().slice(0,10))) return 1;
    if (row.status === 'ON_HOLD') return 2;
    if (row.status === 'CLOSED') return 3;
    return 4;
}
async function loadWOAttention() {
    if (!client) { $('woAttentionList').textContent = 'Database belum terhubung.'; return; }
    const request = ++woAttentionRequest; woAttentionReady = false; woRadarRows = null; woRadarError = '';
    $('woAttentionList').textContent = 'Memuat WO…';
    // Independent requests keep existing WO data responsive if radar is slow.
    woRpc('wo_unassigned_machines', {}).then(result => {
        if (request !== woAttentionRequest) return;
        woRadarRows = result || []; if (woAttentionReady) renderWOAttention();
    }).catch(error => {
        if (request !== woAttentionRequest) return;
        woRadarError = error.message || 'Gagal memuat radar.'; if (woAttentionReady) renderWOAttention();
    });
    try { const rows = await woRpc('wo_attention_list', {}); if (request !== woAttentionRequest) return; woAttentionRows = rows || []; woAttentionReady = true; renderWOAttention(); }
    catch (error) { if (request === woAttentionRequest) $('woAttentionList').textContent = 'Gagal memuat WO Attention: ' + error.message; }
}
function woRadarIsChangeover(machine) {
    return woAttentionRows.some(row => attentionPriority(row) === 0 && (row.assignments || []).some(a => a.changed && woNorm(a.line_code) === woNorm(machine.line_code)));
}
function woRadarMachines() { return (woRadarRows || []).filter(machine => !woRadarIsChangeover(machine)); }
function woRadarCandidates(machine) {
    return woAttentionRows.filter(row => row.status === 'OPEN' && (row.assignments || []).some(a =>
        woNorm(a.product_code) === woNorm(machine.product_code) && woNorm(a.product_name) === woNorm(machine.product_name)));
}
function renderWORadar(list,lineFilter,productFilter) {
    const section=attentionNode('section',null,'woa-section woa-radar'); section.id='woUnassignedMachines';
    const heading=attentionNode('div',null,'woa-section-heading'); heading.append(attentionNode('h3','Mesin Belum Terhubung WO')); section.append(heading);
    if (woRadarError) { section.append(attentionNode('div','Radar gagal dimuat. Tekan Refresh untuk mencoba lagi.','woa-radar-note')); list.append(section); return; }
    if (woRadarRows === null) { section.append(attentionNode('div','Memuat radar mesin…','woa-radar-note')); list.append(section); return; }
    const machines=woRadarMachines().filter(m => (!lineFilter || woNorm(m.line_code).includes(lineFilter)) && (!productFilter || woNorm(`${m.product_code} ${m.product_name}`).includes(productFilter)));
    const unassigned=machines.filter(m => !+m.line_on_hold_wo_count), held=machines.filter(m => +m.line_on_hold_wo_count > 0);
    if (!unassigned.length) section.append(attentionNode('div',(lineFilter || productFilter) ? 'Tidak ada mesin tanpa WO pada filter ini.' : 'Semua mesin aktif sudah terhubung WO.','woa-radar-note'));
    unassigned.forEach(machine => {
        const row=attentionNode('div',null,'woa-radar-row'), identity=attentionNode('div',null,'woa-radar-identity');
        identity.append(attentionNode('strong',`Mesin ${attentionText(machine.line_code)}`),attentionNode('span',`${attentionText(machine.product_code)} · ${attentionText(machine.product_name)}`));
        const detail=attentionNode('div',null,'woa-radar-meta'); detail.append(attentionNode('span',`Terakhir: ${attentionText(machine.latest_date)} · S${attentionText(machine.latest_shift)}`),attentionNode('span',`OK terakhir: ${fmtInt(machine.latest_ok)} PCS`),attentionNode('span','BELUM ADA WO','woa-machine-state woa-machine-warning'));
        row.append(identity,detail,attentionButton('Hubungkan WO',() => attentionLinkUnassigned(machine),'woa-button')); section.append(row);
    });
    if (held.length) section.append(attentionNode('div',`Ada WO tertunda pada mesin: ${held.map(m => m.line_code).join(', ')}. Kelola melalui WO On Hold.`,'woa-radar-note'));
    list.append(section);
}
async function attentionLinkUnassigned(machine) {
    const candidates=woRadarCandidates(machine);
    if (!candidates.length) { Swal.fire({icon:'info',title:'WO OPEN tidak ditemukan',text:'Tidak ada WO OPEN dengan assignment produk exact ini.'}); return; }
    const select=document.createElement('select'); select.className='input'; select.add(new Option('Pilih WO...', ''));
    candidates.forEach((row,i) => { const machines=(row.assignments || []).map(a => a.line_code).filter(Boolean); select.add(new Option(`${row.wo_ref} · Target ${fmtInt(row.qty)} · Progress ${fmtInt(row.ok)} · Sisa ${fmtInt(row.remaining)} · Mesin ${[...new Set(machines)].join(', ') || '-'}${row.parent_ref ? ' · WO LANJUTAN' : ''}`,String(i))); });
    const form=document.createElement('div'); form.append(attentionNode('p',`Mesin ${machine.line_code} · ${machine.product_code} — ${machine.product_name}`),select);
    const result=await Swal.fire({title:'Hubungkan WO',html:form,showCancelButton:true,confirmButtonText:'Lanjutkan',preConfirm:() => { if (select.value==='') { Swal.showValidationMessage('Pilih WO.'); return false; } return +select.value; }});
    if (result.isConfirmed) await attentionParallelWithHistory(candidates[result.value], machine);
}
function renderWOAttention() {
    const list = $('woAttentionList'), kpis = $('woAttentionKpis');
    const historyWasOpen = list.querySelector('.woa-history')?.open || false;
    list.replaceChildren(); kpis.replaceChildren();
    const today = todayISO();
    [['Perlu Konfirmasi',woAttentionRows.filter(r => attentionPriority(r) === 0).length],['WO Open',woAttentionRows.filter(r => r.status === 'OPEN').length],['WO On Hold',woAttentionRows.filter(r => r.status === 'ON_HOLD').length],['WO Closed Hari Ini',woAttentionRows.filter(r => r.status === 'CLOSED' && r.closed_at && r.closed_at.slice(0,10) === today).length]].forEach(([label,value],i) => {
        const item=attentionNode('div',null,'woa-kpi' + (i === 0 && value > 0 ? ' woa-kpi-alert' : '') + (value === 0 ? ' woa-kpi-zero' : ''));
        item.append(attentionNode('span',label),attentionNode('strong',value)); kpis.append(item);
    });
    const radarCount = woRadarRows === null ? null : woRadarMachines().filter(m => !+m.line_on_hold_wo_count).length;
    const radarKpi=attentionButton('',() => $('woUnassignedMachines')?.scrollIntoView({behavior:'smooth',block:'start'}),'woa-kpi woa-radar-kpi' + (radarCount ? ' woa-kpi-alert' : ''));
    radarKpi.append(attentionNode('span','Belum Ada WO'),attentionNode('strong',woRadarError ? '!' : radarCount === null ? '…' : String(radarCount))); kpis.append(radarKpi);
    const line = woNorm($('woAttentionLine').value), product = woNorm($('woAttentionProduct').value), ref = woNorm($('woAttentionRef').value), status = $('woAttentionStatus').value;
    const rows = woAttentionRows.filter(r => (!status || r.status === status) && (!ref || woNorm(r.wo_ref).includes(ref)) && (!line || r.assignments.some(a => woNorm(a.line_code).includes(line))) && (!product || r.assignments.some(a => woNorm(a.product_code + ' ' + a.product_name).includes(product)))).sort((a,b) => attentionPriority(a)-attentionPriority(b));
    if (!rows.length) list.append(attentionNode('div','Tidak ada WO yang cocok.','woa-empty'));
    const sections = [
        {label:'Perlu Perhatian', rows:rows.filter(r => attentionPriority(r) === 0 || attentionPriority(r) === 1)},
        {label:'WO Aktif', rows:rows.filter(r => r.status === 'OPEN' && attentionPriority(r) > 1)},
        {label:'On Hold', rows:rows.filter(r => r.status === 'ON_HOLD')}
    ];
    sections.forEach(section => {
        if (section.label === 'WO Aktif') renderWORadar(list,line,product);
        if (!section.rows.length) return;
        const container = attentionNode('section',null,'woa-section');
        const heading = attentionNode('div',null,'woa-section-heading'); heading.append(attentionNode('h3',section.label),attentionNode('span',String(section.rows.length),'woa-count')); container.append(heading);
        if (section.rows.length) { section.rows.forEach(row => container.append(renderWOAttentionCard(row))); list.append(container); }
    });
    const closed = rows.filter(r => r.status === 'CLOSED');
    if (closed.length) {
        const history = attentionNode('details',null,'woa-history'); history.open = historyWasOpen;
        const todayClosed = closed.filter(r => r.closed_at && r.closed_at.slice(0,10) === today).length;
        const summary = attentionNode('summary',null,'woa-section-heading'); summary.append(attentionNode('span','Riwayat WO Closed'),attentionNode('span',`${todayClosed} WO Closed Hari Ini · ${closed.length} total`,'woa-history-count')); history.append(summary);
        closed.forEach(row => history.append(renderWOAttentionCard(row))); list.append(history);
    }
}
function renderWOAttentionCard(row) {
    const priority = attentionPriority(row), assignments = row.assignments || [];
    const card = attentionNode('article',null,'woa-card ' + (priority === 0 ? 'woa-card-attention' : row.status === 'ON_HOLD' ? 'woa-card-hold' : row.status === 'CLOSED' ? 'woa-card-closed' : 'woa-card-open'));
    const head = attentionNode('div',null,'woa-card-head'), title = attentionNode('div',null,'woa-card-title');
    const first = assignments[0];
    title.append(attentionNode('h4',first ? `${attentionText(first.product_code)} · ${attentionText(first.product_name)}` : 'WO Produksi'), attentionNode('div',`WO ${row.wo_ref}`,'woa-ref'));
    const badges = attentionNode('div',null,'woa-badges');
    if (row.parent_ref) badges.append(attentionNode('span','WO LANJUTAN','woa-badge woa-badge-continuation'));
    badges.append(attentionNode('span',row.status,'woa-badge woa-badge-' + row.status.toLowerCase()));
    head.append(title,badges); card.append(head);
    if (priority === 0) card.append(attentionNode('div','PRODUK BERGANTI SEBELUM WO SELESAI','woa-alert'));
    else if (priority === 1) card.append(attentionNode('div','WO OPEN — TIDAK ADA PRODUKSI 3 HARI','woa-notice'));
    const metrics = attentionNode('div',null,'woa-metrics');
    [['Target',row.qty],['Progress',row.ok],['Sisa',row.remaining]].forEach(([label,value]) => { const item=attentionNode('div',null,'woa-metric'); item.append(attentionNode('span',label),attentionNode('strong',fmtInt(value)),attentionNode('small','PCS')); metrics.append(item); });
    card.append(metrics);
    const track = attentionNode('div',null,'woa-progress'); track.setAttribute('role','progressbar'); track.setAttribute('aria-label','Progress WO');
    const percent = +row.qty > 0 ? Math.max(0,Math.min(100,(+row.ok / +row.qty)*100)) : 0;
    track.setAttribute('aria-valuemin','0'); track.setAttribute('aria-valuemax','100'); track.setAttribute('aria-valuenow',String(Math.round(percent)));
    const fill=attentionNode('div',null,'woa-progress-fill'); fill.style.width=percent+'%'; track.append(fill); card.append(track);
    if (row.parent_ref) card.append(attentionNode('div',`Lanjutan dari ${row.parent_ref} · Carry-over ${fmtInt(row.carryover_qty)} · Produksi Baru ${fmtInt(row.ok - row.carryover_qty)}`,'woa-secondary'));
    if (row.child_ref) card.append(attentionNode('div',`Lebih ${fmtInt(Math.max(0, row.ok - row.qty))} · Dilanjutkan ke: ${row.child_ref}`,'woa-secondary'));
    if (assignments.length) {
        const machines=attentionNode('div',null,'woa-machines'); machines.append(attentionNode('div','MESIN / PRODUK','woa-machines-label'));
        assignments.forEach(a => {
            const box=attentionNode('div',null,'woa-machine'), identity=attentionNode('div',null,'woa-machine-identity');
            identity.append(attentionNode('strong',`Mesin ${attentionText(a.line_code)}`),attentionNode('span',`${attentionText(a.product_code)} · ${attentionText(a.product_name)}`,'woa-machine-product'));
            const data=attentionNode('div',null,'woa-machine-data');
            data.append(attentionNode('span',a.changed ? 'MENINGGALKAN WO' : a.latest_date ? 'AKTIF' : 'BELUM ADA LAPORAN',a.changed ? 'woa-machine-state woa-machine-warning' : 'woa-machine-state'),
                attentionNode('div',`Terakhir produksi WO: ${attentionText(a.previous_date)} S${attentionText(a.previous_shift)}`),
                attentionNode('div',`Produk terbaru: ${attentionText(a.latest_code)} ${attentionText(a.latest_name)} · ${attentionText(a.latest_date)} S${attentionText(a.latest_shift)}`));
            box.append(identity,data);
            if (row.status !== 'CLOSED') {
                const menu=attentionNode('details',null,'woa-menu'); menu.append(attentionNode('summary','Kelola Mesin ▾'));
                const controls=attentionNode('div',null,'woa-menu-items'); controls.append(attentionButton('Koreksi Produk Assignment',() => attentionCorrectAssignment(row,a),'woa-menu-button'),attentionButton('Tutup assignment',() => attentionAssignment(row,a,'END_ASSIGNMENT'),'woa-menu-button'),attentionButton('Pindah Mesin',() => attentionAssignment(row,a,'TRANSFER'),'woa-menu-button'),attentionButton('Tambah Mesin Paralel',() => attentionAssignment(row,a,'PARALLEL'),'woa-menu-button')); menu.append(controls); box.append(menu);
            }
            machines.append(box);
        }); card.append(machines);
    }
    if (row.status !== 'CLOSED') {
        const actions=attentionNode('div',null,'woa-actions');
        if (row.status === 'OPEN') actions.append(attentionButton('Tambah WO / WO Lanjutan',() => attentionContinuation(row),'woa-button woa-button-primary'));
        actions.append(attentionButton('Tunda / ON HOLD',() => attentionStatus(row,'ON_HOLD','HOLD'),'woa-button'),attentionButton('Tutup WO',() => attentionStatus(row,'CLOSED','CLOSE'),'woa-button woa-button-danger'));
        const menu=attentionNode('details',null,'woa-more'); menu.append(attentionNode('summary','Aksi lainnya ▾')); const secondary=attentionNode('div',null,'woa-more-items'); secondary.append(attentionButton('Tetap Open',() => attentionStatus(row,'OPEN','KEEP_OPEN'),'woa-menu-button')); menu.append(secondary); actions.append(menu); card.append(actions);
    } else card.append(attentionNode('div',`Ditutup: ${attentionText(row.closed_at)} · ${attentionText(row.reason)} · ${attentionText(row.note)}`,'woa-secondary'));
    return card;
}
async function attentionStatus(row,status,action) {
    let reason = '', note = '';
    if (status === 'CLOSED') {
        const form=document.createElement('div'), label=attentionNode('p',`Remaining: ${fmtInt(row.remaining)} PCS`), select=document.createElement('select'), input=document.createElement('textarea');
        select.className='input'; input.className='input'; input.placeholder='Catatan (opsional)';
        select.add(new Option('Pilih alasan...', '')); ['PPIC Cukup','Cetakan Turun','Order Dihentikan','Target Direvisi','Produk Diganti','Lainnya'].forEach(value => select.add(new Option(value,value))); form.append(label,select,input);
        const result=await Swal.fire({title:'Tutup WO?',html:form,showCancelButton:true,confirmButtonText:'Tutup WO',preConfirm:() => { if (!select.value) { Swal.showValidationMessage('Pilih alasan penutupan.'); return false; } return {reason:select.value,note:input.value.trim()}; }});
        if (!result.isConfirmed) return; ({reason,note}=result.value);
    } else { const result=await Swal.fire({title:status === 'OPEN' ? 'Tetap Open?' : 'Tunda WO?',input:'text',inputPlaceholder:'Catatan (opsional)',showCancelButton:true}); if (!result.isConfirmed) return; note=result.value || ''; }
    try { await woRpc('wo_admin_status',{p_ref:row.wo_ref,p_status:status,p_action:action,p_reason:reason || null,p_note:note || null,p_remaining:status === 'CLOSED' ? row.remaining : null}); await loadWOAttention(); }
    catch(error) { Swal.fire({icon:'error',title:'Aksi gagal',text:error.message}); }
}
async function attentionAssignment(row,source,action) {
    if (action === 'PARALLEL') return attentionParallelWithHistory(row);
    if (source?.assignment_id == null || source.assignment_id === '') {
        return Swal.fire({icon:'error',title:'Assignment tidak tersedia',text:'Assignment ID tidak tersedia. Refresh WO Attention lalu coba lagi.'});
    }
    const form=document.createElement('div'), date=document.createElement('input'), shift=document.createElement('select'), line=document.createElement('input'), product=document.createElement('select'), note=document.createElement('input');
    date.type='date'; date.value=todayISO(); date.className='input'; shift.className='input'; ['1','2','3'].forEach(v => shift.add(new Option('Shift '+v,v)));
    line.className='input'; line.placeholder='Mesin baru'; product.className='input'; product.add(new Option('Pilih produk persis...', ''));
    master.forEach((p,i) => product.add(new Option(`${p.kode} - ${p.nama}`,String(i)))); note.className='input'; note.placeholder='Catatan (opsional)';
    form.append(attentionNode('p',action === 'END_ASSIGNMENT' ? 'Assignment berakhir pada shift sebelum waktu ini.' : 'Assignment baru dimulai pada waktu ini.'),date,shift);
    if (action !== 'END_ASSIGNMENT') form.append(line,product); form.append(note);
    const result=await Swal.fire({title:action === 'TRANSFER' ? 'Pindah Mesin' : action === 'PARALLEL' ? 'Tambah Mesin Paralel' : 'Tutup Assignment',html:form,showCancelButton:true,preConfirm:() => { if (!date.value || (action !== 'END_ASSIGNMENT' && (!line.value.trim() || product.value === ''))) { Swal.showValidationMessage('Lengkapi mesin, produk, tanggal dan shift.'); return false; } return true; }});
    if (!result.isConfirmed) return;
    const p=product.value === '' ? null : master[+product.value];
    try { await woRpc('wo_admin_assignment',{p_ref:row.wo_ref,p_action:action,p_source:source.assignment_id,p_line:line.value.trim() || null,p_code:p?.kode || null,p_name:p?.nama || null,p_date:date.value,p_shift:+shift.value,p_note:note.value.trim() || null}); await loadWOAttention(); }
    catch(error) { Swal.fire({icon:'error',title:'Aksi gagal',text:error.message}); }
}

async function attentionContinuation(row) {
    const form = document.createElement('div'), qty = document.createElement('input'), date = document.createElement('input'), shift = document.createElement('select'), note = document.createElement('input'), use = document.createElement('input'), summary = attentionNode('p',''), choices = document.createElement('div');
    const excess = Math.max(0, +row.ok - +row.qty);
    qty.type='number'; qty.min='1'; qty.step='1'; qty.className='input'; qty.placeholder='Qty tambahan PPIC';
    date.type='date'; date.value=todayISO(); date.className='input'; shift.className='input'; ['1','2','3'].forEach(v => shift.add(new Option('Shift ' + v,v)));
    note.className='input'; note.placeholder='Catatan / nomor dokumen PPIC (opsional)'; use.type='checkbox'; use.checked=excess>0;
    const useLabel=document.createElement('label'); useLabel.append(use, document.createTextNode(' Gunakan excess WO sebelumnya'));
    (row.assignments || []).forEach(a => { const label=document.createElement('label'), box=document.createElement('input'), line=document.createElement('div'); box.type='checkbox'; box.value=String(a.assignment_id); box.checked=true; label.append(box,document.createTextNode(` Mesin ${a.line_code} — ${a.product_code} ${a.product_name}`)); line.append(label); choices.append(line); });
    const update = () => { const added=Math.max(0,toNum(qty.value)), carry=use.checked ? Math.min(excess,added) : 0; summary.textContent=`Tambahan PPIC ${fmtInt(added)} · Carry-over ${fmtInt(carry)} · Sisa Produksi ${fmtInt(added-carry)}`; };
    qty.addEventListener('input',update); use.addEventListener('change',update); update();
    form.append(attentionNode('p',`WO Parent ${row.wo_ref} · Target ${fmtInt(row.qty)} · Actual ${fmtInt(row.ok)} · Excess ${fmtInt(excess)}`),qty,date,shift,note,useLabel,summary,attentionNode('p','Pilih assignment yang diteruskan:'),choices);
    const result=await Swal.fire({title:'Tambah WO / WO Lanjutan',html:form,showCancelButton:true,confirmButtonText:'Buat WO Lanjutan',preConfirm:() => { const ids=[...choices.querySelectorAll('input:checked')].map(x => Number(x.value)); if (!(+qty.value>0) || !date.value || !ids.length) { Swal.showValidationMessage('Isi qty, tanggal dan pilih minimal satu assignment.'); return false; } return {ids}; }});
    if (!result.isConfirmed) return;
    try { const created=await woRpc('wo_create_continuation',{p_parent:row.wo_ref,p_added_qty:+qty.value,p_date:date.value,p_shift:+shift.value,p_use_excess:use.checked,p_assignment_ids:result.value.ids,p_note:note.value.trim() || null}); await Swal.fire({icon:'success',title:'WO lanjutan dibuat',text:`${created.child_wo_ref} · Carry-over ${fmtInt(created.carryover_qty)} · Sisa ${fmtInt(created.remaining)}`}); await loadWOAttention(); }
    catch(error) { Swal.fire({icon:'error',title:'WO lanjutan gagal dibuat',text:error.message}); }
}

// Repair dialogs use database previews; no production log is modified.
function attentionProductSelect() {
    const select=document.createElement('select'); select.className='input'; select.add(new Option('Pilih produk persis...', ''));
    master.forEach((p,i) => select.add(new Option(`${p.kode} - ${p.nama}`,String(i)))); return select;
}
function attentionRepairSummary(preview) {
    const panel=document.createElement('div');
    const point=(d,s) => d ? `${d} S${s}` : '-';
    panel.append(attentionNode('p',`Mesin ${preview.line} · ${preview.code} — ${preview.name}`),
        attentionNode('p',`Produksi pertama: ${point(preview.first_date,preview.first_shift)} · Terakhir: ${point(preview.last_date,preview.last_shift)}`),
        attentionNode('p',`OK kandidat: ${fmtInt(preview.candidate_ok)} PCS · ${preview.candidate_count} laporan`),
        attentionNode('p',`Produksi saat ini: ${fmtInt(preview.production_before)} · Carry-over: ${fmtInt(preview.carryover_qty)} PCS`),
        attentionNode('p',`Progress sebelum: ${fmtInt(preview.progress_before)} · Proyeksi: ${fmtInt(preview.progress_after)} · Sisa: ${fmtInt(preview.projected_remaining)} PCS`),
        attentionNode('p',`Selisih progress: ${fmtSigned(preview.progress_delta)} PCS`));
    if (+preview.protected_other_wo_count > 0) panel.append(attentionNode('p',`${preview.protected_other_wo_count} laporan (${fmtInt(preview.protected_other_wo_ok)} PCS) dikecualikan karena terkait WO lain.`));
    if (+preview.blocking_protected_count > 0 || +preview.blocking_ownership_conflicts > 0) panel.append(attentionNode('p','Boundary bertabrakan dengan cakupan atau log WO lain dan tidak dapat disimpan. Pilih boundary lain.'));
    if (preview.mode === 'PARALLEL') panel.append(attentionNode('p',`Boundary assignment: ${point(preview.effective_date,preview.effective_shift)} · Boundary normal: ${point(preview.normal_date,preview.normal_shift)}`));
    return panel;
}
async function attentionConfirmRepair(params, preview, note) {
    const result=await Swal.fire({title:'Konfirmasi preview WO',html:attentionRepairSummary(preview),showCancelButton:true,confirmButtonText:'Simpan perubahan'});
    if (!result.isConfirmed) return;
    try { await woRpc('wo_repair_apply',{...params,p_expected:preview,p_note:note || null}); await loadWOAttention(); }
    catch(error) { Swal.fire({icon:'error',title:'Perubahan gagal',text:error.message}); }
}
async function attentionCorrectAssignment(row, assignment) {
    const form=document.createElement('div'), product=attentionProductSelect(), note=document.createElement('input'); note.className='input'; note.placeholder='Catatan (opsional)';
    form.append(attentionNode('p',`Mesin ${assignment.line_code} · WO ${row.wo_ref}`),
        attentionNode('p',`Assignment sekarang: ${assignment.product_code} — ${assignment.product_name} · Mulai ${assignment.effective_date} S${assignment.effective_shift}`),
        attentionNode('p',`Produk terbaru mesin: ${attentionText(assignment.latest_code)} ${attentionText(assignment.latest_name)}`),product,note);
    const selection=await Swal.fire({title:'Koreksi Produk Assignment',html:form,showCancelButton:true,confirmButtonText:'Lihat preview',preConfirm:async () => {
        if (product.value==='') { Swal.showValidationMessage('Pilih produk exact.'); return false; }
        const p=master[+product.value], params={p_mode:'CORRECT',p_ref:row.wo_ref,p_assignment_id:assignment.assignment_id,p_line:assignment.line_code,p_code:p.kode,p_name:p.nama,p_date:null,p_shift:null,p_include_history:false};
        try { return {params,preview:await woRpc('wo_repair_preview',params),note:note.value.trim()}; }
        catch(error) { Swal.showValidationMessage(error.message || 'Preview gagal'); return false; }
    }});
    if (selection.isConfirmed) await attentionConfirmRepair(selection.value.params,selection.value.preview,selection.value.note);
}
async function attentionParallelWithHistory(row, prefill = null) {
    const form=document.createElement('div'), line=document.createElement('input'), product=attentionProductSelect(), date=document.createElement('input'), shift=document.createElement('select'), note=document.createElement('input'), info=attentionNode('div','Pilih mesin dan produk untuk mencari produksi sebelumnya.'), include=document.createElement('input'), includeLabel=document.createElement('label');
    line.className='input'; line.placeholder='Mesin baru'; date.type='date'; date.value=todayISO(); date.className='input'; shift.className='input'; ['1','2','3'].forEach(v => shift.add(new Option('Shift '+v,v))); note.className='input'; note.placeholder='Catatan (opsional)'; include.type='checkbox'; include.checked=false; include.disabled=true; includeLabel.append(include,document.createTextNode(' Sertakan produksi sebelumnya ke WO ini'));
    if (prefill) {
        line.value=prefill.line_code || ''; date.value=prefill.latest_date || todayISO(); shift.value=String(prefill.latest_shift || '1');
        const index=master.findIndex(p => woNorm(p.kode)===woNorm(prefill.product_code) && woNorm(p.nama)===woNorm(prefill.product_name));
        if (index < 0) { Swal.fire({icon:'warning',title:'Produk tidak ada di master',text:'Produk exact mesin tidak ditemukan di master. Periksa master produk sebelum menghubungkan WO.'}); return; }
        product.value=String(index);
    }
    form.append(line,product,date,shift,note,attentionNode('h4','Produksi Sebelum Terhubung'),info,includeLabel);
    let timer, serial=0;
    const paramsFor = withHistory => { const p=master[+product.value]; return {p_mode:'PARALLEL',p_ref:row.wo_ref,p_assignment_id:null,p_line:line.value.trim(),p_code:p.kode,p_name:p.nama,p_date:date.value,p_shift:+shift.value,p_include_history:withHistory}; };
    const discover=() => {
        const request=++serial; clearTimeout(timer); include.checked=false; include.disabled=true; info.textContent='Pilih mesin dan produk untuk mencari produksi sebelumnya.';
        if (!line.value.trim() || product.value==='' || !date.value) return;
        info.textContent='Mencari produksi sebelumnya…';
        timer=setTimeout(async () => { try { const preview=await woRpc('wo_repair_preview',paramsFor(false)); if (request!==serial) return; info.replaceChildren(attentionRepairSummary(preview)); include.disabled=+preview.candidate_count===0; }
            catch(error) { if(request===serial) info.textContent='Pencarian gagal: '+error.message; } },350);
    };
    [line,product,date,shift].forEach(el => { el.addEventListener('input',discover); el.addEventListener('change',discover); });
    const selection=await Swal.fire({title:'Tambah Mesin Paralel',html:form,showCancelButton:true,confirmButtonText:'Lihat preview',preConfirm:async () => {
        if (!line.value.trim() || product.value==='' || !date.value) { Swal.showValidationMessage('Lengkapi mesin, produk, tanggal dan shift.'); return false; }
        ++serial; clearTimeout(timer);
        const params=paramsFor(include.checked);
        try { return {params,preview:await woRpc('wo_repair_preview',params),note:note.value.trim()}; }
        catch(error) { Swal.showValidationMessage(error.message || 'Preview gagal'); return false; }
    },didOpen:() => { if (prefill) discover(); },willClose:() => { ++serial; clearTimeout(timer); }});
    if (selection.isConfirmed) await attentionConfirmRepair(selection.value.params,selection.value.preview,selection.value.note);
}
