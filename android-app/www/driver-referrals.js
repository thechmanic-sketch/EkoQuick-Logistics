let currentUser = null;
let currentProfile = null;

function formatDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-ZA') : '—'; }
function generateReferralCode() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;
    currentProfile = await getProfile(currentUser.id);
    if (!currentProfile || currentProfile.role !== 'driver') { window.location.href = 'driver-login.html'; return; }

    if (!currentProfile.referral_code) {
        const code = generateReferralCode();
        const { error } = await supabase.from('profiles').update({ referral_code: code }).eq('id', currentUser.id);
        if (!error) currentProfile.referral_code = code;
    }

    document.getElementById('referralCode').textContent = currentProfile.referral_code || '—';

    const baseUrl = window.location.origin + window.location.pathname.replace('driver-referrals.html', '');
    const driverLink = baseUrl + 'driver-signup.html?ref=' + currentProfile.referral_code;
    const customerLink = baseUrl + 'signup.html?ref=' + currentProfile.referral_code;

    document.getElementById('inviteDriverBtn').href = 'https://wa.me/?text=' + encodeURIComponent('Drive with Ekoquick! Sign up here: ' + driverLink);
    document.getElementById('inviteCustomerBtn').href = 'https://wa.me/?text=' + encodeURIComponent('Try Ekoquick for your deliveries! Sign up here: ' + customerLink);

    await loadReferrals();
});

async function loadReferrals() {
    const { data } = await supabase.from('referrals').select('*').eq('referrer_id', currentUser.id).order('created_at', { ascending: false });
    const referrals = data || [];

    const driverRefs = referrals.filter(function (r) { return r.referred_role === 'driver'; });
    const customerRefs = referrals.filter(function (r) { return r.referred_role === 'customer'; });
    const earnings = referrals.filter(function (r) { return r.status === 'approved' || r.status === 'paid'; }).reduce(function (s, r) { return s + Number(r.reward_amount); }, 0);

    document.getElementById('summaryCards').innerHTML =
        '<div class="summary-card"><div class="num">' + driverRefs.length + '</div><div class="lbl">Drivers Invited</div></div>' +
        '<div class="summary-card"><div class="num">' + customerRefs.length + '</div><div class="lbl">Customers Invited</div></div>' +
        '<div class="summary-card"><div class="num">R' + earnings.toFixed(0) + '</div><div class="lbl">Referral Earnings</div></div>';

    const body = document.getElementById('referralBody');
    const empty = document.getElementById('emptyState');
    if (!referrals.length) { body.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    body.innerHTML = referrals.map(function (r) {
        return '<tr><td>' + formatDate(r.created_at) + '</td><td>' + r.referred_role + '</td><td>R' + Number(r.reward_amount).toFixed(2) + '</td><td>' + r.status + '</td></tr>';
    }).join('');
}
