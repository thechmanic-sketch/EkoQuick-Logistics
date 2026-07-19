let currentUser = null;
let currentProfile = null;

function formatDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-ZA') : '—'; }
function expiryStatus(dateStr) {
    if (!dateStr) return 'No expiry date on file.';
    const days = Math.round((new Date(dateStr) - new Date()) / 86400000);
    if (days < 0) return 'Expired on ' + formatDate(dateStr) + '.';
    if (days <= 30) return 'Expires ' + formatDate(dateStr) + ' — ' + days + ' days left.';
    return 'Valid until ' + formatDate(dateStr) + '.';
}

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;
    currentProfile = await getProfile(currentUser.id);
    if (!currentProfile || currentProfile.role !== 'driver') { window.location.href = 'driver-login.html'; return; }

    document.getElementById('fVehicleClass').innerHTML = VEHICLES.map(function (v) {
        return '<option value="' + v.id + '">' + v.icon + ' ' + v.label + '</option>';
    }).join('');

    fillForm(currentProfile);

    document.getElementById('saveDetailsBtn').addEventListener('click', saveDetails);
    document.getElementById('uploadDocsBtn').addEventListener('click', uploadDocs);
});

function fillForm(p) {
    if (p.vehicle_photo_url) {
        const img = document.getElementById('vehiclePhotoPreview');
        img.src = p.vehicle_photo_url;
        img.classList.remove('hidden');
    }
    document.getElementById('fVehicleClass').value = p.vehicle_class || VEHICLES[0].id;
    document.getElementById('fMake').value = p.vehicle_make || '';
    document.getElementById('fModel').value = p.vehicle_model || '';
    document.getElementById('fYear').value = p.vehicle_year || '';
    document.getElementById('fColor').value = p.vehicle_color || '';
    document.getElementById('fReg').value = p.registration_number || '';
    document.getElementById('fVin').value = p.vehicle_vin || '';

    document.getElementById('fInsuranceExpiry').value = p.insurance_expiry || '';
    document.getElementById('insuranceStatus').textContent = expiryStatus(p.insurance_expiry);
    document.getElementById('fDiscExpiry').value = p.license_disc_expiry || '';
    document.getElementById('discStatus').textContent = expiryStatus(p.license_disc_expiry);
    document.getElementById('fRoadworthyExpiry').value = p.roadworthy_expiry || '';
    document.getElementById('roadworthyStatus').textContent = expiryStatus(p.roadworthy_expiry);
}

async function saveDetails() {
    const msg = document.getElementById('detailsMsg');
    const fields = {
        vehicle_class: document.getElementById('fVehicleClass').value,
        vehicle_make: document.getElementById('fMake').value.trim(),
        vehicle_model: document.getElementById('fModel').value.trim(),
        vehicle_year: document.getElementById('fYear').value.trim(),
        vehicle_color: document.getElementById('fColor').value.trim(),
        registration_number: document.getElementById('fReg').value.trim(),
        vehicle_vin: document.getElementById('fVin').value.trim() || null,
    };

    const photoFile = document.getElementById('vehiclePhotoFile').files[0];
    if (photoFile) {
        const path = currentUser.id + '/vehicle-' + Date.now() + '.' + (photoFile.name.split('.').pop() || 'jpg');
        const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, photoFile, { upsert: true });
        if (!uploadErr) fields.vehicle_photo_url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    }

    msg.textContent = 'Saving...';
    const { error } = await supabase.from('profiles').update(fields).eq('id', currentUser.id);
    msg.textContent = error ? 'Could not save: ' + error.message : 'Vehicle details saved.';
    if (!error) { currentProfile = Object.assign(currentProfile, fields); fillForm(currentProfile); }
}

async function uploadDocs() {
    const msg = document.getElementById('docsMsg');
    const fields = {
        insurance_expiry: document.getElementById('fInsuranceExpiry').value || null,
        license_disc_expiry: document.getElementById('fDiscExpiry').value || null,
        roadworthy_expiry: document.getElementById('fRoadworthyExpiry').value || null,
    };

    const insuranceFile = document.getElementById('insuranceFile').files[0];
    const discFile = document.getElementById('discFile').files[0];
    const roadworthyFile = document.getElementById('roadworthyFile').files[0];

    msg.textContent = 'Uploading...';
    try {
        if (insuranceFile) {
            const path = currentUser.id + '/insurance-' + Date.now() + '.' + (insuranceFile.name.split('.').pop() || 'jpg');
            const { error } = await supabase.storage.from('driver-docs').upload(path, insuranceFile, { upsert: true });
            if (error) throw error;
            fields.insurance_url = path;
        }
        if (discFile) {
            const path = currentUser.id + '/licencedisc-' + Date.now() + '.' + (discFile.name.split('.').pop() || 'jpg');
            const { error } = await supabase.storage.from('driver-docs').upload(path, discFile, { upsert: true });
            if (error) throw error;
            fields.license_disc_url = path;
        }
        if (roadworthyFile) {
            const path = currentUser.id + '/roadworthy-' + Date.now() + '.' + (roadworthyFile.name.split('.').pop() || 'jpg');
            const { error } = await supabase.storage.from('driver-docs').upload(path, roadworthyFile, { upsert: true });
            if (error) throw error;
            fields.roadworthy_url = path;
        }

        const { error } = await supabase.from('profiles').update(fields).eq('id', currentUser.id);
        if (error) throw error;
        msg.textContent = 'Documents updated.';
        currentProfile = Object.assign(currentProfile, fields);
        fillForm(currentProfile);
    } catch (err) {
        msg.textContent = 'Upload failed: ' + (err && err.message ? err.message : err);
    }
}
