let currentUser = null;
let watchId = null;
let activeJobId = null;

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;

    const profile = await getProfile(currentUser.id);
    if (!profile || profile.role !== 'driver') {
        await supabase.auth.signOut();
        window.location.href = 'driver-login.html';
        return;
    }

    document.getElementById('logoutBtn').addEventListener('click', async function () {
        stopTracking();
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
    const { data: jobs, error } = await supabase.from('jobs').select('*').eq('driver_id', currentUser.id).order('created_at', { ascending: false });
    if (error) { list.innerHTML = '<div class="empty">Failed to load jobs: ' + error.message + '</div>'; return; }
    if (!jobs || jobs.length === 0) { list.innerHTML = '<div class="empty">No jobs assigned to you yet.</div>'; return; }

    list.innerHTML = jobs.map(function (job) {
        let actionBtn = '';
        if (job.status === 'assigned') {
            actionBtn = '<button class="btn btn-blue" data-job="' + job.id + '" data-action="start">Start Trip</button>';
        } else if (job.status === 'in_progress') {
            actionBtn = '<button class="btn btn-outline-blue" data-job="' + job.id + '" data-action="deliver">Mark Delivered</button>';
        }
        return (
            '<div class="job">' +
                '<div class="route">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                '<div class="meta">' + (job.distance || 0) + ' km • R' + (job.quote || 0) + ' • Customer: ' + escapeHtml(job.customer_phone || '') + '</div>' +
                '<span class="badge ' + job.status + '">' + (STATUS_LABELS[job.status] || job.status) + '</span>' +
                (actionBtn ? '<div style="margin-top: 10px;">' + actionBtn + '</div>' : '') +
            '</div>'
        );
    }).join('');

    list.querySelectorAll('button[data-action="start"]').forEach(function (btn) {
        btn.addEventListener('click', function () { startTrip(btn.dataset.job); });
    });
    list.querySelectorAll('button[data-action="deliver"]').forEach(function (btn) {
        btn.addEventListener('click', function () { markDelivered(btn.dataset.job); });
    });
}

async function startTrip(jobId) {
    const { error } = await supabase.from('jobs').update({ status: 'in_progress' }).eq('id', jobId);
    if (error) { alert('Failed to start trip: ' + error.message); return; }
    beginTracking(jobId);
    loadJobs();
}

function beginTracking(jobId) {
    if (!navigator.geolocation) { alert('Geolocation is not supported on this device'); return; }
    stopTracking();
    activeJobId = jobId;
    watchId = navigator.geolocation.watchPosition(async function (pos) {
        await supabase.from('jobs').update({
            driver_lat: pos.coords.latitude,
            driver_lng: pos.coords.longitude,
        }).eq('id', jobId);
    }, function () {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
}

function stopTracking() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    activeJobId = null;
}

async function markDelivered(jobId) {
    const { error } = await supabase.from('jobs').update({ status: 'delivered' }).eq('id', jobId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    if (activeJobId === jobId) stopTracking();
    loadJobs();
}
