let map = null;
let driverMarker = null;
let pickupMarker = null;
let dropoffMarker = null;
let routeLine = null;
let currentJob = null;
let currentUser = null;

const STATUS_LABELS = {
    pending: 'Pending',
    offered: 'Driver Assigned',
    to_pickup: 'Heading to Pickup',
    to_dropoff: 'Heading to Destination',
    delivered: 'Delivered',
};
const STATUS_PROGRESS = { pending: 10, offered: 25, to_pickup: 50, to_dropoff: 75, delivered: 100 };
const ACTIVE_STATUSES = ['pending', 'offered', 'to_pickup', 'to_dropoff'];

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function formatTime(iso) {
    return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeEta(job) {
    if (job.status !== 'to_pickup' && job.status !== 'to_dropoff') return '—';
    const destLat = job.status === 'to_pickup' ? job.pickup_lat : job.dropoff_lat;
    const destLng = job.status === 'to_pickup' ? job.pickup_lng : job.dropoff_lng;
    if (!job.driver_lat || !job.driver_lng || !destLat || !destLng) return '—';
    const km = haversineKm(job.driver_lat, job.driver_lng, destLat, destLng);
    return Math.round((km / 30) * 60) + ' min';
}

function vehicleLabel(id) {
    const v = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).find(function (v) { return v.id === id; });
    return v ? v.icon + ' ' + v.label : (id || '—');
}

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('login.html');
    if (!currentUser) return;

    const jobIdParam = new URLSearchParams(window.location.search).get('job');

    document.getElementById('recenterBtn').addEventListener('click', function () {
        if (!map || !currentJob) return;
        recenterMap();
    });
    document.getElementById('fullscreenBtn').addEventListener('click', function () {
        const el = document.getElementById('trackMap');
        if (document.fullscreenElement) document.exitFullscreen();
        else el.requestFullscreen && el.requestFullscreen();
    });

    async function loadJob() {
        let job = null;
        if (jobIdParam) {
            const { data } = await supabase.from('jobs').select('*').eq('id', jobIdParam).eq('customer_id', currentUser.id).single();
            job = data;
        } else {
            const { data } = await supabase.from('jobs').select('*').eq('customer_id', currentUser.id).in('status', ACTIVE_STATUSES).order('created_at', { ascending: false }).limit(1);
            job = data && data[0];
        }

        if (!job || !ACTIVE_STATUSES.includes(job.status)) {
            document.getElementById('emptyState').classList.remove('hidden');
            document.getElementById('trackingContent').classList.add('hidden');
            return;
        }

        document.getElementById('emptyState').classList.add('hidden');
        document.getElementById('trackingContent').classList.remove('hidden');
        currentJob = job;
        render(job);
    }

    let mapReadyPromise = null;
    function initMap() {
        if (!mapReadyPromise) {
            mapReadyPromise = GoogleMaps.createMap('trackMap', [-29.6, 30.9], 8).then(function (m) { map = m; return m; });
        }
        return mapReadyPromise;
    }

    function recenterMap() {
        const pts = [];
        if (currentJob.pickup_lat && currentJob.pickup_lng) pts.push([currentJob.pickup_lat, currentJob.pickup_lng]);
        if (currentJob.dropoff_lat && currentJob.dropoff_lng) pts.push([currentJob.dropoff_lat, currentJob.dropoff_lng]);
        if (currentJob.driver_lat && currentJob.driver_lng) pts.push([currentJob.driver_lat, currentJob.driver_lng]);
        GoogleMaps.fitBounds(map, pts);
    }

    async function render(job) {
        document.getElementById('orderIdLine').textContent = 'Order ' + job.id.slice(0, 8) + ' · ' + (STATUS_LABELS[job.status] || job.status);
        document.getElementById('statusTitle').textContent = STATUS_LABELS[job.status] || job.status;
        document.getElementById('progressFill').style.width = (STATUS_PROGRESS[job.status] || 0) + '%';
        document.getElementById('etaText').textContent = computeEta(job);
        document.getElementById('etaText2').textContent = computeEta(job);
        document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
        document.getElementById('pickupAddr').textContent = job.pickup || '—';
        document.getElementById('dropoffAddr').textContent = job.dropoff || '—';
        document.getElementById('distanceText').textContent = job.distance ? Number(job.distance).toFixed(1) + ' km' : '—';
        document.getElementById('feeText').textContent = job.quote ? 'R' + Number(job.quote).toFixed(2) : '—';

        await initMap();
        if (job.pickup_lat && job.pickup_lng) {
            const pos = [job.pickup_lat, job.pickup_lng];
            if (!pickupMarker) pickupMarker = GoogleMaps.createMarker(map, pos, '📦', { title: 'Pickup' }).bindPopup('Pickup');
            else pickupMarker.setLatLng(pos);
        }
        if (job.dropoff_lat && job.dropoff_lng) {
            const pos = [job.dropoff_lat, job.dropoff_lng];
            if (!dropoffMarker) dropoffMarker = GoogleMaps.createMarker(map, pos, '🏁', { title: 'Drop-off' }).bindPopup('Drop-off');
            else dropoffMarker.setLatLng(pos);
        }
        if (job.pickup_lat && job.dropoff_lat) {
            const line = [[job.pickup_lat, job.pickup_lng], [job.dropoff_lat, job.dropoff_lng]];
            if (!routeLine) routeLine = GoogleMaps.createPolyline(map, line, '#3E8BFF', 3);
            else routeLine.setLatLngs(line);
        }
        if (job.driver_lat && job.driver_lng) {
            document.getElementById('trackNote').classList.add('hidden');
            const pos = [job.driver_lat, job.driver_lng];
            if (!driverMarker) driverMarker = GoogleMaps.createMarker(map, pos, '🚚', { title: 'Driver' });
            else driverMarker.setLatLng(pos);
        } else {
            document.getElementById('trackNote').classList.remove('hidden');
        }
        recenterMap();

        renderDriver(job);
        renderTimeline(job);
        renderOtp(job);

        const supportBtn = document.getElementById('contactSupportBtn');
        supportBtn.href = 'https://wa.me/27676659966?text=' + encodeURIComponent('Hi Ekoquick, I need help with order ' + job.id.slice(0, 8) + '.');
    }

    async function renderDriver(job) {
        const card = document.getElementById('driverCard');
        if (!job.driver_id) { card.classList.add('hidden'); return; }
        const { data: driver } = await supabase.from('profiles').select('full_name, phone, avatar_url, vehicle_class').eq('id', job.driver_id).single();
        if (!driver) { card.classList.add('hidden'); return; }
        card.classList.remove('hidden');
        document.getElementById('driverName').textContent = driver.full_name;
        document.getElementById('driverVehicle').textContent = vehicleLabel(driver.vehicle_class);
        if (driver.avatar_url) {
            const img = document.getElementById('driverAvatar');
            img.src = driver.avatar_url;
            img.classList.remove('hidden');
        }

        const { data: ratedJobs } = await supabase.from('jobs').select('rating').eq('driver_id', job.driver_id).not('rating', 'is', null);
        if (ratedJobs && ratedJobs.length) {
            const avg = ratedJobs.reduce(function (s, j) { return s + j.rating; }, 0) / ratedJobs.length;
            document.getElementById('driverRating').textContent = avg.toFixed(1) + ' ★ (' + ratedJobs.length + ' ratings)';
        } else {
            document.getElementById('driverRating').textContent = 'No ratings yet';
        }

        const digits = (driver.phone || '').replace(/\D/g, '');
        const waLink = digits ? 'https://wa.me/' + digits + '?text=' + encodeURIComponent('Hi, regarding my Ekoquick order ' + job.id.slice(0, 8) + '.') : '#';
        document.getElementById('callDriverBtn').href = driver.phone ? 'tel:' + driver.phone : '#';
        document.getElementById('msgDriverBtn').href = waLink;
        document.getElementById('contactDriverBtn2').href = waLink;
        document.getElementById('chatDriverBtn').href = 'chat.html?job=' + job.id;
    }

    function renderTimeline(job) {
        const stages = [
            { key: 'created_at', label: 'Order Created', time: job.created_at },
            { key: 'assigned_at', label: 'Driver Assigned', time: job.assigned_at },
            { key: 'to_pickup_at', label: 'Heading to Pickup', time: job.to_pickup_at },
            { key: 'to_dropoff_at', label: 'Parcel Picked Up', time: job.to_dropoff_at },
            { key: 'to_dropoff_at2', label: 'Heading to Destination', time: job.to_dropoff_at },
            { key: 'delivered_at', label: 'Delivered', time: job.delivered_at },
            { key: 'delivered_at2', label: 'Completed', time: job.delivered_at },
        ];
        document.getElementById('timelineList').innerHTML = stages.map(function (s) {
            const done = !!s.time;
            return '<li class="' + (done ? 'done' : '') + '"><div class="t-label">' + s.label + '</div>' +
                '<div class="t-time">' + (done ? formatTime(s.time) : 'Pending') + '</div></li>';
        }).join('');
    }

    function renderOtp(job) {
        const card = document.getElementById('otpCard');
        if (!job.collection_code && !job.delivery_code) { card.classList.add('hidden'); return; }
        card.classList.remove('hidden');
        const collectionVerified = job.status === 'to_dropoff' || job.status === 'delivered';
        const deliveryVerified = job.status === 'delivered';
        document.getElementById('collectionStatus').textContent = collectionVerified ? 'Verified' : 'Pending';
        document.getElementById('deliveryStatus').textContent = deliveryVerified ? 'Verified' : 'Pending';
    }

    await loadJob();

    if (jobIdParam) {
        supabase
            .channel('job-track-' + jobIdParam)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs', filter: 'id=eq.' + jobIdParam }, function (payload) {
                if (!ACTIVE_STATUSES.includes(payload.new.status)) { loadJob(); return; }
                currentJob = payload.new;
                render(payload.new);
            })
            .subscribe();
    } else {
        supabase
            .channel('customer-live-tracking')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: 'customer_id=eq.' + currentUser.id }, loadJob)
            .subscribe();
    }
});
