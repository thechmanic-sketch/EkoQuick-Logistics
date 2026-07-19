let allJobs = [];
let allDrivers = [];
let driversById = {};
let allRules = [];
let allHistory = [];

document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireSession('admin-login.html');
    if (!user) return;

    const profile = await getProfile(user.id);
    if (!profile || profile.role !== 'admin') {
        await supabase.auth.signOut();
        window.location.href = 'admin-login.html';
        return;
    }
    window.currentAdminName = profile.full_name || profile.email || 'Admin';

    document.getElementById('logoutBtn').addEventListener('click', async function () {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
    document.getElementById('refreshBtn').addEventListener('click', loadAll);
    document.getElementById('historySearch').addEventListener('input', renderHistory);
    document.getElementById('driverShareInput').addEventListener('input', updateDefaultInputs);
    document.getElementById('saveBtn').addEventListener('click', saveDefaultRate);
    document.getElementById('saveVehicleRatesBtn').addEventListener('click', saveVehicleRates);
    document.getElementById('specialType').addEventListener('change', updateSpecialFormVisibility);
    document.getElementById('addSpecialBtn').addEventListener('click', addSpecialRule);
    document.getElementById('calcFee').addEventListener('input', updateCalculator);

    await loadDriverShare();
    updateDefaultInputs();
    updateSpecialFormVisibility();
    populateVehicleClassRows();

    await loadAll();

    supabase.channel('commissions-page').on('postgres_changes', { event: '*', schema: 'public', table: 'commission_rules' }, loadAll).subscribe();
});

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function formatDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-ZA') : '—'; }
function formatTime(iso) { return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }
function money(n) { return 'R' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function vehicleLabel(id) {
    const v = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).find(function (x) { return x.id === id; });
    return v ? v.icon + ' ' + v.label : (id || '—');
}

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function startOfMonth() { const d = startOfToday(); d.setDate(1); return d; }

async function loadAll() {
    const { data: jobs } = await supabase.from('jobs').select('*').eq('status', 'delivered');
    const { data: drivers } = await supabase.from('profiles').select('*').eq('role', 'driver');
    const { data: rules } = await supabase.from('commission_rules').select('*').order('created_at', { ascending: false });
    const { data: history } = await supabase.from('commission_history').select('*').order('created_at', { ascending: false });

    allJobs = jobs || [];
    allDrivers = drivers || [];
    driversById = {};
    allDrivers.forEach(function (d) { driversById[d.id] = d; });
    allRules = rules || [];
    allHistory = history || [];

    await loadCommissionRules();

    renderSummaryCards();
    refreshVehicleClassInputs();
    populateSpecialDriverSelect();
    renderSpecialRules();
    renderHistory();
    renderDriverEarnings();
    updateCalculator();
}

function renderSummaryCards() {
    const todayStart = startOfToday(), monthStart = startOfMonth();
    const deliveredToday = allJobs.filter(function (j) { return j.delivered_at && new Date(j.delivered_at) >= todayStart; });
    const deliveredMonth = allJobs.filter(function (j) { return j.delivered_at && new Date(j.delivered_at) >= monthStart; });

    const platformToday = deliveredToday.reduce(function (s, j) { return s + platformFeeForJob(j); }, 0);
    const driverToday = deliveredToday.reduce(function (s, j) { return s + driverEarningForJob(j); }, 0);
    const platformMonth = deliveredMonth.reduce(function (s, j) { return s + platformFeeForJob(j); }, 0);
    const avgCommission = allJobs.length ? allJobs.reduce(function (s, j) { return s + platformFeeForJob(j); }, 0) / allJobs.length : 0;

    function card(title, value) {
        return '<div class="kpi-card"><div class="kpi-title">' + title + '</div><div class="kpi-value">' + value + '</div></div>';
    }
    document.getElementById('summaryCards').innerHTML =
        card('Platform Commission Today', money(platformToday)) + card('Driver Earnings Today', money(driverToday)) +
        card('Total Commission This Month', money(platformMonth)) + card('Average Commission Per Delivery', money(avgCommission));
}

function updateDefaultInputs() {
    const input = document.getElementById('driverShareInput');
    if (document.activeElement !== input) input.value = Math.round(DRIVER_SHARE * 100);
    const pct = parseFloat(input.value) || 0;
    document.getElementById('platformShareNote').textContent = 'Driver ' + pct + '% / Ekoquick keeps ' + (100 - pct) + '%. Must total 100%.';
}

function showMsg(type, text) {
    document.getElementById('msgArea').innerHTML = '<div class="msg ' + type + '">' + text + '</div>';
}

async function logHistory(scope, previousValue, newValue, reason) {
    await supabase.from('commission_history').insert({
        changed_by: window.currentAdminName || 'Admin', scope: scope,
        previous_value: String(previousValue), new_value: String(newValue), reason: reason || null,
    });
}

