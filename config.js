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
