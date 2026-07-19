const CATEGORY_LABELS = {
    late_delivery: 'Late Delivery',
    rude_behaviour: 'Rude Behaviour',
    dangerous_driving: 'Dangerous Driving',
    damaged_package: 'Damaged Package',
    missing_package: 'Missing Package',
    wrong_delivery: 'Wrong Delivery',
    fraud: 'Fraud',
    poor_communication: 'Poor Communication',
    vehicle_hygiene: 'Vehicle Hygiene',
    other: 'Other',
};

let allJobs = [];
let allComplaints = [];
let allNotes = [];
let allAttachments = [];
let profilesById = {};
let activeTab = 'reviews';

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
    document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);
    document.getElementById('reviewSearch').addEventListener('input', renderReviews);
    document.getElementById('reviewSortBy').addEventListener('change', renderReviews);
    document.getElementById('statusFilter').addEventListener('change', renderComplaints);
    document.getElementById('priorityFilter').addEventListener('change', renderComplaints);
    document.getElementById('newComplaintBtn').addEventListener('click', function () { openComplaintForm(); });

    document.querySelectorAll('.cmd-tab').forEach(function (tab) {
        tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
    });

    await loadAll();

    supabase.channel('reviews-page-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadAll).subscribe();
    supabase.channel('reviews-page-complaints').on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' }, loadAll).subscribe();
    supabase.channel('reviews-page-attachments').on('postgres_changes', { event: '*', schema: 'public', table: 'complaint_attachments' }, loadAll).subscribe();
});

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.cmd-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === tab); });
    document.getElementById('reviewsTab').classList.toggle('hidden', tab !== 'reviews');
    document.getElementById('complaintsTab').classList.toggle('hidden', tab !== 'complaints');
}

async function loadAll() {
    const { data: jobs } = await supabase.from('jobs').select('*').not('rating', 'is', null).order('created_at', { ascending: false });
    const { data: complaints } = await supabase.from('complaints').select('*').order('created_at', { ascending: false });
    const { data: notes } = await supabase.from('complaint_notes').select('*').order('created_at', { ascending: true });
    const { data: attachments } = await supabase.from('complaint_attachments').select('*').order('created_at', { ascending: false });
    const { data: profiles } = await supabase.from('profiles').select('id, full_name, phone, vehicle_class, account_status');

    allJobs = jobs || [];
    allComplaints = complaints || [];
    allNotes = notes || [];
    allAttachments = attachments || [];
    profilesById = {};
    (profiles || []).forEach(function (p) { profilesById[p.id] = p; });

    document.getElementById('headerLabel').textContent = allJobs.length + ' review' + (allJobs.length === 1 ? '' : 's') + ' · ' + allComplaints.length + ' complaint' + (allComplaints.length === 1 ? '' : 's');

    renderReviewSummary();
    renderReviews();
    renderComplaintSummary();
    renderComplaints();
}

// ---------------------------------------------------------------------
// Reviews tab
// ---------------------------------------------------------------------

function renderReviewSummary() {
    const total = allJobs.length;
    const avg = total ? (allJobs.reduce(function (s, j) { return s + j.rating; }, 0) / total) : null;
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    allJobs.forEach(function (j) { counts[j.rating] = (counts[j.rating] || 0) + 1; });

    function card(title, value) {
        return '<div class="kpi-card"><div class="kpi-title">' + title + '</div><div class="kpi-value">' + value + '</div></div>';
    }
    document.getElementById('reviewSummaryCards').innerHTML =
        card('Average Rating', avg ? avg.toFixed(1) + ' ★' : 'No ratings yet') +
        card('Total Reviews', total) +
        card('5★', counts[5]) + card('4★', counts[4]) + card('3★', counts[3]) + card('2★', counts[2]) + card('1★', counts[1]);

    const breakdown = document.getElementById('ratingBreakdown');
    if (!total) { breakdown.innerHTML = '<div class="empty">No reviews yet.</div>'; return; }
    breakdown.innerHTML = [5, 4, 3, 2, 1].map(function (star) {
        const pct = Math.round((counts[star] / total) * 100);
        return '<div class="rating-bar-row"><span style="width:70px;">' + '★'.repeat(star) + '</span>' +
            '<div class="rating-bar-track"><div class="rating-bar-fill" style="width:' + pct + '%;"></div></div>' +
            '<span style="width:40px; text-align:right;">' + pct + '%</span></div>';
    }).join('');
}

