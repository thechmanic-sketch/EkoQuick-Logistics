let currentUser = null;
let allJobs = [];
let starFilter = 'all';

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-ZA') : '—'; }
function startOfMonth() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(1); return d; }

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;
    const profile = await getProfile(currentUser.id);
    if (!profile || profile.role !== 'driver') { window.location.href = 'driver-login.html'; return; }

    document.getElementById('reviewSearch').addEventListener('input', renderTable);
    document.querySelectorAll('.filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            starFilter = btn.dataset.filter;
            renderTable();
        });
    });

    await loadAll();
});

async function loadAll() {
    const { data } = await supabase.from('jobs').select('*').eq('driver_id', currentUser.id).eq('status', 'delivered').order('delivered_at', { ascending: false });
    allJobs = data || [];
    renderSummary();
    renderBreakdown();
    renderPerfScores();
    renderBadges();
    renderImprovement();
    renderTable();
}

function reviewedJobs() { return allJobs.filter(function (j) { return j.rating; }); }

function renderSummary() {
    const reviewed = reviewedJobs();
    const monthStart = startOfMonth();
    const thisMonth = reviewed.filter(function (j) { return new Date(j.review_edited_at || j.delivered_at) >= monthStart; });
    const overall = reviewed.length ? (reviewed.reduce(function (s, j) { return s + j.rating; }, 0) / reviewed.length) : null;
    const monthAvg = thisMonth.length ? (thisMonth.reduce(function (s, j) { return s + j.rating; }, 0) / thisMonth.length) : null;
    const fiveStar = reviewed.filter(function (j) { return j.rating === 5; }).length;
    const fourStar = reviewed.filter(function (j) { return j.rating === 4; }).length;

    document.getElementById('summaryCards').innerHTML =
        '<div class="summary-card"><div class="num">' + (overall ? overall.toFixed(1) + ' ★' : '—') + '</div><div class="lbl">Overall Rating</div></div>' +
        '<div class="summary-card"><div class="num">' + reviewed.length + '</div><div class="lbl">Total Reviews</div></div>' +
        '<div class="summary-card"><div class="num">' + fiveStar + '</div><div class="lbl">5-Star Reviews</div></div>' +
        '<div class="summary-card"><div class="num">' + fourStar + '</div><div class="lbl">4-Star Reviews</div></div>' +
        '<div class="summary-card"><div class="num">' + (monthAvg ? monthAvg.toFixed(1) + ' ★' : '—') + '</div><div class="lbl">Average Rating This Month</div></div>' +
        '<div class="summary-card"><div class="num">' + (overall ? overall.toFixed(1) + ' ★' : '—') + '</div><div class="lbl">Lifetime Rating</div></div>';
}

function renderBreakdown() {
    const reviewed = reviewedJobs();
    const wrap = document.getElementById('ratingBreakdown');
    if (!reviewed.length) { wrap.innerHTML = '<div class="empty">No reviews yet.</div>'; return; }
    wrap.innerHTML = [5, 4, 3, 2, 1].map(function (n) {
        const count = reviewed.filter(function (j) { return j.rating === n; }).length;
        const pct = Math.round((count / reviewed.length) * 100);
        return '<div class="bar-row"><span style="width:40px;">' + '★'.repeat(n) + '</span>' +
            '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;"></div></div>' +
            '<span style="width:80px; text-align:right;">' + count + ' (' + pct + '%)</span></div>';
    }).join('');
}

function avgOf(field) {
    const withField = reviewedJobs().filter(function (j) { return j[field]; });
    return withField.length ? (withField.reduce(function (s, j) { return s + j[field]; }, 0) / withField.length) : null;
}

function renderPerfScores() {
    const professionalism = avgOf('rating_professionalism');
    const communication = avgOf('rating_communication');
    const speed = avgOf('rating_speed');
    const parcel = avgOf('rating_parcel_condition');
    const overall = avgOf('rating');

    document.getElementById('perfScores').innerHTML =
        '<div class="summary-card"><div class="num">' + (professionalism ? professionalism.toFixed(1) : '—') + '</div><div class="lbl">Professionalism</div></div>' +
        '<div class="summary-card"><div class="num">' + (communication ? communication.toFixed(1) : '—') + '</div><div class="lbl">Communication</div></div>' +
        '<div class="summary-card"><div class="num">' + (speed ? speed.toFixed(1) : '—') + '</div><div class="lbl">Delivery Speed</div></div>' +
        '<div class="summary-card"><div class="num">' + (parcel ? parcel.toFixed(1) : '—') + '</div><div class="lbl">Parcel Handling</div></div>' +
        '<div class="summary-card"><div class="num">' + (overall ? overall.toFixed(1) : '—') + '</div><div class="lbl">Overall Service</div></div>';
}

