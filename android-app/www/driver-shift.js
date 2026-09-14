let currentUser = null;
let allShifts = [];
let openShift = null;

function formatTime(iso) { return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }
function hoursBetween(a, b) { return a && b ? ((new Date(b) - new Date(a)) / 3600000) : 0; }

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;
    const profile = await getProfile(currentUser.id);
    if (!profile || profile.role !== 'driver') { window.location.href = 'driver-login.html'; return; }

    document.getElementById('clockInBtn').addEventListener('click', clockIn);
    document.getElementById('clockOutBtn').addEventListener('click', clockOut);
    document.getElementById('breakBtn').addEventListener('click', toggleBreak);

    await loadAll();
});

async function loadAll() {
    const { data } = await supabase.from('driver_shifts').select('*').eq('driver_id', currentUser.id).order('clock_in_at', { ascending: false });
    allShifts = data || [];
    openShift = allShifts.find(function (s) { return !s.clock_out_at; }) || null;

    renderStatus();
    await renderSummary();
    await renderHistory();
}

function renderStatus() {
    const statusEl = document.getElementById('shiftStatus');
    const inBtn = document.getElementById('clockInBtn');
    const outBtn = document.getElementById('clockOutBtn');
    const breakBtn = document.getElementById('breakBtn');

    if (openShift) {
        statusEl.textContent = 'On shift since ' + formatTime(openShift.clock_in_at) + (openShift.break_start_at ? ' — on break since ' + formatTime(openShift.break_start_at) : '');
        inBtn.classList.add('hidden');
        outBtn.classList.remove('hidden');
        breakBtn.classList.remove('hidden');
        breakBtn.textContent = openShift.break_start_at ? 'End Break' : 'Start Break';
    } else {
        statusEl.textContent = 'Not currently clocked in.';
        inBtn.classList.remove('hidden');
        outBtn.classList.add('hidden');
        breakBtn.classList.add('hidden');
    }
}

async function clockIn() {
    const msg = document.getElementById('shiftMsg');
    const { error } = await supabase.from('driver_shifts').insert({ driver_id: currentUser.id });
    msg.textContent = error ? 'Could not clock in: ' + error.message : '';
    await loadAll();
}

async function toggleBreak() {
    if (!openShift) return;
    if (openShift.break_start_at) {
        const minutes = Math.round(hoursBetween(openShift.break_start_at, new Date().toISOString()) * 60);
        await supabase.from('driver_shifts').update({
            break_start_at: null,
            total_break_minutes: (openShift.total_break_minutes || 0) + minutes,
        }).eq('id', openShift.id);
    } else {
        await supabase.from('driver_shifts').update({ break_start_at: new Date().toISOString() }).eq('id', openShift.id);
    }
    await loadAll();
}

async function clockOut() {
    if (!openShift) return;
    const fields = { clock_out_at: new Date().toISOString() };
    if (openShift.break_start_at) {
        const minutes = Math.round(hoursBetween(openShift.break_start_at, fields.clock_out_at) * 60);
        fields.total_break_minutes = (openShift.total_break_minutes || 0) + minutes;
        fields.break_start_at = null;
    }
    await supabase.from('driver_shifts').update(fields).eq('id', openShift.id);
    await loadAll();
}

async function jobsInRange(from, to) {
    let query = supabase.from('jobs').select('distance, status, delivered_at').eq('driver_id', currentUser.id).eq('status', 'delivered').gte('delivered_at', from);
    if (to) query = query.lte('delivered_at', to);
    const { data } = await query;
    return data || [];
}

async function renderSummary() {
    if (!allShifts.length) { document.getElementById('summaryCards').innerHTML = ''; return; }
    const totalHours = allShifts.reduce(function (s, sh) {
        return s + hoursBetween(sh.clock_in_at, sh.clock_out_at || new Date().toISOString()) - (sh.total_break_minutes || 0) / 60;
    }, 0);

    const jobs = await jobsInRange(allShifts[allShifts.length - 1].clock_in_at, null);
    const totalDistance = jobs.reduce(function (s, j) { return s + (Number(j.distance) || 0); }, 0);

    document.getElementById('summaryCards').innerHTML =
        '<div class="summary-card"><div class="num">' + totalHours.toFixed(1) + 'h</div><div class="lbl">Total Hours Worked</div></div>' +
        '<div class="summary-card"><div class="num">' + allShifts.length + '</div><div class="lbl">Shifts Logged</div></div>' +
        '<div class="summary-card"><div class="num">' + totalDistance.toFixed(1) + ' km</div><div class="lbl">Distance Travelled</div></div>' +
        '<div class="summary-card"><div class="num">' + jobs.length + '</div><div class="lbl">Deliveries Completed</div></div>';
}

async function renderHistory() {
    const body = document.getElementById('shiftBody');
    const empty = document.getElementById('emptyState');
    if (!allShifts.length) { body.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    const rows = [];
    for (const sh of allShifts) {
        const hours = hoursBetween(sh.clock_in_at, sh.clock_out_at || new Date().toISOString()) - (sh.total_break_minutes || 0) / 60;
        const jobs = await jobsInRange(sh.clock_in_at, sh.clock_out_at || new Date().toISOString());
        const distance = jobs.reduce(function (s, j) { return s + (Number(j.distance) || 0); }, 0);
        rows.push('<tr>' +
            '<td>' + formatTime(sh.clock_in_at) + '</td>' +
            '<td>' + (sh.clock_out_at ? formatTime(sh.clock_out_at) : 'In progress') + '</td>' +
            '<td>' + hours.toFixed(1) + 'h</td>' +
            '<td>' + (sh.total_break_minutes || 0) + ' min</td>' +
            '<td>' + distance.toFixed(1) + ' km</td>' +
            '<td>' + jobs.length + '</td>' +
        '</tr>');
    }
    body.innerHTML = rows.join('');
}
