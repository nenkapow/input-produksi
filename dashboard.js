/* DASHBOARD MONITORING ROOM
   Logic for Chart.js & KPI Analytics
*/

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
            start.setDate(end.getDate() - 7);
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
    if(typeof logs === 'undefined' || logs.length === 0) {
        alert("Data belum siap atau kosong. Refresh halaman dulu.");
        return;
    }

    const startStr = document.getElementById('dFrom').value;
    const endStr = document.getElementById('dTo').value;
    const lineFilter = document.getElementById('dLine').value.trim().toUpperCase();
    
    const dStart = new Date(startStr);
    const dEnd = new Date(endStr);

    const dataDash = logs.filter(r => {
        const d = new Date(r.tanggal);
        const dateOk = d >= dStart && d <= dEnd;
        const lineOk = lineFilter ? r.line.toUpperCase().includes(lineFilter) : true;
        return dateOk && lineOk;
    });

    if(dataDash.length === 0) {
        alert("Tidak ada data di periode ini.");
        return;
    }

    // KPI Calc
    let totalHasil=0, totalOk=0, totalReject=0, sumYield=0;
    dataDash.forEach(r => {
        totalHasil += (+r.hasil); totalOk += (+r.okpcs); totalReject += (+r.reject); sumYield += (+r.yieldpct);
    });
    
    document.getElementById('kpiHasil').innerText = totalHasil.toLocaleString();
    document.getElementById('kpiOk').innerText = totalOk.toLocaleString();
    document.getElementById('kpiReject').innerText = totalReject.toLocaleString();
    document.getElementById('kpiYield').innerText = (dataDash.length ? (sumYield / dataDash.length) : 0).toFixed(2) + "%";

    // Trend Chart
    const trendMap = {};
    dataDash.forEach(r => {
        if(!trendMap[r.tanggal]) trendMap[r.tanggal] = { ok:0, rej:0 };
        trendMap[r.tanggal].ok += (+r.okpcs); trendMap[r.tanggal].rej += (+r.reject);
    });
    const labelsTrend = Object.keys(trendMap).sort();
    
    const ctxTrend = document.getElementById('chartTrend').getContext('2d');
    if(chartTrendInstance) chartTrendInstance.destroy();
    chartTrendInstance = new Chart(ctxTrend, {
        type: 'bar',
        data: {
            labels: labelsTrend,
            datasets: [
                { label: 'OK (Pcs)', data: labelsTrend.map(d => trendMap[d].ok), backgroundColor: '#10b981' },
                { label: 'Reject (Pcs)', data: labelsTrend.map(d => trendMap[d].rej), backgroundColor: '#ef4444' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } }, plugins: { legend: { position:'bottom', labels: {color:'#a3a3a3'} } } }
    });

    // Pareto Chart
    const rejectKeys = ['uneven', 'mottled', 'startup', 'short', 'flow', 'flashing', 'crack', 'spot', 'scratch', 'dirty'];
    const rejectCounts = {}; rejectKeys.forEach(k => rejectCounts[k] = 0);
    
    dataDash.forEach(r => {
        rejectCounts['uneven'] += (+r.reject_uneven || 0); rejectCounts['mottled'] += (+r.reject_mottled || 0);
        rejectCounts['startup'] += (+r.reject_startup || 0); rejectCounts['short'] += (+r.reject_short || 0);
        rejectCounts['flow'] += (+r.reject_flow || 0); rejectCounts['flashing'] += (+r.reject_flashing || 0);
        rejectCounts['crack'] += (+r.reject_crack || 0); rejectCounts['spot'] += (+r.reject_spot || 0);
        rejectCounts['scratch'] += (+r.reject_scratch || 0); rejectCounts['dirty'] += (+r.reject_dirty || 0);
    });

    const sortedReject = Object.entries(rejectCounts).sort((a,b) => b[1] - a[1]).filter(x => x[1] > 0);
    const ctxPareto = document.getElementById('chartPareto').getContext('2d');
    if(chartParetoInstance) chartParetoInstance.destroy();
    
    chartParetoInstance = new Chart(ctxPareto, {
        type: 'bar',
        data: {
            labels: sortedReject.map(x => x[0].toUpperCase()),
            datasets: [{ label: 'Defect', data: sortedReject.map(x => x[1]), backgroundColor: '#d4af37' }]
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#a3a3a3' } }, y: { ticks: { color: '#e5e5e5' } } } }
    });
    
    // Top Product Table
    const prodMap = {};
    dataDash.forEach(r => {
        const k = r.nama; if(!prodMap[k]) prodMap[k] = { ok:0, rej:0 };
        prodMap[k].ok += (+r.okpcs); prodMap[k].rej += (+r.reject);
    });
    const topProds = Object.entries(prodMap).sort((a,b) => b[1].ok - a[1].ok).slice(0, 5);
    document.querySelector('#tblTopProd tbody').innerHTML = topProds.map(x => `<tr><td>${x[0]}</td><td class="right text-ok">${x[1].ok.toLocaleString()}</td><td class="right text-danger">${x[1].rej.toLocaleString()}</td><td class="right">${x[1].ok+x[1].rej>0?((x[1].ok/(x[1].ok+x[1].rej))*100).toFixed(1)+'%':'0%'}</td></tr>`).join('');
}