let driversCache = [];
let allJobsCache = [];

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
    document.getElementById('refreshBtn').addEventListener('click', loadJobs);
    document.getElementById('jobSearch').addEventListener('input', applyJobFilters);
    document.getElementById('jobStatusFilter').addEventListener('change', applyJobFilters);

    await loadDriverShare();
    loadJobs();
    supabase.channel('admin-jobs-page').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadJobs).subscribe();
});

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function vehicleLabel(id) {
    const v = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).find(function (x) { return x.id === id; });
    return v ? v.icon + ' ' + v.label : '';
}

function formatTime(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function whatsappResend(phone, message) {
    const digits = (phone || '').replace(/[^0-9]/g, '');
    if (!digits) { alert('No phone number on file for this contact.'); return; }
    window.open('https://wa.me/' + digits + '?text=' + encodeURIComponent(message), '_blank', 'noopener');
}

const STATUS_LABELS = {
    pending: 'Pending',
    offered: 'Awaiting driver',
    to_pickup: 'Heading to pickup',
    to_dropoff: 'Heading to drop-off',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
};

async function loadJobs() {
    const list = document.getElementById('jobsList');
    const { data: jobs, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    if (error) { list.innerHTML = '<div class="empty">Failed to load jobs: ' + error.message + '</div>'; return; }

    const { data: drivers } = await supabase.from('profiles').select('id, full_name, vehicle_class').eq('role', 'driver');
    driversCache = drivers || [];
    allJobsCache = jobs || [];

    applyJobFilters();
}

function applyJobFilters() {
    const query = (document.getElementById('jobSearch').value || '').trim().toLowerCase();
    const status = document.getElementById('jobStatusFilter').value;

    let filtered = allJobsCache;
    if (status) filtered = filtered.filter(function (j) { return j.status === status; });
    if (query) {
        filtered = filtered.filter(function (j) {
            return (j.pickup || '').toLowerCase().indexOf(query) !== -1 ||
                (j.dropoff || '').toLowerCase().indexOf(query) !== -1 ||
                (j.customer_phone || '').toLowerCase().indexOf(query) !== -1 ||
                (j.receiver_phone || '').toLowerCase().indexOf(query) !== -1;
        });
    }
    renderJobsList(filtered);
}

function renderJobsList(jobs) {
    const list = document.getElementById('jobsList');
    if (!jobs || jobs.length === 0) { list.innerHTML = '<div class="empty">No jobs match.</div>'; return; }

    const driverOptions = driversCache.map(function (d) {
        return '<option value="' + d.id + '">' + escapeHtml(d.full_name || d.id) + ' — ' + vehicleLabel(d.vehicle_class) + '</option>';
    }).join('');

    list.innerHTML = jobs.map(function (job) {
        const isDone = job.status === 'delivered' || job.status === 'cancelled';

        const codesHtml =
            (job.collection_code
                ? '<div class="meta">Pickup code: <b>' + escapeHtml(job.collection_code) + '</b> ' +
                    '<button class="btn btn-outline-blue" style="width:auto; display:inline-block; padding:4px 10px; font-size:10px;" data-job="' + job.id + '" data-action="resend-collection">Resend</button></div>'
                : '') +
            (job.delivery_code
                ? '<div class="meta" style="margin-top:4px;">Delivery code: <b>' + escapeHtml(job.delivery_code) + '</b> ' +
                    '<button class="btn btn-outline-blue" style="width:auto; display:inline-block; padding:4px 10px; font-size:10px;" data-job="' + job.id + '" data-action="resend-delivery">Resend</button></div>'
                : '');

        const timelineHtml = isDone
            ? '<div class="meta" style="margin-top: 8px; line-height:1.8;">' +
                'Booked: ' + (formatTime(job.created_at) || '—') + '<br>' +
                'Accepted (heading to pickup): ' + (formatTime(job.to_pickup_at) || '—') + '<br>' +
                'Picked up (heading to drop-off): ' + (formatTime(job.to_dropoff_at) || '—') + '<br>' +
                'Delivered: ' + (formatTime(job.delivered_at) || '—') +
              '</div>'
            : '';

        const assignHtml = isDone ? '' :
            '<div style="margin-top: 10px;">' +
                '<select class="field-plain" id="driverSelect-' + job.id + '" style="margin-bottom: 8px;">' +
                    '<option value="">Assign a driver...</option>' +
                    driverOptions +
                '</select>' +
                '<button class="btn btn-blue" data-job="' + job.id + '" data-action="assign">Assign Driver</button>' +
            '</div>';

        return (
            '<div class="job">' +
                '<div class="route">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                '<div class="meta">' + vehicleLabel(job.vehicle) + ' • ' + (job.distance || 0) + ' km • R' + (job.quote || 0) +
                    ' (driver R' + driverEarning(job.quote).toFixed(2) + ' / us R' + platformFee(job.quote).toFixed(2) + ')' +
                    ' • Customer: ' + escapeHtml(job.customer_phone || '') + '</div>' +
                (job.receiver_name ? '<div class="meta">Receiver: ' + escapeHtml(job.receiver_name) + '</div>' : '') +
                '<span class="badge ' + job.status + '">' + (STATUS_LABELS[job.status] || job.status) + '</span>' +
                (job.rating ? '<div class="meta" style="margin-top: 6px;">Rating: ' + '★'.repeat(job.rating) + (job.rating_comment ? ' — "' + escapeHtml(job.rating_comment) + '"' : '') + '</div>' : '') +
                (codesHtml ? '<div style="margin-top: 8px;">' + codesHtml + '</div>' : '') +
                timelineHtml +
                assignHtml +
            '</div>'
        );
    }).join('');

    jobs.forEach(function (job) {
        if (job.driver_id) {
            const sel = document.getElementById('driverSelect-' + job.id);
            if (sel) sel.value = job.driver_id;
        }
    });

    list.querySelectorAll('button[data-action="assign"]').forEach(function (btn) {
        btn.addEventListener('click', function () { assignDriver(btn.dataset.job); });
    });
    list.querySelectorAll('button[data-action="resend-collection"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const job = jobs.find(function (j) { return j.id === btn.dataset.job; });
            if (!job) return;
            whatsappResend(job.customer_phone, 'Ekoquick pickup code reminder: ' + job.collection_code + ' — give this to your driver at pickup.');
        });
    });
    list.querySelectorAll('button[data-action="resend-delivery"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const job = jobs.find(function (j) { return j.id === btn.dataset.job; });
            if (!job) return;
            whatsappResend(job.receiver_phone, 'Ekoquick delivery code reminder: ' + job.delivery_code + ' — give this to the driver when your parcel arrives.');
        });
    });
}

async function assignDriver(jobId) {
    const sel = document.getElementById('driverSelect-' + jobId);
    const driverId = sel.value;
    if (!driverId) { alert('Please select a driver'); return; }
    const { error } = await supabase.from('jobs').update({ driver_id: driverId, status: 'offered' }).eq('id', jobId);
    if (error) { alert('Failed to assign driver: ' + error.message); return; }
    loadJobs();
}
