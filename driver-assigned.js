document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireSession('login.html');
    if (!user) return;

    const jobId = new URLSearchParams(window.location.search).get('job');
    if (!jobId) { window.location.href = 'dashboard.html'; return; }

    document.getElementById('trackBtn').href = 'live-tracking.html?job=' + jobId;

    let wiredCodes = false;

    async function refresh() {
        const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).single();
        if (!job) return;

        if (job.status === 'to_pickup' || job.status === 'to_dropoff') {
            window.location.href = 'live-tracking.html?job=' + jobId;
            return;
        }
        if (job.status === 'delivered') {
            window.location.href = 'delivery-completed.html?job=' + jobId;
            return;
        }

        if (job.collection_code && job.delivery_code) {
            document.getElementById('collectionCode').textContent = job.collection_code;
            document.getElementById('deliveryCode').textContent = job.delivery_code;
            document.getElementById('codesInfo').classList.remove('hidden');

            if (!wiredCodes) {
                wiredCodes = true;
                document.getElementById('sendCodeBtn').addEventListener('click', function () {
                    var msg = 'Ekoquick delivery for you.\n' +
                        'Route: ' + job.pickup + ' → ' + job.dropoff + '\n' +
                        'Your delivery code: ' + job.delivery_code + '\n' +
                        'Please give this code to the driver when your parcel arrives.';
                    var digits = (job.receiver_phone || '').replace(/[^0-9]/g, '');
                    window.open('https://wa.me/' + digits + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
                });
            }
        }

        if (job.driver_id) {
            const { data: driver } = await supabase.from('profiles').select('full_name, phone, avatar_url').eq('id', job.driver_id).single();
            document.getElementById('statusTitle').textContent = job.status === 'offered' ? 'Driver Found!' : 'Driver Assigned!';
            document.getElementById('statusSubtitle').textContent = job.status === 'offered'
                ? 'Waiting for the driver to accept your job.'
                : 'Your driver is preparing for pickup.';
            document.getElementById('driverName').textContent = driver ? driver.full_name : 'Your driver';
            document.getElementById('driverPhone').textContent = driver && driver.phone ? 'Contact: ' + driver.phone : '';
            document.getElementById('jobRoute').textContent = job.pickup + ' → ' + job.dropoff;
            if (driver && driver.avatar_url) {
                const avatar = document.getElementById('driverAvatar');
                avatar.src = driver.avatar_url;
                avatar.classList.remove('hidden');
            }
            document.getElementById('driverInfo').classList.remove('hidden');
            if (job.status !== 'offered') document.getElementById('trackBtn').classList.remove('hidden');
        }
    }

    refresh();
    supabase
        .channel('job-assigned-' + jobId)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs', filter: 'id=eq.' + jobId }, refresh)
        .subscribe();
});
