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

    await loadDriverShare();
    updateInputs();
    document.getElementById('driverShareInput').addEventListener('input', updateInputs);
    document.getElementById('saveBtn').addEventListener('click', saveRate);

    loadDriverEarnings();
});

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function updateInputs() {
    const input = document.getElementById('driverShareInput');
    if (document.activeElement !== input) input.value = Math.round(DRIVER_SHARE * 100);
    const pct = parseFloat(input.value) || 0;
    document.getElementById('platformShareNote').textContent = 'Ekoquick keeps ' + (100 - pct) + '%.';
}

function showMsg(type, text) {
    document.getElementById('msgArea').innerHTML = '<div class="msg ' + type + '">' + text + '</div>';
}

async function saveRate() {
    const pct = parseFloat(document.getElementById('driverShareInput').value);
    if (isNaN(pct) || pct < 0 || pct > 100) { showMsg('error', 'Enter a number between 0 and 100'); return; }

    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const { error } = await supabase.from('settings').update({ value: String(pct / 100) }).eq('key', 'driver_share');

    btn.disabled = false;
    btn.textContent = 'Save rate';

    if (error) { showMsg('error', 'Failed to save: ' + error.message); return; }

    DRIVER_SHARE = pct / 100;
    updateInputs();
    showMsg('success', 'Commission rate updated.');
    loadDriverEarnings();
}

async function loadDriverEarnings() {
    const el = document.getElementById('driverEarningsTable');
    const { data: jobs, error } = await supabase.from('jobs').select('driver_id, quote').eq('status', 'delivered');
    if (error) { el.innerHTML = '<div class="empty">Failed to load: ' + error.message + '</div>'; return; }

    const { data: drivers } = await supabase.from('profiles').select('id, full_name').eq('role', 'driver');
    const nameById = {};
    (drivers || []).forEach(function (d) { nameById[d.id] = d.full_name; });

    const totals = {};
    (jobs || []).forEach(function (j) {
        if (!j.driver_id) return;
        if (!totals[j.driver_id]) totals[j.driver_id] = { trips: 0, earned: 0 };
        totals[j.driver_id].trips += 1;
        totals[j.driver_id].earned += driverEarning(j.quote);
    });

    const rows = Object.keys(totals).sort(function (a, b) { return totals[b].earned - totals[a].earned; });
    if (!rows.length) { el.innerHTML = '<div class="empty">No completed jobs yet.</div>'; return; }

    el.innerHTML = rows.map(function (id) {
        const t = totals[id];
        return '<div class="job"><div class="route">' + escapeHtml(nameById[id] || id) + '</div>' +
            '<div class="meta">' + t.trips + ' trips • R' + t.earned.toFixed(2) + ' earned</div></div>';
    }).join('');
}
