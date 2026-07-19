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

    loadReviews();
    supabase.channel('reviews-page').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadReviews).subscribe();
});

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

async function loadReviews() {
    const el = document.getElementById('reviewsList');
    const { data: jobs, error } = await supabase.from('jobs').select('*').not('rating', 'is', null).order('rating', { ascending: true });
    if (error) { el.innerHTML = '<div class="empty">Failed to load: ' + error.message + '</div>'; return; }

    if (!jobs || !jobs.length) { el.innerHTML = '<div class="empty">No reviews yet.</div>'; return; }

    const driverIds = [...new Set(jobs.map(function (j) { return j.driver_id; }).filter(Boolean))];
    const { data: drivers } = driverIds.length
        ? await supabase.from('profiles').select('id, full_name').in('id', driverIds)
        : { data: [] };
    const nameById = {};
    (drivers || []).forEach(function (d) { nameById[d.id] = d.full_name; });

    el.innerHTML = jobs.map(function (job) {
        const isComplaint = job.rating <= 2;
        return (
            '<div class="job">' +
                (isComplaint ? '<span class="badge cancelled">Complaint</span>' : '') +
                '<div class="route" style="margin-top: 6px;">' + '★'.repeat(job.rating) + '☆'.repeat(5 - job.rating) + ' — ' + escapeHtml(nameById[job.driver_id] || 'Unknown driver') + '</div>' +
                '<div class="meta">' + escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff) + '</div>' +
                (job.rating_comment ? '<div class="meta" style="margin-top:6px;">"' + escapeHtml(job.rating_comment) + '"</div>' : '') +
                '<div class="meta">Customer: ' + escapeHtml(job.customer_phone || '') + '</div>' +
            '</div>'
        );
    }).join('');
}
