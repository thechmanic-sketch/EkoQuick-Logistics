let currentUser = null;
let driversCache = [];

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('admin-login.html');
    if (!currentUser) return;

    const profile = await getProfile(currentUser.id);
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

    loadJobs();
});

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

const STATUS_LABELS = {
    pending: 'Pending',
    assigned: 'Assigned',
    in_progress: 'In Progress',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
};

async function loadJobs() {
    const list = document.getElementById('jobsList');
    const { data: jobs, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    if (error) { list.innerHTML = '<div class="empty">Failed to load jobs: ' + error.message + '</div>'; return; }

    const { data: drivers } = await supabase.from('profiles').select('id, full_name').eq('role', 'driver');
    driversCache = drivers || [];

    if (!jobs || jobs.length === 0) { list.innerHTML = '<div class="empty">No jobs yet.</div>'; return; }

    const driverOptions = driversCache.map(function (d) {
        return '<option value="' + d.id + '">' + escapeHtml(d.full_name || d.id) + '</option>';
    }).join('');

    list.innerHTML = jobs.map(function (job) {
        return (
            '<div class="job">' +
                '<div class="route">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                '<div class="meta">' + (job.distance || 0) + ' km • R' + (job.quote || 0) + ' • Customer: ' + escapeHtml(job.customer_phone || '') + '</div>' +
                '<span class="badge ' + job.status + '">' + (STATUS_LABELS[job.status] || job.status) + '</span>' +
                '<div style="margin-top: 10px;">' +
                    '<select class="field-plain" id="driverSelect-' + job.id + '" style="margin-bottom: 8px;">' +
                        '<option value="">Assign a driver...</option>' +
                        driverOptions +
                    '</select>' +
                    '<button class="btn btn-blue" data-job="' + job.id + '" data-action="assign">Assign Driver</button>' +
                '</div>' +
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
}

async function assignDriver(jobId) {
    const sel = document.getElementById('driverSelect-' + jobId);
    const driverId = sel.value;
    if (!driverId) { alert('Please select a driver'); return; }
    const { error } = await supabase.from('jobs').update({ driver_id: driverId, status: 'assigned' }).eq('id', jobId);
    if (error) { alert('Failed to assign driver: ' + error.message); return; }
    loadJobs();
}