function renderReviews() {
    const el = document.getElementById('reviewsList');
    if (!allJobs.length) { el.innerHTML = '<div class="empty">No reviews yet.</div>'; return; }

    const q = document.getElementById('reviewSearch').value.trim().toLowerCase();
    const sortBy = document.getElementById('reviewSortBy').value;

    let list = allJobs.filter(function (j) {
        if (!q) return true;
        const driver = profilesById[j.driver_id];
        const hay = ((driver ? driver.full_name : '') + ' ' + (j.customer_phone || '')).toLowerCase();
        return hay.indexOf(q) !== -1;
    });

    list = list.slice().sort(function (a, b) {
        if (sortBy === 'dateAsc') return new Date(a.created_at) - new Date(b.created_at);
        if (sortBy === 'ratingAsc') return a.rating - b.rating;
        if (sortBy === 'ratingDesc') return b.rating - a.rating;
        return new Date(b.created_at) - new Date(a.created_at);
    });

    if (!list.length) { el.innerHTML = '<div class="empty">No reviews match your search.</div>'; return; }

    el.innerHTML = list.map(function (job) {
        const driver = profilesById[job.driver_id];
        const isComplaint = job.rating <= 2;
        return (
            '<div class="job">' +
                (isComplaint ? '<span class="badge cancelled">Low Rating</span> ' : '') +
                (job.review_hidden ? '<span class="badge cancelled">Hidden</span>' : '<span class="badge delivered">Visible</span>') +
                '<div class="route" style="margin-top: 6px;">' + '★'.repeat(job.rating) + '☆'.repeat(5 - job.rating) + ' — ' + escapeHtml(driver ? driver.full_name : 'Unknown driver') + '</div>' +
                '<div class="meta">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + ' · Order ' + job.id.slice(0, 8) + '</div>' +
                '<div class="meta">Customer: ' + escapeHtml(job.customer_phone || '—') + ' · ' + new Date(job.created_at).toLocaleDateString('en-ZA') + '</div>' +
                (job.rating_comment ? '<div class="meta" style="margin-top:6px;">"' + escapeHtml(job.rating_comment) + '"</div>' : '') +
                (job.review_reply ? '<div class="meta" style="margin-top:6px; padding-left:10px; border-left:2px solid var(--orange);">Admin reply: "' + escapeHtml(job.review_reply) + '"</div>' : '') +
                '<div style="margin-top: 10px; display:flex; gap:8px; flex-wrap:wrap;">' +
                    '<button class="btn btn-outline-blue" style="width:auto;" data-action="reply" data-job="' + job.id + '">' + (job.review_reply ? 'Edit Reply' : 'Reply') + '</button>' +
                    '<button class="btn btn-outline-blue" style="width:auto;" data-action="toggle-hide" data-job="' + job.id + '">' + (job.review_hidden ? 'Unhide' : 'Hide') + '</button>' +
                    '<button class="btn btn-outline-blue" style="width:auto;" data-action="report-abuse" data-job="' + job.id + '">Report Abuse</button>' +
                '</div>' +
            '</div>'
        );
    }).join('');

    el.querySelectorAll('button[data-action="reply"]').forEach(function (btn) {
        btn.addEventListener('click', function () { replyToReview(btn.dataset.job); });
    });
    el.querySelectorAll('button[data-action="toggle-hide"]').forEach(function (btn) {
        btn.addEventListener('click', function () { toggleHideReview(btn.dataset.job); });
    });
    el.querySelectorAll('button[data-action="report-abuse"]').forEach(function (btn) {
        btn.addEventListener('click', function () { openComplaintForm(btn.dataset.job); });
    });
}

