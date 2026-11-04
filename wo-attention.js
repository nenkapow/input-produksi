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
    const list = $('woAttentionList'), kpis = $('woAttentionKpis'); list.replaceChildren(); kpis.replaceChildren();
    const today = todayISO();
    [['Perlu Konfirmasi',woAttentionRows.filter(r => attentionPriority(r) === 0).length],['WO Open',woAttentionRows.filter(r => r.status === 'OPEN').length],['WO On Hold',woAttentionRows.filter(r => r.status === 'ON_HOLD').length],['WO Closed Hari Ini',woAttentionRows.filter(r => r.status === 'CLOSED' && r.closed_at && r.closed_at.slice(0,10) === today).length]].forEach(([label,value]) => { const item=attentionNode('div',null,'wo-attention-kpi'); item.append(attentionNode('span',label),attentionNode('strong',value)); kpis.append(item); });
    const line = woNorm($('woAttentionLine').value), product = woNorm($('woAttentionProduct').value), ref = woNorm($('woAttentionRef').value), status = $('woAttentionStatus').value;
    const rows = woAttentionRows.filter(r => (!status || r.status === status) && (!ref || woNorm(r.wo_ref).includes(ref)) && (!line || r.assignments.some(a => woNorm(a.line_code).includes(line))) && (!product || r.assignments.some(a => woNorm(a.product_code + ' ' + a.product_name).includes(product)))).sort((a,b) => attentionPriority(a)-attentionPriority(b));
    if (!rows.length) { list.textContent = 'Tidak ada WO yang cocok.'; return; }
    rows.forEach(row => {
        const priority = attentionPriority(row), card = attentionNode('article',null,'wo-attention-card' + (priority === 0 ? ' alert' : ''));
        const heading = priority === 0 ? 'PRODUK BERGANTI SEBELUM WO SELESAI' : priority === 1 ? 'WO OPEN — TIDAK ADA PRODUKSI 3 HARI' : row.status === 'ON_HOLD' ? 'WO ON HOLD' : row.status === 'CLOSED' ? 'WO CLOSED' : 'WO OPEN';
        card.append(attentionNode('h3',heading), attentionNode('div',`${row.wo_ref} · ${row.status} · Target ${fmtInt(row.qty)} · OK ${fmtInt(row.ok)} · Sisa ${fmtInt(row.remaining)} PCS`));
        (row.assignments || []).forEach(a => {
            const box=attentionNode('div',null,'wo-attention-assignment');
            box.append(attentionNode('strong',`Mesin ${attentionText(a.line_code)} · ${attentionText(a.product_code)} ${attentionText(a.product_name)}`),
                attentionNode('div',`${a.changed ? 'Mesin meninggalkan WO' : a.latest_date ? 'Produk masih sesuai' : 'Belum ada laporan mesin'} · Terakhir produk WO: ${attentionText(a.previous_date)} S${attentionText(a.previous_shift)}`),
                attentionNode('div',`Produk terbaru: ${attentionText(a.latest_code)} ${attentionText(a.latest_name)} · ${attentionText(a.latest_date)} S${attentionText(a.latest_shift)}`));
            if (row.status !== 'CLOSED') { const controls=attentionNode('div',null,'wo-attention-actions'); controls.append(attentionButton('Tutup assignment',() => attentionAssignment(row,a,'END_ASSIGNMENT')),attentionButton('Pindah Mesin',() => attentionAssignment(row,a,'TRANSFER')),attentionButton('Tambah Mesin Paralel',() => attentionAssignment(row,a,'PARALLEL'))); box.append(controls); }
            card.append(box);
        });
        if (row.status !== 'CLOSED') { const actions=attentionNode('div',null,'wo-attention-actions'); actions.append(attentionButton('Tetap Open',() => attentionStatus(row,'OPEN','KEEP_OPEN')),attentionButton('Tunda / ON HOLD',() => attentionStatus(row,'ON_HOLD','HOLD')),attentionButton('Tutup WO',() => attentionStatus(row,'CLOSED','CLOSE'),'btn danger sm')); card.append(actions); }
        else card.append(attentionNode('div',`Ditutup: ${attentionText(row.closed_at)} · ${attentionText(row.reason)} · ${attentionText(row.note)}`));
        list.append(card);
    });
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
