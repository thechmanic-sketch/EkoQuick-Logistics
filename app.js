// ============================================
// CONFIG
// ============================================
const SUPABASE_URL = 'https://vgzkpugjdyqggpunoxod.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZnemtwdWdqZHlxZ2dwdW5veG9kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODc4NzgsImV4cCI6MjA5ODc2Mzg3OH0.0vqvpFIk5V_uUMMNDluK2jdfoE6xtVOGHePXVA0CCFo';
const DISTANCE_MATRIX_API_KEY = 'BE2w7PoMQ4xmiDE0VXaN2zHdTqiOpy8ECtEStW9QCdW7O68yH33SOwZ31ASLDZ67';
const ADMIN_WHATSAPP = '27676659966';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentProfile = null;
let selectedSignupRole = 'customer';

let selectedVehicle = 'bike';
let selectedRate = 6.50;
let selectedBase = 45;
let currentQuote = 0;
let currentDistance = 0;
let currentDuration = '';
let currentJobId = null;

let trackMap = null;
let trackMarker = null;
let trackChannel = null;
let driverWatchId = null;
let driverActiveJobId = null;

// KZN fallback distances
const kznDistances = {
    'durban': { 'pietermaritzburg': 78, 'umhlanga': 16, 'ballito': 40, 'richardsbay': 180, 'newcastle': 270, 'ladysmith': 190, 'portshepstone': 120, 'pinetown': 22, 'amanzimtoti': 25, 'westville': 15, 'hillcrest': 30, 'howick': 88, 'kokstad': 330, 'vryheid': 300, 'estcourt': 160, 'mtunzini': 140 },
    'pietermaritzburg': { 'durban': 78, 'umhlanga': 85, 'ballito': 100, 'richardsbay': 240, 'newcastle': 200, 'ladysmith': 120, 'portshepstone': 170, 'howick': 28, 'estcourt': 90, 'greytown': 70 },
    'umhlanga': { 'durban': 16, 'ballito': 24, 'pietermaritzburg': 85, 'richardsbay': 195, 'amanzimtoti': 40 },
    'ballito': { 'durban': 40, 'umhlanga': 24, 'pietermaritzburg': 100, 'richardsbay': 170, 'stanger': 30 },
    'richardsbay': { 'durban': 180, 'pietermaritzburg': 240, 'empangeni': 18, 'mtunzini': 50, 'newcastle': 250 },
    'newcastle': { 'durban': 270, 'pietermaritzburg': 200, 'ladysmith': 85, 'vryheid': 80 },
    'ladysmith': { 'durban': 190, 'pietermaritzburg': 120, 'newcastle': 85, 'estcourt': 70 },
    'portshepstone': { 'durban': 120, 'pietermaritzburg': 170, 'margate': 12, 'kokstad': 210 },
    'pinetown': { 'durban': 22, 'westville': 10, 'hillcrest': 15 },
    'westville': { 'durban': 15, 'pinetown': 10, 'hillcrest': 20 },
    'hillcrest': { 'durban': 30, 'pinetown': 15, 'westville': 20, 'howick': 65 },
    'howick': { 'pietermaritzburg': 28, 'hillcrest': 65, 'durban': 88 },
    'amanzimtoti': { 'durban': 25, 'umhlanga': 40, 'portshepstone': 95 },
    'stanger': { 'ballito': 30, 'durban': 70 },
    'empangeni': { 'richardsbay': 18, 'durban': 195 },
    'margate': { 'portshepstone': 12, 'durban': 132 },
    'kokstad': { 'portshepstone': 210, 'durban': 330, 'pietermaritzburg': 260 },
    'vryheid': { 'newcastle': 80, 'durban': 300, 'ladysmith': 140 },
    'estcourt': { 'pietermaritzburg': 90, 'ladysmith': 70, 'durban': 160 },
    'mtunzini': { 'richardsbay': 50, 'durban': 140 },
    'greytown': { 'pietermaritzburg': 70, 'durban': 150 }
};

function normalizeLocation(loc) { return loc.toLowerCase().replace(/[^a-z]/g, ''); }

function findFallbackDistance(from, to) {
    const nf = normalizeLocation(from), nt = normalizeLocation(to);
    if (kznDistances[nf] && kznDistances[nf][nt]) return kznDistances[nf][nt];
    if (kznDistances[nt] && kznDistances[nt][nf]) return kznDistances[nt][nf];
    for (let key in kznDistances) {
        if (nf.includes(key) || key.includes(nf)) {
            for (let dest in kznDistances[key]) {
                if (nt.includes(dest) || dest.includes(nt)) return kznDistances[key][dest];
            }
        }
    }
    return null;
}