async function replyToReview(jobId) {
    const job = allJobs.find(function (j) { return j.id === jobId; });
    const reply = prompt('Reply to this review (visible to customer support records):', job.review_reply || '');
    if (reply === null) return;
    const { error } = await supabase.from('jobs').update({ review_reply: reply.trim() || null, review_reply_at: new Date().toISOString() }).eq('id', jobId);
    if (error) { alert('Failed to save reply: ' + error.message); return; }
    loadAll();
}

async function toggleHideReview(jobId) {
    const job = allJobs.find(function (j) { return j.id === jobId; });
    const { error } = await supabase.from('jobs').update({ review_hidden: !job.review_hidden }).eq('id', jobId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    loadAll();
}

// ---------------------------------------------------------------------
// Complaints tab
// ---------------------------------------------------------------------

function renderComplaintSummary() {
    const total = allComplaints.length;
    const open = allComplaints.filter(function (c) { return c.status === 'open'; }).length;
    const investigating = allComplaints.filter(function (c) { return c.status === 'investigating'; }).length;
    const resolved = allComplaints.filter(function (c) { return c.status === 'resolved'; }).length;
    const dismissed = allComplaints.filter(function (c) { return c.status === 'dismissed'; }).length;

    function card(title, value) {
        return '<div class="kpi-card"><div class="kpi-title">' + title + '</div><div class="kpi-value">' + value + '</div></div>';
    }
    document.getElementById('complaintSummaryCards').innerHTML =
        card('Total Complaints', total) + card('Open', open) + card('Under Investigation', investigating) +
        card('Resolved', resolved) + card('Dismissed', dismissed);
}

function renderComplaints() {
    const wrap = document.getElementById('complaintsTableWrap');
    if (!allComplaints.length) { wrap.innerHTML = '<div class="empty">No complaints logged yet.</div>'; return; }

    const statusFilter = document.getElementById('statusFilter').value;
    const priorityFilter = document.getElementById('priorityFilter').value;
    let list = allComplaints.filter(function (c) {
        if (statusFilter && c.status !== statusFilter) return false;
        if (priorityFilter && c.priority !== priorityFilter) return false;
        return true;
    });

    if (!list.length) { wrap.innerHTML = '<div class="empty">No complaints match your filters.</div>'; return; }

    wrap.innerHTML =
        '<table class="simple-table"><thead><tr>' +
        '<th>Complaint ID</th><th>Customer</th><th>Order</th><th>Category</th><th>Priority</th><th>Status</th><th>Date</th><th>Assigned</th><th></th>' +
        '</tr></thead><tbody>' +
        list.map(function (c) {
            const customer = profilesById[c.customer_id];
            const statusBadge = c.status === 'resolved' ? 'delivered' : c.status === 'dismissed' ? 'cancelled' : c.status === 'investigating' ? 'assigned' : 'pending';
            const priorityBadge = c.priority === 'high' ? 'cancelled' : c.priority === 'low' ? 'delivered' : 'pending';
            return '<tr style="cursor:pointer;" data-complaint="' + c.id + '">' +
                '<td>' + c.id.slice(0, 8) + '</td>' +
                '<td>' + escapeHtml(customer ? customer.full_name : '—') + '</td>' +
                '<td>' + (c.job_id ? c.job_id.slice(0, 8) : '—') + '</td>' +
                '<td>' + (CATEGORY_LABELS[c.category] || c.category) + '</td>' +
                '<td><span class="badge ' + priorityBadge + '">' + c.priority + '</span></td>' +
                '<td><span class="badge ' + statusBadge + '">' + c.status + '</span></td>' +
                '<td>' + new Date(c.created_at).toLocaleDateString('en-ZA') + '</td>' +
                '<td>' + escapeHtml(c.assigned_staff || '—') + '</td>' +
                '<td><button class="btn btn-outline-blue" style="width:auto;" data-action="open-complaint" data-complaint="' + c.id + '">View</button></td>' +
                '</tr>';
        }).join('') +
        '</tbody></table>';

    wrap.querySelectorAll('tr[data-complaint]').forEach(function (row) {
        row.addEventListener('click', function (e) { if (e.target.closest('button')) return; openComplaintDrawer(row.dataset.complaint); });
    });
    wrap.querySelectorAll('button[data-action="open-complaint"]').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); openComplaintDrawer(btn.dataset.complaint); });
    });
}

