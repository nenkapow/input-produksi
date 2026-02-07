// --- HELPER FUNCTIONS ---
const $ = id => document.getElementById(id);
const toNum = v => isNaN(+v) ? 0 : +v;
const uid = () => Math.random().toString(36).slice(2);
const todayISO = () => new Date().toISOString().slice(0, 10);

// GLOBAL VARIABLES
let client = null;
let logs = [];
let master = [];
let _rekapLogs = [];

// 🔥 SETUP PIN ADMIN DISINI 🔥
const ADMIN_PIN = "1234"; 

document.addEventListener('DOMContentLoaded', () => {
    // --- ACTIONS (MENU UTAMA) ---
    $('btnAdd').onclick = () => { $('mEntry').classList.add('open'); resetEntryForm(); };
    $('btnRekap').onclick = fetchAndShowRekap;
    $('btnOpenLog').onclick = () => { $('vLaporan').classList.add('open'); renderTable(); };

    // --- PROTECTED MENUS (BUTUH PIN) ---
    $('btnConfig').onclick = () => checkAdmin(() => $('mConfig').classList.add('open'));
    $('btnMaster').onclick = () => checkAdmin(() => $('mMaster').classList.add('open'));

    // --- CLOSERS ---
    $('vLaporanClose').onclick = () => $('vLaporan').classList.remove('open');
    $('mConfigClose').onclick = () => $('mConfig').classList.remove('open');
    $('mEntryClose').onclick = () => $('mEntry').classList.remove('open');
    $('mMasterClose').onclick = () => $('mMaster').classList.remove('open');
    $('mRekapClose').onclick = () => $('mRekap').classList.remove('open');

    // --- CORE ---
    $('btnSaveConfig').onclick = saveConfig;
    
    // 🔥 SYNC MODE CEPAT & FULL 🔥
    $('btnRefresh').onclick = () => refreshData(false); 
    if($('btnLoadFull')) $('btnLoadFull').onclick = () => refreshData(true); 

    $('btnSaveEntry').onclick = saveEntry;
    $('btnExport').onclick = exportCSV;
    $('mpAdd').onclick = saveMaster;
    
    // --- FILTER & TABLE ---
    $('btnClearFilter').onclick = () => { $('fFrom').value=''; $('fTo').value=''; $('fProduk').value=''; renderTable(); };
    $('fFrom').onchange = renderTable; $('fTo').onchange = renderTable;
    $('fProduk').oninput = renderTable; $('fShift').onchange = renderTable; $('fLine').oninput = renderTable;
    
    $('btnRefreshRekap').onclick = processRekapFilter;
    if($('btnExportRekap')) $('btnExportRekap').onclick = exportRekapCSV;

    // 🔥 RESET DATA (DILINDUNGI PIN) 🔥
    $('btnClear').onclick = () => checkAdmin(wipeLogs);
    $('btnWipeMaster').onclick = () => checkAdmin(wipeMaster);
    
    $('btnImportCsv').onclick = () => $('fileCsvMaster').click();
    $('fileCsvMaster').onchange = importCSV;

    setupCustomSearch();
    $('eLine').onchange = autoFillProductByLine;

    // 🔥 PENCARIAN MASTER PRODUK (BARU) 🔥
    if($('mpSearch')) $('mpSearch').oninput = renderMaster; 

    // Kalkulasi Realtime
    const calcIds = ['eCavity', 'eCounter', 'eRunner', 'eJatah', 'eStok', 'eBalokan', 'eQtyDus', 'eQtyBox', 'eQtyDusPlus', 'eIsiDusPlus', 'eSblm1','eSblm2', 'eSblm3', 'eSblm4', 'eSblm5', 'eSblm6', 'eSsdh1', 'eSsdh2', 'eSsdh3', 'eSsdh4', 'eSsdh5', 'eSsdh6', 'rUneven', 'rMottled', 'rStartup', 'rShort', 'rFlow', 'rFlash', 'rCrack', 'rSpot', 'rScratch', 'rDirty'];
    calcIds.forEach(id => { if($(id)) $(id).oninput = recalc; });

    // INIT DATE
    $('eTanggal').value = todayISO();
    $('eShift').value = '1';
    
    // Default Filter
    const today = todayISO();
    $('fFrom').value = today;
    $('fTo').value = today;
    $('rDateFrom').value = today;
    $('rDateTo').value = today;

    setupExcelNavigation();

    const sUrl = localStorage.getItem('prod_sb_url');
    const sKey = localStorage.getItem('prod_sb_key');
    if(sUrl && sKey) initSupabase(sUrl, sKey); else $('mConfig').classList.add('open');
});