async function saveDefaultRate() {
    const pct = parseFloat(document.getElementById('driverShareInput').value);
    if (isNaN(pct) || pct < 0 || pct > 100) { showMsg('error', 'Enter a number between 0 and 100 — driver % and platform % must total 100%.'); return; }

    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const previousPct = Math.round(DRIVER_SHARE * 100);
    const reason = document.getElementById('defaultReasonInput').value.trim();
    const { error } = await supabase.from('settings').update({ value: String(pct / 100) }).eq('key', 'driver_share');

    btn.disabled = false;
    btn.textContent = 'Save Changes';

    if (error) { showMsg('error', 'Failed to save: ' + error.message); return; }

    await logHistory('Default commission', previousPct + '% driver', pct + '% driver', reason);
    DRIVER_SHARE = pct / 100;
    updateDefaultInputs();
    document.getElementById('defaultReasonInput').value = '';
    showMsg('success', 'Default commission rate updated.');
    loadAll();
}

function populateVehicleClassRows() {
    const el = document.getElementById('vehicleClassRows');
    el.innerHTML = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).map(function (v) {
        return '<div class="vehicle-comm-row"><span class="name">' + v.icon + ' ' + v.label + '</span>' +
            '<input class="field-plain" type="number" min="0" max="100" placeholder="Default" style="width:100px;" data-vehicle="' + v.id + '" id="vehicleRate-' + v.id + '"> %</div>';
    }).join('');
}

function refreshVehicleClassInputs() {
    (typeof VEHICLES !== 'undefined' ? VEHICLES : []).forEach(function (v) {
        const rule = allRules.find(function (r) { return r.rule_type === 'vehicle_class' && r.vehicle_class === v.id && r.active; });
        const input = document.getElementById('vehicleRate-' + v.id);
        if (input) input.value = rule ? Math.round(rule.driver_share * 100) : '';
    });
}

async function saveVehicleRates() {
    const vehicles = (typeof VEHICLES !== 'undefined' ? VEHICLES : []);
    for (const v of vehicles) {
        const input = document.getElementById('vehicleRate-' + v.id);
        const raw = input.value.trim();
        const existing = allRules.find(function (r) { return r.rule_type === 'vehicle_class' && r.vehicle_class === v.id && r.active; });

        if (!raw) {
            if (existing) {
                await supabase.from('commission_rules').update({ active: false }).eq('id', existing.id);
                await logHistory('Vehicle class: ' + v.label, Math.round(existing.driver_share * 100) + '%', 'default', 'Reverted to default');
            }
            continue;
        }
        const pct = parseFloat(raw);
        if (isNaN(pct) || pct < 0 || pct > 100) continue;
        const share = pct / 100;

        if (existing && existing.driver_share === share) continue;

        if (existing) await supabase.from('commission_rules').update({ active: false }).eq('id', existing.id);
        await supabase.from('commission_rules').insert({
            name: v.label + ' commission', rule_type: 'vehicle_class', vehicle_class: v.id,
            driver_share: share, active: true, created_by: window.currentAdminName || 'Admin',
        });
        await logHistory('Vehicle class: ' + v.label, existing ? Math.round(existing.driver_share * 100) + '%' : 'default', pct + '%', null);
    }
    loadAll();
}

function updateSpecialFormVisibility() {
    const type = document.getElementById('specialType').value;
    document.getElementById('specialDriverSelect').classList.toggle('hidden', type !== 'driver');
    document.getElementById('specialName').classList.toggle('hidden', type !== 'campaign');
    document.getElementById('specialStartDate').classList.toggle('hidden', type !== 'campaign');
    document.getElementById('specialEndDate').classList.toggle('hidden', type !== 'campaign');
}

function populateSpecialDriverSelect() {
    const sel = document.getElementById('specialDriverSelect');
    sel.innerHTML = '<option value="">Select driver...</option>' + allDrivers.map(function (d) {
        return '<option value="' + d.id + '">' + escapeHtml(d.full_name || d.id) + '</option>';
    }).join('');
}

async function addSpecialRule() {
    const type = document.getElementById('specialType').value;
    const shareInput = document.getElementById('specialShare').value;
    const pct = parseFloat(shareInput);
    if (isNaN(pct) || pct < 0 || pct > 100) { alert('Enter a valid driver % between 0 and 100.'); return; }

    const fields = { driver_share: pct / 100, active: true, created_by: window.currentAdminName || 'Admin' };

    if (type === 'driver') {
        const driverId = document.getElementById('specialDriverSelect').value;
        if (!driverId) { alert('Select a driver.'); return; }
        const driver = driversById[driverId];
        fields.rule_type = 'driver';
        fields.driver_id = driverId;
        fields.name = 'VIP — ' + (driver ? driver.full_name : driverId);
    } else {
        const name = document.getElementById('specialName').value.trim();
        const start = document.getElementById('specialStartDate').value;
        const end = document.getElementById('specialEndDate').value;
        if (!name || !start || !end) { alert('Enter a campaign name, start date, and end date.'); return; }
        fields.rule_type = 'campaign';
        fields.name = name;
        fields.start_date = start;
        fields.end_date = end;
    }

    const { error } = await supabase.from('commission_rules').insert(fields);
    if (error) { alert('Failed to add rule: ' + error.message); return; }
    await logHistory(fields.name, '—', pct + '% driver', 'Special commission rule added');

    document.getElementById('specialShare').value = '';
    document.getElementById('specialName').value = '';
    loadAll();
}