function closeDrawer() {
    document.getElementById('complaintDrawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('open');
}

function computeDriverRisk(driverId) {
    const ratedJobs = allJobs.filter(function (j) { return j.driver_id === driverId; });
    const avgRating = ratedJobs.length ? (ratedJobs.reduce(function (s, j) { return s + j.rating; }, 0) / ratedJobs.length) : null;
    const driverComplaints = allComplaints.filter(function (c) { return c.driver_id === driverId; });
    const openComplaints = driverComplaints.filter(function (c) { return c.status === 'open' || c.status === 'investigating'; }).length;
    const resolvedComplaints = driverComplaints.filter(function (c) { return c.status === 'resolved'; }).length;
    const lastComplaint = driverComplaints.length ? driverComplaints.reduce(function (a, b) { return new Date(a.created_at) > new Date(b.created_at) ? a : b; }) : null;
    const hasUnresolvedSerious = driverComplaints.some(function (c) { return c.priority === 'high' && (c.status === 'open' || c.status === 'investigating'); });

    let risk = 'low';
    if ((avgRating !== null && avgRating < 3.5) || driverComplaints.length > 5 || hasUnresolvedSerious) risk = 'high';
    else if ((avgRating !== null && avgRating >= 3.5 && avgRating <= 4.5) || (driverComplaints.length >= 3 && driverComplaints.length <= 5)) risk = 'medium';

    return { avgRating: avgRating, complaintCount: driverComplaints.length, openComplaints: openComplaints, resolvedComplaints: resolvedComplaints, lastComplaint: lastComplaint, risk: risk };
}

function openComplaintForm(jobId) {
    const job = jobId ? allJobs.find(function (j) { return j.id === jobId; }) : null;
    const drawer = document.getElementById('complaintDrawer');
    const categoryOptions = Object.keys(CATEGORY_LABELS).map(function (k) { return '<option value="' + k + '">' + CATEGORY_LABELS[k] + '</option>'; }).join('');

    drawer.innerHTML =
        '<button class="drawer-close" id="closeDrawerBtn">✕</button>' +
        '<h2 style="margin-top:0;">New Complaint</h2>' +
        (job ? '<div class="meta">From review on order ' + job.id.slice(0, 8) + '</div>' : '') +
        '<label>Category</label>' +
        '<select class="field-plain" id="newCategory">' + categoryOptions + '</select>' +
        '<label>Priority</label>' +
        '<select class="field-plain" id="newPriority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select>' +
        '<label>Description</label>' +
        '<textarea class="field-plain" id="newDescription" rows="4">' + (job && job.rating_comment ? escapeHtml(job.rating_comment) : '') + '</textarea>' +
        '<button class="btn btn-blue" id="createComplaintBtn" style="margin-top:10px;">Create Complaint</button>';

    document.getElementById('closeDrawerBtn').addEventListener('click', closeDrawer);
    document.getElementById('createComplaintBtn').addEventListener('click', async function () {
        const category = document.getElementById('newCategory').value;
        const priority = document.getElementById('newPriority').value;
        const description = document.getElementById('newDescription').value.trim();
        if (!description) { alert('Description is required.'); return; }
        const { error } = await supabase.from('complaints').insert({
            customer_id: job ? job.customer_id : null,
            driver_id: job ? job.driver_id : null,
            job_id: job ? job.id : null,
            category: category,
            priority: priority,
            description: description,
        });
        if (error) { alert('Failed to create complaint: ' + error.message); return; }
        closeDrawer();
        switchTab('complaints');
        loadAll();
    });

    drawer.classList.add('open');
    document.getElementById('drawerBackdrop').classList.add('open');
}

function timelineStep(label, ts) {
    return '<div class="timeline-item"><span class="dot ' + (ts ? 'done' : 'pending') + '"></span><div>' + label + (ts ? ' — ' + new Date(ts).toLocaleString('en-ZA') : '') + '</div></div>';
}

function openComplaintDrawer(complaintId) {
    const c = allComplaints.find(function (x) { return x.id === complaintId; });
    if (!c) return;
    const customer = profilesById[c.customer_id];
    const driver = profilesById[c.driver_id];
    const job = c.job_id ? allJobs.find(function (j) { return j.id === c.job_id; }) : null;
    const notes = allNotes.filter(function (n) { return n.complaint_id === c.id; });
    const attachments = allAttachments.filter(function (a) { return a.complaint_id === c.id; });
    const risk = driver ? computeDriverRisk(c.driver_id) : null;

    const drawer = document.getElementById('complaintDrawer');
    drawer.innerHTML =
        '<button class="drawer-close" id="closeDrawerBtn">✕</button>' +
        '<h2 style="margin-top:0;">Complaint ' + c.id.slice(0, 8) + '</h2>' +

        (risk ? (
            '<h3>Driver Risk Summary</h3>' +
            kv('Average Rating', risk.avgRating ? risk.avgRating.toFixed(1) + ' ★' : 'No ratings yet') +
            kv('Complaint Count', risk.complaintCount) +
            kv('Open Complaints', risk.openComplaints) +
            kv('Resolved Complaints', risk.resolvedComplaints) +
            kv('Last Complaint Date', risk.lastComplaint ? new Date(risk.lastComplaint.created_at).toLocaleDateString('en-ZA') : '—') +
            '<div style="margin-top:6px;"><span class="risk-pill risk-' + risk.risk + '">' +
                (risk.risk === 'low' ? '🟢 Low Risk' : risk.risk === 'medium' ? '🟡 Medium Risk' : '🔴 High Risk') + '</span></div>'
        ) : '') +

        '<h3>Customer Information</h3>' +
        kv('Name', customer ? customer.full_name : '—') + kv('Phone', customer ? customer.phone : (job ? job.customer_phone : '—')) +

        '<h3>Driver Information</h3>' +
        (driver ? kv('Name', driver.full_name) + kv('Phone', driver.phone) + kv('Vehicle', vehicleLabel(driver.vehicle_class)) + kv('Account Status', driver.account_status) : '<div class="meta">No driver linked.</div>') +

        '<h3>Order Information</h3>' +
        (job ? kv('Route', job.pickup + ' → ' + job.dropoff) + kv('Order ID', job.id.slice(0, 8)) + kv('Fee', 'R' + (Number(job.quote) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })) : '<div class="meta">No order linked.</div>') +

        '<h3>Complaint Description</h3>' +
        '<div class="meta">' + escapeHtml(c.description) + '</div>' +
        kv('Category', CATEGORY_LABELS[c.category] || c.category) + kv('Priority', c.priority) + kv('Status', c.status) + kv('Assigned Staff', c.assigned_staff || '—') +

        '<h3>Supporting Images & Files</h3>' +
        '<div id="attachmentsList">' + (attachments.length ? attachments.map(function (a) {
            return '<div class="kv-row"><span>' + escapeHtml(a.file_name) + (a.uploaded_by ? ' <span style="color:var(--muted-dim);">· ' + escapeHtml(a.uploaded_by) + '</span>' : '') + '</span>' +
                '<span><button class="btn btn-outline-blue" style="width:auto; padding:2px 10px;" data-action="view-attachment" data-path="' + escapeHtml(a.file_path) + '">View</button> ' +
                '<button class="btn btn-outline-blue" style="width:auto; padding:2px 10px;" data-action="delete-attachment" data-id="' + a.id + '" data-path="' + escapeHtml(a.file_path) + '">✕</button></span></div>';
        }).join('') : '<div class="empty">No supporting images or files attached yet.</div>') + '</div>' +
        '<input type="file" id="attachmentFile" style="margin-top:8px; font-size:12px;">' +
        '<button class="btn btn-outline-blue" id="uploadAttachmentBtn" style="width:auto; margin-top:6px;">Upload</button>' +

        '<h3>Resolution Timeline</h3>' +
        timelineStep('Complaint Submitted', c.created_at) +
        timelineStep('Assigned', c.assigned_at) +
        timelineStep('Investigation Started', c.investigation_started_at) +
        timelineStep('Driver Contacted', c.driver_contacted_at) +
        timelineStep('Customer Contacted', c.customer_contacted_at) +
        timelineStep('Resolved', c.resolved_at) +
        timelineStep('Closed', c.closed_at) +

        '<h3>Internal Notes</h3>' +
        '<div id="notesList">' + (notes.length ? notes.map(function (n) {
            return '<div class="meta" style="margin-bottom:6px;">' + escapeHtml(n.note) + '<br><span style="color:var(--muted-dim); font-size:11px;">' + escapeHtml(n.author || 'Admin') + ' · ' + new Date(n.created_at).toLocaleString('en-ZA') + '</span></div>';
        }).join('') : '<div class="empty">No internal notes yet.</div>') + '</div>' +
        '<textarea class="field-plain" id="newNoteText" rows="2" placeholder="Add internal note..." style="margin-top:6px;"></textarea>' +
        '<button class="btn btn-outline-blue" id="addNoteBtn" style="width:auto; margin-top:6px;">Add Note</button>' +

        '<h3>Actions</h3>' +
        '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
            '<button class="btn btn-outline-blue" style="width:auto;" data-action="assign">Assign Investigator</button>' +
            (driver && driver.phone ? '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" target="_blank" href="https://wa.me/' + driver.phone.replace(/\D/g, '') + '" data-action="contact-driver">Contact Driver</a>' : '') +
            (customer && customer.phone ? '<a class="btn btn-outline-blue" style="width:auto; text-decoration:none; text-align:center;" target="_blank" href="https://wa.me/' + customer.phone.replace(/\D/g, '') + '" data-action="contact-customer">Contact Customer</a>' : '') +
            '<button class="btn btn-outline-blue" style="width:auto;" data-action="request-info">Request More Information</button>' +
            '<button class="btn btn-outline-blue" style="width:auto;" data-action="start-investigation">Start Investigation</button>' +
            '<button class="btn btn-blue" style="width:auto;" data-action="resolve">Resolve Complaint</button>' +
            '<button class="btn btn-outline-blue" style="width:auto;" data-action="dismiss">Dismiss Complaint</button>' +
            '<button class="btn btn-outline-blue" style="width:auto;" data-action="escalate">Escalate</button>' +
            (driver && driver.account_status === 'active' ? '<button class="btn btn-outline-blue" style="width:auto;" data-action="suspend-driver">Suspend Driver</button>' : '') +
        '</div>';

    document.getElementById('closeDrawerBtn').addEventListener('click', closeDrawer);
    document.getElementById('addNoteBtn').addEventListener('click', function () { addComplaintNote(c.id); });
    document.getElementById('uploadAttachmentBtn').addEventListener('click', function () { uploadComplaintAttachment(c.id); });
    drawer.querySelectorAll('button[data-action="view-attachment"]').forEach(function (btn) {
        btn.addEventListener('click', function () { viewAttachment(btn.dataset.path); });
    });
    drawer.querySelectorAll('button[data-action="delete-attachment"]').forEach(function (btn) {
        btn.addEventListener('click', function () { deleteAttachment(btn.dataset.id, btn.dataset.path, c.id); });
    });

    const actionHandlers = {
        'assign': function () { assignInvestigator(c.id); },
        'contact-driver': function () { logNote(c.id, 'Driver contacted via WhatsApp.'); supabase.from('complaints').update({ driver_contacted_at: new Date().toISOString() }).eq('id', c.id).then(loadAll); },
        'contact-customer': function () { logNote(c.id, 'Customer contacted via WhatsApp.'); supabase.from('complaints').update({ customer_contacted_at: new Date().toISOString() }).eq('id', c.id).then(loadAll); },
        'request-info': function () { requestMoreInfo(c.id); },
        'start-investigation': function () { updateComplaintStatus(c.id, 'investigating', { investigation_started_at: new Date().toISOString() }); },
        'resolve': function () { updateComplaintStatus(c.id, 'resolved', { resolved_at: new Date().toISOString(), closed_at: new Date().toISOString() }); },
        'dismiss': function () { updateComplaintStatus(c.id, 'dismissed', { closed_at: new Date().toISOString() }); },
        'escalate': function () { supabase.from('complaints').update({ priority: 'high' }).eq('id', c.id).then(function () { logNote(c.id, 'Complaint escalated to high priority.'); }); },
        'suspend-driver': function () {
            if (!confirm('Suspend this driver pending investigation?')) return;
            supabase.from('profiles').update({ account_status: 'paused' }).eq('id', c.driver_id).then(function () { logNote(c.id, 'Driver suspended pending investigation.'); });
        },
    };
    drawer.querySelectorAll('[data-action]').forEach(function (elm) {
        const action = elm.dataset.action;
        if (action === 'contact-driver' || action === 'contact-customer') return;
        elm.addEventListener('click', function () { actionHandlers[action](); });
    });

    drawer.classList.add('open');
    document.getElementById('drawerBackdrop').classList.add('open');
}