// ============================================
// AUTH
// ============================================
function switchAuthTab(tab) {
    document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
    document.getElementById('tabSignup').classList.toggle('active', tab === 'signup');
    document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
    document.getElementById('signupForm').classList.toggle('hidden', tab !== 'signup');
}

function selectRole(el) {
    document.querySelectorAll('.role-option').forEach(r => r.classList.remove('selected'));
    el.classList.add('selected');
    selectedSignupRole = el.dataset.role;
}

function showAuthError(msg) {
    const err = document.getElementById('authError');
    document.getElementById('authErrorText').textContent = msg;
    err.classList.add('show');
    setTimeout(() => err.classList.remove('show'), 6000);
}

function showAuthSuccess(msg) {
    const suc = document.getElementById('authSuccess');
    document.getElementById('authSuccessText').textContent = msg;
    suc.classList.add('show');
    setTimeout(() => suc.classList.remove('show'), 6000);
}

async function doSignup() {
    const name = document.getElementById('signupName').value.trim();
    const phone = document.getElementById('signupPhone').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;

    if (!name || !phone || !email || !password) { showAuthError('Please fill in all fields'); return; }
    if (password.length < 6) { showAuthError('Password must be at least 6 characters'); return; }

    const btn = document.getElementById('signupBtn');
    btn.disabled = true;
    document.getElementById('signupBtnText').textContent = 'Creating account...';

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
        showAuthError(error.message);
        btn.disabled = false;
        document.getElementById('signupBtnText').textContent = 'Create Account';
        return;
    }

    if (data.user) {
        const { error: profileError } = await supabase.from('profiles').insert({
            id: data.user.id,
            role: selectedSignupRole,
            full_name: name,
            phone: phone
        });
        if (profileError) {
            showAuthError('Account created but profile setup failed: ' + profileError.message);
            btn.disabled = false;
            document.getElementById('signupBtnText').textContent = 'Create Account';
            return;
        }
    }

    btn.disabled = false;
    document.getElementById('signupBtnText').textContent = 'Create Account';

    if (data.session) {
        await handleSignedIn(data.session.user);
    } else {
        showAuthSuccess('Account created! Check your email to confirm, then log in.');
        switchAuthTab('login');
    }
}

async function doLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) { showAuthError('Please enter your email and password'); return; }

    const btn = document.getElementById('loginBtn');
    btn.disabled = true;
    document.getElementById('loginBtnText').textContent = 'Logging in...';

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    btn.disabled = false;
    document.getElementById('loginBtnText').textContent = 'Log In';

    if (error) { showAuthError(error.message); return; }
    await handleSignedIn(data.user);
}

async function doLogout() {
    stopDriverTracking();
    if (trackChannel) { supabase.removeChannel(trackChannel); trackChannel = null; }
    await supabase.auth.signOut();
    currentUser = null;
    currentProfile = null;
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('authGate').classList.remove('hidden');
}

async function handleSignedIn(user) {
    currentUser = user;
    const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (error || !profile) {
        showAuthError('Could not load your profile. Please try again.');
        await supabase.auth.signOut();
        return;
    }
    currentProfile = profile;
    document.getElementById('authGate').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    document.getElementById('whoName').textContent = profile.full_name || user.email;
    document.getElementById('whoRole').textContent = profile.role;

    document.getElementById('customerView').classList.add('hidden');
    document.getElementById('driverView').classList.add('hidden');
    document.getElementById('adminView').classList.add('hidden');

    if (profile.role === 'customer') {
        document.getElementById('customerView').classList.remove('hidden');
        loadMyBookings();
    } else if (profile.role === 'driver') {
        document.getElementById('driverView').classList.remove('hidden');
        loadDriverJobs();
    } else if (profile.role === 'admin') {
        document.getElementById('adminView').classList.remove('hidden');
        loadAdminJobs();
    }
}

async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (data.session) await handleSignedIn(data.session.user);
}

// ============================================
// CUSTOMER: QUOTE + BOOKING
// ============================================
function selectVehicle(el) {
    document.querySelectorAll('.vehicle-option').forEach(v => v.classList.remove('selected'));
    el.classList.add('selected');
    selectedVehicle = el.dataset.vehicle;
    selectedRate = parseFloat(el.dataset.rate);
    selectedBase = parseFloat(el.dataset.base);
    const rateDisplay = document.getElementById('rateDisplay');
    if (rateDisplay) rateDisplay.textContent = `R${selectedRate.toFixed(2)}`;
    if (currentDistance > 0) calculateQuote();
}

