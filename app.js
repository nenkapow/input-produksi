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

// TARGET CONTROL SETTINGS
const STANDARD_SHIFT_HOURS = 8;
const SHIFT_HOURS = STANDARD_SHIFT_HOURS; // kompatibilitas data lama
const TARGET_TOLERANCE_PCT = 97; // Spare 3%: actual >= 97% dari target aktual dianggap masih aman.
const TARGET_CRITICAL_PCT = 90;  // Di bawah 90% masuk merah besar.
const TARGET_STATUS = {
    NO_TARGET: { label: 'Target belum aktif', cls: 'neutral', icon: '•' },
    TARGET_STANDARD_TERCAPAI: { label: 'Target Tercapai', cls: 'ok', icon: '•' },
    TERCAPAI_AKTUAL_LOSS_CAPACITY: { label: 'Target Aktual Tercapai, Kapasitas Turun', cls: 'warn', icon: '•' },
    HAMPIR_TIDAK_TARGET: { label: 'Hampir Tidak Target', cls: 'warn', icon: '•' },
    TIDAK_TARGET: { label: 'Tidak Dapat Target', cls: 'bad', icon: '•' }
};

const fmtInt = n => Math.round(+n || 0).toLocaleString('id-ID');
const fmtPct = n => ((+n || 0).toFixed(1)) + '%';
const fmtSigned = n => { const x = Math.round(+n || 0); return (x > 0 ? '+' : '') + x.toLocaleString('id-ID'); };
const normLine = v => (v || '').toString().trim().toUpperCase();
const ymd = d => d.toISOString().slice(0, 10);

function getProductCycleTime(prod) {
    if(!prod) return 0;
    return toNum(prod.cycle_time_sec ?? prod.cycle_time ?? prod.ct ?? prod.time_cycle ?? prod.cycletime);
}

function getProductStdCavity(prod) {
    return Math.max(1, toNum(prod?.cavity));
}

function getTargetShotHour(cycleTimeSec) {
    return cycleTimeSec > 0 ? Math.round(3600 / cycleTimeSec) : 0;
}

function getSelectedEffectiveHours() {
    const raw = toNum($('eEffectiveHours')?.value) || STANDARD_SHIFT_HOURS;
    return Math.min(STANDARD_SHIFT_HOURS, Math.max(1, raw));
}

function uniqueDashboardLogs(rows) {
    const seen = new Set();
    return (rows || []).filter(r => {
        const tg = extractLogTarget(r);
        const key = [r.tanggal, r.shift, normLine(r.line), r.kode, r.nama, Math.round(tg.okpcs), Math.round(tg.targetActual), Math.round(tg.gapActual)].join('|');
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function makeTargetStatus(okpcs, targetStandard, targetActual) {
    if(!targetActual || targetActual <= 0) return 'NO_TARGET';
    const safeStandard = targetStandard > 0 ? targetStandard : targetActual;
    const achActual = targetActual > 0 ? (okpcs / targetActual) * 100 : 0;
    const okAgainstStandard = okpcs >= (safeStandard * (TARGET_TOLERANCE_PCT / 100));
    const okAgainstActual = okpcs >= (targetActual * (TARGET_TOLERANCE_PCT / 100));

    if(okAgainstStandard) return 'TARGET_STANDARD_TERCAPAI';
    if(okAgainstActual) return 'TERCAPAI_AKTUAL_LOSS_CAPACITY';
    if(achActual >= TARGET_CRITICAL_PCT) return 'HAMPIR_TIDAK_TARGET';
    return 'TIDAK_TARGET';
}

function isTargetUnsafe(status) {
    return ['HAMPIR_TIDAK_TARGET', 'TIDAK_TARGET'].includes(status);
}

function statusMeta(status) {
    return TARGET_STATUS[status] || TARGET_STATUS.NO_TARGET;
}


function scrollEntryFormToTop(behavior = 'smooth') {
    const entryModal = $('mEntry');
    if(!entryModal) return;

    const safeBehavior = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior;
    try {
        entryModal.scrollTo({ top: 0, left: 0, behavior: safeBehavior });
    } catch(e) {
        entryModal.scrollTop = 0;
    }

    const entryWrap = entryModal.querySelector('.wrap-full');
    if(entryWrap) {
        try {
            entryWrap.scrollTo({ top: 0, left: 0, behavior: safeBehavior });
        } catch(e) {
            entryWrap.scrollTop = 0;
        }
    }
}



function openEntryRequiredAccordions() {
    const entryModal = $('mEntry');
    if(!entryModal) return;
    entryModal.querySelectorAll('details.required-accordion').forEach(panel => { panel.open = true; });
}

function blurActiveElementSafely() {
    try {
        const active = document.activeElement;
        if(active && typeof active.blur === 'function') active.blur();
    } catch(e) {}
}


function syncQuickHourChips() {
    const sel = $('eEffectiveHours');
    if(!sel) return;
    document.querySelectorAll('.quick-hour-chip').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.hours === String(sel.value || STANDARD_SHIFT_HOURS));
    });
}

function setupQuickInputMode() {
    document.querySelectorAll('.quick-hour-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const sel = $('eEffectiveHours');
            if(!sel) return;
            sel.value = btn.dataset.hours || STANDARD_SHIFT_HOURS;

            const stopReason = $('eStopReason');
            if(stopReason) {
                if(sel.value === String(STANDARD_SHIFT_HOURS)) {
                    stopReason.value = '';
                } else if(btn.dataset.reason) {
                    stopReason.value = btn.dataset.reason;
                }
            }

            syncQuickHourChips();
            recalc();
        });
    });

    if($('eEffectiveHours')) {
        $('eEffectiveHours').addEventListener('change', () => {
            syncQuickHourChips();
            recalc();
        });
    }

    // Biar mandor bisa tab/enter lebih cepat: setelah pilih produk, alur diarahkan ke counter.
    if($('eCounter')) $('eCounter').setAttribute('inputmode', 'numeric');
    if($('eLine')) $('eLine').setAttribute('inputmode', 'numeric');
    syncQuickHourChips();
}

function extractLogTarget(r) {
    const targetActual = toNum(r.target_actual_pcs ?? r.target_pcs);
    const targetStandard = toNum(r.target_standard_pcs) || targetActual;
    const okpcs = toNum(r.okpcs);
    const gapActual = (r.gap_actual_pcs !== undefined && r.gap_actual_pcs !== null) ? toNum(r.gap_actual_pcs) : (targetActual ? okpcs - targetActual : 0);
    const achActual = (r.achievement_actual_pct !== undefined && r.achievement_actual_pct !== null) ? toNum(r.achievement_actual_pct) : (targetActual ? (okpcs / targetActual) * 100 : 0);
    const cavityStd = toNum(r.cavity_standard_snapshot ?? r.cavity_standard ?? r.cavity);
    const cavityActive = toNum(r.cavity_active ?? r.cavity);
    const standardShiftHours = toNum(r.standard_shift_hours) || STANDARD_SHIFT_HOURS;
    const effectiveHours = toNum(r.effective_hours ?? r.shift_hours) || standardShiftHours;
    const plannedStopHours = toNum(r.planned_stop_hours) || Math.max(0, standardShiftHours - effectiveHours);
    const targetHourStandard = toNum(r.target_hour_standard) || (standardShiftHours ? targetStandard / standardShiftHours : 0);
    const loss = toNum(r.cavity_loss_pcs) || 0;
    const timeLoss = toNum(r.time_loss_pcs) || Math.max(0, targetHourStandard * plannedStopHours);
    const capacityLossTotal = toNum(r.capacity_loss_total_pcs) || Math.max(0, targetStandard - targetActual);
    const stopReason = r.planned_stop_reason || '';
    const status = makeTargetStatus(okpcs, targetStandard, targetActual);
    return { targetActual, targetStandard, okpcs, gapActual, achActual, cavityStd, cavityActive, loss, timeLoss, capacityLossTotal, standardShiftHours, effectiveHours, plannedStopHours, stopReason, status };
}

