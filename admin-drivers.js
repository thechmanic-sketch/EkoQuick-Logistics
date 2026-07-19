let driversCache = [];
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

    loadDrivers();
    supabase.channel('drivers-page').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadDrivers).subscribe();
});

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function isOnline(driver) {
    return !!(driver.last_seen_at && (Date.now() - new Date(driver.last_seen_at).getTime()) < ONLINE_WINDOW_MS);
}

async function loadDrivers() {
    const { data: drivers } = await supabase.from('profiles').select('id, full_name, phone, vehicle_class, last_lat, last_lng, last_seen_at, avatar_url, verification_status, account_status, license_url, id_doc_url, vehicle_reg_url, insurance_url').eq('role', 'driver');
    driversCache = drivers || [];
    renderDrivers();
}

function renderDrivers() {
    const el = document.getElementById('driversList');
    if (!el) return;
    if (!driversCache.length) { el.innerHTML = '<div class="empty">No drivers signed up yet.</div>'; return; }

    const vehicleOptions = (typeof VEHICLES !== 'undefined' ? VEHICLES : [])
        .map(function (v) { return '<option value="' + v.id + '">' + v.icon + ' ' + v.label + '</option>'; })
        .join('');

    const docFields = [
        ['license_url', 'Licence'],
        ['id_doc_url', 'ID'],
        ['vehicle_reg_url', 'Vehicle reg'],
        ['insurance_url', 'Insurance'],
    ];

    el.innerHTML = driversCache.map(function (d) {
        const docLinks = docFields.map(function (f) {
            if (!d[f[0]]) return '';
            return '<button class="btn btn-outline-blue" style="margin-right: 6px; margin-bottom: 6px; display:inline-block; width:auto;" data-doc="' + escapeHtml(d[f[0]]) + '" data-action="view-doc">' + f[1] + '</button>';
        }).join('');

        const online = isOnline(d);
        const statusBadge = d.account_status === 'active' ? '' : '<span class="badge cancelled" style="margin-left:6px;">' + d.account_status + '</span>';

        return (
            '<div class="job">' +
                '<div style="display:flex; align-items:center; gap:10px;">' +
                    (d.avatar_url ? '<img src="' + escapeHtml(d.avatar_url) + '" style="width:40px; height:40px; object-fit:cover; border:1px solid var(--line);">' : '') +
                    '<div class="route">' + escapeHtml(d.full_name || d.id) + '</div>' +
                '</div>' +
                '<span class="badge ' + (online ? 'delivered' : 'cancelled') + '" style="margin-top: 8px;">' + (online ? 'Online' : 'Offline') + '</span> ' +
                '<span class="badge ' + (d.verification_status === 'approved' ? 'delivered' : d.verification_status === 'rejected' ? 'cancelled' : 'pending') + '">' + (d.verification_status || 'pending') + '</span>' +
                statusBadge +
                (docLinks ? '<div style="margin-top: 8px;">' + docLinks + '</div>' : '<div class="meta" style="margin-top: 8px;">No documents uploaded yet.</div>') +
                '<div style="margin-top: 10px;">' +
                    '<label>Full name</label>' +
                    '<input class="field-plain" id="nameInput-' + d.id + '" value="' + escapeHtml(d.full_name || '') + '">' +
                    '<label>Phone</label>' +
                    '<input class="field-plain" id="phoneInput-' + d.id + '" value="' + escapeHtml(d.phone || '') + '">' +
                    '<select class="field-plain" id="vehicleSelect-' + d.id + '" style="margin-bottom: 8px;">' +
                        '<option value="">No vehicle class set</option>' +
                        vehicleOptions +
                    '</select>' +
                    '<button class="btn btn-blue" data-driver="' + d.id + '" data-action="save-profile">Save profile</button>' +
                '</div>' +
                '<div style="margin-top: 8px;">' +
                    '<button class="btn btn-blue" data-driver="' + d.id + '" data-action="approve" style="margin-right: 8px;">Approve</button>' +
                    '<button class="btn btn-outline-blue" data-driver="' + d.id + '" data-action="reject">Reject</button>' +
                '</div>' +
                '<div style="margin-top: 8px;">' +
                    (d.account_status === 'active'
                        ? '<button class="btn btn-outline-blue" data-driver="' + d.id + '" data-action="pause" style="margin-right: 8px;">Pause</button>'
                        : '<button class="btn btn-blue" data-driver="' + d.id + '" data-action="activate" style="margin-right: 8px;">Reactivate</button>') +
                    '<button class="btn btn-outline-blue" data-driver="' + d.id + '" data-action="ban">Ban / Cut profile</button>' +
                '</div>' +
            '</div>'
        );
    }).join('');

    driversCache.forEach(function (d) {
        const sel = document.getElementById('vehicleSelect-' + d.id);
        if (sel && d.vehicle_class) sel.value = d.vehicle_class;
    });

    el.querySelectorAll('button[data-action="save-profile"]').forEach(function (btn) {
        btn.addEventListener('click', function () { saveDriverProfile(btn.dataset.driver); });
    });
    el.querySelectorAll('button[data-action="approve"]').forEach(function (btn) {
        btn.addEventListener('click', function () { setDriverVerification(btn.dataset.driver, 'approved'); });
    });
    el.querySelectorAll('button[data-action="reject"]').forEach(function (btn) {
        btn.addEventListener('click', function () { setDriverVerification(btn.dataset.driver, 'rejected'); });
    });
    el.querySelectorAll('button[data-action="view-doc"]').forEach(function (btn) {
        btn.addEventListener('click', function () { viewDriverDoc(btn.dataset.doc); });
    });
    el.querySelectorAll('button[data-action="pause"]').forEach(function (btn) {
        btn.addEventListener('click', function () { setAccountStatus(btn.dataset.driver, 'paused'); });
    });
    el.querySelectorAll('button[data-action="activate"]').forEach(function (btn) {
        btn.addEventListener('click', function () { setAccountStatus(btn.dataset.driver, 'active'); });
    });
    el.querySelectorAll('button[data-action="ban"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (confirm('This will permanently ban the driver from receiving jobs. Continue?')) {
                setAccountStatus(btn.dataset.driver, 'banned');
            }
        });
    });
}

async function setDriverVerification(driverId, status) {
    const { error } = await supabase.from('profiles').update({ verification_status: status }).eq('id', driverId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    loadDrivers();
}

async function setAccountStatus(driverId, status) {
    const { error } = await supabase.from('profiles').update({ account_status: status }).eq('id', driverId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    loadDrivers();
}

async function viewDriverDoc(path) {
    const { data, error } = await supabase.storage.from('driver-docs').createSignedUrl(path, 300);
    if (error) { alert('Failed to open document: ' + error.message); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
}

async function saveDriverProfile(driverId) {
    const vehicleClass = document.getElementById('vehicleSelect-' + driverId).value;
    const fullName = document.getElementById('nameInput-' + driverId).value.trim();
    const phone = document.getElementById('phoneInput-' + driverId).value.trim();
    if (!fullName) { alert('Name cannot be empty'); return; }

    const { error } = await supabase.from('profiles').update({
        full_name: fullName,
        phone: phone,
        vehicle_class: vehicleClass || null,
    }).eq('id', driverId);
    if (error) { alert('Failed to save: ' + error.message); return; }
    loadDrivers();
}
