const { useState, useEffect, useRef } = React;

const SUPABASE_URL = 'https://vgzkpugjdyqggpunoxod.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZnemtwdWdqZHlxZ2dwdW5veG9kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODc4NzgsImV4cCI6MjA5ODc2Mzg3OH0.0vqvpFIk5V_uUMMNDluK2jdfoE6xtVOGHePXVA0CCFo';
const DISTANCE_MATRIX_API_KEY = 'BE2w7PoMQ4xmiDE0VXaN2zHdTqiOpy8ECtEStW9QCdW7O68yH33SOwZ31ASLDZ67';
const ADMIN_WHATSAPP = '27676659966';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const VEHICLES = [
    { id: 'bike', label: 'Motor Bike', icon: '🏍️', rate: 6.50, base: 45 },
    { id: 'bakkie', label: 'Bakkie', icon: '🛻', rate: 9.50, base: 85 },
    { id: 'truck', label: '1 Tonne Truck', icon: '🚛', rate: 14.00, base: 150 },
];

const KZN_DISTANCES = {
    durban: { pietermaritzburg: 78, umhlanga: 16, ballito: 40, richardsbay: 180, newcastle: 270, ladysmith: 190, portshepstone: 120 },
    pietermaritzburg: { durban: 78, umhlanga: 85, ballito: 100, richardsbay: 240, newcastle: 200, ladysmith: 120, portshepstone: 170 },
    umhlanga: { durban: 16, ballito: 24, pietermaritzburg: 85, richardsbay: 195 },
    ballito: { durban: 40, umhlanga: 24, pietermaritzburg: 100, richardsbay: 170 },
    richardsbay: { durban: 180, pietermaritzburg: 240, newcastle: 250 },
    newcastle: { durban: 270, pietermaritzburg: 200, ladysmith: 85 },
    ladysmith: { durban: 190, pietermaritzburg: 120, newcastle: 85 },
    portshepstone: { durban: 120, pietermaritzburg: 170, margate: 12 },
};

function normalize(s) { return s.toLowerCase().replace(/[^a-z]/g, ''); }

