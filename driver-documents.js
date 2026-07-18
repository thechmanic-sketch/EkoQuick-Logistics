let currentUser = null;

const VERIFICATION_LABELS = {
    pending: 'Pending review',
    approved: 'Approved',
    rejected: 'Rejected — please re-upload',
};

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;

    const profile = await getProfile(currentUser.id);
    if (!profile || profile.role !== 'driver') {
        await supabase.auth.signOut();
        window.location.href = 'driver-login.html';
        return;
    }

    const badge = document.getElementById('verificationBadge');
    badge.textContent = VERIFICATION_LABELS[profile.verification_status] || profile.verification_status;
    badge.className = 'badge ' + (profile.verification_status === 'approved' ? 'delivered' : profile.verification_status === 'rejected' ? 'cancelled' : 'pending');

    if (profile.avatar_url) {
        const preview = document.getElementById('avatarPreview');
        preview.src = profile.avatar_url;
        preview.classList.remove('hidden');
    }

    document.getElementById('verificationNote').textContent = profile.verification_status === 'approved'
        ? 'You are fully verified and can accept jobs.'
        : 'Re-uploading any document will reset your status to pending review.';

    document.getElementById('docsForm').addEventListener('submit', handleSubmit);
});

function showMsg(type, text) {
    document.getElementById('msgArea').innerHTML = '<div class="msg ' + type + '">' + text + '</div>';
}

async function uploadFile(bucket, path, file) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
    if (error) throw error;
    return path;
}

async function handleSubmit(e) {
    e.preventDefault();

    const avatarFile = document.getElementById('avatarFile').files[0];
    const licenseFile = document.getElementById('licenseFile').files[0];
    const idFile = document.getElementById('idFile').files[0];
    const vehicleRegFile = document.getElementById('vehicleRegFile').files[0];
    const insuranceFile = document.getElementById('insuranceFile').files[0];

    if (!avatarFile || !licenseFile || !idFile || !vehicleRegFile || !insuranceFile) {
        showMsg('error', 'Please choose all five files.');
        return;
    }

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Uploading...';

    try {
        const updates = { verification_status: 'pending' };

        const avatarPath = currentUser.id + '/avatar-' + Date.now() + '.' + (avatarFile.name.split('.').pop() || 'jpg');
        await uploadFile('avatars', avatarPath, avatarFile);
        updates.avatar_url = supabase.storage.from('avatars').getPublicUrl(avatarPath).data.publicUrl;

        updates.license_url = await uploadFile('driver-docs', currentUser.id + '/license-' + Date.now() + '.' + (licenseFile.name.split('.').pop() || 'jpg'), licenseFile);
        updates.id_doc_url = await uploadFile('driver-docs', currentUser.id + '/id-' + Date.now() + '.' + (idFile.name.split('.').pop() || 'jpg'), idFile);
        updates.vehicle_reg_url = await uploadFile('driver-docs', currentUser.id + '/vehiclereg-' + Date.now() + '.' + (vehicleRegFile.name.split('.').pop() || 'jpg'), vehicleRegFile);
        updates.insurance_url = await uploadFile('driver-docs', currentUser.id + '/insurance-' + Date.now() + '.' + (insuranceFile.name.split('.').pop() || 'jpg'), insuranceFile);

        const { error } = await supabase.from('profiles').update(updates).eq('id', currentUser.id);
        if (error) throw error;

        showMsg('success', 'Submitted! We\'ll review your documents shortly.');
        setTimeout(function () { window.location.href = 'driver-dashboard.html'; }, 1200);
    } catch (err) {
        showMsg('error', 'Upload failed: ' + (err && err.message ? err.message : err));
        btn.disabled = false;
        btn.textContent = 'Submit for review';
    }
}