// 🔥 SETUP PIN ADMIN DISINI 🔥
const ADMIN_PIN = "1234"; 

document.addEventListener('DOMContentLoaded', () => {
    // --- ACTIONS (MENU UTAMA) ---
    $('btnAdd').onclick = () => { $('mEntry').classList.add('open'); resetEntryForm(); scrollEntryFormToTop('auto'); };
    if($('btnOpenInputFromAlert')) $('btnOpenInputFromAlert').onclick = () => { $('mEntry').classList.add('open'); resetEntryForm(); scrollEntryFormToTop('auto'); };
    if($('btnOpenInputFromTop')) $('btnOpenInputFromTop').onclick = () => { $('mEntry').classList.add('open'); resetEntryForm(); scrollEntryFormToTop('auto'); };
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
    

    setupCustomSearch();
    $('eLine').onchange = autoFillProductByLine;

    // 🔥 PENCARIAN MASTER PRODUK (BARU) 🔥
    if($('mpSearch')) $('mpSearch').oninput = renderMaster; 

    // Kalkulasi Realtime
    const calcIds = ['eCavity', 'eCounter', 'eRunner', 'eCycleTime', 'eCavityStd', 'eJatah', 'eStok', 'eBalokan', 'eQtyDus', 'eQtyBox', 'eQtyDusPlus', 'eIsiDusPlus', 'eSblm1','eSblm2', 'eSblm3', 'eSblm4', 'eSblm5', 'eSblm6', 'eSsdh1', 'eSsdh2', 'eSsdh3', 'eSsdh4', 'eSsdh5', 'eSsdh6', 'rUneven', 'rMottled', 'rStartup', 'rShort', 'rFlow', 'rFlash', 'rCrack', 'rSpot', 'rScratch', 'rDirty'];
    calcIds.forEach(id => { if($(id)) $(id).oninput = recalc; });
    // eEffectiveHours ditangani di setupQuickInputMode (sudah include syncQuickHourChips + recalc)

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
    setupQuickInputMode();
    initLineFocus();

    const sUrl = localStorage.getItem('prod_sb_url');
    const sKey = localStorage.getItem('prod_sb_key');
    if(sUrl && sKey) initSupabase(sUrl, sKey); else $('mConfig').classList.add('open');
});

