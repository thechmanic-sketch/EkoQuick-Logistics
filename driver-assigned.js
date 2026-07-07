document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireSession('login.html');
    if (!user) return;

    const jobId = new URLSearchParams(window.location.search).get('job');
    if (!jobId) { window.location.href = 'dashboard.html'; return; }

    document.getElementById('trackBtn').href = 'live-tracking.html?job=' + jobId;

    async function refresh() {
        const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).single();
        if (!job) return;

        if (job.status === 'in_progress') {
            window.location.href = 'live-tracking.html?job=' + jobId;
            return;
        }
        if (job.status === 'delivered') {
            window.location.href = 'delivery-completed.html?job=' + jobId;
            return;
        }

        if (job.driver_id) {
            const { data: driver } = await supabase.from('profiles').select('full_name').eq('id', job.driver_id).single();
            document.getElementById('statusTitle').textContent = 'Driver Assigned!';
            document.getElementById('statusSubtitle').textContent = 'Your driver is preparing for pickup.';
            document.getElementById('driverName').textContent = driver ? driver.full_name : 'Your driver';
            document.getElementById('jobRoute').textContent = job.pickup + ' → ' + job.dropoff;
            document.getElementById('driverInfo').classList.remove('hidden');
            document.getElementById('trackBtn').classList.remove('hidden');
        }
    }

    refresh();
    supabase
        .channel('job-assigned-' + jobId)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs', filter: 'id=eq.' + jobId }, refresh)
        .subscribe();
});
