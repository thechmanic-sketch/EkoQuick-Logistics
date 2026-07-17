let currentUser = null;

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('login.html');
    if (!currentUser) return;

    const profile = await getProfile(currentUser.id);
    if (profile && profile.full_name) {
        document.getElementById('welcomeText').textContent = 'Welcome back, ' + profile.full_name.split(' ')[0] + '!';
    }

    document.getElementById('logoutBtn').addEventListener('click', async function () {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });

    loadJobs();
});

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

const STATUS_LABELS = {
    pending: 'Waiting for driver assignment',
    offered: 'Waiting for driver to accept',
    to_pickup: 'Driver heading to pickup',
    to_dropoff: 'Driver on the way to you',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
};

async function loadJobs() {
    const list = document.getElementById('jobsList');
    const { data, error } = await supabase.from('jobs').select('*').eq('customer_id', currentUser.id).order('created_at', { ascending: false });

    if (error) { list.innerHTML = '<div class="empty">Failed to load deliveries.</div>'; return; }
    if (!data || data.length === 0) { list.innerHTML = '<div class="empty">No deliveries yet. Create your first one!</div>'; return; }

    list.innerHTML = data.map(function (job) {
        let actionHtml = '';
        if (job.status === 'offered') {
            actionHtml = '<a class="btn btn-outline-blue" href="driver-assigned.html?job=' + job.id + '">View Driver</a>';
        } else if (job.status === 'to_pickup' || job.status === 'to_dropoff') {
            actionHtml = '<a class="btn btn-outline-blue" href="live-tracking.html?job=' + job.id + '">Track Delivery</a>';
        } else if (job.status === 'delivered' && !job.rating) {
            actionHtml = '<a class="btn btn-outline-blue" href="rate-driver.html?job=' + job.id + '">Rate Driver</a>';
        }
        return (
            '<div class="job">' +
                '<div class="route">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                '<div class="meta">' + (job.distance || 0) + ' km • R' + (job.quote || 0) + '</div>' +
                '<span class="badge ' + job.status + '">' + (STATUS_LABELS[job.status] || job.status) + '</span>' +
                (actionHtml ? '<div style="margin-top:10px;">' + actionHtml + '</div>' : '') +
            '</div>'
        );
    }).join('');
}