function renderSpecialRules() {
    const el = document.getElementById('specialRulesList');
    const special = allRules.filter(function (r) { return r.rule_type === 'driver' || r.rule_type === 'campaign'; });
    if (!special.length) { el.innerHTML = '<div class="empty">No special commission rules yet.</div>'; return; }

    el.innerHTML =
        '<table class="simple-table"><thead><tr><th>Name</th><th>Type</th><th>Details</th><th>Driver Share</th><th>Status</th><th></th></tr></thead><tbody>' +
        special.map(function (r) {
            const details = r.rule_type === 'driver'
                ? (driversById[r.driver_id] ? driversById[r.driver_id].full_name : r.driver_id.slice(0, 8))
                : (formatDate(r.start_date) + ' – ' + formatDate(r.end_date));
            return '<tr><td>' + escapeHtml(r.name) + '</td><td>' + (r.rule_type === 'driver' ? 'VIP Driver' : 'Campaign') + '</td>' +
                '<td>' + details + '</td><td>' + Math.round(r.driver_share * 100) + '%</td>' +
                '<td><span class="badge ' + (r.active ? 'delivered' : 'cancelled') + '">' + (r.active ? 'active' : 'inactive') + '</span></td>' +
                '<td>' + (r.active ? '<button data-action="deactivate" data-id="' + r.id + '">Deactivate</button>' : '') + '</td></tr>';
        }).join('') +
        '</tbody></table>';

    el.querySelectorAll('button[data-action="deactivate"]').forEach(function (btn) {
        btn.addEventListener('click', function () { deactivateRule(btn.dataset.id); });
    });
}

async function deactivateRule(ruleId) {
    const rule = allRules.find(function (r) { return r.id === ruleId; });
    if (!confirm('Deactivate "' + rule.name + '"?')) return;
    await supabase.from('commission_rules').update({ active: false }).eq('id', ruleId);
    await logHistory(rule.name, Math.round(rule.driver_share * 100) + '%', 'inactive', 'Rule deactivated');
    loadAll();
}

function updateCalculator() {
    const fee = parseFloat(document.getElementById('calcFee').value) || 0;
    document.getElementById('calcDriver').textContent = money(fee * DRIVER_SHARE);
    document.getElementById('calcPlatform').textContent = money(fee * (1 - DRIVER_SHARE));
}

function renderHistory() {
    const wrap = document.getElementById('historyTableWrap');
    const q = document.getElementById('historySearch').value.trim().toLowerCase();
    let rows = allHistory;
    if (q) {
        rows = rows.filter(function (h) {
            return ((h.scope || '') + ' ' + (h.changed_by || '') + ' ' + (h.reason || '')).toLowerCase().indexOf(q) !== -1;
        });
    }
    if (!rows.length) { wrap.innerHTML = '<div class="empty">No commission changes recorded yet.</div>'; return; }

    wrap.innerHTML =
        '<table class="simple-table"><thead><tr><th>Date</th><th>Changed By</th><th>Scope</th><th>Previous Value</th><th>New Value</th><th>Reason</th></tr></thead><tbody>' +
        rows.map(function (h) {
            return '<tr><td>' + formatTime(h.created_at) + '</td><td>' + escapeHtml(h.changed_by || '—') + '</td>' +
                '<td>' + escapeHtml(h.scope) + '</td><td>' + escapeHtml(h.previous_value || '—') + '</td>' +
                '<td>' + escapeHtml(h.new_value || '—') + '</td><td>' + escapeHtml(h.reason || '—') + '</td></tr>';
        }).join('') +
        '</tbody></table>';
}

function renderDriverEarnings() {
    const el = document.getElementById('driverEarningsTable');
    const totals = {};
    allJobs.forEach(function (j) {
        if (!j.driver_id) return;
        if (!totals[j.driver_id]) totals[j.driver_id] = { trips: 0, earned: 0 };
        totals[j.driver_id].trips += 1;
        totals[j.driver_id].earned += driverEarningForJob(j);
    });

    const rows = Object.keys(totals).sort(function (a, b) { return totals[b].earned - totals[a].earned; });
    if (!rows.length) { el.innerHTML = '<div class="empty">No completed jobs yet.</div>'; return; }

    el.innerHTML = rows.map(function (id) {
        const t = totals[id];
        const driver = driversById[id];
        return '<div class="job"><div class="route">' + escapeHtml(driver ? driver.full_name : id) + '</div>' +
            '<div class="meta">' + t.trips + ' trips • ' + money(t.earned) + ' earned</div></div>';
    }).join('');
}
