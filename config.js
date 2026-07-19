const SUPABASE_URL = 'https://vgzkpugjdyqggpunoxod.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZnemtwdWdqZHlxZ2dwdW5veG9kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODc4NzgsImV4cCI6MjA5ODc2Mzg3OH0.0vqvpFIk5V_uUMMNDluK2jdfoE6xtVOGHePXVA0CCFo';

window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const VEHICLES = [
    { id: 'bike', label: 'Bike', icon: '🏍️', rate: 5.00, base: 25 },
    { id: 'smallcar', label: 'Small Car', icon: '🚗', rate: 7.00, base: 35 },
    { id: 'bakkie', label: 'Bakkie', icon: '🛻', rate: 12.00, base: 80 },
    { id: 'truck12', label: '1–2 Ton Truck', icon: '🚚', rate: 18.00, base: 150 },
    { id: 'truck7', label: '7 Ton Truck', icon: '🚛', rate: 25.00, base: 250 },
];

const DISTANCE_MATRIX_API_KEY = 'BE2w7PoMQ4xmiDE0VXaN2zHdTqiOpy8ECtEStW9QCdW7O68yH33SOwZ31ASLDZ67';

// Driver keeps this share of the quoted fare; Ekoquick's commission is the
// rest. Defaults to 85% but is overridden by the `settings` table (editable
// from the admin Commissions page) as soon as it loads.
let DRIVER_SHARE = 0.85;
function driverEarning(quote) { return Math.round((Number(quote) || 0) * DRIVER_SHARE * 100) / 100; }
function platformFee(quote) { return Math.round((Number(quote) || 0) * (1 - DRIVER_SHARE) * 100) / 100; }

async function loadDriverShare() {
    const { data } = await supabase.from('settings').select('value').eq('key', 'driver_share').single();
    if (data && data.value) DRIVER_SHARE = parseFloat(data.value);
}

// Vehicle-class / driver / campaign overrides on top of DRIVER_SHARE, set
// from the admin Commissions page. Loaded once per page via
// loadCommissionRules(); driverEarningForJob()/platformFeeForJob() apply
// the most specific active rule (driver > vehicle class > campaign > default).
let COMMISSION_RULES = [];

async function loadCommissionRules() {
    const { data } = await supabase.from('commission_rules').select('*').eq('active', true);
    COMMISSION_RULES = data || [];
}

function effectiveDriverShare(job) {
    if (!job) return DRIVER_SHARE;
    const driverRule = COMMISSION_RULES.find(function (r) { return r.rule_type === 'driver' && r.driver_id === job.driver_id; });
    if (driverRule) return driverRule.driver_share;
    const vehicleRule = COMMISSION_RULES.find(function (r) { return r.rule_type === 'vehicle_class' && r.vehicle_class === job.vehicle; });
    if (vehicleRule) return vehicleRule.driver_share;
    const jobDate = job.created_at ? new Date(job.created_at) : null;
    const campaignRule = COMMISSION_RULES.find(function (r) {
        return r.rule_type === 'campaign' && jobDate && r.start_date && r.end_date &&
            jobDate >= new Date(r.start_date) && jobDate <= new Date(r.end_date + 'T23:59:59');
    });
    if (campaignRule) return campaignRule.driver_share;
    return DRIVER_SHARE;
}

function driverEarningForJob(job) { return Math.round((Number(job.quote) || 0) * effectiveDriverShare(job) * 100) / 100; }
function platformFeeForJob(job) { return Math.round((Number(job.quote) || 0) * (1 - effectiveDriverShare(job)) * 100) / 100; }

function mapsDirectionsUrl(lat, lng) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng;
}

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

function normalizeLocation(s) { return s.toLowerCase().replace(/[^a-z]/g, ''); }

function fallbackDistance(from, to) {
    var nf = normalizeLocation(from), nt = normalizeLocation(to);
    if (KZN_DISTANCES[nf] && KZN_DISTANCES[nf][nt]) return KZN_DISTANCES[nf][nt];
    if (KZN_DISTANCES[nt] && KZN_DISTANCES[nt][nf]) return KZN_DISTANCES[nt][nf];
    return null;
}

function formatDuration(seconds) {
    var h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? (h + 'h ' + m + 'm') : (m + ' min');
}

async function requireSession(redirectTo) {
    var { data } = await supabase.auth.getSession();
    if (!data.session) {
        window.location.href = redirectTo || 'login.html';
        return null;
    }
    return data.session.user;
}

async function getProfile(userId) {
    var { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    return data;
}

// General (non-sensitive) platform settings from the Settings page, keyed
// by setting name. Loaded on demand — call loadAppSettings() then read
// APP_SETTINGS['key'] (string values; parse as needed).
let APP_SETTINGS = {};

async function loadAppSettings() {
    const { data } = await supabase.from('settings').select('key, value');
    APP_SETTINGS = {};
    (data || []).forEach(function (row) { APP_SETTINGS[row.key] = row.value; });
}

function appSetting(key, fallback) {
    return (APP_SETTINGS[key] !== undefined && APP_SETTINGS[key] !== '') ? APP_SETTINGS[key] : fallback;
}

async function logAudit(action, module) {
    try {
        await supabase.from('audit_log').insert({ admin_name: window.currentAdminName || 'Admin', action: action, module: module });
    } catch (err) { /* best effort — never block the actual action on audit logging */ }
}
