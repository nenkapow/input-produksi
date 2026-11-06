// Admin WO review. Database access follows the configured Supabase permissions.
let woAttentionRows = [];
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
    $('woAttentionList').textContent = 'Memuat WO…';
    try { woAttentionRows = await woRpc('wo_attention_list', {}) || []; renderWOAttention(); }
    catch (error) { $('woAttentionList').textContent = 'Gagal memuat WO Attention: ' + error.message; }
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
    const line = woNorm($('woAttentionLine').value), product = woNorm($('woAttentionProduct').value), ref = woNorm($('woAttentionRef').value), status = $('woAttentionStatus').value;
    const rows = woAttentionRows.filter(r => (!status || r.status === status) && (!ref || woNorm(r.wo_ref).includes(ref)) && (!line || r.assignments.some(a => woNorm(a.line_code).includes(line))) && (!product || r.assignments.some(a => woNorm(a.product_code + ' ' + a.product_name).includes(product)))).sort((a,b) => attentionPriority(a)-attentionPriority(b));
    if (!rows.length) { list.append(attentionNode('div','Tidak ada WO yang cocok.','woa-empty')); return; }
    const sections = [
        {label:'Perlu Perhatian', rows:rows.filter(r => attentionPriority(r) === 0 || attentionPriority(r) === 1)},
        {label:'WO Aktif', rows:rows.filter(r => r.status === 'OPEN' && attentionPriority(r) > 1)},
        {label:'On Hold', rows:rows.filter(r => r.status === 'ON_HOLD')}
    ];
    sections.forEach(section => {
        if (!section.rows.length) return;
        const container = attentionNode('section',null,'woa-section');
        const heading = attentionNode('div',null,'woa-section-heading'); heading.append(attentionNode('h3',section.label),attentionNode('span',String(section.rows.length),'woa-count')); container.append(heading);
        section.rows.forEach(row => container.append(renderWOAttentionCard(row))); list.append(container);
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
                const controls=attentionNode('div',null,'woa-menu-items'); controls.append(attentionButton('Tutup assignment',() => attentionAssignment(row,a,'END_ASSIGNMENT'),'woa-menu-button'),attentionButton('Pindah Mesin',() => attentionAssignment(row,a,'TRANSFER'),'woa-menu-button'),attentionButton('Tambah Mesin Paralel',() => attentionAssignment(row,a,'PARALLEL'),'woa-menu-button')); menu.append(controls); box.append(menu);
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
    const form=document.createElement('div'), date=document.createElement('input'), shift=document.createElement('select'), line=document.createElement('input'), product=document.createElement('select'), note=document.createElement('input');
    date.type='date'; date.value=todayISO(); date.className='input'; shift.className='input'; ['1','2','3'].forEach(v => shift.add(new Option('Shift '+v,v)));
    line.className='input'; line.placeholder='Mesin baru'; product.className='input'; product.add(new Option('Pilih produk persis...', ''));
    master.forEach((p,i) => product.add(new Option(`${p.kode} - ${p.nama}`,String(i)))); note.className='input'; note.placeholder='Catatan (opsional)';
    form.append(attentionNode('p',action === 'END_ASSIGNMENT' ? 'Assignment berakhir pada shift sebelum waktu ini.' : 'Assignment baru dimulai pada waktu ini.'),date,shift);
    if (action !== 'END_ASSIGNMENT') form.append(line,product); form.append(note);
    const result=await Swal.fire({title:action === 'TRANSFER' ? 'Pindah Mesin' : action === 'PARALLEL' ? 'Tambah Mesin Paralel' : 'Tutup Assignment',html:form,showCancelButton:true,preConfirm:() => { if (!date.value || (action !== 'END_ASSIGNMENT' && (!line.value.trim() || product.value === ''))) { Swal.showValidationMessage('Lengkapi mesin, produk, tanggal dan shift.'); return false; } return true; }});
    if (!result.isConfirmed) return;
    const p=product.value === '' ? null : master[+product.value];
    try { await woRpc('wo_admin_assignment',{p_ref:row.wo_ref,p_action:action,p_source:source.id,p_line:line.value.trim() || null,p_code:p?.kode || null,p_name:p?.nama || null,p_date:date.value,p_shift:+shift.value,p_note:note.value.trim() || null}); await loadWOAttention(); }
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