function updateApiStatus(type, text) {
    const status = document.getElementById('apiStatus');
    document.getElementById('apiStatusText').textContent = text;
    status.className = 'api-status ' + type;
}

function showError(msg) {
    const err = document.getElementById('errorMsg');
    document.getElementById('errorText').textContent = msg;
    err.classList.add('show');
    setTimeout(() => err.classList.remove('show'), 5000);
}

function showSuccess(msg) {
    const suc = document.getElementById('successMsg');
    document.getElementById('successText').textContent = msg;
    suc.classList.add('show');
    setTimeout(() => suc.classList.remove('show'), 5000);
}

async function calculateDistance() {
    const pickup = document.getElementById('pickup').value.trim();
    const dropoff = document.getElementById('dropoff').value.trim();
    const btn = document.getElementById('calcBtn');
    const btnText = document.getElementById('calcBtnText');

    if (!pickup || !dropoff) { showError('Please enter both pickup and drop-off locations'); return; }

    btn.disabled = true;
    btnText.innerHTML = '<span class="loading-ring"></span> Calculating...';

    try {
        const origins = encodeURIComponent(pickup + ', KwaZulu-Natal, South Africa');
        const destinations = encodeURIComponent(dropoff + ', KwaZulu-Natal, South Africa');
        const response = await fetch(`https://api.distancematrix.ai/maps/api/distancematrix/json?key=${DISTANCE_MATRIX_API_KEY}&origins=${origins}&destinations=${destinations}&mode=driving`);
        const data = await response.json();

        if (data.status === 'OK' && data.rows && data.rows[0] && data.rows[0].elements && data.rows[0].elements[0].status === 'OK') {
            const element = data.rows[0].elements[0];
            currentDistance = Math.round(element.distance.value / 1000);
            currentDuration = formatDuration(element.duration.value);

            document.getElementById('distance').value = currentDistance;
            document.getElementById('distDisplay').textContent = currentDistance;
            document.getElementById('distanceBox').classList.remove('hidden');

            updateApiStatus('connected', 'Live distances via DistanceMatrix.ai');
            showSuccess(`Real driving distance: ${currentDistance} km (${currentDuration})`);
            calculateQuote();
            btn.disabled = false;
            btnText.innerHTML = '<i class="fas fa-rotate-right"></i> Recalculate';
            return;
        }
    } catch (e) { console.log('DistanceMatrix.ai failed:', e); }

    const fallbackDist = findFallbackDistance(pickup, dropoff);
    if (fallbackDist) {
        currentDistance = fallbackDist;
        currentDuration = '';
        document.getElementById('distance').value = currentDistance;
        document.getElementById('distDisplay').textContent = currentDistance;
        document.getElementById('distanceBox').classList.remove('hidden');
        updateApiStatus('fallback', 'Using estimated distances — API limit reached');
        showSuccess(`Estimated distance: ${currentDistance} km`);
        calculateQuote();
    } else {
        showError('Could not calculate distance. Please enter distance manually or try more specific addresses.');
        document.getElementById('distanceBox').classList.add('hidden');
    }
    btn.disabled = false;
    btnText.innerHTML = '<i class="fas fa-calculator"></i> Calculate Distance & Quote';
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;
}

function calculateQuote() {
    const distance = parseFloat(document.getElementById('distance').value) || 0;
    currentDistance = distance;
    if (distance <= 0) return;

    const distCharge = distance * selectedRate;
    const total = selectedBase + distCharge;
    currentQuote = Math.round(total);
    const vehicleName = selectedVehicle === 'bike' ? 'Motor Bike' : selectedVehicle === 'bakkie' ? 'Bakkie' : '1 Tonne Truck';

    document.getElementById('quoteAmount').textContent = currentQuote.toLocaleString();
    document.getElementById('quoteDetail').textContent = `${vehicleName} • ${distance} km${currentDuration ? ' • ~' + currentDuration : ''}`;
    document.getElementById('baseFee').textContent = `R${selectedBase}`;
    document.getElementById('distCharge').textContent = `R${distCharge.toFixed(2)}`;
    document.getElementById('totalEstimate').textContent = `R${currentQuote.toLocaleString()}`;

    document.getElementById('quoteBox').classList.remove('hidden');
    document.getElementById('breakdown').classList.remove('hidden');
    document.getElementById('bookBtn').classList.remove('hidden');
}