function checkAdmin(callback) {
    Swal.fire({
        title: '🔒 AREA TERBATAS',
        text: 'Masukkan Security PIN Admin:',
        input: 'password', // 🔥 Fitur ini bikin ketikan jadi titik-titik/bintang
        inputAttributes: {
            autocapitalize: 'off',
            placeholder: 'Masukkan PIN...',
            autocomplete: 'new-password',
            'data-lpignore': 'true',
            'data-form-type': 'other',
            style: 'font-size: 1.5rem; text-align: center; letter-spacing: 4px;' // Biar angka PIN-nya gede & keren
        },
        background: '#0F172A',     // Gelap Mewah
        color: '#6366F1',          // Teks Emas
        confirmButtonText: 'BUKA AKSES',
        confirmButtonColor: '#6366F1',
        showCancelButton: true,
        cancelButtonColor: '#1E293B',
        cancelButtonText: 'Batal',
        
        // Validasi Langsung di Popup
        preConfirm: (inputPin) => {
            if (inputPin === ADMIN_PIN) { // Cek sama variabel global ADMIN_PIN
                return true;
            } else {
                Swal.showValidationMessage(`⛔ AKSES DITOLAK! PIN SALAH.`);
            }
        }
    }).then((result) => {
        if (result.isConfirmed) {
            // Kalau PIN benar, jalankan perintah rahasia (callback)
            callback(); 
            
            // Opsional: Notifikasi kecil kalau berhasil masuk
            const Toast = Swal.mixin({
                toast: true, position: 'top-end', showConfirmButton: false, timer: 2000,
                background: '#10b981', color: '#fff'
            });
            Toast.fire({ icon: 'success', title: 'Admin Mode Unlocked' });
        }
    });
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
        renderTargetBoard();
        
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
        const tg = extractLogTarget(r);
        const meta = statusMeta(tg.status);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${r.tanggal || '-'}</td>
            <td>${r.shift || '-'}</td>
            <td>${r.line || '-'}</td>
            <td><b>${r.nama || '-'}</b><br><small>${r.kode || '-'}</small></td>
            <td>${r.tipe || '-'}</td>
            <td class="right">${(+r.counter || 0).toLocaleString('id-ID')}</td>
            <td class="right">${(+tg.cavityActive || +r.cavity || 0)}</td>
            <td class="right">${tg.effectiveHours || STANDARD_SHIFT_HOURS} jam</td>
            <td class="right">${tg.targetActual ? fmtInt(tg.targetActual) : '-'}</td>
            <td class="right text-ok"><b>${(+r.okpcs || 0).toLocaleString('id-ID')}</b></td>
            <td class="right ${tg.gapActual < 0 ? 'text-danger' : 'text-ok'}"><b>${tg.targetActual ? fmtSigned(tg.gapActual) : '-'}</b></td>
            <td class="right"><b>${tg.targetActual ? fmtPct(tg.achActual) : '-'}</b></td>
            <td><span class="target-pill ${meta.cls}">${meta.icon} ${meta.label}</span></td>
            <td class="right text-danger">${(+r.reject || 0).toLocaleString('id-ID')}</td>
            <td class="right"><b>${(+r.yieldpct || 0).toFixed(2)}%</b></td>
            <td style="text-align:center; white-space:nowrap;">
                <button class="btn sm info" onclick="editLog('${r.id}')">✎</button> 
                <button class="btn sm danger" onclick="deleteLog('${r.id}')">🗑</button>
            </td>
        `;
        t.appendChild(tr);
    });
}

function makeAlertItem(r, opts = {}) {
    const tg = extractLogTarget(r);
    const meta = statusMeta(tg.status);
    const title = `${r.line || '-'} · Shift ${r.shift || '-'} · ${r.kode || ''}`;
    const subtitle = r.nama || '-';
    const reasonParts = [];
    if(r.under_target_reason) reasonParts.push(`Target: ${r.under_target_reason}`);
    if(r.planned_stop_reason) reasonParts.push(`Stop: ${r.planned_stop_reason}`);
    if(r.cavity_adjust_reason) reasonParts.push(`Cavity: ${r.cavity_adjust_reason}`);
    if(!reasonParts.length && r.catatan) reasonParts.push(r.catatan);
    const reason = reasonParts.length ? reasonParts.join(' | ') : '-';
    const capParts = [];
    if(tg.effectiveHours < tg.standardShiftHours) capParts.push(`Jam ${tg.effectiveHours}/${tg.standardShiftHours} (${tg.plannedStopHours} jam stop${tg.stopReason ? ': ' + tg.stopReason : ''})`);
    if(tg.cavityActive < tg.cavityStd) capParts.push(`Cav ${tg.cavityStd} → ${tg.cavityActive}`);
    const lossLine = (opts.showLoss || capParts.length) ? `<div class="alert-item-note">Kapasitas turun: <b>${fmtInt(tg.capacityLossTotal || tg.loss || tg.timeLoss)}</b> pcs${capParts.length ? ' | ' + capParts.join(' | ') : ''}</div>` : '';
    return `
        <div class="alert-item ${meta.cls}">
            <div class="alert-item-main">
                <div>
                    <div class="alert-title"><span class="status-dot-mini ${meta.cls}"></span><span>${title}</span></div>
                    <div class="alert-subtitle">${subtitle}</div>
                    ${lossLine}
                </div>
                <div class="alert-numbers">
                    <span>Target Aktual: <b>${tg.targetActual ? fmtInt(tg.targetActual) : '-'}</b></span>
                    <span>Actual: <b>${fmtInt(tg.okpcs)}</b></span>
                    <span class="${tg.gapActual < 0 ? 'text-danger' : 'text-ok'}">Gap: <b>${tg.targetActual ? fmtSigned(tg.gapActual) : '-'}</b></span>
                    <span>Achv: <b>${tg.targetActual ? fmtPct(tg.achActual) : '-'}</b></span>
                </div>
            </div>
            <div class="alert-footer"><span class="target-pill ${meta.cls}">${meta.label}</span><span>Keterangan: ${reason}</span></div>
        </div>`;
}

/* ═══════════════════════════════════════════════════════════
   LINE FOCUS PANEL — drill-down per mesin
═══════════════════════════════════════════════════════════ */
function initLineFocus() {
    const btnLoad  = $('btnLfLoad');
    const btnReset = $('btnLfReset');
    if (!btnLoad) return;

    // Default: 7 hari terakhir
    const today = new Date();
    const week  = new Date(); week.setDate(today.getDate() - 6);
    if ($('lfFrom')) $('lfFrom').value = week.toISOString().slice(0,10);
    if ($('lfTo'))   $('lfTo').value   = today.toISOString().slice(0,10);

    btnLoad.onclick = renderLineFocus;
    if (btnReset) btnReset.onclick = () => {
        const c = $('lfContent');
        if (c) { c.style.display = 'none'; c.innerHTML = ''; }
        btnReset.style.display = 'none';
        if ($('lfLineInput')) $('lfLineInput').value = '';
    };
    if ($('lfLineInput')) $('lfLineInput').onkeydown = e => { if (e.key === 'Enter') renderLineFocus(); };
}

function renderLineFocus() {
    const lineRaw = ($('lfLineInput')?.value || '').trim();
    if (!lineRaw) { alert('Masukkan nomor line dulu bro!'); return; }
    const lineFilter = lineRaw.toUpperCase();

    const fromVal = $('lfFrom')?.value;
    const toVal   = $('lfTo')?.value;
    if (!fromVal || !toVal) { alert('Pilih rentang tanggal!'); return; }

    const dFrom = new Date(fromVal + 'T00:00:00');
    const dTo   = new Date(toVal   + 'T23:59:59');

    const filtered = logs.filter(r => {
        const lineMatch = (r.line || '').toUpperCase().includes(lineFilter);
        const d = new Date((r.tanggal || '') + 'T12:00:00');
        return lineMatch && d >= dFrom && d <= dTo;
    });

    const content  = $('lfContent');
    const btnReset = $('btnLfReset');
    if (!content) return;

    if (!filtered.length) {
        content.innerHTML = `<div class="lf-empty">Tidak ada data untuk line <b>${lineRaw.toUpperCase()}</b> di periode ini.</div>`;
        content.style.display = 'block';
        if (btnReset) btnReset.style.display = 'inline-flex';
        return;
    }

    // ── Overall summary ──
    const totalOk     = filtered.reduce((s,r) => s + (+r.okpcs  ||0), 0);
    const totalReject = filtered.reduce((s,r) => s + (+r.reject ||0), 0);
    const totalShifts = filtered.length;
    const tgAll       = filtered.map(r => ({ raw:r, tg: extractLogTarget(r) })).filter(x => x.tg.targetActual > 0);
    const badShifts   = tgAll.filter(x => isTargetUnsafe(x.tg.status)).length;
    const capLoss     = tgAll.reduce((s,x) => s + (x.tg.capacityLossTotal||0), 0);
    const yieldAvg    = filtered.length ? filtered.reduce((s,r) => s + (+r.yieldpct||0), 0) / filtered.length : 0;

    // ── Group by produk ──
    const prodMap = {};
    filtered.forEach(r => {
        const key = r.kode || '?';
        if (!prodMap[key]) prodMap[key] = { kode:r.kode, nama:r.nama, rows:[] };
        prodMap[key].rows.push(r);
    });

    const prods = Object.values(prodMap).sort((a,b) => {
        const ra = a.rows.reduce((s,r) => s + (+r.reject||0), 0);
        const rb = b.rows.reduce((s,r) => s + (+r.reject||0), 0);
        return rb - ra;
    });

    const rejectKeys = ['uneven','mottled','startup','short','flow','flashing','crack','spot','scratch','dirty'];

    const prodCards = prods.map(prod => {
        const ok  = prod.rows.reduce((s,r) => s + (+r.okpcs ||0), 0);
        const rej = prod.rows.reduce((s,r) => s + (+r.reject||0), 0);
        const tgR = prod.rows.map(r => ({ raw:r, tg:extractLogTarget(r) })).filter(x => x.tg.targetActual > 0);
        const avgAch  = tgR.length ? tgR.reduce((s,x) => s + x.tg.achActual, 0) / tgR.length : null;
        const gapTot  = tgR.reduce((s,x) => s + x.tg.gapActual, 0);
        const badCnt  = tgR.filter(x => isTargetUnsafe(x.tg.status)).length;

        // Top reject types
        const rejMap = {};
        rejectKeys.forEach(k => {
            const v = prod.rows.reduce((s,r) => s + (+r[`reject_${k}`]||0), 0);
            if (v > 0) rejMap[k] = v;
        });
        const topRej = Object.entries(rejMap).sort((a,b)=>b[1]-a[1]).slice(0,3);

        // Unique issues
        const issues = new Set();
        prod.rows.forEach(r => {
            if (r.planned_stop_reason)  issues.add(`Stop: ${r.planned_stop_reason}`);
            if (r.cavity_adjust_reason) issues.add(`Cavity: ${r.cavity_adjust_reason}`);
            if (r.under_target_reason)  issues.add(`Target: ${r.under_target_reason}`);
        });

        const achColor = avgAch === null ? '#94A3B8'
                       : avgAch >= 100   ? 'var(--success)'
                       : avgAch >= 80    ? 'var(--warning)'
                       : 'var(--danger)';
        const cardCls  = badCnt > 0 ? 'has-issue' : 'ok';

        return `
        <div class="lf-prod-card ${cardCls}">
            <div class="lf-prod-head">
                <div>
                    <div class="lf-prod-kode">${prod.kode || '-'}</div>
                    <div class="lf-prod-nama">${prod.nama || '-'}</div>
                </div>
                <div class="lf-prod-ach" style="color:${achColor}">${avgAch !== null ? avgAch.toFixed(1)+'%' : '-'}</div>
            </div>
            <div class="lf-prod-stats">
                <div class="lf-pstat"><span class="text-ok">${fmtInt(ok)}</span><small>OK</small></div>
                <div class="lf-pstat"><span class="text-danger">${fmtInt(rej)}</span><small>Reject</small></div>
                <div class="lf-pstat"><span class="${gapTot<0?'text-danger':'text-ok'}">${gapTot>=0?'+':''}${fmtInt(gapTot)}</span><small>Gap</small></div>
                <div class="lf-pstat"><span>${prod.rows.length}</span><small>Shift</small></div>
            </div>
            ${topRej.length ? `<div class="lf-reject-pills">${topRej.map(([k,v]) => `<span class="lf-reject-pill">${k.toUpperCase()} <b>${fmtInt(v)}</b></span>`).join('')}</div>` : ''}
            ${issues.size  ? `<div class="lf-issues">${[...issues].slice(0,3).map(i=>`<div class="lf-issue-item">⚠ ${i}</div>`).join('')}</div>` : ''}
        </div>`;
    }).join('');

    content.innerHTML = `
        <div class="lf-summary">
            <div class="lf-summary-title">Line <b>${lineRaw.toUpperCase()}</b> · ${fromVal} s/d ${toVal} · ${prods.length} produk, ${totalShifts} shift</div>
            <div class="lf-summary-kpis">
                <div class="lf-skpi"><span class="lf-skpi-v">${fmtInt(totalOk)}</span><span class="lf-skpi-l">Total OK</span></div>
                <div class="lf-skpi danger"><span class="lf-skpi-v">${fmtInt(totalReject)}</span><span class="lf-skpi-l">Total Reject</span></div>
                <div class="lf-skpi warning"><span class="lf-skpi-v">${badShifts}/${totalShifts}</span><span class="lf-skpi-l">Shift Tidak Target</span></div>
                <div class="lf-skpi"><span class="lf-skpi-v">${fmtInt(capLoss)}</span><span class="lf-skpi-l">Loss Capacity</span></div>
                <div class="lf-skpi"><span class="lf-skpi-v">${yieldAvg.toFixed(1)}%</span><span class="lf-skpi-l">Avg Yield</span></div>
            </div>
        </div>
        <div class="lf-prod-grid">${prodCards}</div>
    `;
    content.style.display = 'block';
    if (btnReset) btnReset.style.display = 'inline-flex';

    // Smooth scroll ke panel
    $('lineFocusPanel')?.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function renderTargetBoard() {
    if(!$('targetControlBoard')) return;
    const sync = $('targetBoardSync');
    if(!logs.length) {
        if(sync) sync.innerText = 'Belum ada data';
        ['latestShiftAlerts','yesterdayAlerts','cavityLossAlerts'].forEach(id => { if($(id)) $(id).innerHTML = 'Belum ada data produksi.'; });
        return;
    }

    const boardLogs = uniqueDashboardLogs(logs);

    const sorted = [...boardLogs].sort((a,b) => {
        const da = `${a.tanggal || ''}-${String(a.shift || '').padStart(2,'0')}`;
        const db = `${b.tanggal || ''}-${String(b.shift || '').padStart(2,'0')}`;
        return db.localeCompare(da);
    });

    const latest = sorted[0];
    const latestDate = latest.tanggal;
    const latestShift = latest.shift;
    const latestShiftLogs = sorted.filter(r => r.tanggal === latestDate && r.shift == latestShift);
    const latestBad = latestShiftLogs.filter(r => {
        const tg = extractLogTarget(r);
        return tg.targetActual > 0 && isTargetUnsafe(tg.status);
    }).sort((a,b) => extractLogTarget(a).gapActual - extractLogTarget(b).gapActual);
    const latestOk = latestShiftLogs.filter(r => {
        const tg = extractLogTarget(r);
        return tg.targetActual > 0 && !isTargetUnsafe(tg.status);
    }).length;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = ymd(yesterday);
    let dayLogs = sorted.filter(r => r.tanggal === yesterdayStr);
    let dayLabel = yesterdayStr;
    if(!dayLogs.length) {
        dayLabel = latestDate;
        dayLogs = sorted.filter(r => r.tanggal === latestDate);
    }
    const dayBad = dayLogs.filter(r => {
        const tg = extractLogTarget(r);
        return tg.targetActual > 0 && isTargetUnsafe(tg.status);
    }).sort((a,b) => extractLogTarget(a).gapActual - extractLogTarget(b).gapActual);

    const last7 = new Date();
    last7.setDate(last7.getDate() - 7);
    const capacityLoss = sorted.filter(r => {
        const d = new Date((r.tanggal || '') + 'T12:00:00');
        const tg = extractLogTarget(r);
        return d >= last7 && tg.capacityLossTotal > 0;
    }).sort((a,b) => extractLogTarget(b).capacityLossTotal - extractLogTarget(a).capacityLossTotal);

    if($('alertKpiBad')) $('alertKpiBad').innerText = latestBad.length;
    if($('alertKpiLoss')) $('alertKpiLoss').innerText = fmtInt(capacityLoss.reduce((sum, r) => sum + extractLogTarget(r).capacityLossTotal, 0));
    if($('alertKpiOk')) $('alertKpiOk').innerText = latestOk;
    if($('alertKpiShift')) $('alertKpiShift').innerText = `${latestDate || '-'} S${latestShift || '-'}`;
    if(sync) sync.innerText = `${logs.length} data tersinkron`;
    if($('targetBoardSubtitle')) $('targetBoardSubtitle').innerText = `Data terbaru: ${latestDate || '-'} shift ${latestShift || '-'} | Hari pembanding: ${dayLabel}`;

    if($('latestShiftAlerts')) {
        $('latestShiftAlerts').innerHTML = latestBad.length
            ? latestBad.map(r => makeAlertItem(r)).join('')
            : `<div class="alert-empty">Shift terakhir aman terhadap target aktual.</div>`;
    }

    if($('yesterdayAlerts')) {
        $('yesterdayAlerts').innerHTML = dayBad.length
            ? dayBad.slice(0,30).map(r => makeAlertItem(r)).join('')
            : `<div class="alert-empty">✅ Tidak ada produk tidak target pada ${dayLabel} berdasarkan data yang tersimpan.</div>`;
    }

    if($('cavityLossAlerts')) {
        $('cavityLossAlerts').innerHTML = capacityLoss.length
            ? capacityLoss.slice(0,30).map(r => makeAlertItem(r, { showLoss:true })).join('')
            : `<div class="alert-empty">Tidak ada catatan kapasitas turun dalam 7 hari terakhir.</div>`;
    }
}

// === ENTRY ===
function resetEntryForm() {
    const fields = ['eLine', 'eProduk', 'eGram', 'eRunner', 'eCavityStd', 'eCycleTime', 'eTargetShotHour', 'eTargetStandard', 'eCavity', 'eCounter', 'eJatah', 'eStok', 'eBalokan', 'eSisaBahan', 'eSblm1', 'eSblm2', 'eSblm3', 'eSblm4', 'eSblm5', 'eSblm6', 'eSsdh1', 'eSsdh2', 'eSsdh3', 'eSsdh4', 'eSsdh5', 'eSsdh6', 'eQtyDus', 'eIsiDus', 'eQtyBox', 'eIsiBox', 'eQtyDusPlus', 'eIsiDusPlus', 'eCavityReason', 'eTargetReason', 'eEffectiveHours', 'eStopReason', 'rUneven', 'rMottled', 'rStartup', 'rShort', 'rFlow', 'rFlash', 'rCrack', 'rSpot', 'rScratch', 'rDirty', 'rTotal', 'rMax'];
    fields.forEach(id => { if($(id)) $(id).value = ''; });
    $('eId').value = '';
    ['vHasil', 'vOkPcs', 'vRejectPcs', 'vYield', 'vOkKg', 'vRejectKg', 'vRunnerKg', 'vSisaBahanLabel', 'vTargetStd', 'vTargetActual', 'vGapActual', 'vAchActual', 'vAchStd', 'vCapacityLoss', 'vTargetHourActual'].forEach(id => { if($(id)) $(id).innerText = id.includes('Yield') || id.includes('Ach') ? '0%' : '0'; });
    if($('eEffectiveHours')) $('eEffectiveHours').value = STANDARD_SHIFT_HOURS;
    if($('vShiftHours')) $('vShiftHours').innerText = STANDARD_SHIFT_HOURS;
    if($('vTargetStatus')) { $('vTargetStatus').innerText = 'Target belum aktif'; $('vTargetStatus').className = 'target-pill neutral'; }
    $('badgeTipe').innerText='';
    $('warnOver').style.display='none';
    if($('cavityReasonBox')) $('cavityReasonBox').style.display='none';
    if($('targetReasonBox')) $('targetReasonBox').style.display='none';
    if($('stopReasonBox')) $('stopReasonBox').style.display='none';
    syncQuickHourChips();
    openEntryRequiredAccordions();
}


function autoFillProductByLine() {
    const ln = $('eLine').value.trim(); if(!ln || !logs.length) return;
    const last = [...logs].sort((a,b)=>new Date(b.tanggal)-new Date(a.tanggal)).find(r=>r.line==ln);
    if(last) { $('eProduk').value = last.kode + " - " + last.nama; hydrateProduk(); }
}

function setupCustomSearch() {
    const inp = $('eProduk'), lst = $('produkSuggestions');
    inp.oninput = function() { const v = this.value.toLowerCase(); if(!v) { lst.style.display='none'; return; } const m = master.filter(p=>p.kode.toLowerCase().includes(v)||p.nama.toLowerCase().includes(v)); lst.innerHTML = m.length ? m.map(p=>{ const val = (p.kode + ' - ' + p.nama).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); return `<div class="search-item" onclick="selectProduk('${val}')"><span>${p.kode}</span> - ${p.nama}</div>`; }).join('') : ''; lst.style.display = m.length?'block':'none'; };
    document.addEventListener('click', e=>{ if(e.target!==inp && e.target!==lst) lst.style.display='none'; });
}

window.selectProduk = v => { $('eProduk').value=v; $('produkSuggestions').style.display='none'; hydrateProduk(); setTimeout(() => { if($('eCounter')) { try { $('eCounter').focus({ preventScroll:false }); $('eCounter').select(); } catch(e) {} } }, 80); };

function hydrateProduk(){
    const val = $('eProduk').value, p = master.find(x=>(x.kode+" - "+x.nama)===val);
    if(p) {
        const cycleTime = getProductCycleTime(p);
        const stdCav = getProductStdCavity(p);
        const shotHour = getTargetShotHour(cycleTime);
        $('eGram').value = p.gram || 0;
        $('eRunner').value = p.runner || 0;
        if($('eCavityStd')) $('eCavityStd').value = stdCav;
        if($('eCycleTime')) $('eCycleTime').value = cycleTime || '';
        if($('eTargetShotHour')) $('eTargetShotHour').value = shotHour || '';
        if($('eTargetStandard')) $('eTargetStandard').value = shotHour ? (shotHour * stdCav * STANDARD_SHIFT_HOURS) : '';
        $('eCavity').value = stdCav;
        $('eIsiDus').value = p.per_dus;
        $('eIsiBox').value = p.per_box;
        $('badgeTipe').innerText=(p.tipe==='kg_sisa')?'Mode KG':'Mode PCS';
        recalc();
    }
}

function sum(ids){ return ids.map(id=>toNum($(id).value)).reduce((a,b)=>a+b,0); }

// --- LOGIKA PERHITUNGAN (TARGET CONTROL) ---
function compute(){
    const prodNameFull=$('eProduk').value, prod=master.find(p=>(p.kode+" - "+p.nama)===prodNameFull);
    const gram=toNum($('eGram').value), tipe=$('badgeTipe').innerText.includes('KG')?'kg_sisa':'pcs';
    const stdCav = prod ? getProductStdCavity(prod) : Math.max(1, toNum($('eCavityStd')?.value));
    const cycleTimeSec = prod ? getProductCycleTime(prod) : toNum($('eCycleTime')?.value);
    const cav=Math.max(1, toNum($('eCavity').value));
    const counter=toNum($('eCounter').value);
    const activeCav = Math.min(cav, stdCav || cav);
    
    let sblm=sum(['eSblm1','eSblm2','eSblm3','eSblm4','eSblm5','eSblm6']), ssdh=sum(['eSsdh1','eSsdh2','eSsdh3','eSsdh4','eSsdh5','eSsdh6']);
    let sblm_pcs=sblm, ssdh_pcs=ssdh; if(tipe==='kg_sisa'){ const c=gram>0?(1000/gram):0; sblm_pcs=sblm*c; ssdh_pcs=ssdh*c; }
    
    const qD=toNum($('eQtyDus').value), iD=toNum($('eIsiDus').value), qB=toNum($('eQtyBox').value), iB=toNum($('eIsiBox').value), qDp=toNum($('eQtyDusPlus').value), iDp=toNum($('eIsiDusPlus').value);
    const packpcs=(qD*iD)+(qB*iB)+(qDp*iDp), okpcs=packpcs-sblm_pcs+ssdh_pcs, produksi=counter*activeCav, hasil=produksi+sblm_pcs-ssdh_pcs, rejectpcs=produksi-okpcs;
    
    const okkg=(okpcs*gram)/1000, rejectkg=(rejectpcs*gram)/1000, runnerkg=(counter*toNum($('eRunner').value))/1000;
    const jatah=toNum($('eJatah').value), stok=toNum($('eStok').value), balok=toNum($('eBalokan').value);
    const sisaBahan=(jatah+stok)-(runnerkg+rejectkg+okkg+balok), yieldpct=hasil>0?(okpcs/hasil)*100:0, overpack=packpcs>hasil;
    
    const targetShotHour = getTargetShotHour(cycleTimeSec);
    const targetHourStandard = targetShotHour * stdCav;
    const targetHourActual = targetShotHour * activeCav;
    const effectiveHours = getSelectedEffectiveHours();
    const plannedStopHours = Math.max(0, STANDARD_SHIFT_HOURS - effectiveHours);
    const targetStandardPcs = targetHourStandard * STANDARD_SHIFT_HOURS;
    const targetActualPcs = targetHourActual * effectiveHours;
    const achievementStandardPct = targetStandardPcs > 0 ? (okpcs / targetStandardPcs) * 100 : 0;
    const achievementActualPct = targetActualPcs > 0 ? (okpcs / targetActualPcs) * 100 : 0;
    const gapStandardPcs = targetStandardPcs > 0 ? okpcs - targetStandardPcs : 0;
    const gapActualPcs = targetActualPcs > 0 ? okpcs - targetActualPcs : 0;
    const timeLossPcs = Math.max(0, targetHourStandard * plannedStopHours);
    const cavityLossPcs = Math.max(0, targetShotHour * Math.max(0, stdCav - activeCav) * effectiveHours);
    const capacityLossTotalPcs = Math.max(0, targetStandardPcs - targetActualPcs);
    const targetStatus = makeTargetStatus(okpcs, targetStandardPcs, targetActualPcs);
    
    const rIds=['rUneven','rMottled','rStartup','rShort','rFlow','rFlash','rCrack','rSpot','rScratch','rDirty'];
    const rValues = rIds.map(i=>toNum($(i).value));
    
    return { 
        prod, tipe, gram, cav: activeCav, stdCav, cycleTimeSec, targetShotHour, targetHourStandard, targetHourActual,
        standardShiftHours: STANDARD_SHIFT_HOURS, effectiveHours, plannedStopHours, targetStandardPcs, targetActualPcs, achievementStandardPct, achievementActualPct, gapStandardPcs, gapActualPcs, timeLossPcs, cavityLossPcs, capacityLossTotalPcs, targetStatus,
        counter, sblm_pcs, ssdh_pcs, hasil, okpcs, okkg, 
        rejectpcs, rejectkg, runnerkg, yieldpct, sisaBahan, overpack, packpcs, 
        rtotal:sum(rIds), rmax:Math.max(...rValues), 
        details:{ sblm:[1,2,3,4,5,6].map(i=>toNum($('eSblm'+i).value)), ssdh:[1,2,3,4,5,6].map(i=>toNum($('eSsdh'+i).value)) } 
    };
}

function recalc(){
    const p=compute();
    $('vHasil').innerText=p.hasil.toFixed(0); $('vOkPcs').innerText=p.okpcs.toFixed(0); $('vRejectPcs').innerText=p.rejectpcs.toFixed(0);
    $('vYield').innerText=p.yieldpct.toFixed(2)+'%'; $('vOkKg').innerText=p.okkg.toFixed(2); $('vRejectKg').innerText=p.rejectkg.toFixed(2);
    $('vRunnerKg').innerText=p.runnerkg.toFixed(2); $('vSisaBahanLabel').innerText=p.sisaBahan.toFixed(2); if($('vBalokan')) $('vBalokan').innerText=toNum($('eBalokan').value).toFixed(2); $('eSisaBahan').value=p.sisaBahan.toFixed(2);
    
    if($('eTargetShotHour')) $('eTargetShotHour').value = p.targetShotHour || '';
    if($('eTargetStandard')) $('eTargetStandard').value = p.targetStandardPcs ? Math.round(p.targetStandardPcs) : '';
    if($('vTargetStd')) $('vTargetStd').innerText = p.targetStandardPcs ? fmtInt(p.targetStandardPcs) : '0';
    if($('vTargetActual')) $('vTargetActual').innerText = p.targetActualPcs ? fmtInt(p.targetActualPcs) : '0';
    if($('vGapActual')) {
        $('vGapActual').innerText = p.targetActualPcs ? fmtSigned(p.gapActualPcs) : '0';
        $('vGapActual').className = 'stat-value ' + (p.gapActualPcs < 0 ? 'text-danger' : 'text-ok');
    }
    if($('vAchActual')) $('vAchActual').innerText = p.targetActualPcs ? fmtPct(p.achievementActualPct) : '0%';
    if($('vAchStd')) $('vAchStd').innerText = p.targetStandardPcs ? fmtPct(p.achievementStandardPct) : '0%';
    if($('vCapacityLoss')) $('vCapacityLoss').innerText = p.capacityLossTotalPcs ? fmtInt(p.capacityLossTotalPcs) : '0';
    if($('vTargetHourActual')) $('vTargetHourActual').innerText = p.targetHourActual ? fmtInt(p.targetHourActual) : '0';
    if($('vShiftHours')) $('vShiftHours').innerText = p.effectiveHours;
    if($('vTargetStatus')) {
        const meta = statusMeta(p.targetStatus);
        $('vTargetStatus').innerText = `${meta.icon} ${meta.label}`;
        $('vTargetStatus').className = `target-pill ${meta.cls}`;
    }
    if($('vTargetHelper')) {
        let helper = 'Angka target dihitung otomatis. Detailnya bisa dilihat di dashboard dan data harian.';
        if(p.targetStatus === 'TIDAK_TARGET') helper = 'Hasil produksi tidak dapat target. Isi alasan sebelum simpan.';
        else if(p.targetStatus === 'HAMPIR_TIDAK_TARGET') helper = 'Hasil masih di bawah toleransi 3%. Isi alasan supaya penyebabnya jelas.';
        else if(p.targetStatus === 'TERCAPAI_AKTUAL_LOSS_CAPACITY') helper = 'Target aktual aman dalam toleransi, tapi kapasitas standar turun. Pastikan alasan stop mesin atau cavity diisi agar manajemen paham.';
        else if(p.targetStatus === 'TARGET_STANDARD_TERCAPAI') helper = 'Target shift aman dalam toleransi 3%.';
        $('vTargetHelper').innerText = helper;
    }
    if($('cavityReasonBox')) $('cavityReasonBox').style.display = (p.targetStandardPcs > 0 && p.cav < p.stdCav) ? 'block' : 'none';
    if($('stopReasonBox')) $('stopReasonBox').style.display = (p.plannedStopHours > 0) ? 'block' : 'none';
    if($('targetReasonBox')) $('targetReasonBox').style.display = isTargetUnsafe(p.targetStatus) ? 'block' : 'none';
    
    // Isi nilai rTotal dan rMax agar tidak kosong saat simpan
    $('rTotal').value = p.rtotal; 
    $('rMax').value = p.rmax; 
    $('warnOver').style.display=p.overpack?'block':'none';
    syncQuickHourChips();
}


async function saveEntry() {
    openEntryRequiredAccordions();
    if(!client) return Swal.fire({icon:'error', title:'Error', text:'Database Belum Konek!', background:'#0F172A', color:'#F8FAFC'}); 
    
    const p = compute(); 
    
    if(!p.prod) {
        Swal.fire({
            icon: 'warning',
            title: 'Belum Lengkap',
            text: 'Pilih produk yang valid dulu ya sayang!',
            background: '#0F172A',
            color: '#F8FAFC',
            confirmButtonColor: '#6366F1',
            confirmButtonText: 'Oke Siap'
        });
        return;
    }

    if(p.cav > p.stdCav) {
        Swal.fire({ icon:'warning', title:'Cavity Tidak Valid', text:'Cavity aktif tidak boleh lebih besar dari cavity standard master produk.', background:'#0F172A', color:'#F8FAFC', confirmButtonColor:'#6366F1' });
        return;
    }

    if(p.cav < p.stdCav && !$('eCavityReason').value) {
        Swal.fire({ icon:'warning', title:'Alasan Cavity Wajib', text:'Cavity aktif lebih kecil dari standard. Pilih alasan cavity turun dulu.', background:'#0F172A', color:'#F8FAFC', confirmButtonColor:'#6366F1' });
        return;
    }

    if(p.plannedStopHours > 0 && !$('eStopReason').value) {
        Swal.fire({ icon:'warning', title:'Alasan Stop Mesin Wajib', text:'Jam efektif kurang dari 8 jam. Pilih salah satu alasan stop supaya manajemen tahu kapasitas turun karena apa.', background:'#0F172A', color:'#F8FAFC', confirmButtonColor:'#6366F1' });
        return;
    }

    if(isTargetUnsafe(p.targetStatus) && !$('eTargetReason').value) {
        Swal.fire({ icon:'warning', title:'Alasan Target Wajib', text:'Actual OK belum masuk zona aman toleransi 3%. Isi alasan supaya mandor dan manager langsung tahu penyebabnya.', background:'#0F172A', color:'#F8FAFC', confirmButtonColor:'#6366F1' });
        return;
    }

    if(!p.cycleTimeSec || p.cycleTimeSec <= 0) {
        const confirmNoTarget = await Swal.fire({
            icon:'warning',
            title:'Cycle Time Master Kosong',
            text:'Data tetap bisa disimpan, tapi Target Alert tidak bisa menghitung target produk ini. Lanjut simpan?',
            showCancelButton:true,
            confirmButtonText:'Lanjut Simpan',
            cancelButtonText:'Batal',
            background:'#0F172A',
            color:'#F8FAFC',
            confirmButtonColor:'#6366F1',
            cancelButtonColor:'#1E293B'
        });
        if(!confirmNoTarget.isConfirmed) return;
    }

    $('loading').style.display = 'flex';
    
    const payload = {
        id: $('eId').value || uid(),
        tanggal: $('eTanggal').value,
        shift: $('eShift').value,
        line: $('eLine').value.toUpperCase(),
        kode: p.prod.kode,
        nama: p.prod.nama,
        tipe: p.tipe,
        gram: p.gram,
        runner: p.prod?.runner ?? 0,
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
        catatan: '',
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
        detail_sisa: JSON.stringify(p.details),

        // Target Control Snapshot
        cycle_time_sec_snapshot: p.cycleTimeSec,
        shift_hours: p.effectiveHours,
        standard_shift_hours: p.standardShiftHours,
        effective_hours: p.effectiveHours,
        planned_stop_hours: p.plannedStopHours,
        planned_stop_reason: $('eStopReason') ? $('eStopReason').value : '',
        planned_stop_note: '',
        cavity_standard_snapshot: p.stdCav,
        cavity_active: p.cav,
        target_shot_hour: p.targetShotHour,
        target_hour_standard: p.targetHourStandard,
        target_hour_actual: p.targetHourActual,
        target_standard_pcs: p.targetStandardPcs,
        target_actual_pcs: p.targetActualPcs,
        achievement_standard_pct: p.achievementStandardPct,
        achievement_actual_pct: p.achievementActualPct,
        gap_standard_pcs: p.gapStandardPcs,
        gap_actual_pcs: p.gapActualPcs,
        target_status: p.targetStatus,
        time_loss_pcs: p.timeLossPcs,
        cavity_loss_pcs: p.cavityLossPcs,
        capacity_loss_total_pcs: p.capacityLossTotalPcs,
        cavity_adjust_reason: $('eCavityReason') ? $('eCavityReason').value : '',
        cavity_note: '',
        under_target_reason: $('eTargetReason') ? $('eTargetReason').value : ''
    };

    const { error } = await client.from('logs').upsert(payload);
    
    $('loading').style.display = 'none'; 

    if(error) {
        let msg = error.message;
        if(msg && msg.toLowerCase().includes('column')) {
            msg += '\n\nKemungkinan database Supabase belum ditambah kolom target. Jalankan file supabase_target_migration.sql dulu ya.';
        }
        Swal.fire({
            icon: 'error',
            title: 'Gagal Simpan',
            text: msg,
            background: '#0F172A',
            color: '#F8FAFC',
            confirmButtonColor: '#ef4444'
        });
    } else { 
        const meta = statusMeta(p.targetStatus);
        blurActiveElementSafely();

        // Penting: tunggu popup sukses selesai dulu.
        // Kalau tidak, SweetAlert/Chrome akan mengembalikan focus ke tombol SIMPAN di bawah
        // dan modal terlihat naik sebentar lalu turun lagi.
        await Swal.fire({
            icon: isTargetUnsafe(p.targetStatus) ? 'warning' : 'success',
            title: isTargetUnsafe(p.targetStatus) ? 'Tersimpan, tapi Target Belum Aman' : 'Berhasil!',
            html: `<div style="text-align:center;line-height:1.7">${meta.icon} <b>${meta.label}</b><br><span style="color:#94A3B8">Detail angka target tersimpan di dashboard dan data harian.</span></div>`,
            background: '#0F172A', 
            color: '#F8FAFC',      
            iconColor: isTargetUnsafe(p.targetStatus) ? '#FBBF24' : '#6366F1',  
            confirmButtonColor: '#6366F1', 
            confirmButtonText: 'Mantap',
            timer: 2600,           
            timerProgressBar: true,
            returnFocus: false
        });

        resetEntryForm();
        blurActiveElementSafely();
        refreshData(false);

        requestAnimationFrame(() => {
            scrollEntryFormToTop('auto');
            const firstField = $('eTanggal') || $('eLine');
            if(firstField && typeof firstField.focus === 'function') {
                try { firstField.focus({ preventScroll: true }); } catch(e) {}
            }
        });
        setTimeout(() => scrollEntryFormToTop('auto'), 80);
        setTimeout(() => scrollEntryFormToTop('auto'), 320);
    }
}

async function saveMaster() {
    if(!client) return alert("DB Error"); 
    const k=$('mpKode').value.trim(), n=$('mpNama').value.trim(); 
    if(!k) return alert("Kode wajib");
    let tID=uid(), ex=master.find(m=>m.kode.toLowerCase()===k.toLowerCase()&&m.nama.toLowerCase()===n.toLowerCase());
    if(ex && !confirm("Update Produk?")) return; 
    if(ex) tID=ex.id;
    $('loading').style.display='flex';
    const { error } = await client.from('master').upsert({ 
        id: tID, 
        kode: k, 
        nama: n, 
        tipe: $('mpTipe').value, 
        gram: toNum($('mpGram').value), 
        runner: toNum($('mpRunner').value), 
        cavity: toNum($('mpCavity').value), 
        cycle_time_sec: toNum($('mpCycleTime').value),
        per_dus: toNum($('mpPerDus').value), 
        per_box: toNum($('mpPerBox').value) 
    });
    $('loading').style.display='none';
    if(error) {
        let msg = error.message;
        if(msg && msg.toLowerCase().includes('column')) msg += '\n\nKolom cycle_time_sec belum ada di tabel master. Jalankan file supabase_target_migration.sql dulu.';
        return Swal.fire({ icon:'error', title:'Gagal Simpan Master', text:msg, background:'#0F172A', color:'#F8FAFC' });
    }
    refreshData(false); 
    ['mpKode','mpNama','mpGram','mpRunner','mpCavity','mpCycleTime','mpPerDus','mpPerBox'].forEach(i=>{ if($(i)) $(i).value=''; });
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
        background: '#0F172A',
        color: '#F8FAFC',
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#1E293B',
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
                    background: '#0F172A',
                    color: '#F8FAFC'
                });
            } else {
                // Kalau Sukses Baru Muncul Ini
                Swal.fire({
                    title: 'Terhapus!',
                    icon: 'success',
                    background: '#0F172A',
                    color: '#F8FAFC',
                    confirmButtonColor: '#6366F1',
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
        background: '#0F172A',
        color: '#F8FAFC',
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#1E293B',
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
                    background: '#0F172A',
                    color: '#F8FAFC'
                });
            } else {
                Swal.fire({
                    title: 'Produk Dihapus!',
                    icon: 'success',
                    background: '#0F172A',
                    color: '#F8FAFC',
                    confirmButtonColor: '#6366F1',
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
        background: '#0F172A',
        color: '#F8FAFC',
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#1E293B',
        confirmButtonText: 'YA, BERSIHKAN!'
    }).then(async (result) => {
        if (result.isConfirmed) {
            $('loading').style.display = 'flex';
            const { error } = await client.from('logs').delete().neq('id', '0');
            $('loading').style.display = 'none';
            
            if (error) {
                Swal.fire({ icon: 'error', title: 'Error', text: error.message, background:'#0F172A', color:'#F8FAFC' });
            } else {
                Swal.fire({ title: 'Bersih!', icon: 'success', background:'#0F172A', color:'#F8FAFC', confirmButtonColor:'#6366F1' });
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
        background: '#0F172A',
        color: '#F8FAFC',
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#1E293B',
        confirmButtonText: 'YA, HAPUS!'
    }).then(async (result) => {
        if (result.isConfirmed) {
            $('loading').style.display = 'flex';
            const { error } = await client.from('master').delete().neq('id', '0');
            $('loading').style.display = 'none';
            
            if (error) {
                Swal.fire({ icon: 'error', title: 'Error', text: error.message, background:'#0F172A', color:'#F8FAFC' });
            } else {
                Swal.fire({ title: 'Bersih!', icon: 'success', background:'#0F172A', color:'#F8FAFC', confirmButtonColor:'#6366F1' });
                refreshData(false);
            }
        }
    });
}

window.editLog=(id)=>{
    const r=logs.find(x=>x.id===id); if(!r) return;
    $('eId').value=r.id; $('eTanggal').value=r.tanggal; $('eShift').value=r.shift; $('eLine').value=r.line; $('eProduk').value=r.kode+" - "+r.nama; hydrateProduk();
    $('eCounter').value=r.counter; 
    if($('eCavityStd')) $('eCavityStd').value = r.cavity_standard_snapshot || r.cavity_standard || $('eCavityStd').value;
    if($('eCycleTime')) $('eCycleTime').value = r.cycle_time_sec_snapshot || $('eCycleTime').value;
    $('eCavity').value = r.cavity_active || r.cavity;
    if($('eCavityReason')) $('eCavityReason').value = r.cavity_adjust_reason || '';
    if($('eTargetReason')) $('eTargetReason').value = r.under_target_reason || '';
    if($('eEffectiveHours')) $('eEffectiveHours').value = r.effective_hours || r.shift_hours || STANDARD_SHIFT_HOURS;
    if($('eStopReason')) $('eStopReason').value = r.planned_stop_reason || '';
    $('eQtyDus').value=r.qty_dus||''; $('eIsiDus').value=r.isi_dus||''; $('eQtyBox').value=r.qty_box||''; $('eIsiBox').value=r.isi_box||''; $('eQtyDusPlus').value=r.qty_dus_plus||''; $('eIsiDusPlus').value=r.isi_dus_plus||'';
    $('rUneven').value=r.reject_uneven||''; $('rMottled').value=r.reject_mottled||''; $('rStartup').value=r.reject_startup||''; $('rShort').value=r.reject_short||''; $('rFlow').value=r.reject_flow||''; $('rFlash').value=r.reject_flashing||''; $('rCrack').value=r.reject_crack||''; $('rSpot').value=r.reject_spot||''; $('rScratch').value=r.reject_scratch||''; $('rDirty').value=r.reject_dirty||'';
    if(r.detail_sisa){ const d=(typeof r.detail_sisa==='string')?JSON.parse(r.detail_sisa):r.detail_sisa; if(d.sblm)d.sblm.forEach((v,i)=>{if($('eSblm'+(i+1)))$('eSblm'+(i+1)).value=v===0?'':v}); if(d.ssdh)d.ssdh.forEach((v,i)=>{if($('eSsdh'+(i+1)))$('eSsdh'+(i+1)).value=v===0?'':v}); }
    recalc(); $('mEntry').classList.add('open'); $('vLaporan').classList.remove('open');
};

// --- FUNGSI RENDER MASTER (SUDAH DIUPGRADE PENCARIAN & ID-BASED) ---
function renderMaster(){
    const t = $('mpBody'); 
    if(!t) return;
    t.innerHTML = '';

    const q = $('mpSearch') ? $('mpSearch').value.toLowerCase() : '';

    const filteredMaster = master.filter(p => 
        (p.kode || '').toLowerCase().includes(q) || 
        (p.nama || '').toLowerCase().includes(q)
    );

    t.innerHTML = filteredMaster.map(p => {
        const ct = getProductCycleTime(p);
        const cav = getProductStdCavity(p);
        const targetHour = getTargetShotHour(ct) * cav;
        return `
        <tr>
            <td>${p.kode}</td>
            <td>${p.nama}</td>
            <td>${p.tipe}</td>
            <td class="right">${p.gram}</td>
            <td class="right">${p.runner}</td>
            <td class="right">${p.cavity}</td>
            <td class="right">${ct || '-'}</td>
            <td class="right">${targetHour ? fmtInt(targetHour) : '-'}</td>
            <td class="right">${p.per_dus}</td>
            <td style="text-align:center">
                <button class="btn sm" onclick="editMaster('${p.id}')">✎</button> 
                <button class="btn sm danger" onclick="deleteMaster('${p.id}')">🗑</button>
            </td>
        </tr>`;
    }).join('');
}

// Fungsi Edit Master yang LEBIH AMAN (Pakai ID)
window.editMaster = (id) => {
    const p = master.find(x => x.id === id); 
    if(!p) return;

    $('mpKode').value = p.kode; 
    $('mpNama').value = p.nama; 
    $('mpTipe').value = p.tipe; 
    $('mpGram').value = p.gram; 
    $('mpRunner').value = p.runner; 
    $('mpCavity').value = p.cavity; 
    if($('mpCycleTime')) $('mpCycleTime').value = getProductCycleTime(p) || '';
    $('mpPerDus').value = p.per_dus; 
    $('mpPerBox').value = p.per_box;
    
    if($('mMaster').scrollTo) $('mMaster').scrollTo({ top: 0, behavior: 'smooth' });
}

function fetchAndShowRekap(){ 
    if($('fFrom').value) $('rDateFrom').value = $('fFrom').value;
    if($('fTo').value) $('rDateTo').value = $('fTo').value;
    processRekapFilter(); 
    $('mRekap').classList.add('open'); 
}

function processRekapFilter() {
    const rf = new Date($('rDateFrom').value + 'T00:00:00');
    const rt = new Date($('rDateTo').value + 'T23:59:59');
    _rekapLogs = logs.filter(r => { const d = new Date(r.tanggal + 'T12:00:00'); return d >= rf && d <= rt; });
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


function setupExcelNavigation() {
    const inputs = document.querySelectorAll('#mEntry input:not([type="hidden"]), #mEntry select:not(.fast-hidden-select), #mEntry textarea');
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
