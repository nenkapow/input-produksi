/* DASHBOARD MONITORING ROOM - ENTERPRISE EDITION v2.5.5 */

let chartTrendInstance = null;
let chartParetoInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    const btnDash = document.getElementById('btnDashboard');
    const closeDash = document.getElementById('pDashboardClose');
    const loadDash = document.getElementById('btnLoadDash');

    if(btnDash) {
        btnDash.onclick = () => {
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - 7); // Default 7 hari terakhir
            document.getElementById('dFrom').value = start.toISOString().slice(0,10);
            document.getElementById('dTo').value = end.toISOString().slice(0,10);
            document.getElementById('pDashboard').classList.add('open');
            renderDashboard();
        };
    }
    
    if(closeDash) closeDash.onclick = () => document.getElementById('pDashboard').classList.remove('open');
    if(loadDash) loadDash.onclick = renderDashboard;
});

function renderDashboard() {
    // Cek data global dari app.js
    if(typeof logs === 'undefined' || logs.length === 0) {
        alert("Data belum siap atau kosong. Refresh halaman utama dulu.");
        return;
    }

    const startStr = document.getElementById('dFrom').value;
    const endStr = document.getElementById('dTo').value;
    const lineFilter = document.getElementById('dLine').value.trim().toUpperCase();
    
    const dStart = new Date(startStr);
    const dEnd = new Date(endStr);

    // 1. FILTER DATA
    const dataDash = logs.filter(r => {
        const d = new Date(r.tanggal);
        const dateOk = d >= dStart && d <= dEnd;
        const lineOk = lineFilter ? r.line.toUpperCase().includes(lineFilter) : true;
        return dateOk && lineOk;
    });

    if(dataDash.length === 0) {
        alert("Tidak ada data produksi di periode/filter ini.");
        return;
    }

    // 2. HITUNG KPI CARD
    let totalHasil=0, totalOk=0, totalReject=0, sumYield=0;
    dataDash.forEach(r => {
        totalHasil += (+r.hasil); 
        totalOk += (+r.okpcs); 
        totalReject += (+r.reject); 
        sumYield += (+r.yieldpct);
    });
    
    document.getElementById('kpiHasil').innerText = totalHasil.toLocaleString();
    document.getElementById('kpiOk').innerText = totalOk.toLocaleString();
    document.getElementById('kpiReject').innerText = totalReject.toLocaleString();
    document.getElementById('kpiYield').innerText = (dataDash.length ? (sumYield / dataDash.length) : 0).toFixed(2) + "%";

    // 3. CHART 1: TREND PRODUKSI
    const trendMap = {};
    dataDash.forEach(r => {
        if(!trendMap[r.tanggal]) trendMap[r.tanggal] = { ok:0, rej:0 };
        trendMap[r.tanggal].ok += (+r.okpcs); 
        trendMap[r.tanggal].rej += (+r.reject);
    });
    const labelsTrend = Object.keys(trendMap).sort();
    
    const ctxTrend = document.getElementById('chartTrend').getContext('2d');
    if(chartTrendInstance) chartTrendInstance.destroy();
    chartTrendInstance = new Chart(ctxTrend, {
        type: 'bar',
        data: {
            labels: labelsTrend,
            datasets: [
                { label: 'OK (Pcs)', data: labelsTrend.map(d => trendMap[d].ok), backgroundColor: '#10b981', borderRadius: 4 },
                { label: 'Reject (Pcs)', data: labelsTrend.map(d => trendMap[d].rej), backgroundColor: '#ef4444', borderRadius: 4 }
            ]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            scales: { x: { stacked: true, ticks:{color:'#888'} }, y: { stacked: true, ticks:{color:'#888'}, grid:{color:'#333'} } }, 
            plugins: { legend: { position:'bottom', labels: {color:'#fff'} } } 
        }
    });

    // 4. CHART 2: PARETO REJECT
    const rejectKeys = ['uneven', 'mottled', 'startup', 'short', 'flow', 'flashing', 'crack', 'spot', 'scratch', 'dirty'];
    const rejectCounts = {}; rejectKeys.forEach(k => rejectCounts[k] = 0);
    
    dataDash.forEach(r => {
        rejectCounts['uneven'] += (+r.reject_uneven || 0); rejectCounts['mottled'] += (+r.reject_mottled || 0);
        rejectCounts['startup'] += (+r.reject_startup || 0); rejectCounts['short'] += (+r.reject_short || 0);
        rejectCounts['flow'] += (+r.reject_flow || 0); rejectCounts['flashing'] += (+r.reject_flashing || 0);
        rejectCounts['crack'] += (+r.reject_crack || 0); rejectCounts['spot'] += (+r.reject_spot || 0);
        rejectCounts['scratch'] += (+r.reject_scratch || 0); rejectCounts['dirty'] += (+r.reject_dirty || 0);
    });

    const sortedPareto = Object.entries(rejectCounts).sort((a,b) => b[1] - a[1]).filter(x => x[1] > 0);
    
    const ctxPareto = document.getElementById('chartPareto').getContext('2d');
    if(chartParetoInstance) chartParetoInstance.destroy();
    
    chartParetoInstance = new Chart(ctxPareto, {
        type: 'bar',
        data: {
            labels: sortedPareto.map(x => x[0].toUpperCase()),
            datasets: [{ label: 'Total Defect', data: sortedPareto.map(x => x[1]), backgroundColor: '#d4af37', borderRadius: 4 }]
        },
        options: { 
            indexAxis: 'y', 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { legend: { display: false } }, 
            scales: { x: { ticks: { color: '#888' }, grid:{color:'#333'} }, y: { ticks: { color: '#e5e5e5' } } } 
        }
    });
    
    // 5. DATA MAPPING (OK & Reject)
    const prodMap = {};
    dataDash.forEach(r => {
        const k = r.kode + "|" + r.nama; 
        if(!prodMap[k]) prodMap[k] = { kode: r.kode, nama: r.nama, ok:0, rej:0 };
        prodMap[k].ok += (+r.okpcs); 
        prodMap[k].rej += (+r.reject);
    });

    // 6. TABEL KIRI: TOP 5 PRODUK OK (Hijau)
    const topProdsOk = Object.values(prodMap).sort((a,b) => b.ok - a.ok).slice(0, 5);
    const tblBodyOk = document.querySelector('#tblTopProd tbody');
    if(tblBodyOk) {
        tblBodyOk.innerHTML = topProdsOk.map(x => `
            <tr>
                <td>
                    <div style="font-weight:700; font-size:0.95rem; margin-bottom:2px; color:var(--gold); font-family:'JetBrains Mono', monospace;">${x.kode}</div>
                    <div style="font-size:0.8rem; color:#e5e5e5;">${x.nama}</div>
                </td>
                <td class="right text-ok" style="font-weight:bold; font-size:1.1rem; vertical-align:middle;">${x.ok.toLocaleString()}</td>
            </tr>
        `).join('');
    }

    // 7. TABEL KANAN: TOP 5 PRODUK REJECT (Merah)
    const topProdsReject = Object.values(prodMap).sort((a,b) => b.rej - a.rej).slice(0, 5);
    const tblBodyReject = document.querySelector('#tblTopReject tbody');
    if(tblBodyReject) {
        tblBodyReject.innerHTML = topProdsReject.map(x => `
            <tr>
                <td>
                    <div style="font-weight:700; font-size:0.95rem; margin-bottom:2px; color:#fff; font-family:'JetBrains Mono', monospace;">${x.kode}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted);">${x.nama}</div>
                </td>
                <td class="right text-danger" style="font-weight:bold; font-size:1.1rem; vertical-align:middle;">${x.rej.toLocaleString()}</td>
            </tr>
        `).join('');
    }
}
