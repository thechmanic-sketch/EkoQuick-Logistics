let currentUser = null;
let currentProfile = null;

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-ZA') : '—'; }
function downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
function downloadCsv(filename, rows) {
    const csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('login.html');
    if (!currentUser) return;

    document.getElementById('fDefaultVehicle').innerHTML = VEHICLES.map(function (v) {
        return '<option value="' + v.id + '">' + v.icon + ' ' + v.label + '</option>';
    }).join('');

    currentProfile = await getProfile(currentUser.id);
    if (currentProfile) fillForm(currentProfile);

    document.getElementById('avatarSaveBtn').addEventListener('click', saveAvatar);
    document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
    document.getElementById('changePasswordBtn').addEventListener('click', changePassword);
    document.getElementById('logoutAllBtn').addEventListener('click', async function () {
        await supabase.auth.signOut({ scope: 'global' });
        window.location.href = 'login.html';
    });
    document.getElementById('logoutBtn').addEventListener('click', async function () {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
    document.getElementById('downloadDataBtn').addEventListener('click', downloadMyData);
    document.getElementById('exportOrdersBtn').addEventListener('click', exportMyOrders);
    document.getElementById('requestDeleteBtn').addEventListener('click', requestAccountDeletion);

    await renderStats();
});

function fillForm(p) {
    document.getElementById('avatarPreview').src = p.avatar_url || '';
    document.getElementById('fFullName').value = p.full_name || '';
    document.getElementById('fPhone').value = p.phone || '';
    document.getElementById('fEmail').value = p.email || currentUser.email || '';
    document.getElementById('dateJoined').textContent = 'Date Joined: ' + formatDate(p.created_at);
    document.getElementById('customerId').textContent = 'Customer ID: ' + currentUser.id.slice(0, 8);

    document.getElementById('fEmergencyName').value = p.emergency_contact_name || '';
    document.getElementById('fEmergencyPhone').value = p.emergency_contact_phone || '';
    document.getElementById('fAlternateName').value = p.alternate_contact_name || '';
    document.getElementById('fAlternatePhone').value = p.alternate_contact_phone || '';

    document.getElementById('fDefaultVehicle').value = p.default_vehicle_class || VEHICLES[0].id;
    document.getElementById('fDefaultPayment').value = p.default_payment_method || 'cash';
    document.getElementById('fPreferredTime').value = p.preferred_delivery_time || '';

    document.getElementById('fLanguage').value = p.language || 'en';
    document.getElementById('fTimezone').value = p.timezone || 'Africa/Johannesburg';
    document.getElementById('fDateFormat').value = p.date_format || 'DD/MM/YYYY';
    document.getElementById('fTheme').value = p.theme_preference || 'dark';

    document.getElementById('notifAssigned').checked = p.notif_driver_assigned !== false;
    document.getElementById('notifNearPickup').checked = p.notif_driver_near_pickup !== false;
    document.getElementById('notifPickedUp').checked = p.notif_parcel_picked_up !== false;
    document.getElementById('notifNearDest').checked = p.notif_driver_near_destination !== false;
    document.getElementById('notifCompleted').checked = p.notif_delivery_completed !== false;
    document.getElementById('notifPromotions').checked = p.notif_promotions !== false;
    document.getElementById('notifSupportReplies').checked = p.notif_support_replies !== false;
}

async function saveAvatar() {
    const file = document.getElementById('avatarFile').files[0];
    if (!file) { alert('Choose a photo first'); return; }
    const path = currentUser.id + '/avatar-' + Date.now() + '.' + (file.name.split('.').pop() || 'jpg');
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    if (uploadError) { alert('Failed to upload: ' + uploadError.message); return; }
    const publicUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', currentUser.id);
    document.getElementById('avatarPreview').src = publicUrl;
}

async function saveProfile() {
    const msg = document.getElementById('profileMsg');
    const fields = {
        full_name: document.getElementById('fFullName').value.trim(),
        phone: document.getElementById('fPhone').value.trim(),
        emergency_contact_name: document.getElementById('fEmergencyName').value.trim() || null,
        emergency_contact_phone: document.getElementById('fEmergencyPhone').value.trim() || null,
        alternate_contact_name: document.getElementById('fAlternateName').value.trim() || null,
        alternate_contact_phone: document.getElementById('fAlternatePhone').value.trim() || null,
        default_vehicle_class: document.getElementById('fDefaultVehicle').value,
        default_payment_method: document.getElementById('fDefaultPayment').value,
        preferred_delivery_time: document.getElementById('fPreferredTime').value.trim() || null,
        language: document.getElementById('fLanguage').value,
        timezone: document.getElementById('fTimezone').value.trim() || 'Africa/Johannesburg',
        date_format: document.getElementById('fDateFormat').value,
        theme_preference: document.getElementById('fTheme').value,
        notif_driver_assigned: document.getElementById('notifAssigned').checked,
        notif_driver_near_pickup: document.getElementById('notifNearPickup').checked,
        notif_parcel_picked_up: document.getElementById('notifPickedUp').checked,
        notif_driver_near_destination: document.getElementById('notifNearDest').checked,
        notif_delivery_completed: document.getElementById('notifCompleted').checked,
        notif_promotions: document.getElementById('notifPromotions').checked,
        notif_support_replies: document.getElementById('notifSupportReplies').checked,
    };
    msg.textContent = 'Saving...';
    const { error } = await supabase.from('profiles').update(fields).eq('id', currentUser.id);
    msg.textContent = error ? 'Could not save: ' + error.message : 'Saved.';
}

async function changePassword() {
    const msg = document.getElementById('passwordMsg');
    const pw = document.getElementById('fNewPassword').value;
    if (!pw || pw.length < 6) { msg.textContent = 'Password must be at least 6 characters.'; return; }
    const { error } = await supabase.auth.updateUser({ password: pw });
    msg.textContent = error ? error.message : 'Password changed.';
    if (!error) document.getElementById('fNewPassword').value = '';
}

async function renderStats() {
    const { data: jobs } = await supabase.from('jobs').select('status, quote, rating').eq('customer_id', currentUser.id);
    const list = jobs || [];
    const completed = list.filter(function (j) { return j.status === 'delivered'; });
    const cancelled = list.filter(function (j) { return j.status === 'cancelled'; });
    const totalSpent = completed.reduce(function (s, j) { return s + Number(j.quote || 0); }, 0);
    const reviewsSubmitted = list.filter(function (j) { return j.rating; }).length;

    const { count: ticketCount } = await supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('customer_id', currentUser.id);

    document.getElementById('statsCards').innerHTML =
        '<div class="summary-card"><div class="num">' + list.length + '</div><div class="lbl">Lifetime Orders</div></div>' +
        '<div class="summary-card"><div class="num">' + completed.length + '</div><div class="lbl">Completed Orders</div></div>' +
        '<div class="summary-card"><div class="num">' + cancelled.length + '</div><div class="lbl">Cancelled Orders</div></div>' +
        '<div class="summary-card"><div class="num">R' + totalSpent.toLocaleString(undefined, { maximumFractionDigits: 0 }) + '</div><div class="lbl">Total Money Spent</div></div>' +
        '<div class="summary-card"><div class="num">' + reviewsSubmitted + '</div><div class="lbl">Reviews Submitted</div></div>' +
        '<div class="summary-card"><div class="num">' + (ticketCount || 0) + '</div><div class="lbl">Support Tickets</div></div>';
}

async function downloadMyData() {
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
    const { data: jobs } = await supabase.from('jobs').select('*').eq('customer_id', currentUser.id);
    const { data: addresses } = await supabase.from('saved_addresses').select('*').eq('customer_id', currentUser.id);
    const { data: tickets } = await supabase.from('support_tickets').select('*').eq('customer_id', currentUser.id);
    downloadJson('ekoquick-my-data.json', { profile: profile, orders: jobs, saved_addresses: addresses, support_tickets: tickets });
}

async function exportMyOrders() {
    const { data: jobs } = await supabase.from('jobs').select('*').eq('customer_id', currentUser.id).order('created_at', { ascending: false });
    const rows = [['Order ID', 'Pickup', 'Drop-off', 'Status', 'Fee', 'Payment Method', 'Payment Status', 'Created', 'Delivered']];
    (jobs || []).forEach(function (j) {
        rows.push([j.id, j.pickup, j.dropoff, j.status, j.quote, j.payment_method, j.payment_status, j.created_at, j.delivered_at]);
    });
    downloadCsv('ekoquick-my-orders.csv', rows);
}

async function requestAccountDeletion() {
    if (!confirm('This will open a support ticket requesting account deletion. Continue?')) return;
    const { data: ticket, error } = await supabase.from('support_tickets').insert({
        customer_id: currentUser.id,
        category: 'other',
        priority: 'high',
        subject: 'Account Deletion Request',
        description: 'Customer has requested deletion of their Ekoquick account and associated data.',
    }).select().single();
    if (!error && ticket) {
        await supabase.from('support_ticket_messages').insert({
            ticket_id: ticket.id, sender_type: 'customer', sender_name: 'You',
            message: 'I would like to request deletion of my account.',
        });
        alert('Your account deletion request has been submitted. Our team will contact you.');
    } else {
        alert('Could not submit request. Please try again.');
    }
}