function kv(label, value) {
    return '<div class="kv-row"><span>' + label + '</span><span>' + escapeHtml(value === 0 ? '0' : (value || '—')) + '</span></div>';
}

function vehicleLabel(id) {
    const v = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).find(function (x) { return x.id === id; });
    return v ? v.icon + ' ' + v.label : (id || '—');
}

async function logNote(complaintId, text) {
    await supabase.from('complaint_notes').insert({ complaint_id: complaintId, author: window.currentAdminName || 'Admin', note: text });
    loadAll();
}

async function addComplaintNote(complaintId) {
    const text = document.getElementById('newNoteText').value.trim();
    if (!text) return;
    await logNote(complaintId, text);
    openComplaintDrawer(complaintId);
}

async function uploadComplaintAttachment(complaintId) {
    const input = document.getElementById('attachmentFile');
    const file = input.files[0];
    if (!file) { alert('Choose a file first.'); return; }

    const path = complaintId + '/' + Date.now() + '-' + file.name;
    const { error: uploadError } = await supabase.storage.from('complaint-evidence').upload(path, file);
    if (uploadError) { alert('Failed to upload: ' + uploadError.message); return; }

    const { error } = await supabase.from('complaint_attachments').insert({
        complaint_id: complaintId,
        file_path: path,
        file_name: file.name,
        file_type: file.type,
        uploaded_by: window.currentAdminName || 'Admin',
    });
    if (error) { alert('Failed to save attachment record: ' + error.message); return; }
    await loadAll();
    openComplaintDrawer(complaintId);
}