function checkAdmin(callback) {
    let input = prompt("🔒 RESTRICTED AREA\nMasukkan PIN Admin:");
    if (input === null) return;
    input = input.toString().trim();
    if (input == ADMIN_PIN) {
        callback(); 
    } else {
        alert("⛔ AKSES DITOLAK! PIN SALAH.");
    }
}

// === DATABASE ===
function initSupabase(url, key) {
    try {
        if(typeof supabase === 'undefined') throw new Error("Library Supabase Error.");
        client = supabase.createClient(url, key);
        $('statusDb').innerText = "ONLINE"; $('statusDb').style.color = "var(--success)";
        refreshData(false); 
    } catch(e) { alert("Gagal konek: " + e.message); $('statusDb').innerText = "ERROR"; $('mConfig').classList.add('open'); }
}

function saveConfig() { localStorage.setItem('prod_sb_url', $('cfgUrl').value); localStorage.setItem('prod_sb_key', $('cfgKey').value); initSupabase($('cfgUrl').value, $('cfgKey').value); $('mConfig').classList.remove('open'); }

// --- 🔥 FIXED REFRESH DATA (STRUKTUR DIPERBAIKI) 🔥 ---
async function refreshData(isFull = false) {
    if(!client) return; 
    $('loading').style.display = 'flex';
    
    let dateLimit = null;
    if (!isFull) {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        dateLimit = d.toISOString().slice(0, 10);
    }

    try {
        // 1. Request Master
        const reqMaster = client.from('master').select('*');

        // 2. Request Logs (Perbaikan struktur query)
        let reqLogs = client
            .from('logs')
            .select('*')
            .order('tanggal', { ascending: false });

        if (dateLimit && !isFull) {
            reqLogs = reqLogs.gte('tanggal', dateLimit);
        }

        // 3. JALANKAN PARALEL
        const [resMaster, resLogs] = await Promise.all([reqMaster, reqLogs]);

        if (resMaster.error) throw resMaster.error;
        if (resLogs.error) throw resLogs.error;

        master = resMaster.data || [];
        master.sort((a,b)=>(a.kode||'').localeCompare(b.kode||''));

        logs = resLogs.data || [];
        console.log('DATA BERHASIL DI-LOAD:', logs.length);
        
        renderTable(); 
        renderMaster();
        
        if(isFull) alert("History lengkap berhasil ditarik (" + logs.length + " data).");

    } catch (e) {
        console.error("Gagal Sync:", e);
        alert("Gagal Sync: " + e.message);
    }

    $('loading').style.display = 'none';
}

