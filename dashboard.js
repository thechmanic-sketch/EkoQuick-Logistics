let currentUser = null;

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('login.html');
    if (!currentUser) return;

    const profile = await getProfile(currentUser.id);
    if (profile && profile.full_name) {
        document.getElementById('welcomeText').textContent = 'Welcome back, ' + profile.full_name.split(' ')[0] + '!';
    }
    if (profile && profile.avatar_url) {
        const preview = document.getElementById('avatarPreview');
        preview.src = profile.avatar_url;
        preview.classList.remove('hidden');
    }

    document.getElementById('avatarSaveBtn').addEventListener('click', saveAvatar);

    document.getElementById('logoutBtn').addEventListener('click', async function () {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });

    loadJobs();
});

async function saveAvatar() {
    const file = document.getElementById('avatarFile').files[0];
    if (!file) { alert('Choose a photo first'); return; }

    const btn = document.getElementById('avatarSaveBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const path = currentUser.id + '/avatar-' + Date.now() + '.' + (file.name.split('.').pop() || 'jpg');
        const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
        if (uploadError) throw uploadError;

        const publicUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
        const { error } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', currentUser.id);
        if (error) throw error;

        const preview = document.getElementById('avatarPreview');
        preview.src = publicUrl;
        preview.classList.remove('hidden');
    } catch (err) {
        alert('Failed to save photo: ' + (err && err.message ? err.message : err));
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save photo';
    }
}

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
