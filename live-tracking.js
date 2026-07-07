let map = null;
let marker = null;

document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireSession('login.html');
    if (!user) return;

    const jobId = new URLSearchParams(window.location.search).get('job');
    if (!jobId) { window.location.href = 'dashboard.html'; return; }

    map = L.map('trackMap').setView([-29.6, 30.9], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);

    function update(job) {
        if (job.status === 'delivered') {
            window.location.href = 'delivery-completed.html?job=' + jobId;
            return;
        }
        if (job.driver_lat && job.driver_lng) {
            document.getElementById('trackNote').classList.add('hidden');
            const pos = [job.driver_lat, job.driver_lng];
            if (!marker) {
                marker = L.marker(pos, { icon: L.divIcon({ html: '🚚', className: 'driver-marker', iconSize: [28, 28] }) }).addTo(map);
            } else {
                marker.setLatLng(pos);
            }
            map.setView(pos, 13);
        }
    }

    const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).single();
    if (job) update(job);

    supabase
        .channel('job-track-' + jobId)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs', filter: 'id=eq.' + jobId }, function (payload) {
            update(payload.new);
        })
        .subscribe();
});