async function viewAttachment(path) {
    const { data, error } = await supabase.storage.from('complaint-evidence').createSignedUrl(path, 300);
    if (error) { alert('Failed to open file: ' + error.message); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
}

async function deleteAttachment(id, path, complaintId) {
    if (!confirm('Remove this attachment?')) return;
    await supabase.storage.from('complaint-evidence').remove([path]);
    await supabase.from('complaint_attachments').delete().eq('id', id);
    await loadAll();
    openComplaintDrawer(complaintId);
}

async function assignInvestigator(complaintId) {
    const name = prompt('Assign to (staff name):');
    if (!name) return;
    const { error } = await supabase.from('complaints').update({ assigned_staff: name.trim(), assigned_at: new Date().toISOString() }).eq('id', complaintId);
    if (error) { alert('Failed to assign: ' + error.message); return; }
    await logNote(complaintId, 'Assigned to ' + name.trim() + '.');
}

async function requestMoreInfo(complaintId) {
    const note = prompt('What information is being requested?');
    if (!note) return;
    await logNote(complaintId, 'Requested more information: ' + note.trim());
}

async function updateComplaintStatus(complaintId, status, extraFields) {
    const fields = Object.assign({ status: status }, extraFields || {});
    const { error } = await supabase.from('complaints').update(fields).eq('id', complaintId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    await logNote(complaintId, 'Status changed to "' + status + '".');
    closeDrawer();
    loadAll();
}