function renderBadges() {
    const delivered = allJobs.length;
    const reviewed = reviewedJobs();
    const overall = reviewed.length ? (reviewed.reduce(function (s, j) { return s + j.rating; }, 0) / reviewed.length) : 0;
    const withDuration = allJobs.filter(function (j) { return j.assigned_at && j.delivered_at; });
    const avgMin = withDuration.length ? withDuration.reduce(function (s, j) { return s + (new Date(j.delivered_at) - new Date(j.assigned_at)); }, 0) / withDuration.length / 60000 : null;

    const badges = [
        { label: '100 Deliveries', earned: delivered >= 100 },
        { label: '500 Deliveries', earned: delivered >= 500 },
        { label: '1000 Deliveries', earned: delivered >= 1000 },
        { label: 'Top Rated Driver', earned: reviewed.length >= 10 && overall >= 4.5 },
        { label: 'Fast Delivery', earned: avgMin !== null && avgMin <= 30 },
        { label: 'Excellent Service', earned: reviewed.length >= 5 && overall >= 4.8 },
    ];

    document.getElementById('badgeGrid').innerHTML = badges.map(function (b) {
        return '<div class="badge-card ' + (b.earned ? 'earned' : 'locked') + '">' + (b.earned ? '🏆' : '🔒') + '<div style="margin-top:6px;">' + b.label + '</div></div>';
    }).join('');
}

function renderImprovement() {
    const reviewed = reviewedJobs();
    const issues = [];

    const withDuration = allJobs.filter(function (j) { return j.assigned_at && j.delivered_at; });
    const lateCount = withDuration.filter(function (j) { return (new Date(j.delivered_at) - new Date(j.assigned_at)) / 60000 > 60; }).length;
    if (lateCount > 0) issues.push('Late Deliveries: ' + lateCount + ' took over an hour from assignment to delivery.');

    const commAvg = avgOf('rating_communication');
    if (commAvg !== null && commAvg < 4) issues.push('Communication ratings average ' + commAvg.toFixed(1) + '/5 — below target.');

    const parcelAvg = avgOf('rating_parcel_condition');
    if (parcelAvg !== null && parcelAvg < 4) issues.push('Parcel Handling ratings average ' + parcelAvg.toFixed(1) + '/5 — below target.');

    document.getElementById('improvementArea').innerHTML = issues.length
        ? issues.map(function (i) { return '<div class="meta">⚠️ ' + escapeHtml(i) + '</div>'; }).join('')
        : '<div class="empty">No areas of concern detected from your recent deliveries.</div>';
}

function filteredReviews() {
    const q = document.getElementById('reviewSearch').value.trim().toLowerCase();
    return reviewedJobs().filter(function (j) {
        if (starFilter !== 'all' && j.rating !== parseInt(starFilter, 10)) return false;
        if (q && !(j.id.toLowerCase().includes(q) || (j.sender_name || '').toLowerCase().includes(q))) return false;
        return true;
    });
}

function renderTable() {
    const list = filteredReviews();
    const body = document.getElementById('reviewBody');
    const empty = document.getElementById('emptyState');
    if (!list.length) { body.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    body.innerHTML = list.map(function (job) {
        return '<tr>' +
            '<td>' + job.id.slice(0, 8) + '</td>' +
            '<td>' + escapeHtml(job.sender_name || '—') + '</td>' +
            '<td>' + '★'.repeat(job.rating) + '</td>' +
            '<td>' + formatDate(job.review_edited_at || job.delivered_at) + '</td>' +
            '<td>' + formatDate(job.delivered_at) + '</td>' +
            '<td><button class="btn btn-outline-blue" style="width:auto;" data-action="toggle-details" data-job="' + job.id + '">View Review</button></td>' +
            '</tr>' +
            '<tr><td colspan="6" style="border:none; padding:0;"><div class="details-row" id="details-' + job.id + '"></div></td></tr>';
    }).join('');

    body.querySelectorAll('button[data-action="toggle-details"]').forEach(function (btn) {
        btn.addEventListener('click', function () { toggleDetails(btn.dataset.job); });
    });
}

function toggleDetails(jobId) {
    const el = document.getElementById('details-' + jobId);
    const open = el.classList.contains('open');
    document.querySelectorAll('.details-row.open').forEach(function (d) { d.classList.remove('open'); });
    if (open) return;

    const job = allJobs.find(function (j) { return j.id === jobId; });
    el.innerHTML =
        '<h4>General</h4>Order ID: ' + job.id.slice(0, 8) + '<br>Delivery Date: ' + formatDate(job.delivered_at) + '<br>Review Date: ' + formatDate(job.review_edited_at || job.delivered_at) +
        '<h4>Customer</h4>' + escapeHtml(job.sender_name || '—') +
        '<h4>Ratings</h4>Overall: ' + '★'.repeat(job.rating) +
        '<br>Professionalism: ' + (job.rating_professionalism ? '★'.repeat(job.rating_professionalism) : '—') +
        '<br>Communication: ' + (job.rating_communication ? '★'.repeat(job.rating_communication) : '—') +
        '<br>Speed: ' + (job.rating_speed ? '★'.repeat(job.rating_speed) : '—') +
        '<br>Parcel Care: ' + (job.rating_parcel_condition ? '★'.repeat(job.rating_parcel_condition) : '—') +
        '<h4>Comment</h4>' + (job.rating_comment ? escapeHtml(job.rating_comment) : '<i>No written comment.</i>') +
        (job.review_image_url ? '<h4>Attachment</h4><img class="review-photo" src="' + escapeHtml(job.review_image_url) + '">' : '');
    el.classList.add('open');
}
