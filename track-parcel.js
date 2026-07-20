let trackMap = null;

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('trackBtn').addEventListener('click', trackJob);
    document.getElementById('trackNumber').addEventListener('keydown', function (e) { if (e.key === 'Enter') trackJob(); });
    document.getElementById('trackPhone').addEventListener('keydown', function (e) { if (e.key === 'Enter') trackJob(); });
});

const STATUS_LABELS = {
    pending: 'Booked — waiting for a driver',
    offered: 'Driver assigned',
    to_pickup: 'Driver heading to pickup',
    to_dropoff: 'Heading to destination',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
};

async function trackJob() {
    const trackingNumber = document.getElementById('trackNumber').value.trim();
    const phone = document.getElementById('trackPhone').value.trim();
    const msgEl = document.getElementById('trackMsg');
    const resultEl = document.getElementById('trackResult');
    const btn = document.getElementById('trackBtn');

    msgEl.textContent = '';
    resultEl.classList.remove('show');

    if (!trackingNumber || !phone) {
        msgEl.textContent = 'Enter both your tracking number and the phone number on the job.';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Tracking...';

    const { data, error } = await supabase.rpc('public_track_job', {
        p_tracking_number: trackingNumber,
        p_phone: phone,
    });

    btn.disabled = false;
    btn.textContent = 'Track';

    const job = data && data[0];
    if (error || !job) {
        msgEl.textContent = "We couldn't find a job matching that tracking number and phone number. Double check both and try again.";
        return;
    }

    renderResult(job);
    resultEl.classList.add('show');
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderResult(job) {
    document.getElementById('rStatus').textContent = STATUS_LABELS[job.status] || job.status;
    document.getElementById('rDriver').textContent = job.driver_name || 'Not yet assigned';
    document.getElementById('rVehicle').textContent = [job.driver_vehicle_make, job.driver_vehicle_model].filter(Boolean).join(' ') || job.vehicle || '—';
    document.getElementById('rEta').textContent = job.duration || '—';
    document.getElementById('rPickup').textContent = job.pickup || '—';
    document.getElementById('rDropoff').textContent = job.dropoff || '—';
    document.getElementById('rCollectionCode').textContent = job.collection_code || '—';
    document.getElementById('rDeliveryCode').textContent = job.delivery_code || '—';

    renderTimeline(job);
    renderMap(job);
}

function renderTimeline(job) {
    const steps = [
        { key: 'created_at', label: 'Booked', time: job.created_at },
        { key: 'assigned_at', label: 'Driver Assigned', time: job.assigned_at },
        { key: 'to_pickup_at', label: 'Heading to Pickup', time: job.to_pickup_at },
        { key: 'to_dropoff_at', label: 'Parcel Picked Up — Heading to Destination', time: job.to_dropoff_at },
        { key: 'delivered_at', label: 'Delivered', time: job.delivered_at },
    ];

    if (job.status === 'cancelled') {
        document.getElementById('rTimeline').innerHTML = '<li class="current">Cancelled<span class="t-time">' + (job.cancelled_at ? new Date(job.cancelled_at).toLocaleString() : '') + '</span></li>';
        return;
    }

    const order = ['pending', 'offered', 'to_pickup', 'to_dropoff', 'delivered'];
    const currentIdx = order.indexOf(job.status);

    document.getElementById('rTimeline').innerHTML = steps.map(function (s, i) {
        const done = s.time || i < currentIdx;
        const isCurrent = i === currentIdx;
        const cls = isCurrent ? 'current' : (done ? 'done' : '');
        return '<li class="' + cls + '">' + s.label + (s.time ? '<span class="t-time">' + new Date(s.time).toLocaleString() + '</span>' : '') + '</li>';
    }).join('');
}

function renderMap(job) {
    const mapEl = document.getElementById('trackMap');
    if (!job.driver_lat && !job.driver_lng) {
        mapEl.innerHTML = '<div style="display:flex; align-items:center; justify-content:center; height:100%; color: var(--muted-dim); font-family: var(--font-mono); font-size:12px;">Live position not available yet.</div>';
        return;
    }
    if (trackMap) { trackMap.remove(); trackMap = null; }
    trackMap = L.map('trackMap').setView([job.driver_lat, job.driver_lng], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(trackMap);
    L.marker([job.driver_lat, job.driver_lng]).addTo(trackMap).bindPopup('Driver').openPopup();
}
