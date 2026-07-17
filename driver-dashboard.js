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
        let actionArea = '';
        if (job.status === 'assigned') {
            actionArea =
                '<label>Pickup code (ask the sender)</label>' +
                '<input class="field-plain" id="collectionInput-' + job.id + '" placeholder="4-digit code">' +
                '<div class="msg error hidden" id="collectionError-' + job.id + '"></div>' +
                '<button class="btn btn-blue" data-job="' + job.id + '" data-action="start">Start Trip</button>';
        } else if (job.status === 'in_progress') {
            actionArea =
                '<label>Delivery code (ask the receiver)</label>' +
                '<input class="field-plain" id="deliveryInput-' + job.id + '" placeholder="4-digit code">' +
                '<div class="msg error hidden" id="deliveryError-' + job.id + '"></div>' +
                '<div class="msg error hidden" id="locError-' + job.id + '"></div>' +
                '<button class="btn btn-outline-blue" data-job="' + job.id + '" data-action="deliver">Mark Delivered</button>';
        }
        return (
            '<div class="job">' +
                '<div class="route">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                '<div class="meta">' + (job.distance || 0) + ' km • R' + (job.quote || 0) + '</div>' +
                '<div class="meta">Sender: ' + escapeHtml(job.customer_phone || '') + '</div>' +
                '<div class="meta">Receiver: ' + escapeHtml(job.receiver_name || '') + (job.receiver_phone ? ' (' + escapeHtml(job.receiver_phone) + ')' : '') + '</div>' +
                '<span class="badge ' + job.status + '">' + (STATUS_LABELS[job.status] || job.status) + '</span>' +
                (actionArea ? '<div style="margin-top: 10px;">' + actionArea + '</div>' : '') +
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

function showJobError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
}

async function startTrip(jobId) {
    const { data: job } = await supabase.from('jobs').select('collection_code').eq('id', jobId).single();
    const entered = (document.getElementById('collectionInput-' + jobId).value || '').trim();

    if (job && job.collection_code && entered !== job.collection_code) {
        showJobError('collectionError-' + jobId, 'Incorrect pickup code — ask the sender to confirm it.');
        return;
    }

    const { error } = await supabase.from('jobs').update({ status: 'in_progress' }).eq('id', jobId);
    if (error) { alert('Failed to start trip: ' + error.message); return; }
    beginTracking(jobId);
    loadJobs();
}

function beginTracking(jobId) {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported on this device — live tracking will not work for this trip.');
        return;
    }
    stopTracking();
    activeJobId = jobId;
    watchId = navigator.geolocation.watchPosition(
        async function (pos) {
            await supabase.from('jobs').update({
                driver_lat: pos.coords.latitude,
                driver_lng: pos.coords.longitude,
            }).eq('id', jobId);
        },
        function (err) {
            var message = err && err.code === 1
                ? 'Location permission was denied — the customer will not see your live position. Please enable location access and start the trip again.'
                : 'Could not get your location (' + (err ? err.message : 'unknown error') + ') — live tracking may not work.';
            var errEl = document.getElementById('locError-' + jobId);
            if (errEl) { errEl.textContent = message; errEl.classList.remove('hidden'); }
            else alert(message);
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
}

function stopTracking() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    activeJobId = null;
}

async function markDelivered(jobId) {
    const { data: job } = await supabase.from('jobs').select('delivery_code').eq('id', jobId).single();
    const entered = (document.getElementById('deliveryInput-' + jobId).value || '').trim();

    if (job && job.delivery_code && entered !== job.delivery_code) {
        showJobError('deliveryError-' + jobId, 'Incorrect delivery code — ask the receiver to confirm it.');
        return;
    }

    const { error } = await supabase.from('jobs').update({ status: 'delivered' }).eq('id', jobId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    if (activeJobId === jobId) stopTracking();
    loadJobs();
}