async function bookNow() {
    const phone = document.getElementById('phone').value.trim();
    const pickup = document.getElementById('pickup').value.trim();
    const dropoff = document.getElementById('dropoff').value.trim();
    const vehicleName = selectedVehicle === 'bike' ? 'Motor Bike' : selectedVehicle === 'bakkie' ? 'Bakkie' : '1 Tonne Truck';

    if (!phone || !pickup || !dropoff || currentQuote <= 0) { showError('Please fill in all fields and calculate a quote first'); return; }

    const { data, error } = await supabase.from('jobs').insert({
        customer_id: currentUser.id,
        pickup, dropoff,
        vehicle: selectedVehicle,
        distance: currentDistance,
        duration: currentDuration,
        quote: currentQuote,
        customer_phone: phone,
        status: 'pending'
    }).select().single();

    if (error) { showError('Booking failed: ' + error.message); return; }

    currentJobId = data.id;

    let formattedPhone = phone.replace(/\s/g, '').replace(/^0/, '27');
    if (!formattedPhone.startsWith('27')) formattedPhone = '27' + formattedPhone;
    const ownerMsg = `🚨 *New Ekoquick Booking*\n\n📍 From: ${pickup}\n📍 To: ${dropoff}\n🛻 Vehicle: ${vehicleName}\n📏 Distance: ${currentDistance} km\n💰 Quote: R${currentQuote.toLocaleString()}\n📱 Customer: ${phone}\n\nJob ID: ${data.id}\n\nPlease assign a driver.`;
    window.open(`https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(ownerMsg)}`, '_blank');

    showModal('Booking Confirmed!', `Your delivery has been booked.\n\nBooking ID: ${data.id}\n\nWe're assigning a driver now — track progress below.`);
    startTracking(data.id);
    loadMyBookings();
}

async function loadMyBookings() {
    const list = document.getElementById('myBookingsList');
    const { data, error } = await supabase.from('jobs').select('*').eq('customer_id', currentUser.id).order('created_at', { ascending: false }).limit(10);
    if (error || !data || data.length === 0) { list.innerHTML = '<div class="empty-note">No bookings yet.</div>'; return; }

    list.innerHTML = data.map(job => `
        <div class="job-card">
            <div class="route">${escapeHtml(job.pickup)} → ${escapeHtml(job.dropoff)}</div>
            <div class="meta">${job.distance || 0} km • R${job.quote || 0}</div>
            <span class="job-status ${job.status}">${job.status.replace('_', ' ')}</span>
            ${job.status !== 'delivered' && job.status !== 'cancelled' ? `<div style="margin-top:10px;"><button class="btn btn-outline btn-sm" onclick="startTracking('${job.id}')"><i class="fas fa-location-arrow"></i> Track</button></div>` : ''}
        </div>
    `).join('');

    if (!currentJobId && data.length > 0 && data[0].status !== 'delivered' && data[0].status !== 'cancelled') {
        startTracking(data[0].id);
    }
}

