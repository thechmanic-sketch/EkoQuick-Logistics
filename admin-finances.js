let allDelivered = [];

document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireSession('admin-login.html');
    if (!user) return;

    const profile = await getProfile(user.id);
    if (!profile || profile.role !== 'admin') {
        await supabase.auth.signOut();
        window.location.href = 'admin-login.html';
        return;
    }

    document.getElementById('logoutBtn').addEventListener('click', async function () {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
    document.getElementById('exportBtn').addEventListener('click', exportCsv);

    await loadDriverShare();
    await loadFinances();
});

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

async function loadFinances() {
    const { data, error } = await supabase.from('jobs').select('*').eq('status', 'delivered').order('created_at', { ascending: false });
    if (error) {
        document.getElementById('financesTable').innerHTML = '<div class="empty">Failed to load: ' + error.message + '</div>';
        return;
    }
    allDelivered = data || [];
    renderTotals(allDelivered);
    renderDailyTable(allDelivered);
}

function renderTotals(jobs) {
    const revenue = jobs.reduce(function (s, j) { return s + (Number(j.quote) || 0); }, 0);
    const platform = jobs.reduce(function (s, j) { return s + platformFee(j.quote); }, 0);
    const drivers = jobs.reduce(function (s, j) { return s + driverEarning(j.quote); }, 0);

    document.getElementById('statTotalRevenue').textContent = 'R' + revenue.toLocaleString();
    document.getElementById('statTotalPlatform').textContent = 'R' + platform.toLocaleString(undefined, { maximumFractionDigits: 2 });
    document.getElementById('statTotalDrivers').textContent = 'R' + drivers.toLocaleString(undefined, { maximumFractionDigits: 2 });
    document.getElementById('statTotalTrips').textContent = jobs.length;
}

function dayKey(iso) {
    return new Date(iso).toISOString().slice(0, 10);
}

function renderDailyTable(jobs) {
    const el = document.getElementById('financesTable');
    if (!jobs.length) { el.innerHTML = '<div class="empty">No completed jobs yet.</div>'; return; }

    const byDay = {};
    jobs.forEach(function (j) {
        const key = dayKey(j.created_at);
        if (!byDay[key]) byDay[key] = { count: 0, revenue: 0, driver: 0, platform: 0 };
        byDay[key].count += 1;
        byDay[key].revenue += Number(j.quote) || 0;
        byDay[key].driver += driverEarning(j.quote);
        byDay[key].platform += platformFee(j.quote);
    });

    const days = Object.keys(byDay).sort().reverse();
    el.innerHTML =
        '<table style="width:100%; border-collapse: collapse; font-size: 13px;">' +
            '<thead><tr style="text-align:left; border-bottom:1px solid var(--line);">' +
                '<th style="padding:6px 4px;">Date</th><th style="padding:6px 4px;">Trips</th><th style="padding:6px 4px;">Revenue</th><th style="padding:6px 4px;">Driver payout</th><th style="padding:6px 4px;">Platform</th>' +
            '</tr></thead>' +
            '<tbody>' +
            days.map(function (d) {
                const r = byDay[d];
                return '<tr style="border-bottom:1px solid var(--line);">' +
                    '<td style="padding:6px 4px;">' + d + '</td>' +
                    '<td style="padding:6px 4px;">' + r.count + '</td>' +
                    '<td style="padding:6px 4px;">R' + r.revenue.toFixed(2) + '</td>' +
                    '<td style="padding:6px 4px;">R' + r.driver.toFixed(2) + '</td>' +
                    '<td style="padding:6px 4px;">R' + r.platform.toFixed(2) + '</td>' +
                '</tr>';
            }).join('') +
            '</tbody>' +
        '</table>';
}

function exportCsv() {
    const rows = [['Date', 'Pickup', 'Dropoff', 'Vehicle', 'Distance (km)', 'Quote', 'Driver payout', 'Platform fee']];
    allDelivered.forEach(function (j) {
        rows.push([
            j.created_at, j.pickup, j.dropoff, j.vehicle, j.distance || 0,
            j.quote || 0, driverEarning(j.quote).toFixed(2), platformFee(j.quote).toFixed(2),
        ]);
    });
    const csv = rows.map(function (r) {
        return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ekoquick-finances.csv';
    a.click();
    URL.revokeObjectURL(url);
}
