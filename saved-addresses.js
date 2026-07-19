let currentUser = null;
let allAddresses = [];
let editingId = null;
let miniMap = null;
let miniMarker = null;
let pendingLat = null, pendingLng = null;

const TYPE_LABELS = { home: 'Home', work: 'Work', business: 'Business', warehouse: 'Warehouse', family: 'Family', other: 'Other' };

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

async function reverseGeocode(lat, lng) {
    try {
        const res = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng);
        const data = await res.json();
        return data && data.display_name ? data.display_name : null;
    } catch (err) { return null; }
}

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('login.html');
    if (!currentUser) return;

    document.getElementById('addrSearch').addEventListener('input', renderGrid);
    document.getElementById('addAddrBtn').addEventListener('click', function () { openModal(null); });
    document.getElementById('emptyAddBtn').addEventListener('click', function () { openModal(null); });
    document.getElementById('cancelAddrBtn').addEventListener('click', closeModal);
    document.getElementById('saveAddrBtn').addEventListener('click', saveAddress);

    await loadAll();
});

async function loadAll() {
    const { data } = await supabase.from('saved_addresses').select('*').eq('customer_id', currentUser.id).order('created_at', { ascending: false });
    allAddresses = data || [];
    renderSummary();
    renderGrid();
}

function renderSummary() {
    const defaultPickup = allAddresses.find(function (a) { return a.is_default_pickup; });
    const defaultDropoff = allAddresses.find(function (a) { return a.is_default_dropoff; });
    document.getElementById('summaryCards').innerHTML =
        '<div class="summary-card"><div class="num">' + allAddresses.length + '</div><div class="lbl">Total Saved Addresses</div></div>' +
        '<div class="summary-card"><div class="num" style="font-size:14px;">' + (defaultPickup ? escapeHtml(defaultPickup.label) : '—') + '</div><div class="lbl">Default Pickup</div></div>' +
        '<div class="summary-card"><div class="num" style="font-size:14px;">' + (defaultDropoff ? escapeHtml(defaultDropoff.label) : '—') + '</div><div class="lbl">Default Delivery</div></div>';
}