function startTracking(jobId) {
    currentJobId = jobId;
    document.getElementById('trackingCard').classList.remove('hidden');

    if (!trackMap) {
        trackMap = L.map('trackMap').setView([-29.6, 30.9], 8);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(trackMap);
    }

    if (trackChannel) supabase.removeChannel(trackChannel);
    trackChannel = supabase
        .channel('job-track-' + jobId)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` }, (payload) => {
            renderTrackUpdate(payload.new);
        })
        .subscribe();

    supabase.from('jobs').select('*').eq('id', jobId).single().then(({ data }) => {
        if (data) renderTrackUpdate(data);
    });
}

function renderTrackUpdate(job) {
    const statusLabels = {
        pending: 'Waiting for driver assignment...',
        assigned: 'Driver assigned — waiting for pickup',
        in_progress: 'Your driver is on the way!',
        delivered: 'Delivered ✅',
        cancelled: 'Booking cancelled'
    };
    document.getElementById('trackStatusText').textContent = statusLabels[job.status] || job.status;

    if (job.driver_lat && job.driver_lng) {
        document.getElementById('trackNote').classList.add('hidden');
        const pos = [job.driver_lat, job.driver_lng];
        if (!trackMarker) {
            trackMarker = L.marker(pos).addTo(trackMap);
        } else {
            trackMarker.setLatLng(pos);
        }
        trackMap.setView(pos, 12);
    } else {
        document.getElementById('trackNote').classList.remove('hidden');
    }
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

// ============================================
// DRIVER VIEW
// ============================================
async function loadDriverJobs() {
    const list = document.getElementById('driverJobsList');
    const { data, error } = await supabase.from('jobs').select('*').eq('driver_id', currentUser.id).order('created_at', { ascending: false });
    if (error) { list.innerHTML = `<div class="empty-note">Failed to load jobs: ${error.message}</div>`; return; }
    if (!data || data.length === 0) { list.innerHTML = '<div class="empty-note">No jobs assigned to you yet.</div>'; return; }

    list.innerHTML = data.map(job => `
        <div class="job-card">
            <div class="route">${escapeHtml(job.pickup)} → ${escapeHtml(job.dropoff)}</div>
            <div class="meta">${job.distance || 0} km • R${job.quote || 0} • Customer: ${escapeHtml(job.customer_phone || '')}</div>
            <span class="job-status ${job.status}">${job.status.replace('_', ' ')}</span>
            <div class="job-actions">
                ${job.status === 'assigned' ? `<button class="btn btn-primary" onclick="startTrip('${job.id}')"><i class="fas fa-play"></i> Start Trip</button>` : ''}
                ${job.status === 'in_progress' ? `<button class="btn btn-secondary" onclick="markDelivered('${job.id}')"><i class="fas fa-flag-checkered"></i> Mark Delivered</button>` : ''}
            </div>
        </div>
    `).join('');
}

async function startTrip(jobId) {
    const { error } = await supabase.from('jobs').update({ status: 'in_progress' }).eq('id', jobId);
    if (error) { alert('Failed to start trip: ' + error.message); return; }
    beginDriverTracking(jobId);
    loadDriverJobs();
}

function beginDriverTracking(jobId) {
    if (!navigator.geolocation) { alert('Geolocation is not supported on this device'); return; }
    stopDriverTracking();
    driverActiveJobId = jobId;
    driverWatchId = navigator.geolocation.watchPosition(async (pos) => {
        await supabase.from('jobs').update({
            driver_lat: pos.coords.latitude,
            driver_lng: pos.coords.longitude
        }).eq('id', jobId);
    }, (err) => console.log('Geolocation error:', err), { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
}

function stopDriverTracking() {
    if (driverWatchId !== null) {
        navigator.geolocation.clearWatch(driverWatchId);
        driverWatchId = null;
    }
    driverActiveJobId = null;
}

async function markDelivered(jobId) {
    const { error } = await supabase.from('jobs').update({ status: 'delivered' }).eq('id', jobId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    if (driverActiveJobId === jobId) stopDriverTracking();
    loadDriverJobs();
}

// ============================================
// ADMIN VIEW
// ============================================
async function loadAdminJobs() {
    const list = document.getElementById('adminJobsList');
    const { data: jobs, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    if (error) { list.innerHTML = `<div class="empty-note">Failed to load jobs: ${error.message}</div>`; return; }

    const { data: drivers } = await supabase.from('profiles').select('id, full_name').eq('role', 'driver');
    const driverOptions = (drivers || []).map(d => `<option value="${d.id}">${escapeHtml(d.full_name || d.id)}</option>`).join('');

    if (!jobs || jobs.length === 0) { list.innerHTML = '<div class="empty-note">No jobs yet.</div>'; return; }

    list.innerHTML = jobs.map(job => `
        <div class="job-card">
            <div class="route">${escapeHtml(job.pickup)} → ${escapeHtml(job.dropoff)}</div>
            <div class="meta">${job.distance || 0} km • R${job.quote || 0} • Customer: ${escapeHtml(job.customer_phone || '')}</div>
            <span class="job-status ${job.status}">${job.status.replace('_', ' ')}</span>
            <div class="form-group" style="margin-top:12px; margin-bottom:0;">
                <select class="form-select" id="driverSelect-${job.id}">
                    <option value="">Assign a driver...</option>
                    ${driverOptions}
                </select>
            </div>
            <div class="job-actions">
                <button class="btn btn-primary" onclick="assignDriver('${job.id}')"><i class="fas fa-user-check"></i> Assign</button>
            </div>
        </div>
    `).join('');

    jobs.forEach(job => {
        if (job.driver_id) {
            const sel = document.getElementById(`driverSelect-${job.id}`);
            if (sel) sel.value = job.driver_id;
        }
    });
}

async function assignDriver(jobId) {
    const sel = document.getElementById(`driverSelect-${jobId}`);
    const driverId = sel.value;
    if (!driverId) { alert('Please select a driver'); return; }
    const { error } = await supabase.from('jobs').update({ driver_id: driverId, status: 'assigned' }).eq('id', jobId);
    if (error) { alert('Failed to assign driver: ' + error.message); return; }
    loadAdminJobs();
}

// ============================================
// MODAL
// ============================================
function showModal(title, text) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalText').textContent = text;
    document.getElementById('modal').classList.add('active');
}
function closeModal() { document.getElementById('modal').classList.remove('active'); }
document.getElementById('modal').addEventListener('click', function (e) { if (e.target === this) closeModal(); });

// ============================================
// INIT
// ============================================
updateApiStatus('fallback', 'Ready to calculate distances');
checkSession();