// --- 🔥 FIXED RENDER TABLE (ANTISIPASI DATA NULL) 🔥 ---
function renderTable() {
    const t = $('tbody'); 
    if(!t) return;
    t.innerHTML = '';
    
    // Ambil filter dari UI
    const fFrom = $('fFrom').value ? new Date($('fFrom').value + 'T00:00:00') : null;
    const fTo = $('fTo').value ? new Date($('fTo').value + 'T23:59:59') : null;
    const q = ($('fProduk').value || '').toLowerCase();
    const s = $('fShift').value;
    const l = ($('fLine').value || '').toLowerCase();

    const filteredLogs = logs.filter(r => {
        const dr = new Date(r.tanggal + 'T12:00:00');
        const matchDate = (!fFrom || dr >= fFrom) && (!fTo || dr <= fTo);
        const matchProd = q ? (r.nama || '').toLowerCase().includes(q) : true;
        const matchShift = s ? r.shift == s : true;
        const matchLine = l ? (r.line || '').toLowerCase().includes(l) : true;
        return matchDate && matchProd && matchShift && matchLine;
    });

    $('rowCount').textContent = filteredLogs.length + " data";

    filteredLogs.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${r.tanggal || '-'}</td>
            <td>${r.shift || '-'}</td>
            <td>${r.line || '-'}</td>
            <td><b>${r.nama || '-'}</b><br><small>${r.kode || '-'}</small></td>
            <td>${r.tipe || '-'}</td>
            <td class="right">${(+r.counter || 0).toLocaleString()}</td>
            <td class="right">${(+r.cavity || 0)}</td>
            <td class="right">${(+r.qty_dus || 0)}</td>
            <td class="right">${(+r.qty_box || 0)}</td>
            <td class="right text-ok"><b>${(+r.okpcs || 0).toLocaleString()}</b></td>
            <td class="right">${(+r.okkg || 0).toFixed(2)}</td>
            <td class="right text-danger">${(+r.reject || 0).toLocaleString()}</td>
            <td class="right">${(+r.sisa_bahan || 0).toFixed(2)}</td>
            <td class="right"><b>${(+r.yieldpct || 0).toFixed(2)}%</b></td>
            <td class="right">${r.reject_max || 0}</td>
            <td style="text-align:center; white-space:nowrap;">
                <button class="btn sm info" onclick="editLog('${r.id}')">✎</button> 
                <button class="btn sm danger" onclick="deleteLog('${r.id}')">🗑</button>
            </td>
        `;
        t.appendChild(tr);
    });
}

// === ENTRY ===
function resetEntryForm() {
    const fields = ['eLine', 'eProduk', 'eGram', 'eRunner', 'eCavity', 'eCounter', 'eJatah', 'eStok', 'eBalokan', 'eSisaBahan', 'eSblm1', 'eSblm2', 'eSblm3', 'eSblm4', 'eSblm5', 'eSblm6', 'eSsdh1', 'eSsdh2', 'eSsdh3', 'eSsdh4', 'eSsdh5', 'eSsdh6', 'eQtyDus', 'eIsiDus', 'eQtyBox', 'eIsiBox', 'eQtyDusPlus', 'eIsiDusPlus', 'eCatatan', 'rUneven', 'rMottled', 'rStartup', 'rShort', 'rFlow', 'rFlash', 'rCrack', 'rSpot', 'rScratch', 'rDirty', 'rTotal', 'rMax'];
    fields.forEach(id => { if($(id)) $(id).value = ''; });
    $('eId').value = ''; ['vHasil', 'vOkPcs', 'vRejectPcs', 'vYield', 'vOkKg', 'vRejectKg', 'vRunnerKg', 'vSisaBahanLabel'].forEach(id => $(id).innerText='0'); $('badgeTipe').innerText=''; $('warnOver').style.display='none';
}

function autoFillProductByLine() {
    const ln = $('eLine').value.trim(); if(!ln || !logs.length) return;
    const last = logs.sort((a,b)=>new Date(b.tanggal)-new Date(a.tanggal)).find(r=>r.line==ln);
    if(last) { $('eProduk').value = last.kode + " - " + last.nama; hydrateProduk(); }
}

function setupCustomSearch() {
    const inp = $('eProduk'), lst = $('produkSuggestions');
    inp.oninput = function() { const v = this.value.toLowerCase(); if(!v) { lst.style.display='none'; return; } const m = master.filter(p=>p.kode.toLowerCase().includes(v)||p.nama.toLowerCase().includes(v)); lst.innerHTML = m.length ? m.map(p=>`<div class="search-item" onclick="selectProduk('${p.kode} - ${p.nama}')"><span>${p.kode}</span> - ${p.nama}</div>`).join('') : ''; lst.style.display = m.length?'block':'none'; };
    document.addEventListener('click', e=>{ if(e.target!==inp && e.target!==lst) lst.style.display='none'; });
}

window.selectProduk = v => { $('eProduk').value=v; $('produkSuggestions').style.display='none'; hydrateProduk(); };

function hydrateProduk(){ const val = $('eProduk').value, p = master.find(x=>(x.kode+" - "+x.nama)===val); if(p) { $('eGram').value=p.gram; $('eRunner').value=p.runner; $('eCavity').value=p.cavity; $('eIsiDus').value=p.per_dus; $('eIsiBox').value=p.per_box; $('badgeTipe').innerText=(p.tipe==='kg_sisa')?'Mode KG':'Mode PCS'; recalc(); } }

function sum(ids){ return ids.map(id=>toNum($(id).value)).reduce((a,b)=>a+b,0); }

// --- LOGIKA PERHITUNGAN (FIXED) ---
function compute(){
    const prodNameFull=$('eProduk').value, prod=master.find(p=>(p.kode+" - "+p.nama)===prodNameFull);
    const gram=toNum($('eGram').value), tipe=$('badgeTipe').innerText.includes('KG')?'kg_sisa':'pcs';
    const cav=Math.max(1, toNum($('eCavity').value)), counter=toNum($('eCounter').value);
    
    let sblm=sum(['eSblm1','eSblm2','eSblm3','eSblm4','eSblm5','eSblm6']), ssdh=sum(['eSsdh1','eSsdh2','eSsdh3','eSsdh4','eSsdh5','eSsdh6']);
    let sblm_pcs=sblm, ssdh_pcs=ssdh; if(tipe==='kg_sisa'){ const c=gram>0?(1000/gram):0; sblm_pcs=sblm*c; ssdh_pcs=ssdh*c; }
    
    const qD=toNum($('eQtyDus').value), iD=toNum($('eIsiDus').value), qB=toNum($('eQtyBox').value), iB=toNum($('eIsiBox').value), qDp=toNum($('eQtyDusPlus').value), iDp=toNum($('eIsiDusPlus').value);
    const packpcs=(qD*iD)+(qB*iB)+(qDp*iDp), okpcs=packpcs-sblm_pcs+ssdh_pcs, produksi=counter*cav, hasil=produksi+sblm_pcs-ssdh_pcs, rejectpcs=produksi-okpcs;
    
    const okkg=(okpcs*gram)/1000, rejectkg=(rejectpcs*gram)/1000, runnerkg=(counter*toNum($('eRunner').value))/1000;
    const jatah=toNum($('eJatah').value), stok=toNum($('eStok').value), balok=toNum($('eBalokan').value);
    const sisaBahan=(jatah+stok)-(runnerkg+rejectkg+okkg+balok), yieldpct=hasil>0?(okpcs/hasil)*100:0, overpack=packpcs>hasil;
    
    const rIds=['rUneven','rMottled','rStartup','rShort','rFlow','rFlash','rCrack','rSpot','rScratch','rDirty'];
    const rValues = rIds.map(i=>toNum($(i).value));
    
    return { 
        prod, tipe, gram, cav, counter, sblm_pcs, ssdh_pcs, hasil, okpcs, okkg, 
        rejectpcs, rejectkg, runnerkg, yieldpct, sisaBahan, overpack, packpcs, 
        rtotal:sum(rIds), rmax:Math.max(...rValues), 
        details:{ sblm:[1,2,3,4,5,6].map(i=>toNum($('eSblm'+i).value)), ssdh:[1,2,3,4,5,6].map(i=>toNum($('eSsdh'+i).value)) } 
    };
}

function recalc(){
    const p=compute();
    $('vHasil').innerText=p.hasil.toFixed(0); $('vOkPcs').innerText=p.okpcs.toFixed(0); $('vRejectPcs').innerText=p.rejectpcs.toFixed(0);
    $('vYield').innerText=p.yieldpct.toFixed(2)+'%'; $('vOkKg').innerText=p.okkg.toFixed(2); $('vRejectKg').innerText=p.rejectkg.toFixed(2);
    $('vRunnerKg').innerText=p.runnerkg.toFixed(2); $('vSisaBahanLabel').innerText=p.sisaBahan.toFixed(2); $('eSisaBahan').value=p.sisaBahan.toFixed(2);
    
    // 🔥 PERBAIKAN: Isi nilai rTotal dan rMax agar tidak kosong saat simpan
    $('rTotal').value = p.rtotal; 
    $('rMax').value = p.rmax; 
    $('warnOver').style.display=p.overpack?'block':'none';
}

async function saveEntry() {
    if(!client) return Swal.fire({icon:'error', title:'Error', text:'Database Belum Konek!', background:'#1e1e1e', color:'#e5e5e5'}); 
    
    const p = compute(); 
    
    // 1. Validasi Produk Kosong (Pakai SweetAlert)
    if(!p.prod) {
        Swal.fire({
            icon: 'warning', // Pakai icon warning lebih pas
            title: 'Belum Lengkap',
            text: 'Pilih produk yang valid dulu ya sayang!',
            background: '#1e1e1e',
            color: '#e5e5e5',
            confirmButtonColor: '#d4af37',
            confirmButtonText: 'Oke Siap'
        });
        return;
    }

    $('loading').style.display = 'flex';
    
    // 2. Simpan ke Database
    const { error } = await client.from('logs').upsert({
        id: $('eId').value || uid(),
        tanggal: $('eTanggal').value,
        shift: $('eShift').value,
        line: $('eLine').value.toUpperCase(),
        kode: p.prod.kode,
        nama: p.prod.nama,
        tipe: p.tipe,
        gram: p.gram,
        runner: p.runner,
        cavity: p.cav,
        counter: p.counter,
        qty_dus: toNum($('eQtyDus').value),
        isi_dus: toNum($('eIsiDus').value),
        qty_box: toNum($('eQtyBox').value),
        isi_box: toNum($('eIsiBox').value),
        qty_dus_plus: toNum($('eQtyDusPlus').value),
        isi_dus_plus: toNum($('eIsiDusPlus').value),
        hasil: p.hasil,
        okpcs: p.okpcs,
        okkg: p.okkg,
        reject: p.rejectpcs,
        yieldpct: p.yieldpct,
        sisa_bahan: p.sisaBahan,
        catatan: $('eCatatan').value,
        reject_uneven: toNum($('rUneven').value),
        reject_mottled: toNum($('rMottled').value),
        reject_startup: toNum($('rStartup').value),
        reject_short: toNum($('rShort').value),
        reject_flow: toNum($('rFlow').value),
        reject_flashing: toNum($('rFlash').value),
        reject_crack: toNum($('rCrack').value),
        reject_spot: toNum($('rSpot').value),
        reject_scratch: toNum($('rScratch').value),
        reject_dirty: toNum($('rDirty').value),
        reject_max: p.rmax,
        detail_sisa: JSON.stringify(p.details)
    });
    
    $('loading').style.display = 'none'; 

    if(error) {
        // 3. Error Database (Pakai SweetAlert)
        Swal.fire({
            icon: 'error',
            title: 'Gagal Simpan',
            text: error.message,
            background: '#1e1e1e',
            color: '#e5e5e5',
            confirmButtonColor: '#ef4444'
        });
    } else { 
        // 4. SUKSES (Pakai SweetAlert Gold Kamu)
        Swal.fire({
            icon: 'success',
            title: 'Berhasil!',
            text: 'Alhamdulillah data tersimpan!',
            background: '#1e1e1e', 
            color: '#e5e5e5',      
            iconColor: '#d4af37',  
            confirmButtonColor: '#d4af37', 
            confirmButtonText: 'Mantap',
            timer: 2000,           
            timerProgressBar: true
        });

        resetEntryForm(); 
        refreshData(false); 
    }
}

async function saveMaster() {
    if(!client) return alert("DB Error"); const k=$('mpKode').value.trim(), n=$('mpNama').value.trim(); if(!k) return alert("Kode wajib");
    let tID=uid(), ex=master.find(m=>m.kode.toLowerCase()===k.toLowerCase()&&m.nama.toLowerCase()===n.toLowerCase());
    if(ex && !confirm("Update Produk?")) return; if(ex) tID=ex.id;
    $('loading').style.display='flex';
    await client.from('master').upsert({ id: tID, kode: k, nama: n, tipe: $('mpTipe').value, gram: toNum($('mpGram').value), runner: toNum($('mpRunner').value), cavity: toNum($('mpCavity').value), per_dus: toNum($('mpPerDus').value), per_box: toNum($('mpPerBox').value) });
    $('loading').style.display='none'; refreshData(false); ['mpKode','mpNama','mpGram','mpRunner','mpCavity','mpPerDus','mpPerBox'].forEach(i=>$(i).value='');
}

// --- FITUR HAPUS & RESET (VERSI SWEETALERT DARK & GOLD) ---

// 1. Hapus Satu Data Laporan (Log)
// --- FITUR HAPUS & RESET (REVISI FIX ERROR) ---

// 1. Hapus Satu Data Laporan (Log)
window.deleteLog = (id) => {
    Swal.fire({
        title: 'Hapus Data Ini?',
        text: "Data laporan yang dihapus tidak bisa kembali lho!",
        icon: 'warning',
        showCancelButton: true,
        background: '#1e1e1e',
        color: '#e5e5e5',
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#333',
        confirmButtonText: 'Ya, Hapus!',
        cancelButtonText: 'Batal'
    }).then(async (result) => {
        if (result.isConfirmed) {
            $('loading').style.display = 'flex';
            
            // 🔥 INI PERBAIKANNYA: Kita tangkap error-nya
            const { error } = await client.from('logs').delete().eq('id', id);
            
            $('loading').style.display = 'none';
            
            if (error) {
                // Kalau Gagal, Munculkan Pesan Error Aslinya
                Swal.fire({
                    icon: 'error',
                    title: 'Gagal Hapus',
                    text: error.message, // <--- Ini biar kita tau alasannya!
                    background: '#1e1e1e',
                    color: '#e5e5e5'
                });
            } else {
                // Kalau Sukses Baru Muncul Ini
                Swal.fire({
                    title: 'Terhapus!',
                    icon: 'success',
                    background: '#1e1e1e',
                    color: '#e5e5e5',
                    confirmButtonColor: '#d4af37',
                    timer: 1000,
                    showConfirmButton: false
                });
                refreshData(false);
            }
        }
    });
};

// 2. Hapus Satu Master Produk
window.deleteMaster = (id) => {
    Swal.fire({
        title: 'Hapus Produk?',
        text: "Produk ini akan hilang dari database master.",
        icon: 'warning',
        showCancelButton: true,
        background: '#1e1e1e',
        color: '#e5e5e5',
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#333',
        confirmButtonText: 'Ya, Hapus Produk',
        cancelButtonText: 'Batal'
    }).then(async (result) => {
        if (result.isConfirmed) {
            $('loading').style.display = 'flex';
            
            // 🔥 Tangkap error juga disini
            const { error } = await client.from('master').delete().eq('id', id);
            
            $('loading').style.display = 'none';
            
            if (error) {
                Swal.fire({
                    icon: 'error',
                    title: 'Gagal Hapus',
                    text: error.message,
                    background: '#1e1e1e',
                    color: '#e5e5e5'
                });
            } else {
                Swal.fire({
                    title: 'Produk Dihapus!',
                    icon: 'success',
                    background: '#1e1e1e',
                    color: '#e5e5e5',
                    confirmButtonColor: '#d4af37',
                    timer: 1000,
                    showConfirmButton: false
                });
                refreshData(false);
            }
        }
    });
};

// 3. WIPE DATA (Logs)
async function wipeLogs() {
    Swal.fire({
        title: '⚠️ RESET TOTAL?',
        text: "Yakin hapus SEMUA data laporan?",
        icon: 'error',
        showCancelButton: true,
        background: '#1e1e1e',
        color: '#e5e5e5',
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#333',
        confirmButtonText: 'YA, BERSIHKAN!'
    }).then(async (result) => {
        if (result.isConfirmed) {
            $('loading').style.display = 'flex';
            const { error } = await client.from('logs').delete().neq('id', '0');
            $('loading').style.display = 'none';
            
            if (error) {
                Swal.fire({ icon: 'error', title: 'Error', text: error.message, background:'#1e1e1e', color:'#e5e5e5' });
            } else {
                Swal.fire({ title: 'Bersih!', icon: 'success', background:'#1e1e1e', color:'#e5e5e5', confirmButtonColor:'#d4af37' });
                refreshData(false);
            }
        }
    });
}

// 4. WIPE MASTER
async function wipeMaster() {
    Swal.fire({
        title: '⚠️ HAPUS SEMUA PRODUK?',
        text: "Master Produk akan kosong!",
        icon: 'error',
        showCancelButton: true,
        background: '#1e1e1e',
        color: '#e5e5e5',
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#333',
        confirmButtonText: 'YA, HAPUS!'
    }).then(async (result) => {
        if (result.isConfirmed) {
            $('loading').style.display = 'flex';
            const { error } = await client.from('master').delete().neq('id', '0');
            $('loading').style.display = 'none';
            
            if (error) {
                Swal.fire({ icon: 'error', title: 'Error', text: error.message, background:'#1e1e1e', color:'#e5e5e5' });
            } else {
                Swal.fire({ title: 'Bersih!', icon: 'success', background:'#1e1e1e', color:'#e5e5e5', confirmButtonColor:'#d4af37' });
                refreshData(false);
            }
        }
    });
}

window.editLog=(id)=>{
    const r=logs.find(x=>x.id===id); if(!r) return;
    $('eId').value=r.id; $('eTanggal').value=r.tanggal; $('eShift').value=r.shift; $('eLine').value=r.line; $('eProduk').value=r.kode+" - "+r.nama; hydrateProduk();
    $('eCounter').value=r.counter; $('eCavity').value=r.cavity;
    $('eQtyDus').value=r.qty_dus||''; $('eIsiDus').value=r.isi_dus||''; $('eQtyBox').value=r.qty_box||''; $('eIsiBox').value=r.isi_box||''; $('eQtyDusPlus').value=r.qty_dus_plus||''; $('eIsiDusPlus').value=r.isi_dus_plus||''; $('eCatatan').value=r.catatan||'';
    $('rUneven').value=r.reject_uneven||''; $('rMottled').value=r.reject_mottled||''; $('rStartup').value=r.reject_startup||''; $('rShort').value=r.reject_short||''; $('rFlow').value=r.reject_flow||''; $('rFlash').value=r.reject_flashing||''; $('rCrack').value=r.reject_crack||''; $('rSpot').value=r.reject_spot||''; $('rScratch').value=r.reject_scratch||''; $('rDirty').value=r.reject_dirty||'';
    if(r.detail_sisa){ const d=(typeof r.detail_sisa==='string')?JSON.parse(r.detail_sisa):r.detail_sisa; if(d.sblm)d.sblm.forEach((v,i)=>{if($('eSblm'+(i+1)))$('eSblm'+(i+1)).value=v===0?'':v}); if(d.ssdh)d.ssdh.forEach((v,i)=>{if($('eSsdh'+(i+1)))$('eSsdh'+(i+1)).value=v===0?'':v}); }
    recalc(); $('mEntry').classList.add('open'); $('vLaporan').classList.remove('open');
};

// --- FUNGSI RENDER MASTER (SUDAH DIUPGRADE PENCARIAN & ID-BASED) ---
function renderMaster(){
    const t = $('mpBody'); 
    if(!t) return;
    t.innerHTML = '';

    // Ambil kata kunci pencarian
    const q = $('mpSearch') ? $('mpSearch').value.toLowerCase() : '';

    // Filter master array berdasarkan Kode ATAU Nama
    const filteredMaster = master.filter(p => 
        (p.kode || '').toLowerCase().includes(q) || 
        (p.nama || '').toLowerCase().includes(q)
    );

    // Render data yang sudah difilter
    // PERHATIKAN: onclick="editMaster('${p.id}')" -> Kita kirim ID, bukan Index (i)
    t.innerHTML = filteredMaster.map(p => `
        <tr>
            <td>${p.kode}</td>
            <td>${p.nama}</td>
            <td>${p.tipe}</td>
            <td class="right">${p.gram}</td>
            <td class="right">${p.runner}</td>
            <td class="right">${p.cavity}</td>
            <td class="right">${p.per_dus}</td>
            <td style="text-align:center">
                <button class="btn sm" onclick="editMaster('${p.id}')">✎</button> 
                <button class="btn sm danger" onclick="deleteMaster('${p.id}')">🗑</button>
            </td>
        </tr>
    `).join('');
}

// Fungsi Edit Master yang LEBIH AMAN (Pakai ID)
window.editMaster = (id) => {
    // Cari data berdasarkan ID, bukan urutan array
    const p = master.find(x => x.id === id); 
    if(!p) return;

    // Isi form dengan data yang ditemukan
    $('mpKode').value = p.kode; 
    $('mpNama').value = p.nama; 
    $('mpTipe').value = p.tipe; 
    $('mpGram').value = p.gram; 
    $('mpRunner').value = p.runner; 
    $('mpCavity').value = p.cavity; 
    $('mpPerDus').value = p.per_dus; 
    $('mpPerBox').value = p.per_box;
    
    // Scroll ke atas biar formnya kelihatan
    if($('mMaster').scrollTo) $('mMaster').scrollTo({ top: 0, behavior: 'smooth' });
}

function fetchAndShowRekap(){ 
    if($('fFrom').value) $('rDateFrom').value = $('fFrom').value;
    if($('fTo').value) $('rDateTo').value = $('fTo').value;
    processRekapFilter(); 
    $('mRekap').classList.add('open'); 
}

function processRekapFilter() {
    const rf = new Date($('rDateFrom').value);
    const rt = new Date($('rDateTo').value);
    _rekapLogs = logs.filter(r => { const d = new Date(r.tanggal); return d >= rf && d <= rt; });
    const activeBtn = document.querySelector('#mRekap .filter-btn.active');
    filterRekap(activeBtn ? (activeBtn.innerText.includes('SEMUA') ? 'all' : activeBtn.innerText.replace('SHIFT ','')) : 'all', activeBtn);
}

window.filterRekap = (m, b) => {
    if(b){
        document.querySelectorAll('.filter-btn').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
    }
    const mode = (b && b.innerText.includes('SEMUA')) ? 'all' : m;
    renderRekapTable(mode);
}

function renderRekapTable(m){
    const d = (m === 'all') ? _rekapLogs : _rekapLogs.filter(r => r.shift == m);
    const g = {};
    d.forEach(r => {
        const ln = (r.line || '').toString().trim().toUpperCase();
        const kd = (r.kode || '').toString().trim();
        const nm = (r.nama || '').toString().trim();
        const k = ln + "##" + kd + "##" + nm;
        if(!g[k]) g[k] = { l: ln, k: kd, n: nm, o: 0, r: 0, w: 0, y: 0, c: 0 };
        g[k].o += +r.okpcs; g[k].r += +r.reject; g[k].w += +r.okkg; g[k].y += +r.yieldpct; g[k].c++;
    });
    const uniqueLines = new Set(Object.values(g).map(x => x.l)).size;
    $('rekapMachineCount').innerHTML = `Total Data: <b style="color:#fff">${d.length}</b> | Mesin Aktif: <b style="color:#fff">${uniqueLines} Unit</b>`;
    const sortedData = Object.values(g).sort((a,b) => {
        const lineDiff = a.l.localeCompare(b.l, undefined, { numeric: true });
        if(lineDiff !== 0) return lineDiff;
        return a.n.localeCompare(b.n);
    });
    $('tbodyRekap').innerHTML = sortedData.map(x => `<tr><td>${x.l}</td><td>${x.k}<br><small style="color:#fff">${x.n}</small></td><td class="right text-ok">${x.o.toLocaleString()}</td><td class="right text-danger">${x.r.toLocaleString()}</td><td class="right">${x.w.toFixed(2)}</td><td class="right"><b>${(x.c ? x.y / x.c : 0).toFixed(2)}%</b></td></tr>`).join('');
}

function exportCSV(){
    const f=new Date($('fFrom').value), t=new Date($('fTo').value), d=logs.filter(r=>{const dr=new Date(r.tanggal); return dr>=f && dr<=t;}); if(!d.length) return alert("Kosong");
    const h=Object.keys(d[0]).join(","), c=[h].concat(d.map(r=>Object.values(r).map(v=>`"${v}"`).join(","))).join("\n");
    const b=new Blob([c],{type:'text/csv'}), u=URL.createObjectURL(b), a=document.createElement('a'); a.href=u; a.download='Data.csv'; a.click();
}

function importCSV(e){ alert("Fitur Import CSV aktif"); refreshData(false); }

function setupExcelNavigation() {
    const inputs = document.querySelectorAll('#mEntry input:not([type="hidden"]), #mEntry select, #mEntry textarea');
    inputs.forEach((input, index) => {
        input.addEventListener('keydown', (e) => {
            const key = e.key;
            if (key === 'ArrowDown' || key === 'Enter' || key === 'ArrowUp') {
                e.preventDefault(); 
                let targetIndex = index;
                const direction = (key === 'ArrowDown' || key === 'Enter') ? 1 : -1;
                while (true) {
                    targetIndex += direction;
                    if (targetIndex < 0 || targetIndex >= inputs.length) break;
                    const el = inputs[targetIndex];
                    if (el.offsetParent !== null && !el.disabled && !el.readOnly) {
                        el.focus(); if (el.select) el.select(); break;
                    }
                }
            }
        });
    });
} // 🔥 INI DIA TANDA KURUNG YANG TADI HILANG SAYANG! SEKARANG UDAH AMAN 🔥

// --- FITUR EXPORT EXCEL .XLSX (PURE FORMAT) ---
function exportRekapCSV() { // Nama fungsinya biarin exportRekapCSV biar gak usah ubah listener di atas
    
    // 1. Cek Data
    if (!_rekapLogs || !_rekapLogs.length) {
        return alert("Datanya kosong sayang. Klik 'PROSES DATA' dulu ya! 😘");
    }

    // 2. Filter Sesuai Shift Aktif
    const activeBtn = document.querySelector('#mRekap .filter-btn.active');
    const mode = activeBtn ? (activeBtn.innerText.includes('SEMUA') ? 'all' : activeBtn.innerText.replace('SHIFT ','')) : 'all';
    const d = (mode === 'all') ? _rekapLogs : _rekapLogs.filter(r => r.shift == mode);

    if (d.length === 0) return alert("Data kosong untuk shift ini sayang.");

    // 3. Olah Data (Grouping)
    const g = {};
    d.forEach(r => {
        const ln = (r.line || '').toString().trim().toUpperCase();
        const kd = (r.kode || '').toString().trim();
        const nm = (r.nama || '').toString().trim();
        
        // Key Unik
        const k = ln + "##" + kd + "##" + nm;
        
        if(!g[k]) g[k] = { 
            l: ln, 
            gabungan: `${kd} - ${nm}`, 
            o: 0, r: 0, w: 0, y: 0, c: 0 
        };
        
        g[k].o += +r.okpcs;
        g[k].r += +r.reject;
        g[k].w += +r.okkg;
        g[k].y += +r.yieldpct;
        g[k].c++;
    });

    // 4. Urutkan Data
    const sorted = Object.values(g).sort((a,b) => 
        a.l.localeCompare(b.l, undefined, { numeric: true })
    );

    // 5. SIAPKAN DATA UNTUK EXCEL (ARRAY OF OBJECTS)
    // Ini format yang diminta: Mesin | Nama | Hasil OK | ...
    const dataExcel = sorted.map(x => ({
        "Mesin": x.l,                      // Kolom A: Mesin (Pisah)
        "Produk (Kode - Nama)": x.gabungan,// Kolom B: Gabungan
        "Hasil OK (Pcs)": x.o,             // Kolom C
        "Total Reject (Pcs)": x.r,         // Kolom D
        "Total OK (Kg)": Number(x.w.toFixed(2)), // Kolom E (Jadiin angka biar bisa disum di excel)
        "Avg Yield (%)": (x.c ? Number((x.y / x.c).toFixed(2)) : 0) // Kolom F
    }));

    // 6. GENERATE FILE .XLSX MENGGUNAKAN SHEETJS
    const ws = XLSX.utils.json_to_sheet(dataExcel);
    
    // (Opsional) Bikin lebar kolom otomatis biar rapi
    const wscols = [
        {wch: 10}, // Lebar Kolom A (Mesin)
        {wch: 40}, // Lebar Kolom B (Nama Produk)
        {wch: 15}, // Lebar Kolom C
        {wch: 15}, // Lebar Kolom D
        {wch: 15}, // Lebar Kolom E
        {wch: 15}  // Lebar Kolom F
    ];
    ws['!cols'] = wscols;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekap Produksi");

    // 7. DOWNLOAD
    const fileName = `Laporan_Produksi_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
}