function renderGrid() {
    const q = document.getElementById('addrSearch').value.trim().toLowerCase();
    const list = allAddresses.filter(function (a) {
        if (!q) return true;
        return (a.label || '').toLowerCase().includes(q) || (a.street || '').toLowerCase().includes(q) || (a.contact_person || '').toLowerCase().includes(q);
    });

    const grid = document.getElementById('addrGrid');
    const empty = document.getElementById('emptyState');
    if (!list.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    grid.innerHTML = list.map(function (a) {
        return '<div class="addr-card">' +
            '<div class="name">' + escapeHtml(a.label) +
                (a.is_default_pickup ? '<span class="default-badge">Default Pickup</span>' : '') +
                (a.is_default_dropoff ? '<span class="default-badge">Default Delivery</span>' : '') +
            '</div>' +
            '<div class="meta">' + escapeHtml(a.street) + (a.suburb ? ', ' + escapeHtml(a.suburb) : '') + (a.city ? ', ' + escapeHtml(a.city) : '') + '</div>' +
            (a.contact_person ? '<div class="meta">' + escapeHtml(a.contact_person) + (a.contact_phone ? ' · ' + escapeHtml(a.contact_phone) : '') + '</div>' : '') +
            '<div class="meta">' + TYPE_LABELS[a.address_type] + '</div>' +
            '<div class="addr-actions">' +
                '<button class="btn btn-outline-blue" style="width:auto;" data-action="edit" data-id="' + a.id + '">Edit</button>' +
                '<button class="btn btn-outline-blue" style="width:auto;" data-action="delete" data-id="' + a.id + '">Delete</button>' +
            '</div>' +
        '</div>';
    }).join('');

    grid.querySelectorAll('button[data-action="edit"]').forEach(function (btn) {
        btn.addEventListener('click', function () { openModal(allAddresses.find(function (a) { return a.id === btn.dataset.id; })); });
    });
    grid.querySelectorAll('button[data-action="delete"]').forEach(function (btn) {
        btn.addEventListener('click', function () { deleteAddress(btn.dataset.id); });
    });
}

function openModal(addr) {
    editingId = addr ? addr.id : null;
    document.getElementById('modalTitle').textContent = addr ? 'Edit Address' : 'Add Address';
    document.getElementById('fLabel').value = addr ? addr.label : '';
    document.getElementById('fType').value = addr ? addr.address_type : 'home';
    document.getElementById('fStreet').value = addr ? addr.street : '';
    document.getElementById('fSuburb').value = addr ? (addr.suburb || '') : '';
    document.getElementById('fCity').value = addr ? (addr.city || '') : '';
    document.getElementById('fProvince').value = addr ? (addr.province || '') : '';
    document.getElementById('fPostal').value = addr ? (addr.postal_code || '') : '';
    document.getElementById('fContactPerson').value = addr ? (addr.contact_person || '') : '';
    document.getElementById('fContactPhone').value = addr ? (addr.contact_phone || '') : '';
    document.getElementById('fContactEmail').value = addr ? (addr.contact_email || '') : '';
    document.getElementById('fNotes').value = addr ? (addr.notes || '') : '';
    document.getElementById('fDefaultPickup').checked = addr ? addr.is_default_pickup : false;
    document.getElementById('fDefaultDropoff').checked = addr ? addr.is_default_dropoff : false;
    document.getElementById('modalMsg').textContent = '';
    pendingLat = addr ? addr.lat : null;
    pendingLng = addr ? addr.lng : null;

    document.getElementById('addrModal').classList.add('open');

    setTimeout(function () {
        if (!miniMap) {
            miniMap = L.map('miniMap').setView([-29.6, 30.9], 8);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(miniMap);
            miniMap.on('click', async function (e) {
                pendingLat = e.latlng.lat;
                pendingLng = e.latlng.lng;
                if (!miniMarker) miniMarker = L.marker(e.latlng).addTo(miniMap);
                else miniMarker.setLatLng(e.latlng);
                const addrText = await reverseGeocode(pendingLat, pendingLng);
                if (addrText) document.getElementById('fStreet').value = addrText;
            });
        }
        miniMap.invalidateSize();
        if (pendingLat && pendingLng) {
            const pos = [pendingLat, pendingLng];
            if (!miniMarker) miniMarker = L.marker(pos).addTo(miniMap);
            else miniMarker.setLatLng(pos);
            miniMap.setView(pos, 14);
        } else {
            miniMap.setView([-29.6, 30.9], 8);
            if (miniMarker) { miniMap.removeLayer(miniMarker); miniMarker = null; }
        }
    }, 50);
}

function closeModal() {
    document.getElementById('addrModal').classList.remove('open');
}

async function saveAddress() {
    const label = document.getElementById('fLabel').value.trim();
    const street = document.getElementById('fStreet').value.trim();
    const msg = document.getElementById('modalMsg');
    if (!label || !street) { msg.textContent = 'Address Name and Street Address are required.'; return; }

    const isDefaultPickup = document.getElementById('fDefaultPickup').checked;
    const isDefaultDropoff = document.getElementById('fDefaultDropoff').checked;

    const fields = {
        customer_id: currentUser.id,
        label: label,
        address_type: document.getElementById('fType').value,
        street: street,
        suburb: document.getElementById('fSuburb').value.trim() || null,
        city: document.getElementById('fCity').value.trim() || null,
        province: document.getElementById('fProvince').value.trim() || null,
        postal_code: document.getElementById('fPostal').value.trim() || null,
        lat: pendingLat, lng: pendingLng,
        contact_person: document.getElementById('fContactPerson').value.trim() || null,
        contact_phone: document.getElementById('fContactPhone').value.trim() || null,
        contact_email: document.getElementById('fContactEmail').value.trim() || null,
        notes: document.getElementById('fNotes').value.trim() || null,
        is_default_pickup: isDefaultPickup,
        is_default_dropoff: isDefaultDropoff,
    };

    msg.textContent = 'Saving...';

    // Only one default pickup / default dropoff allowed — clear any existing one first.
    if (isDefaultPickup) await supabase.from('saved_addresses').update({ is_default_pickup: false }).eq('customer_id', currentUser.id);
    if (isDefaultDropoff) await supabase.from('saved_addresses').update({ is_default_dropoff: false }).eq('customer_id', currentUser.id);

    let error;
    if (editingId) {
        ({ error } = await supabase.from('saved_addresses').update(fields).eq('id', editingId));
    } else {
        ({ error } = await supabase.from('saved_addresses').insert(fields));
    }

    if (error) { msg.textContent = 'Could not save address. Please try again.'; return; }
    closeModal();
    await loadAll();
}

async function deleteAddress(id) {
    if (!confirm('Delete this saved address?')) return;
    await supabase.from('saved_addresses').delete().eq('id', id);
    await loadAll();
}