function fallbackDistance(from, to) {
    const nf = normalize(from), nt = normalize(to);
    if (KZN_DISTANCES[nf] && KZN_DISTANCES[nf][nt]) return KZN_DISTANCES[nf][nt];
    if (KZN_DISTANCES[nt] && KZN_DISTANCES[nt][nf]) return KZN_DISTANCES[nt][nf];
    return null;
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

function whatsapp(phone, text) {
    let p = phone.replace(/\s/g, '').replace(/^0/, '27');
    if (!p.startsWith('27')) p = '27' + p;
    window.open(`https://wa.me/${p}?text=${encodeURIComponent(text)}`, '_blank');
}

function Msg({ type, text }) {
    if (!text) return null;
    return <div className={`msg ${type}`}>{text}</div>;
}

function AuthScreen({ onSignedIn }) {
    const [tab, setTab] = useState('login');
    const [role, setRole] = useState('customer');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    async function login() {
        setError(''); setSuccess('');
        if (!email || !password) { setError('Please enter your email and password'); return; }
        setBusy(true);
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        setBusy(false);
        if (error) { setError(error.message); return; }
        onSignedIn(data.user);
    }

    async function signup() {
        setError(''); setSuccess('');
        if (!name || !phone || !email || !password) { setError('Please fill in all fields'); return; }
        if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
        setBusy(true);
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) { setBusy(false); setError(error.message); return; }
        if (data.user) {
            const { error: profileError } = await supabase.from('profiles').insert({
                id: data.user.id, role, full_name: name, phone,
            });
            if (profileError) { setBusy(false); setError('Account created but profile setup failed: ' + profileError.message); return; }
        }
        setBusy(false);
        if (data.session) {
            onSignedIn(data.session.user);
        } else {
            setSuccess('Account created! Check your email to confirm, then log in.');
            setTab('login');
        }
    }

    return (
        <div className="wrap">
            <div className="card">
                <div className="row" style={{ marginBottom: 16 }}>
                    <button className={`btn-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => setTab('login')}>Log In</button>
                    <button className={`btn-tab ${tab === 'signup' ? 'active' : ''}`} onClick={() => setTab('signup')}>Sign Up</button>
                </div>

                {tab === 'login' && (
                    <div>
                        <label>Email</label>
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
                        <label>Password</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
                        <button className="btn-primary" onClick={login} disabled={busy}>{busy ? 'Logging in...' : 'Log In'}</button>
                    </div>
                )}

                {tab === 'signup' && (
                    <div>
                        <label>I am a...</label>
                        <div className="row" style={{ marginBottom: 12 }}>
                            <button className={`btn-tab ${role === 'customer' ? 'active' : ''}`} onClick={() => setRole('customer')}>Customer</button>
                            <button className={`btn-tab ${role === 'driver' ? 'active' : ''}`} onClick={() => setRole('driver')}>Driver</button>
                        </div>
                        <label>Full Name</label>
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Dlamini" />
                        <label>WhatsApp Number</label>
                        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="0676659966" />
                        <label>Email</label>
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
                        <label>Password</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 6 characters" />
                        <button className="btn-primary" onClick={signup} disabled={busy}>{busy ? 'Creating account...' : 'Create Account'}</button>
                    </div>
                )}

                <Msg type="error" text={error} />
                <Msg type="success" text={success} />
            </div>
        </div>
    );
}

function CustomerView({ user }) {
    const [vehicle, setVehicle] = useState(VEHICLES[0]);
    const [pickup, setPickup] = useState('');
    const [dropoff, setDropoff] = useState('');
    const [phone, setPhone] = useState('');
    const [distance, setDistance] = useState(0);
    const [duration, setDuration] = useState('');
    const [calculating, setCalculating] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [bookings, setBookings] = useState([]);
    const [trackedJob, setTrackedJob] = useState(null);
    const mapRef = useRef(null);
    const mapObjRef = useRef(null);
    const markerRef = useRef(null);
    const channelRef = useRef(null);

    const quote = distance > 0 ? Math.round(vehicle.base + distance * vehicle.rate) : 0;

    useEffect(() => { loadBookings(); }, []);

    async function loadBookings() {
        const { data } = await supabase.from('jobs').select('*').eq('customer_id', user.id).order('created_at', { ascending: false }).limit(10);
        setBookings(data || []);
    }

    async function calculateDistance() {
        setError(''); setSuccess('');
        if (!pickup || !dropoff) { setError('Please enter both pickup and drop-off locations'); return; }
        setCalculating(true);
        try {
            const origins = encodeURIComponent(pickup + ', KwaZulu-Natal, South Africa');
            const destinations = encodeURIComponent(dropoff + ', KwaZulu-Natal, South Africa');
            const res = await fetch(`https://api.distancematrix.ai/maps/api/distancematrix/json?key=${DISTANCE_MATRIX_API_KEY}&origins=${origins}&destinations=${destinations}&mode=driving`);
            const data = await res.json();
            const el = data?.rows?.[0]?.elements?.[0];
            if (data.status === 'OK' && el?.status === 'OK') {
                setDistance(Math.round(el.distance.value / 1000));
                setDuration(formatDuration(el.duration.value));
                setSuccess(`Real driving distance: ${Math.round(el.distance.value / 1000)} km`);
                setCalculating(false);
                return;
            }
        } catch (e) { /* fall through to fallback */ }

        const fb = fallbackDistance(pickup, dropoff);
        if (fb) {
            setDistance(fb);
            setDuration('');
            setSuccess(`Estimated distance: ${fb} km`);
        } else {
            setError('Could not calculate distance. Try more specific addresses.');
        }
        setCalculating(false);
    }

    async function bookNow() {
        setError(''); setSuccess('');
        if (!phone || !pickup || !dropoff || quote <= 0) { setError('Please fill in all fields and calculate a quote first'); return; }
        const { data, error } = await supabase.from('jobs').insert({
            customer_id: user.id, pickup, dropoff, vehicle: vehicle.id,
            distance, duration, quote, customer_phone: phone, status: 'pending',
        }).select().single();
        if (error) { setError('Booking failed: ' + error.message); return; }

        whatsapp(ADMIN_WHATSAPP, `New Ekoquick Booking\nFrom: ${pickup}\nTo: ${dropoff}\nVehicle: ${vehicle.label}\nDistance: ${distance} km\nQuote: R${quote}\nCustomer: ${phone}\nJob ID: ${data.id}`);
        setSuccess('Booking confirmed! Track it below.');
        loadBookings();
        trackJob(data.id);
    }

    function trackJob(jobId) {
        setTrackedJob({ id: jobId, status: 'pending', driver_lat: null, driver_lng: null });

        if (!mapObjRef.current && mapRef.current) {
            mapObjRef.current = L.map(mapRef.current).setView([-29.6, 30.9], 8);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapObjRef.current);
        }

        if (channelRef.current) supabase.removeChannel(channelRef.current);
        channelRef.current = supabase
            .channel('job-' + jobId)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` }, payload => {
                updateTracking(payload.new);
            })
            .subscribe();

        supabase.from('jobs').select('*').eq('id', jobId).single().then(({ data }) => {
            if (data) updateTracking(data);
        });
    }

    function updateTracking(job) {
        setTrackedJob(job);
        if (job.driver_lat && job.driver_lng && mapObjRef.current) {
            const pos = [job.driver_lat, job.driver_lng];
            if (!markerRef.current) markerRef.current = L.marker(pos).addTo(mapObjRef.current);
            else markerRef.current.setLatLng(pos);
            mapObjRef.current.setView(pos, 12);
        }
    }

    const statusLabels = {
        pending: 'Waiting for driver assignment...',
        assigned: 'Driver assigned — waiting for pickup',
        in_progress: 'Your driver is on the way!',
        delivered: 'Delivered',
        cancelled: 'Cancelled',
    };

    return (
        <div className="wrap">
            <div className="card">
                <h2>Choose Your Vehicle</h2>
                <div className="grid3">
                    {VEHICLES.map(v => (
                        <div key={v.id} className={`vopt ${vehicle.id === v.id ? 'selected' : ''}`} onClick={() => setVehicle(v)}>
                            <span className="icon">{v.icon}</span>{v.label}
                        </div>
                    ))}
                </div>
            </div>

            <div className="card">
                <h2>Delivery Details</h2>
                <label>Pickup Location</label>
                <input value={pickup} onChange={e => setPickup(e.target.value)} placeholder="e.g. 45 West Street, Durban CBD" />
                <label>Drop-off Location</label>
                <input value={dropoff} onChange={e => setDropoff(e.target.value)} placeholder="e.g. 12 Main Road, Pietermaritzburg" />
                <label>Your WhatsApp</label>
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="0676659966" />

                <Msg type="error" text={error} />
                <Msg type="success" text={success} />

                <button className="btn-primary" onClick={calculateDistance} disabled={calculating}>
                    {calculating ? 'Calculating...' : 'Calculate Distance & Quote'}
                </button>

                {quote > 0 && (
                    <React.Fragment>
                        <div className="quote">
                            <div style={{ fontSize: 12 }}>Your Delivery Quote</div>
                            <div className="amt">R{quote}</div>
                            <div style={{ fontSize: 13 }}>{vehicle.label} • {distance} km{duration ? ' • ~' + duration : ''}</div>
                        </div>
                        <button className="btn-secondary" onClick={bookNow}>Confirm & Book Now</button>
                    </React.Fragment>
                )}
            </div>

            {trackedJob && (
                <div className="card">
                    <h2>Track Your Delivery</h2>
                    <div style={{ fontSize: 13, marginBottom: 6 }}>{statusLabels[trackedJob.status] || trackedJob.status}</div>
                    <div id="trackMap" ref={mapRef}></div>
                </div>
            )}

            <div className="card">
                <h2>My Bookings</h2>
                {bookings.length === 0 && <div className="empty">No bookings yet.</div>}
                {bookings.map(job => (
                    <div key={job.id} className="job">
                        <div className="route">{job.pickup} → {job.dropoff}</div>
                        <div className="meta">{job.distance || 0} km • R{job.quote || 0}</div>
                        <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
                        {job.status !== 'delivered' && job.status !== 'cancelled' && (
                            <div style={{ marginTop: 8 }}>
                                <button className="btn-outline" onClick={() => trackJob(job.id)}>Track</button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function DriverView({ user }) {
    const [jobs, setJobs] = useState([]);
    const watchIdRef = useRef(null);

    useEffect(() => { loadJobs(); return () => stopTracking(); }, []);

    async function loadJobs() {
        const { data } = await supabase.from('jobs').select('*').eq('driver_id', user.id).order('created_at', { ascending: false });
        setJobs(data || []);
    }

    async function startTrip(jobId) {
        await supabase.from('jobs').update({ status: 'in_progress' }).eq('id', jobId);
        beginTracking(jobId);
        loadJobs();
    }

    function beginTracking(jobId) {
        if (!navigator.geolocation) { alert('Geolocation is not supported on this device'); return; }
        stopTracking();
        watchIdRef.current = navigator.geolocation.watchPosition(async pos => {
            await supabase.from('jobs').update({
                driver_lat: pos.coords.latitude, driver_lng: pos.coords.longitude,
            }).eq('id', jobId);
        }, () => {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
    }

    function stopTracking() {
        if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
    }

    async function markDelivered(jobId) {
        await supabase.from('jobs').update({ status: 'delivered' }).eq('id', jobId);
        stopTracking();
        loadJobs();
    }

    return (
        <div className="wrap">
            <div className="card">
                <h2>My Jobs</h2>
                <button className="btn-outline" onClick={loadJobs}>Refresh</button>
                <div style={{ marginTop: 12 }}>
                    {jobs.length === 0 && <div className="empty">No jobs assigned to you yet.</div>}
                    {jobs.map(job => (
                        <div key={job.id} className="job">
                            <div className="route">{job.pickup} → {job.dropoff}</div>
                            <div className="meta">{job.distance || 0} km • R{job.quote || 0} • Customer: {job.customer_phone}</div>
                            <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
                            <div style={{ marginTop: 8 }}>
                                {job.status === 'assigned' && <button className="btn-primary" onClick={() => startTrip(job.id)}>Start Trip</button>}
                                {job.status === 'in_progress' && <button className="btn-secondary" onClick={() => markDelivered(job.id)}>Mark Delivered</button>}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function AdminView({ user }) {
    const [jobs, setJobs] = useState([]);
    const [drivers, setDrivers] = useState([]);
    const [selected, setSelected] = useState({});

    useEffect(() => { loadAll(); }, []);

    async function loadAll() {
        const { data: jobsData } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
        const { data: driversData } = await supabase.from('profiles').select('id, full_name').eq('role', 'driver');
        setJobs(jobsData || []);
        setDrivers(driversData || []);
        const sel = {};
        (jobsData || []).forEach(j => { if (j.driver_id) sel[j.id] = j.driver_id; });
        setSelected(sel);
    }

    async function assignDriver(jobId) {
        const driverId = selected[jobId];
        if (!driverId) { alert('Please select a driver'); return; }
        await supabase.from('jobs').update({ driver_id: driverId, status: 'assigned' }).eq('id', jobId);
        loadAll();
    }

    return (
        <div className="wrap">
            <div className="card">
                <h2>All Jobs</h2>
                <button className="btn-outline" onClick={loadAll}>Refresh</button>
                <div style={{ marginTop: 12 }}>
                    {jobs.length === 0 && <div className="empty">No jobs yet.</div>}
                    {jobs.map(job => (
                        <div key={job.id} className="job">
                            <div className="route">{job.pickup} → {job.dropoff}</div>
                            <div className="meta">{job.distance || 0} km • R{job.quote || 0} • Customer: {job.customer_phone}</div>
                            <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
                            <select value={selected[job.id] || ''} onChange={e => setSelected({ ...selected, [job.id]: e.target.value })} style={{ marginTop: 10 }}>
                                <option value="">Assign a driver...</option>
                                {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name || d.id}</option>)}
                            </select>
                            <button className="btn-primary" onClick={() => assignDriver(job.id)}>Assign</button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function App() {
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            if (data.session) signedIn(data.session.user);
            else setLoading(false);
        });
    }, []);

    async function signedIn(u) {
        setUser(u);
        const { data } = await supabase.from('profiles').select('*').eq('id', u.id).single();
        setProfile(data);
        setLoading(false);
    }

    async function logout() {
        await supabase.auth.signOut();
        setUser(null);
        setProfile(null);
    }

    if (loading) return <div className="wrap"><div className="empty">Loading...</div></div>;

    return (
        <div>
            <header>
                <h1>Ekoquick</h1>
                <p>Instant delivery quotes. Real-time tracking.</p>
            </header>

            {!user && <AuthScreen onSignedIn={signedIn} />}

            {user && profile && (
                <React.Fragment>
                    <div className="navbar">
                        <div className="who">Signed in as {profile.full_name || user.email} · {profile.role}</div>
                        <button className="btn-outline" onClick={logout}>Log Out</button>
                    </div>
                    {profile.role === 'customer' && <CustomerView user={user} />}
                    {profile.role === 'driver' && <DriverView user={user} />}
                    {profile.role === 'admin' && <AdminView user={user} />}
                </React.Fragment>
            )}
        </div>
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
