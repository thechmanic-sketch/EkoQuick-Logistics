let fleetMap = null;
let fleetMarkers = {};
let onlineMarkers = {};
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

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

    fleetMap = L.map('fleetMap').setView([-29.6, 30.9], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(fleetMap);

    load();
    supabase.channel('fleet-map-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load).subscribe();
    supabase.channel('fleet-map-drivers').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, load).subscribe();
});

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function isOnline(driver) {
    return !!(driver.last_seen_at && (Date.now() - new Date(driver.last_seen_at).getTime()) < ONLINE_WINDOW_MS);
}

async function load() {
    const { data: jobs } = await supabase.from('jobs').select('*').in('status', ['to_pickup', 'to_dropoff']);
    const { data: drivers } = await supabase.from('profiles').select('id, full_name, last_lat, last_lng, last_seen_at').eq('role', 'driver');

    const activeJobsByDriver = {};
    (jobs || []).forEach(function (j) {
        if (j.driver_lat && j.driver_lng) activeJobsByDriver[j.driver_id] = j;
    });

    const seenJobs = {};
    Object.keys(activeJobsByDriver).forEach(function (driverId) {
        const job = activeJobsByDriver[driverId];
        seenJobs[job.id] = true;
        const pos = [job.driver_lat, job.driver_lng];
        if (fleetMarkers[job.id]) {
            fleetMarkers[job.id].setLatLng(pos);
        } else {
            fleetMarkers[job.id] = L.marker(pos, {
                icon: L.divIcon({ html: '🚚', className: 'driver-marker', iconSize: [28, 28] }),
            }).bindPopup(escapeHtml(job.pickup) + ' → ' + escapeHtml(job.dropoff)).addTo(fleetMap);
        }
    });
    Object.keys(fleetMarkers).forEach(function (id) {
        if (!seenJobs[id]) { fleetMap.removeLayer(fleetMarkers[id]); delete fleetMarkers[id]; }
    });

    const seenOnline = {};
    (drivers || []).forEach(function (d) {
        if (activeJobsByDriver[d.id] || !isOnline(d) || !d.last_lat || !d.last_lng) return;
        seenOnline[d.id] = true;
        const pos = [d.last_lat, d.last_lng];
        if (onlineMarkers[d.id]) {
            onlineMarkers[d.id].setLatLng(pos);
        } else {
            onlineMarkers[d.id] = L.marker(pos, {
                icon: L.divIcon({ html: '🟢', className: 'driver-marker', iconSize: [20, 20] }),
            }).bindPopup(escapeHtml(d.full_name) + ' — online').addTo(fleetMap);
        }
    });
    Object.keys(onlineMarkers).forEach(function (id) {
        if (!seenOnline[id]) { fleetMap.removeLayer(onlineMarkers[id]); delete onlineMarkers[id]; }
    });
}
