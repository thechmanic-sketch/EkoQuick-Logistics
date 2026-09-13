let currentUser = null;
let allJobs = [];
let driversById = {};
let starFilter = 'all';

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-ZA') : '—'; }

function vehicleLabel(id) {
    const v = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).find(function (v) { return v.id === id; });
    return v ? v.icon + ' ' + v.label : (id || '—');
}

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('login.html');
    if (!currentUser) return;

    document.getElementById('reviewSearch').addEventListener('input', renderAll);
    document.querySelectorAll('.filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            starFilter = btn.dataset.filter;
            renderAll();
        });
    });

    await loadAll();
    supabase.channel('customer-reviews').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: 'customer_id=eq.' + currentUser.id }, loadAll).subscribe();
});

async function loadAll() {
    const { data: jobs } = await supabase.from('jobs').select('*').eq('customer_id', currentUser.id).eq('status', 'delivered').order('delivered_at', { ascending: false });
    allJobs = jobs || [];

    const driverIds = [...new Set(allJobs.map(function (j) { return j.driver_id; }).filter(Boolean))];
    driversById = {};
    if (driverIds.length) {
        const { data: drivers } = await supabase.from('profiles').select('id, full_name, avatar_url, vehicle_class').in('id', driverIds);
        (drivers || []).forEach(function (d) { driversById[d.id] = d; });
    }

    renderAll();
}

function renderAll() {
    const reviewed = allJobs.filter(function (j) { return j.rating; });
    const pending = allJobs.filter(function (j) { return !j.rating; });

    const fiveStar = reviewed.filter(function (j) { return j.rating === 5; });
    const avgGiven = reviewed.length ? (reviewed.reduce(function (s, j) { return s + j.rating; }, 0) / reviewed.length) : null;

    document.getElementById('summaryCards').innerHTML =
        '<div class="summary-card"><div class="num">' + reviewed.length + '</div><div class="lbl">Reviews Submitted</div></div>' +
        '<div class="summary-card"><div class="num">' + (avgGiven ? avgGiven.toFixed(1) + ' ★' : '—') + '</div><div class="lbl">Average Rating Given</div></div>' +
        '<div class="summary-card"><div class="num">' + fiveStar.length + '</div><div class="lbl">5-Star Reviews</div></div>' +
        '<div class="summary-card"><div class="num">' + pending.length + '</div><div class="lbl">Reviews Awaiting Submission</div></div>';

    renderPending(pending);
    renderHistory(reviewed);
}

function renderPending(pending) {
    const wrap = document.getElementById('pendingList');
    const empty = document.getElementById('pendingEmpty');
    if (!pending.length) { wrap.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    wrap.innerHTML = pending.map(function (job) {
        const driver = driversById[job.driver_id];
        return '<div class="review-card" style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">' +
            '<div style="display:flex; align-items:center; gap:10px;">' +
                (driver && driver.avatar_url ? '<img class="avatar" src="' + escapeHtml(driver.avatar_url) + '">' : '') +
                '<div><b>Order ' + job.id.slice(0, 8) + '</b><div class="meta">' + (driver ? escapeHtml(driver.full_name) + ' · ' + vehicleLabel(driver.vehicle_class) : 'Driver unavailable') + '</div>' +
                '<div class="meta">' + formatDate(job.delivered_at) + '</div></div>' +
            '</div>' +
            '<a class="btn btn-blue" style="width:auto;" href="rate-driver.html?job=' + job.id + '">Leave Review</a>' +
        '</div>';
    }).join('');
}

function renderHistory(reviewed) {
    const q = document.getElementById('reviewSearch').value.trim().toLowerCase();
    let list = reviewed.filter(function (j) {
        if (starFilter !== 'all' && j.rating !== parseInt(starFilter, 10)) return false;
        if (!q) return true;
        const driver = driversById[j.driver_id];
        return j.id.toLowerCase().includes(q) || (driver && driver.full_name.toLowerCase().includes(q));
    });

    const body = document.getElementById('historyBody');
    const empty = document.getElementById('historyEmpty');
    if (!list.length) { body.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    body.innerHTML = list.map(function (job) {
        const driver = driversById[job.driver_id];
        return '<tr>' +
            '<td>' + job.id.slice(0, 8) + '</td>' +
            '<td>' + (driver ? escapeHtml(driver.full_name) : '—') + '</td>' +
            '<td>' + '★'.repeat(job.rating) + '</td>' +
            '<td>' + formatDate(job.review_edited_at || job.delivered_at) + '</td>' +
            '<td>' + (job.review_edited_at ? 'Edited' : 'Published') + '</td>' +
            '<td><a class="btn btn-outline-blue" style="width:auto;" href="rate-driver.html?job=' + job.id + '">Edit Review</a></td>' +
            '</tr>';
    }).join('');
}
